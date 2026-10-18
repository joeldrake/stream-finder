import { defineQueue } from "void";
import { env } from "void/env";
import { processMatchMessages } from "../src/ingest/match";
import { messagesSettled, processTracked, type MatchBody } from "../src/sync";
import { syncDeps } from "../src/sync-deps";

// Två meddelanden à 10 titlar ger högst 40 sökningar per anrop.
export const maxBatchSize = 2;
export const maxRetries = 5;

export default defineQueue<MatchBody>(async (batch, bindings) => {
  await processTracked(
    batch.messages,
    maxRetries,
    (body) => body.runId,
    (messages) => processMatchMessages(bindings.DB, env.TMDB_API_KEY, messages, new Date()),
    (runId, count) => messagesSettled(syncDeps(bindings.DB), runId, count),
  );
});
