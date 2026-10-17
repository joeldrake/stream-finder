import { describe, expect, it, vi } from "vite-plus/test";
import type { CatalogIndex } from "../catalog/format";
import { loadCatalog, type CachedCatalog, type CatalogSource, type CatalogStore } from "./catalog-cache";

const OLD: CatalogIndex = { version: "old", items: [] };
const NEW: CatalogIndex = { version: "new", items: [] };

function memoryStore(initial: CachedCatalog | null = null) {
  const state = { entry: initial };
  const store: CatalogStore = {
    read: async () => state.entry,
    write: async (e) => {
      state.entry = e;
    },
  };
  return { store, state };
}

function collect() {
  const seen: [string, CatalogSource][] = [];
  return { seen, onIndex: (i: CatalogIndex, s: CatalogSource) => void seen.push([i.version, s]) };
}

const respond = (res: Response) => vi.fn(async (_url: string, _init?: RequestInit) => res) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("loadCatalog", () => {
  it("hämtar och sparar katalogen första gången", async () => {
    const { store, state } = memoryStore();
    const { seen, onIndex } = collect();
    const fetchFn = respond(new Response(JSON.stringify(NEW), { headers: { etag: '"v2"' } }));

    await loadCatalog(onIndex, store, fetchFn);

    expect(seen).toEqual([["new", "network"]]);
    expect(state.entry).toEqual({ etag: '"v2"', json: JSON.stringify(NEW) });
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: {} });
  });

  it("visar cachen direkt och nöjer sig med 304", async () => {
    const { store } = memoryStore({ etag: '"v1"', json: JSON.stringify(OLD) });
    const { seen, onIndex } = collect();
    const fetchFn = respond(new Response(null, { status: 304 }));

    await loadCatalog(onIndex, store, fetchFn);

    expect(seen).toEqual([["old", "cache"]]);
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ headers: { "if-none-match": '"v1"' } });
  });

  it("byter till en ny version när servern har en", async () => {
    const { store, state } = memoryStore({ etag: '"v1"', json: JSON.stringify(OLD) });
    const { seen, onIndex } = collect();

    await loadCatalog(onIndex, store, respond(new Response(JSON.stringify(NEW), { headers: { etag: '"v2"' } })));

    expect(seen).toEqual([
      ["old", "cache"],
      ["new", "network"],
    ]);
    expect(state.entry?.etag).toBe('"v2"');
  });

  it("klarar sig offline med cache men kastar utan", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const cached = collect();
    await loadCatalog(cached.onIndex, memoryStore({ etag: '"v1"', json: JSON.stringify(OLD) }).store, offline);
    expect(cached.seen).toEqual([["old", "cache"]]);

    await expect(loadCatalog(collect().onIndex, memoryStore().store, offline)).rejects.toThrow("Failed to fetch");
  });

  it("faller tillbaka på nätet när lagringen inte fungerar", async () => {
    const broken: CatalogStore = {
      read: async () => {
        throw new Error("blocked");
      },
      write: async () => {
        throw new Error("blocked");
      },
    };
    const { seen, onIndex } = collect();
    await loadCatalog(onIndex, broken, respond(new Response(JSON.stringify(NEW), { headers: { etag: '"v2"' } })));
    expect(seen).toEqual([["new", "network"]]);
  });
});
