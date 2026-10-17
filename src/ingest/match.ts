import { posterUrl, tmdbGet, TmdbRateLimitError, type TmdbResult } from "./tmdb";

// Omatchade SVT-titlar söks igen efter så här lång tid; TMDB växer hela tiden.
export const RECHECK_UNMATCHED_DAYS = 30;
// Titlar per kömeddelande. Varje titel kostar 1–2 sökningar.
export const TITLES_PER_MESSAGE = 10;

export interface SvtMatchInput {
  svtId: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string | null;
  year: number | null;
}

export interface SvtMatch {
  svtId: string;
  tmdbKind: "movie" | "tv" | null;
  tmdbId: number | null;
  title: string | null;
  originalTitle: string | null;
  year: number | null;
  poster: string | null;
  popularity: number | null;
}

// Gemener, utan diakritiska tecken och skiljetecken: "Kriminalarkivet: Lasermannen"
// och "Kriminalarkivet - Lasermannen" blir lika.
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function yearOf(date: string | undefined): number | null {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  return Number.isNaN(year) ? null : year;
}

// Kräver exakt (normaliserad) titelmatchning. Filmer måste dessutom ha samma
// år ±1 när SVT anger år. Serier saknar år hos SVT och matchas bara på titel.
// Ett stickprov på 37 matchningar var rätt i samtliga fall (2026-10-17).
export function pickMatch(input: SvtMatchInput, query: string, results: TmdbResult[]): TmdbResult | null {
  const wanted = normalizeTitle(query);
  for (const r of results.slice(0, 5)) {
    const names = [r.title ?? r.name, r.original_title ?? r.original_name]
      .filter((n): n is string => !!n)
      .map(normalizeTitle);
    if (!names.includes(wanted)) continue;
    if (input.kind === "series") return r;
    const year = yearOf(r.release_date);
    if (input.year == null) return r;
    if (year != null && Math.abs(year - input.year) <= 1) return r;
  }
  return null;
}

export async function findTmdbMatch(
  apiKey: string,
  input: SvtMatchInput,
  fetchFn: typeof fetch = fetch,
): Promise<SvtMatch> {
  const tmdbKind = input.kind === "movie" ? "movie" : "tv";
  // Originaltiteln först: den är oftast unik och känd av TMDB.
  const queries = [...new Set([input.originalTitle, input.title].filter((q): q is string => !!q?.trim()))];

  for (const query of queries) {
    const { results } = await tmdbGet<{ results: TmdbResult[] }>(
      apiKey,
      `/search/${tmdbKind}`,
      { query, language: "sv-SE" },
      fetchFn,
    );
    const hit = pickMatch(input, query, results);
    if (hit) {
      const title = (tmdbKind === "movie" ? hit.title : hit.name) ?? null;
      const original = (tmdbKind === "movie" ? hit.original_title : hit.original_name) ?? null;
      return {
        svtId: input.svtId,
        tmdbKind,
        tmdbId: hit.id,
        title,
        originalTitle: original && original !== title ? original : null,
        year: yearOf(tmdbKind === "movie" ? hit.release_date : hit.first_air_date),
        poster: posterUrl(hit.poster_path),
        popularity: hit.popularity ?? null,
      };
    }
  }
  return {
    svtId: input.svtId,
    tmdbKind: null,
    tmdbId: null,
    title: null,
    originalTitle: null,
    year: null,
    poster: null,
    popularity: null,
  };
}

// SVT-titlar som är tillgängliga och antingen aldrig sökta eller omatchade
// sedan länge.
export async function titlesToMatch(d1: D1Database, now: Date): Promise<SvtMatchInput[]> {
  const recheckBefore = new Date(now.getTime() - RECHECK_UNMATCHED_DAYS * 86_400_000).toISOString();
  const { results } = await d1
    .prepare(
      `SELECT t.svt_id AS svtId, t.kind, t.title, t.original_title AS originalTitle, t.year
       FROM titles t
       JOIN availability a ON a.title_id = t.id AND a.service = 'svt'
       LEFT JOIN svt_matches m ON m.svt_id = t.svt_id
       WHERE t.svt_id IS NOT NULL
         AND (m.svt_id IS NULL OR (m.tmdb_id IS NULL AND m.checked_at < ?1))`,
    )
    .bind(recheckBefore)
    .all<SvtMatchInput>();
  return results;
}

const UPSERT_MATCHES = `
INSERT INTO svt_matches (svt_id, tmdb_kind, tmdb_id, title, original_title, year, poster, popularity, checked_at)
SELECT
  json_extract(value, '$.svtId'),
  json_extract(value, '$.tmdbKind'),
  json_extract(value, '$.tmdbId'),
  json_extract(value, '$.title'),
  json_extract(value, '$.originalTitle'),
  json_extract(value, '$.year'),
  json_extract(value, '$.poster'),
  json_extract(value, '$.popularity'),
  ?2
FROM json_each(?1) WHERE true
ON CONFLICT (svt_id) DO UPDATE SET
  tmdb_kind = excluded.tmdb_kind,
  tmdb_id = excluded.tmdb_id,
  title = excluded.title,
  original_title = excluded.original_title,
  year = excluded.year,
  poster = excluded.poster,
  popularity = excluded.popularity,
  checked_at = excluded.checked_at`;

export interface MatchMessage {
  body: { titles: SvtMatchInput[] };
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

// Söker upp titlarna i varje meddelande och sparar resultatet, även
// "ingen träff", så att titeln inte söks igen förrän om 30 dagar.
export async function processMatchMessages(
  d1: D1Database,
  apiKey: string,
  messages: readonly MatchMessage[],
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const matches: SvtMatch[] = [];
  const done: MatchMessage[] = [];
  for (const msg of messages) {
    try {
      const found: SvtMatch[] = [];
      for (const input of msg.body.titles) found.push(await findTmdbMatch(apiKey, input, fetchFn));
      matches.push(...found);
      done.push(msg);
    } catch (error) {
      console.warn(`SVT-matchning: ${(error as Error).message}`);
      msg.retry({ delaySeconds: error instanceof TmdbRateLimitError ? 10 : 30 });
    }
  }
  if (matches.length > 0) {
    await d1.prepare(UPSERT_MATCHES).bind(JSON.stringify(matches), now.toISOString()).run();
  }
  for (const msg of done) msg.ack();
}
