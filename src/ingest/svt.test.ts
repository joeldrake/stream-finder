import { describe, expect, it } from "vite-plus/test";
import { upsertCatalog } from "./catalog";
import {
  fetchSvtCatalog,
  ingestSvt,
  isAvailable,
  MIN_EXPECTED_TITLES,
  toCatalogRow,
  type SvtContent,
} from "./svt";
import { testD1 } from "./test-d1";

const NOW = new Date("2026-10-17T12:00:00Z");

function svt(overrides: Partial<SvtContent> = {}): SvtContent {
  return {
    svtId: "jnG14JK",
    name: "A Bucket of Blood",
    titleType: "Single",
    popularity: 85,
    numberOfActiveEpisodes: 0,
    urls: { svtplay: "/video/jnG14JK/a-bucket-of-blood" },
    image: { id: "53389885", changed: 1762954012 },
    productionYear: 1959,
    originalProgramTitle: "",
    validTo: "2027-01-12T23:59:00+01:00",
    ...overrides,
  };
}

function svtResponse(atillo: SvtContent[], indexer: SvtContent[] = []) {
  return (async () =>
    Response.json({
      data: { programAtillO: { flat: atillo }, allTitlesForSearchIndexer: indexer },
    })) as unknown as typeof fetch;
}

describe("isAvailable", () => {
  it("släpper igenom filmer som inte har gått ut", () => {
    expect(isAvailable(svt({ validTo: "2026-10-18T00:00:00Z" }), NOW)).toBe(true);
    expect(isAvailable(svt({ validTo: "2026-10-11T23:59:00+02:00" }), NOW)).toBe(false);
    expect(isAvailable(svt({ validTo: null }), NOW)).toBe(false);
  });

  it("kräver sändbara avsnitt för serier", () => {
    expect(isAvailable(svt({ titleType: "TvSeries", numberOfActiveEpisodes: 3 }), NOW)).toBe(true);
    expect(isAvailable(svt({ titleType: "TvSeries", numberOfActiveEpisodes: 0 }), NOW)).toBe(false);
  });
});

describe("toCatalogRow", () => {
  it("mappar en SVT-titel", () => {
    expect(toCatalogRow(svt())).toEqual({
      id: "svt:jnG14JK",
      kind: "movie",
      title: "A Bucket of Blood",
      originalTitle: null,
      year: 1959,
      popularity: 85,
      poster: "https://www.svtstatic.se/image/custom/400/53389885/1762954012",
      tmdbId: null,
      svtId: "jnG14JK",
      url: "https://www.svtplay.se/video/jnG14JK/a-bucket-of-blood",
      validTo: "2027-01-12T23:59:00+01:00",
    });
  });

  it("behåller bara originaltitel som skiljer sig från namnet", () => {
    const name = "Aalto: Känslornas arkitekt";
    expect(toCatalogRow(svt({ name, originalProgramTitle: "Aalto - Architect of emotions" })).originalTitle).toBe(
      "Aalto - Architect of emotions",
    );
    expect(toCatalogRow(svt({ originalProgramTitle: "A Bucket of Blood" })).originalTitle).toBeNull();
  });

  it("gör serier till series och klarar saknade fält", () => {
    const row = toCatalogRow(
      svt({ titleType: "KidsTvShow", image: null, productionYear: undefined, validTo: undefined }),
    );
    expect(row).toMatchObject({ kind: "series", poster: null, year: null, validTo: null });
  });
});

describe("fetchSvtCatalog", () => {
  it("slår ihop listorna och låter A–Ö vinna", async () => {
    const items = await fetchSvtCatalog(
      svtResponse([svt({ svtId: "a", name: "Från A–Ö" })], [svt({ svtId: "a", name: "Från index" }), svt({ svtId: "b" })]),
    );
    expect(items.map((i) => [i.svtId, i.name])).toEqual([
      ["a", "Från A–Ö"],
      ["b", "A Bucket of Blood"],
    ]);
  });

  it("kastar vid GraphQL-fel", async () => {
    const failing = (async () => Response.json({ errors: [{ message: "Boom" }] })) as unknown as typeof fetch;
    await expect(fetchSvtCatalog(failing)).rejects.toThrow("Boom");
  });
});

describe("upsertCatalog", () => {
  it("behåller first_seen och tmdb_id men uppdaterar resten", async () => {
    const { db, d1 } = testD1();
    await upsertCatalog(d1, "svt", [toCatalogRow(svt())], "2026-10-16T04:00:00.000Z");
    db.exec("UPDATE titles SET tmdb_id = 42");

    await upsertCatalog(
      d1,
      "svt",
      [toCatalogRow(svt({ name: "Nytt namn", validTo: "2027-02-01T00:00:00Z" }))],
      "2026-10-17T04:00:00.000Z",
    );

    expect(db.prepare("SELECT title, tmdb_id, svt_id FROM titles").all()).toEqual([
      { title: "Nytt namn", tmdb_id: 42, svt_id: "jnG14JK" },
    ]);
    expect(db.prepare("SELECT service, valid_to, first_seen, last_seen FROM availability").all()).toEqual([
      {
        service: "svt",
        valid_to: "2027-02-01T00:00:00Z",
        first_seen: "2026-10-16T04:00:00.000Z",
        last_seen: "2026-10-17T04:00:00.000Z",
      },
    ]);
  });

  it("delar upp stora mängder i flera chunkar", async () => {
    const { db, d1 } = testD1();
    const rows = Array.from({ length: 2500 }, (_, i) => toCatalogRow(svt({ svtId: `id${i}` })));
    await upsertCatalog(d1, "svt", rows, NOW.toISOString());
    expect(db.prepare("SELECT count(*) AS n FROM availability").get()).toEqual({ n: 2500 });
  });
});

describe("ingestSvt", () => {
  it("skriver bara tillgängliga titlar", async () => {
    const { db, d1 } = testD1();
    const live = Array.from({ length: MIN_EXPECTED_TITLES }, (_, i) => svt({ svtId: `live${i}` }));
    const expired = svt({ svtId: "gammal", validTo: "2025-01-31T23:59:00+01:00" });

    const result = await ingestSvt(d1, NOW, svtResponse([...live, expired]));

    expect(result).toEqual({ fetched: MIN_EXPECTED_TITLES + 1, available: MIN_EXPECTED_TITLES });
    expect(db.prepare("SELECT count(*) AS n FROM titles WHERE id = 'svt:gammal'").get()).toEqual({ n: 0 });
  });

  it("skriver ingenting när SVT ger misstänkt få titlar", async () => {
    const { db, d1 } = testD1();
    await expect(ingestSvt(d1, NOW, svtResponse([svt()]))).rejects.toThrow("Inget skrevs");
    expect(db.prepare("SELECT count(*) AS n FROM titles").get()).toEqual({ n: 0 });
  });
});
