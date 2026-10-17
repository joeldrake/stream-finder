export type Service = "svt" | "netflix" | "disney" | "hbomax";

// En titel som den ser ut när en källa har läst in den, före upsert till D1.
export interface CatalogRow {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string | null;
  year: number | null;
  popularity: number | null;
  poster: string | null;
  tmdbId: number | null;
  svtId: string | null;
  url: string | null;
  validTo: string | null;
}

// D1 begränsar antalet frågor per anrop, så raderna skickas som JSON i
// en enda parameter och packas upp med json_each. Två frågor per chunk.
const CHUNK_SIZE = 1000;

const UPSERT_TITLES = `
INSERT INTO titles (id, kind, title, original_title, year, popularity, poster, tmdb_id, svt_id)
SELECT
  json_extract(value, '$.id'),
  json_extract(value, '$.kind'),
  json_extract(value, '$.title'),
  json_extract(value, '$.originalTitle'),
  json_extract(value, '$.year'),
  json_extract(value, '$.popularity'),
  json_extract(value, '$.poster'),
  json_extract(value, '$.tmdbId'),
  json_extract(value, '$.svtId')
FROM json_each(?1) WHERE true
ON CONFLICT (id) DO UPDATE SET
  kind = excluded.kind,
  title = excluded.title,
  original_title = excluded.original_title,
  year = excluded.year,
  popularity = excluded.popularity,
  poster = excluded.poster,
  tmdb_id = coalesce(excluded.tmdb_id, titles.tmdb_id),
  svt_id = coalesce(excluded.svt_id, titles.svt_id)`;

const UPSERT_AVAILABILITY = `
INSERT INTO availability (title_id, service, url, valid_to, first_seen, last_seen)
SELECT
  json_extract(value, '$.id'),
  ?2,
  json_extract(value, '$.url'),
  json_extract(value, '$.validTo'),
  ?3,
  ?3
FROM json_each(?1) WHERE true
ON CONFLICT (title_id, service) DO UPDATE SET
  url = excluded.url,
  valid_to = excluded.valid_to,
  last_seen = excluded.last_seen`;

export async function upsertCatalog(
  d1: D1Database,
  service: Service,
  rows: CatalogRow[],
  seenAt: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const json = JSON.stringify(rows.slice(i, i + CHUNK_SIZE));
    statements.push(
      d1.prepare(UPSERT_TITLES).bind(json),
      d1.prepare(UPSERT_AVAILABILITY).bind(json, service, seenAt),
    );
  }
  if (statements.length > 0) await d1.batch(statements);
}
