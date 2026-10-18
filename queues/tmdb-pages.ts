import { defineQueue } from "void";
import { env } from "void/env";
import { processTmdbPages, type TmdbPageMessage } from "../src/ingest/tmdb";
import { messagesSettled, processTracked } from "../src/sync";
import { syncDeps } from "../src/sync-deps";

// Sidorna i en batch hämtas i tur och ordning. Om flera batchar körs samtidigt
// och TMDB svarar 429, försöks sidan igen efter 10 s.
export const maxBatchSize = 10;
export const maxRetries = 5;

export default defineQueue<TmdbPageMessage>(async (batch, bindings) => {
  await processTracked(
    batch.messages,
    maxRetries,
    (body) => body.seenAt,
    (messages) => processTmdbPages(bindings.DB, env.TMDB_API_KEY, messages),
    (runId, count) => messagesSettled(syncDeps(bindings.DB), runId, count),
  );
});
