import { defineHandler } from "void";
import { storage } from "void/storage";
import { CATALOG_KEY, publishCatalog } from "../../src/catalog/store";

export const GET = defineHandler(async (c) => {
  let object = await storage.get(CATALOG_KEY);
  // Första gången, innan cron-jobbet har kört: bygg katalogen direkt.
  if (!object) {
    await publishCatalog(c.env.DB, storage, new Date());
    object = await storage.get(CATALOG_KEY);
    if (!object) return c.json({ error: "Katalogen kunde inte byggas" }, 500);
  }

  if (c.req.header("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
  }
  return new Response(object.body, {
    headers: {
      "content-type": "application/json",
      etag: object.httpEtag,
      // Katalogen ändras en gång per dygn. no-cache betyder att webbläsaren
      // alltid frågar, men får 304 utan innehåll så länge etaggen stämmer.
      "cache-control": "no-cache",
    },
  });
});
