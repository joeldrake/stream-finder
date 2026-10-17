import { defineQueue } from "void";
import { env } from "void/env";
import { processTmdbPages, type TmdbPageMessage } from "../src/ingest/tmdb";

// Sidorna i en batch hämtas i tur och ordning. Om flera batchar körs samtidigt
// och TMDB svarar 429, försöks sidan igen efter 10 s.
export const maxBatchSize = 10;
export const maxRetries = 5;

export default defineQueue<TmdbPageMessage>(async (batch, bindings) => {
  await processTmdbPages(bindings.DB, env.TMDB_API_KEY, batch.messages);
});
