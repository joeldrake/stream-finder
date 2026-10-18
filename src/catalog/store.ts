import { buildCatalog } from "./build";

export const CATALOG_KEY = "catalog/latest.json";

// Bygger katalogen ur D1 och sparar den i R2, så att routen bara behöver
// strömma en färdig fil.
export async function publishCatalog(
  d1: D1Database,
  bucket: R2Bucket,
  now: Date,
): Promise<{ items: number; bytes: number }> {
  const index = await buildCatalog(d1, now);
  const json = JSON.stringify(index);
  await bucket.put(CATALOG_KEY, json, { httpMetadata: { contentType: "application/json" } });
  return { items: index.items.length, bytes: json.length };
}

// Cloudflare gör om starka etaggar till svaga (W/"…") när svaret komprimeras,
// så webbläsaren skickar tillbaka W/"…" i If-None-Match. Jämför därför svagt,
// som RFC 9110 föreskriver för If-None-Match.
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((tag) => opaque(tag) === opaque(etag));
}
