import { defineScheduled } from "void";
import { queues } from "void/queues";
import { TITLES_PER_MESSAGE, titlesToMatch } from "../src/ingest/match";

// 04:30 UTC varje dygn, efter SVT-jobbet. Första gången ~4 000 titlar,
// sedan bara nya och gamla omatchade.
export const cron = "30 4 * * *";

export default defineScheduled(async (controller, env) => {
  const titles = await titlesToMatch(env.DB, new Date(controller.scheduledTime));

  const messages = [];
  for (let i = 0; i < titles.length; i += TITLES_PER_MESSAGE) {
    messages.push({ body: { titles: titles.slice(i, i + TITLES_PER_MESSAGE) } });
  }
  // sendBatch tar max 100 meddelanden per anrop.
  for (let i = 0; i < messages.length; i += 100) {
    await queues["svt-match"].sendBatch(messages.slice(i, i + 100));
  }
  console.log(`SVT-matchning: ${titles.length} titlar köade`);
});
