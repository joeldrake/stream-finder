import type { CatalogIndex } from "../catalog/format";

export interface CachedCatalog {
  etag: string;
  json: string;
}

export interface CatalogStore {
  read(): Promise<CachedCatalog | null>;
  write(entry: CachedCatalog): Promise<void>;
}

export type CatalogSource = "cache" | "network";

// Visar den sparade katalogen direkt och hämtar sedan en eventuell ny version
// i bakgrunden. onIndex anropas en gång per katalog som blir tillgänglig:
// först från cachen (om den finns), sedan från nätet om servern har en nyare.
export async function loadCatalog(
  onIndex: (index: CatalogIndex, source: CatalogSource) => void,
  store: CatalogStore,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  // IndexedDB kan saknas eller kasta (privat läge, blockerad lagring).
  const cached = await store.read().catch(() => null);
  if (cached) onIndex(JSON.parse(cached.json) as CatalogIndex, "cache");

  let res: Response;
  try {
    res = await fetchFn("/api/catalog", {
      // no-store: vi sköter cachningen själva, och 304 ska nå hit.
      cache: "no-store",
      headers: cached ? { "if-none-match": cached.etag } : {},
    });
  } catch (error) {
    if (cached) return; // Offline: den sparade katalogen räcker.
    throw error;
  }

  if (res.status === 304) return;
  if (!res.ok) {
    if (cached) return;
    throw new Error(`Katalogen svarade ${res.status}`);
  }

  const json = await res.text();
  onIndex(JSON.parse(json) as CatalogIndex, "network");
  const etag = res.headers.get("etag");
  if (etag) await store.write({ etag, json }).catch(() => {});
}

const DB_NAME = "stream-finder";
const STORE = "catalog";
const KEY = "latest";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return request(req);
}

export const indexedDbStore: CatalogStore = {
  async read() {
    const db = await openDb();
    try {
      const entry = await request(db.transaction(STORE).objectStore(STORE).get(KEY));
      return (entry as CachedCatalog | undefined) ?? null;
    } finally {
      db.close();
    }
  },
  async write(entry) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, KEY);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};
