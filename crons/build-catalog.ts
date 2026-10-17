import { defineScheduled } from "void";
import { storage } from "void/storage";
import { publishCatalog } from "../src/catalog/store";

// 05:00 UTC, när inläsning och matchning (04:00–04:30) har hunnit klart.
export const cron = "0 5 * * *";

export default defineScheduled(async (controller, env) => {
  const { items, bytes } = await publishCatalog(env.DB, storage, new Date(controller.scheduledTime));
  console.log(`Katalog: ${items} titlar, ${Math.round(bytes / 1024)} kB`);
});
