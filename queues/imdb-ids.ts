import { defineQueue } from "void";
import { env } from "void/env";
import { processImdbIdMessages } from "../src/ingest/imdb";

// Två meddelanden à 10 titlar ger högst 20 TMDB-anrop per batch.
export const maxBatchSize = 2;
export const maxRetries = 5;

export default defineQueue<{ keys: string[] }>(async (batch, bindings) => {
  await processImdbIdMessages(bindings.DB, env.TMDB_API_KEY, batch.messages, new Date());
});
