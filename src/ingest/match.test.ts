import { describe, expect, it, vi } from "vite-plus/test";
import { upsertCatalog } from "./catalog";
import {
  findTmdbMatch,
  normalizeTitle,
  pickMatch,
  processMatchMessages,
  titlesToMatch,
  type MatchMessage,
  type SvtMatchInput,
} from "./match";
import { testD1 } from "./test-d1";
import type { TmdbResult } from "./tmdb";

const NOW = new Date("2026-10-17T04:30:00Z");

const film: SvtMatchInput = {
  svtId: "jnG14JK",
  kind: "movie",
  title: "En hink med blod",
  originalTitle: "A Bucket of Blood",
  year: 1959,
};
const serie: SvtMatchInput = { svtId: "KMdJNoE", kind: "series", title: "Macklean", originalTitle: null, year: null };

// Svarar på TMDB-sökningar utifrån query-parametern.
function fakeSearch(byQuery: Record<string, TmdbResult[]>) {
  return vi.fn(async (req: Request) => {
    const query = new URL(req.url).searchParams.get("query") ?? "";
    return Response.json({ results: byQuery[query] ?? [] });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("normalizeTitle", () => {
  it("bortser från skiljetecken, versaler och diakritiska tecken", () => {
    expect(normalizeTitle("Kriminalarkivet: Lasermannen")).toBe(normalizeTitle("Kriminalarkivet - Lasermannen"));
    expect(normalizeTitle("Bolibompa: Drakens sångstund")).toBe(normalizeTitle("Bolibompa: Drakens Sångstund"));
    expect(normalizeTitle("Älvar")).toBe("alvar");
  });
});

describe("pickMatch", () => {
  it("kräver samma titel och år ±1 för filmer", () => {
    const right: TmdbResult = { id: 1, title: "A Bucket of Blood", release_date: "1959-10-21" };
    const remake: TmdbResult = { id: 2, title: "A Bucket of Blood", release_date: "1995-06-01" };
    expect(pickMatch(film, "A Bucket of Blood", [remake, right])?.id).toBe(1);
    expect(pickMatch(film, "A Bucket of Blood", [remake])).toBeNull();
  });

  it("matchar på originaltitel också", () => {
    const hit: TmdbResult = { id: 3, title: "Paw Patrol: Redo, Rejsa, Rädda", original_title: "PAW Patrol: Ready Race Rescue", release_date: "2019-01-01" };
    expect(pickMatch({ ...film, year: 2019 }, "PAW Patrol: Ready Race Rescue", [hit])?.id).toBe(3);
  });

  it("matchar serier på titel utan år", () => {
    expect(pickMatch(serie, "Macklean", [{ id: 4, name: "Mackan" }, { id: 5, name: "Macklean" }])?.id).toBe(5);
  });
});

describe("findTmdbMatch", () => {
  it("söker originaltitel först och faller tillbaka på svensk titel", async () => {
    const fetchFn = fakeSearch({
      "En hink med blod": [{ id: 9, title: "En hink med blod", release_date: "1959-01-01", poster_path: "/p.jpg", popularity: 3 }],
    });
    const match = await findTmdbMatch("key", film, fetchFn);

    expect(fetchFn.mock.calls.map((c) => new URL((c[0] as Request).url).searchParams.get("query"))).toEqual([
      "A Bucket of Blood",
      "En hink med blod",
    ]);
    expect(match).toEqual({
      svtId: "jnG14JK",
      tmdbKind: "movie",
      tmdbId: 9,
      title: "En hink med blod",
      originalTitle: null,
      year: 1959,
      poster: "https://image.tmdb.org/t/p/w342/p.jpg",
      popularity: 3,
    });
  });

  it("söker serier i /search/tv och ger tom matchning utan träff", async () => {
    const fetchFn = fakeSearch({});
    const match = await findTmdbMatch("key", serie, fetchFn);
    expect(new URL((fetchFn.mock.calls[0][0] as Request).url).pathname).toBe("/3/search/tv");
    expect(match).toMatchObject({ svtId: "KMdJNoE", tmdbId: null, tmdbKind: null });
  });
});

describe("titlesToMatch och processMatchMessages", () => {
  async function seed() {
    const { db, d1 } = testD1();
    const row = (svtId: string, title: string) => ({
      id: `svt:${svtId}`,
      kind: "series" as const,
      title,
      originalTitle: null,
      year: null,
      popularity: 1,
      poster: null,
      tmdbId: null,
      svtId,
      url: null,
      validTo: null,
    });
    await upsertCatalog(d1, "svt", [row("a", "Macklean"), row("b", "Okänd"), row("c", "Gammal miss")], NOW.toISOString());
    return { db, d1 };
  }

  it("söker bara osökta titlar och omatchade äldre än 30 dagar", async () => {
    const { db, d1 } = await seed();
    db.exec(`INSERT INTO svt_matches (svt_id, checked_at) VALUES ('b', '2026-10-10T00:00:00Z'), ('c', '2026-09-01T00:00:00Z')`);
    expect((await titlesToMatch(d1, NOW)).map((t) => t.svtId).sort()).toEqual(["a", "c"]);
  });

  it("sparar både träffar och missar och kvitterar meddelandet", async () => {
    const { db, d1 } = await seed();
    const msg = {
      body: { titles: await titlesToMatch(d1, NOW) },
      ack: vi.fn<MatchMessage["ack"]>(),
      retry: vi.fn<MatchMessage["retry"]>(),
    };
    await processMatchMessages(d1, "key", [msg], NOW, fakeSearch({ Macklean: [{ id: 5, name: "Macklean" }] }));

    expect(db.prepare("SELECT svt_id, tmdb_kind, tmdb_id FROM svt_matches ORDER BY svt_id").all()).toEqual([
      { svt_id: "a", tmdb_kind: "tv", tmdb_id: 5 },
      { svt_id: "b", tmdb_kind: null, tmdb_id: null },
      { svt_id: "c", tmdb_kind: null, tmdb_id: null },
    ]);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(await titlesToMatch(d1, NOW)).toEqual([]);
  });

  it("sparar ingenting för ett meddelande som misslyckas", async () => {
    const { db, d1 } = await seed();
    const msg = {
      body: { titles: await titlesToMatch(d1, NOW) },
      ack: vi.fn<MatchMessage["ack"]>(),
      retry: vi.fn<MatchMessage["retry"]>(),
    };
    const limited = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await processMatchMessages(d1, "key", [msg], NOW, limited);

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(db.prepare("SELECT count(*) AS n FROM svt_matches").get()).toEqual({ n: 0 });
  });
});
