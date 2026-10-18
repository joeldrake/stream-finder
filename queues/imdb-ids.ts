import { defineQueue } from "void";
import { env } from "void/env";
import { processImdbIdMessages } from "../src/ingest/imdb";
import { messagesSettled, processTracked, type ImdbBody } from "../src/sync";
import { syncDeps } from "../src/sync-deps";

// Två meddelanden à 10 titlar ger högst 20 TMDB-anrop per batch.
export const maxBatchSize = 2;
export const maxRetries = 5;

export default defineQueue<ImdbBody>(async (batch, bindings) => {
  await processTracked(
    batch.messages,
    maxRetries,
    (body) => body.runId,
    (messages) => processImdbIdMessages(bindings.DB, env.TMDB_API_KEY, messages, new Date()),
    (runId, count) => messagesSettled(syncDeps(bindings.DB), runId, count),
  );
});
