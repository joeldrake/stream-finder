import { defineScheduled } from "void";
import { ingestSvt } from "../src/ingest/svt";

// 04:00 UTC varje dygn.
export const cron = "0 4 * * *";

export default defineScheduled(async (controller, env) => {
  const result = await ingestSvt(env.DB, new Date(controller.scheduledTime));
  console.log(`SVT: ${result.available} tillgängliga av ${result.fetched} hämtade`);
});
