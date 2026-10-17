import { describe, expect, it } from "vite-plus/test";
import { createCatalogSearch } from "../search/catalog-search";
import { mergeCatalog, type CatalogRowWithMatch } from "./build";
import { compressPoster, expandPoster, servicesOf } from "./format";

const V = "2026-10-17T05:00:00.000Z";

function row(overrides: Partial<CatalogRowWithMatch>): CatalogRowWithMatch {
  return {
    id: "tmdb:movie:1",
    kind: "movie",
    title: "Titel",
    originalTitle: null,
    year: 2020,
    popularity: 10,
    poster: null,
    services: "netflix",
    svtUrl: null,
    matchKind: null,
    matchId: null,
    matchTitle: null,
    matchOriginalTitle: null,
    matchYear: null,
    matchPoster: null,
    matchPopularity: null,
    ...overrides,
  };
}

describe("mergeCatalog", () => {
  it("lägger SVT till en TMDB-titel som redan finns i katalogen", () => {
    const { items } = mergeCatalog(
      [
        row({ id: "tmdb:tv:7", kind: "series", title: "Änglamakerskan", services: "netflix,hbomax" }),
        row({
          id: "svt:abc",
          kind: "series",
          title: "Änglamakerskan",
          year: null,
          services: "svt",
          svtUrl: "https://www.svtplay.se/anglamakerskan",
          matchKind: "tv",
          matchId: 7,
        }),
      ],
      V,
    );
    expect(items).toHaveLength(1);
    const [id, , , , series, , services, , svtPath] = items[0];
    expect([id, series, servicesOf(services), svtPath]).toEqual([
      "tmdb:tv:7",
      1,
      ["svt", "netflix", "hbomax"],
      "/anglamakerskan",
    ]);
  });

  it("ger en matchad SVT-titel utanför katalogen TMDB:s affisch och år", () => {
    const { items } = mergeCatalog(
      [
        row({
          id: "svt:abc",
          kind: "series",
          title: "Macklean",
          year: null,
          popularity: 20,
          poster: "https://www.svtstatic.se/image/custom/400/1/2",
          services: "svt",
          svtUrl: "https://www.svtplay.se/macklean",
          matchKind: "tv",
          matchId: 5,
          matchYear: 1993,
          matchPoster: "https://image.tmdb.org/t/p/w342/m.jpg",
          matchPopularity: 2,
        }),
      ],
      V,
    );
    expect(items[0]).toEqual(["tmdb:tv:5", "Macklean", "", 1993, 1, 2, 1, "t/m.jpg", "/macklean"]);
  });

  it("behåller omatchade SVT-titlar med SVT:s bild och halverad popularitet", () => {
    const { items } = mergeCatalog(
      [
        row({
          id: "svt:xyz",
          title: "Svenska nyheter",
          kind: "series",
          popularity: 80,
          poster: "https://www.svtstatic.se/image/custom/400/1/2",
          services: "svt",
        }),
      ],
      V,
    );
    expect(items[0]).toMatchObject(["svt:xyz", "Svenska nyheter", "", 2020, 1, 40, 1, "s1/2", ""]);
  });

  it("samlar alternativa titlar utan dubbletter av huvudtiteln", () => {
    const { items } = mergeCatalog(
      [row({ title: "Paw Patrol: Redo, Rejsa, Rädda", originalTitle: "PAW Patrol: Ready Race Rescue" })],
      V,
    );
    expect(items[0][2]).toBe("PAW Patrol: Ready Race Rescue");
  });
});

describe("posterkomprimering", () => {
  it("går fram och tillbaka", () => {
    for (const url of ["https://image.tmdb.org/t/p/w342/a.jpg", "https://www.svtstatic.se/image/custom/400/1/2", "https://example.com/x.png"]) {
      expect(expandPoster(compressPoster(url))).toBe(url);
    }
    expect(expandPoster(compressPoster(null))).toBeNull();
  });
});

describe("createCatalogSearch", () => {
  const search = createCatalogSearch(
    mergeCatalog(
      [
        row({ id: "tmdb:movie:1", title: "Dune", popularity: 100 }),
        row({ id: "tmdb:movie:2", title: "Dude", popularity: 100 }),
        row({ id: "tmdb:movie:3", title: "Interstellar" }),
        row({ id: "tmdb:movie:4", title: "Sällskapsresan" }),
      ],
      V,
    ),
  );

  it("söker först från två tecken", () => {
    expect(search.search("d")).toEqual([]);
    expect(search.search("du").map((h) => h.title).sort()).toEqual(["Dude", "Dune"]);
  });

  it("tolererar inte stavfel i korta ord men väl i långa", () => {
    expect(search.search("dune").map((h) => h.title)).toEqual(["Dune"]);
    expect(search.search("intersteller").map((h) => h.title)).toEqual(["Interstellar"]);
  });

  it("bortser från å, ä och ö", () => {
    expect(search.search("sallskap").map((h) => h.title)).toEqual(["Sällskapsresan"]);
  });
});
