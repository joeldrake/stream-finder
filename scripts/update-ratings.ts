/// <reference types="node" />
// Hämtar IMDb-betyg och laddar upp dem till stream-finder.
//
// Körs utanför Workern, eftersom IMDb:s fil (~9 MB gzip, ~25 MB text) kräver
// mer CPU än Workers gratisplan tillåter. Se docs/PLAN.md.
//
//   pnpm ratings:update                       # mot lokal dev-server
//   STREAM_FINDER_URL=https://… ADMIN_TOKEN=… pnpm ratings:update
//
// IMDb:s datafiler får användas för personligt och icke-kommersiellt bruk:
// https://data.imdb.com/non-commercial-datasets/
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";

const RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
const UPLOAD_BATCH = 5000;

const baseUrl = (process.env.STREAM_FINDER_URL ?? "http://localhost:5173").replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error("ADMIN_TOKEN saknas. Lägg den i .env eller sätt den i miljön.");
  process.exit(1);
}
const auth = { authorization: `Bearer ${token}` };

async function check(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return res;
}

const started = Date.now();

const { ids } = (await (await check(await fetch(`${baseUrl}/api/admin/imdb-ids`, { headers: auth }), "Hämta IMDb-id")).json()) as {
  ids: string[];
};
const wanted = new Set(ids);
console.log(`${wanted.size} IMDb-id att hämta betyg för (${baseUrl})`);

const download = await check(await fetch(RATINGS_URL), "Ladda ned IMDb-betyg");
const lines = createInterface({
  input: Readable.fromWeb(download.body as ReadableStream).pipe(createGunzip()),
  crlfDelay: Infinity,
});

// tconst \t averageRating \t numVotes
const ratings: [string, number, number][] = [];
let total = 0;
for await (const line of lines) {
  if (total++ === 0) continue; // rubrikraden
  const tab = line.indexOf("\t");
  const id = line.slice(0, tab);
  if (!wanted.has(id)) continue;
  const [, rating, votes] = line.split("\t");
  ratings.push([id, Number(rating), Number(votes)]);
}
console.log(`Läste ${total - 1} IMDb-betyg, ${ratings.length} matchade våra titlar`);

for (let i = 0; i < ratings.length; i += UPLOAD_BATCH) {
  const batch = ratings.slice(i, i + UPLOAD_BATCH);
  await check(
    await fetch(`${baseUrl}/api/admin/ratings`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ratings: batch }),
    }),
    "Ladda upp betyg",
  );
}
console.log(`Klart på ${((Date.now() - started) / 1000).toFixed(1)} s. Betygen syns i katalogen efter nästa katalogbygge.`);
