import { defineScheduled } from "void";
import { queues } from "void/queues";
import { KEYS_PER_MESSAGE, keysToLookup } from "../src/ingest/imdb";

// 04:45 UTC, efter TMDB-jobbet och SVT-matchningen. Första gången ~16 000
// titlar, sedan bara nya.
export const cron = "45 4 * * *";

export default defineScheduled(async (controller, env) => {
  const keys = await keysToLookup(env.DB, new Date(controller.scheduledTime));

  const messages = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_MESSAGE) {
    messages.push({ body: { keys: keys.slice(i, i + KEYS_PER_MESSAGE) } });
  }
  // sendBatch tar max 100 meddelanden per anrop.
  for (let i = 0; i < messages.length; i += 100) {
    await queues["imdb-ids"].sendBatch(messages.slice(i, i + 100));
  }
  console.log(`IMDb-id: ${keys.length} titlar köade`);
});
