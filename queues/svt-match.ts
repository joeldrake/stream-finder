import { defineQueue } from "void";
import { env } from "void/env";
import { processMatchMessages, type SvtMatchInput } from "../src/ingest/match";

// Två meddelanden à 10 titlar ger högst 40 sökningar per anrop.
export const maxBatchSize = 2;
export const maxRetries = 5;

export default defineQueue<{ titles: SvtMatchInput[] }>(async (batch, bindings) => {
  await processMatchMessages(bindings.DB, env.TMDB_API_KEY, batch.messages, new Date());
});
