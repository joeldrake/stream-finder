import { env } from "void/env";
import { queues } from "void/queues";
import { storage } from "void/storage";
import { publishCatalog } from "./catalog/store";
import type { SyncDeps } from "./sync";

// sendBatch tar max 100 meddelanden per anrop.
async function sendAll<T>(queue: { sendBatch(messages: { body: T }[]): Promise<unknown> }, bodies: T[]) {
  for (let i = 0; i < bodies.length; i += 100) {
    await queue.sendBatch(bodies.slice(i, i + 100).map((body) => ({ body })));
  }
}

// Kopplar src/sync.ts till Workerns köer och lagring.
export function syncDeps(d1: D1Database): SyncDeps {
  return {
    d1,
    apiKey: env.TMDB_API_KEY,
    sendTmdb: (bodies) => sendAll(queues["tmdb-pages"], bodies),
    sendMatch: (bodies) => sendAll(queues["svt-match"], bodies),
    sendImdb: (bodies) => sendAll(queues["imdb-ids"], bodies),
    publish: async (now) => {
      const { items, bytes } = await publishCatalog(d1, storage, now);
      console.log(`Katalog: ${items} titlar, ${Math.round(bytes / 1024)} kB`);
    },
  };
}
