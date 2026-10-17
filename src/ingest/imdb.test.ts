import { describe, expect, it, vi } from "vite-plus/test";
import { isAuthorized } from "../admin-auth";
import { upsertCatalog, type CatalogRow } from "./catalog";
import {
  applyRatings,
  isImdbRating,
  keysToLookup,
  listImdbIds,
  processImdbIdMessages,
  type ImdbIdMessage,
} from "./imdb";
import { testD1 } from "./test-d1";

const NOW = new Date("2026-10-17T04:45:00Z");

function tmdbRow(id: string): CatalogRow {
  return {
    id,
    kind: id.includes(":tv:") ? "series" : "movie",
    title: id,
    originalTitle: null,
    year: null,
    popularity: 1,
    poster: null,
    tmdbId: Number(id.split(":")[2]),
    svtId: null,
    url: null,
    validTo: null,
  };
}

async function seed() {
  const { db, d1 } = testD1();
  await upsertCatalog(d1, "netflix", [tmdbRow("tmdb:movie:1"), tmdbRow("tmdb:tv:2")], NOW.toISOString());
  // En SVT-titel matchad mot en TMDB-titel som inte finns på någon annan tjänst.
  db.exec(`INSERT INTO svt_matches (svt_id, tmdb_kind, tmdb_id, checked_at) VALUES ('s1', 'tv', 3, '${NOW.toISOString()}')`);
  return { db, d1 };
}

// Svarar som TMDB:s /{kind}/{id}/external_ids.
function fakeExternalIds(byPath: Record<string, string | null>) {
  return (async (req: Request) => {
    const path = new URL(req.url).pathname.replace("/3", "").replace("/external_ids", "");
    return Response.json({ imdb_id: byPath[path] ?? null });
  }) as unknown as typeof fetch;
}

describe("keysToLookup", () => {
  it("tar med både TMDB-titlar och SVT-matchningar som inte slagits upp", async () => {
    const { db, d1 } = await seed();
    expect((await keysToLookup(d1, NOW)).sort()).toEqual(["tmdb:movie:1", "tmdb:tv:2", "tmdb:tv:3"]);

    db.exec(`INSERT INTO imdb_ratings (tmdb_key, imdb_id, checked_at) VALUES
      ('tmdb:movie:1', 'tt1', '2026-01-01T00:00:00Z'),
      ('tmdb:tv:2', NULL, '2026-10-10T00:00:00Z'),
      ('tmdb:tv:3', NULL, '2026-09-01T00:00:00Z')`);
    // Funna id slås aldrig upp igen; saknade efter 30 dagar.
    expect(await keysToLookup(d1, NOW)).toEqual(["tmdb:tv:3"]);
  });
});

describe("processImdbIdMessages", () => {
  it("sparar IMDb-id, även när det saknas, och kvitterar", async () => {
    const { db, d1 } = await seed();
    const msg = {
      body: { keys: await keysToLookup(d1, NOW) },
      ack: vi.fn<ImdbIdMessage["ack"]>(),
      retry: vi.fn<ImdbIdMessage["retry"]>(),
    };
    await processImdbIdMessages(d1, "key", [msg], NOW, fakeExternalIds({ "/movie/1": "tt0001", "/tv/3": "tt0003" }));

    expect(db.prepare("SELECT tmdb_key, imdb_id FROM imdb_ratings ORDER BY tmdb_key").all()).toEqual([
      { tmdb_key: "tmdb:movie:1", imdb_id: "tt0001" },
      { tmdb_key: "tmdb:tv:2", imdb_id: null },
      { tmdb_key: "tmdb:tv:3", imdb_id: "tt0003" },
    ]);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(await listImdbIds(d1)).toEqual(["tt0001", "tt0003"]);
  });
});

describe("applyRatings", () => {
  it("uppdaterar betyg för alla titlar med samma IMDb-id och ignorerar okända", async () => {
    const { db, d1 } = testD1();
    db.exec(`INSERT INTO imdb_ratings (tmdb_key, imdb_id, checked_at) VALUES
      ('tmdb:movie:1', 'tt0001', 'x'), ('tmdb:tv:9', 'tt0001', 'x'), ('tmdb:movie:2', 'tt0002', 'x')`);

    await applyRatings(d1, [["tt0001", 8.1, 1200], ["tt9999", 5, 10]], NOW.toISOString());

    expect(db.prepare("SELECT tmdb_key, rating, votes, rated_at FROM imdb_ratings ORDER BY tmdb_key").all()).toEqual([
      { tmdb_key: "tmdb:movie:1", rating: 8.1, votes: 1200, rated_at: NOW.toISOString() },
      { tmdb_key: "tmdb:movie:2", rating: null, votes: null, rated_at: null },
      { tmdb_key: "tmdb:tv:9", rating: 8.1, votes: 1200, rated_at: NOW.toISOString() },
    ]);
  });
});

describe("isImdbRating", () => {
  it("godtar bara [ttId, 0–10, heltal ≥ 0]", () => {
    expect(isImdbRating(["tt0111161", 9.3, 3000000])).toBe(true);
    expect(isImdbRating(["0111161", 9.3, 1])).toBe(false);
    expect(isImdbRating(["tt1", 11, 1])).toBe(false);
    expect(isImdbRating(["tt1", 5, 1.5])).toBe(false);
    expect(isImdbRating(["tt1", "5", 1])).toBe(false);
  });
});

describe("isAuthorized", () => {
  const token = "a".repeat(64);
  it("kräver rätt Bearer-token", () => {
    expect(isAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(isAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(isAuthorized(token, token)).toBe(false);
    expect(isAuthorized(undefined, token)).toBe(false);
  });

  it("vägrar när token saknas eller är för kort", () => {
    expect(isAuthorized("Bearer ", "")).toBe(false);
    expect(isAuthorized("Bearer kort", "kort")).toBe(false);
  });
});
