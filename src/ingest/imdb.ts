import { tmdbGet, TmdbRateLimitError } from "./tmdb";

// TMDB-titlar utan IMDb-id provas igen efter så här lång tid.
export const RECHECK_MISSING_DAYS = 30;
export const KEYS_PER_MESSAGE = 10;

// Alla TMDB-titlar vi visar: de som kommer från TMDB-jobbet och de som
// SVT-titlar har matchats mot.
const TMDB_KEYS = `
SELECT id AS tmdb_key FROM titles WHERE id LIKE 'tmdb:%'
UNION
SELECT 'tmdb:' || tmdb_kind || ':' || tmdb_id FROM svt_matches WHERE tmdb_id IS NOT NULL`;

export async function keysToLookup(d1: D1Database, now: Date): Promise<string[]> {
  const recheckBefore = new Date(now.getTime() - RECHECK_MISSING_DAYS * 86_400_000).toISOString();
  const { results } = await d1
    .prepare(
      `SELECT k.tmdb_key FROM (${TMDB_KEYS}) k
       LEFT JOIN imdb_ratings r ON r.tmdb_key = k.tmdb_key
       WHERE r.tmdb_key IS NULL OR (r.imdb_id IS NULL AND r.checked_at < ?1)`,
    )
    .bind(recheckBefore)
    .all<{ tmdb_key: string }>();
  return results.map((r) => r.tmdb_key);
}

export async function fetchImdbId(apiKey: string, tmdbKey: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const [, kind, id] = tmdbKey.split(":");
  const { imdb_id } = await tmdbGet<{ imdb_id?: string | null }>(apiKey, `/${kind}/${id}/external_ids`, {}, fetchFn);
  return imdb_id || null;
}

const UPSERT_IDS = `
INSERT INTO imdb_ratings (tmdb_key, imdb_id, checked_at)
SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2
FROM json_each(?1) WHERE true
ON CONFLICT (tmdb_key) DO UPDATE SET
  imdb_id = excluded.imdb_id,
  checked_at = excluded.checked_at`;

export interface ImdbIdMessage {
  body: { keys: string[] };
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export async function processImdbIdMessages(
  d1: D1Database,
  apiKey: string,
  messages: readonly ImdbIdMessage[],
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const found: [string, string | null][] = [];
  const done: ImdbIdMessage[] = [];
  for (const msg of messages) {
    try {
      const pairs: [string, string | null][] = [];
      for (const key of msg.body.keys) pairs.push([key, await fetchImdbId(apiKey, key, fetchFn)]);
      found.push(...pairs);
      done.push(msg);
    } catch (error) {
      console.warn(`IMDb-id: ${(error as Error).message}`);
      msg.retry({ delaySeconds: error instanceof TmdbRateLimitError ? 10 : 30 });
    }
  }
  if (found.length > 0) {
    await d1.prepare(UPSERT_IDS).bind(JSON.stringify(found), now.toISOString()).run();
  }
  for (const msg of done) msg.ack();
}

export async function listImdbIds(d1: D1Database): Promise<string[]> {
  const { results } = await d1
    .prepare("SELECT DISTINCT imdb_id FROM imdb_ratings WHERE imdb_id IS NOT NULL ORDER BY imdb_id")
    .all<{ imdb_id: string }>();
  return results.map((r) => r.imdb_id);
}

// [imdbId, betyg, antal röster], som i IMDb:s title.ratings.tsv.
export type ImdbRating = [string, number, number];

const CHUNK_SIZE = 2000;

const UPDATE_RATINGS = `
UPDATE imdb_ratings SET
  rating = json_extract(j.value, '$[1]'),
  votes = json_extract(j.value, '$[2]'),
  rated_at = ?2
FROM json_each(?1) AS j
WHERE imdb_ratings.imdb_id = json_extract(j.value, '$[0]')`;

export function isImdbRating(value: unknown): value is ImdbRating {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "string" &&
    /^tt\d+$/.test(value[0]) &&
    typeof value[1] === "number" &&
    value[1] >= 0 &&
    value[1] <= 10 &&
    Number.isInteger(value[2]) &&
    value[2] >= 0
  );
}

export async function applyRatings(d1: D1Database, ratings: ImdbRating[], ratedAt: string): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < ratings.length; i += CHUNK_SIZE) {
    statements.push(d1.prepare(UPDATE_RATINGS).bind(JSON.stringify(ratings.slice(i, i + CHUNK_SIZE)), ratedAt));
  }
  if (statements.length > 0) await d1.batch(statements);
}
