import { defineScheduled } from "void";
import { env } from "void/env";
import { queues } from "void/queues";
import { planTmdbPages } from "../src/ingest/tmdb";

// 04:15 UTC varje dygn, efter SVT-jobbet.
export const cron = "15 4 * * *";

export default defineScheduled(async (controller) => {
  const seenAt = new Date(controller.scheduledTime).toISOString();
  const messages = await planTmdbPages(env.TMDB_API_KEY, seenAt);

  // sendBatch tar max 100 meddelanden per anrop.
  for (let i = 0; i < messages.length; i += 100) {
    await queues["tmdb-pages"].sendBatch(messages.slice(i, i + 100).map((body) => ({ body })));
  }
  console.log(`TMDB: ${messages.length} sidor köade`);
});
