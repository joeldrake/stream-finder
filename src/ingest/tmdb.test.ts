import { describe, expect, it, vi } from "vite-plus/test";
import { testD1 } from "./test-d1";
import {
  planTmdbPages,
  processTmdbPages,
  toCatalogRow,
  type PageMessage,
  type TmdbPageMessage,
  type TmdbResult,
} from "./tmdb";

const SEEN_AT = "2026-10-17T04:15:00.000Z";

const dune: TmdbResult = {
  id: 438631,
  title: "Dune",
  original_title: "Dune",
  release_date: "2021-09-15",
  popularity: 120.5,
  poster_path: "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
};

// Svarar som TMDB:s discover; `pages` styr total_pages per tjänst+typ.
function fakeTmdb(pages: Record<string, number> = {}, results: TmdbResult[] = [dune]) {
  return vi.fn(async (req: Request) => {
    const url = new URL(req.url);
    const key = `${url.searchParams.get("with_watch_providers")}/${url.pathname.split("/").pop()}`;
    return Response.json({
      page: Number(url.searchParams.get("page")),
      total_pages: pages[key] ?? 1,
      total_results: (pages[key] ?? 1) * 20,
      results,
    });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function message(body: Partial<TmdbPageMessage> = {}) {
  return {
    body: { service: "hbomax", kind: "movie", page: 1, seenAt: SEEN_AT, ...body },
    ack: vi.fn<PageMessage["ack"]>(),
    retry: vi.fn<PageMessage["retry"]>(),
  } satisfies PageMessage;
}

describe("toCatalogRow", () => {
  it("mappar en film", () => {
    expect(toCatalogRow(dune, "movie")).toEqual({
      id: "tmdb:movie:438631",
      kind: "movie",
      title: "Dune",
      originalTitle: null,
      year: 2021,
      popularity: 120.5,
      poster: "https://image.tmdb.org/t/p/w342/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
      tmdbId: 438631,
      svtId: null,
      url: null,
      validTo: null,
    });
  });

  it("mappar en serie med svensk titel och utan datum och poster", () => {
    const row = toCatalogRow(
      { id: 1, name: "Dalmatinervägen 101", original_name: "101 Dalmatian Street", first_air_date: "", poster_path: null },
      "tv",
    );
    expect(row).toMatchObject({
      id: "tmdb:tv:1",
      kind: "series",
      title: "Dalmatinervägen 101",
      originalTitle: "101 Dalmatian Street",
      year: null,
      poster: null,
    });
  });
});

describe("planTmdbPages", () => {
  it("ger ett meddelande per sida och tjänst+typ", async () => {
    const fetchFn = fakeTmdb({ "8/movie": 3, "337/tv": 2 });
    const messages = await planTmdbPages("key", SEEN_AT, fetchFn);

    expect(messages).toHaveLength(3 + 1 + 1 + 2 + 1 + 1); // netflix, disney, hbomax × movie/tv
    expect(messages.filter((m) => m.service === "netflix" && m.kind === "movie").map((m) => m.page)).toEqual([1, 2, 3]);
    expect(messages.every((m) => m.seenAt === SEEN_AT)).toBe(true);
  });

  it("stannar vid TMDB:s gräns på 500 sidor", async () => {
    const messages = await planTmdbPages("key", SEEN_AT, fakeTmdb({ "8/movie": 620 }));
    expect(messages.filter((m) => m.service === "netflix" && m.kind === "movie")).toHaveLength(500);
  });

  it("skickar v3-nyckel som parameter och v4-token som Bearer", async () => {
    const v3 = fakeTmdb();
    await planTmdbPages("abc123", SEEN_AT, v3);
    const v3req = v3.mock.calls[0][0] as Request;
    expect(new URL(v3req.url).searchParams.get("api_key")).toBe("abc123");
    expect(v3req.headers.get("authorization")).toBeNull();

    const v4 = fakeTmdb();
    await planTmdbPages("eyJtoken", SEEN_AT, v4);
    const v4req = v4.mock.calls[0][0] as Request;
    expect(new URL(v4req.url).searchParams.get("api_key")).toBeNull();
    expect(v4req.headers.get("authorization")).toBe("Bearer eyJtoken");
  });
});

describe("processTmdbPages", () => {
  it("sparar titlar per tjänst och kvitterar sidorna", async () => {
    const { db, d1 } = testD1();
    const msgs = [message({ service: "hbomax" }), message({ service: "netflix", page: 2 })];

    await processTmdbPages(d1, "key", msgs, fakeTmdb());

    expect(db.prepare("SELECT title_id, service, last_seen FROM availability ORDER BY service").all()).toEqual([
      { title_id: "tmdb:movie:438631", service: "hbomax", last_seen: SEEN_AT },
      { title_id: "tmdb:movie:438631", service: "netflix", last_seen: SEEN_AT },
    ]);
    expect(db.prepare("SELECT count(*) AS n FROM titles").get()).toEqual({ n: 1 });
    expect(msgs.every((m) => m.ack.mock.calls.length === 1)).toBe(true);
  });

  it("klarar samma titel två gånger i en batch", async () => {
    const { db, d1 } = testD1();
    await processTmdbPages(d1, "key", [message({ page: 1 }), message({ page: 2 })], fakeTmdb({}, [dune, dune]));
    expect(db.prepare("SELECT count(*) AS n FROM availability").get()).toEqual({ n: 1 });
  });

  it("försöker misslyckade sidor igen och kvitterar resten", async () => {
    const { db, d1 } = testD1();
    const ok = fakeTmdb();
    const flaky = (async (req: Request) =>
      new URL(req.url).searchParams.get("page") === "2"
        ? new Response("slow down", { status: 429 })
        : ok(req)) as typeof fetch;
    const [good, limited] = [message({ page: 1 }), message({ page: 2 })];

    await processTmdbPages(d1, "key", [good, limited], flaky);

    expect(good.ack).toHaveBeenCalledOnce();
    expect(limited.ack).not.toHaveBeenCalled();
    expect(limited.retry).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(db.prepare("SELECT count(*) AS n FROM titles").get()).toEqual({ n: 1 });
  });
});
