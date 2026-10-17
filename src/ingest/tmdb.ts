import { upsertCatalog, type CatalogRow, type Service } from "./catalog";

// Tjänster som läses från TMDB (data från JustWatch), se docs/PLAN.md B2.
// Netflix Kids (175) och HBO Max Amazon Channel (1825) ingår inte.
export const TMDB_PROVIDERS = {
  netflix: 8,
  disney: 337,
  hbomax: 1899,
} as const satisfies Partial<Record<Service, number>>;

export type TmdbService = keyof typeof TMDB_PROVIDERS;
export type TmdbKind = "movie" | "tv";

// TMDB:s discover ger max 500 sidor (10 000 träffar) per fråga.
const MAX_PAGES = 500;

export interface TmdbPageMessage {
  service: TmdbService;
  kind: TmdbKind;
  page: number;
  // Körningens starttid. Alla sidor i en körning får samma last_seen.
  seenAt: string;
}

export interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
  poster_path?: string | null;
}

interface DiscoverResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbResult[];
}

export class TmdbRateLimitError extends Error {}

export async function tmdbGet<T>(
  apiKey: string,
  path: string,
  query: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const params = new URLSearchParams(query);
  const headers: Record<string, string> = { accept: "application/json" };
  // Read Access Token (v4) skickas som Bearer, en v3-nyckel som parameter.
  if (apiKey.startsWith("eyJ")) headers.authorization = `Bearer ${apiKey}`;
  else params.set("api_key", apiKey);

  const res = await fetchFn(new Request(`https://api.themoviedb.org/3${path}?${params}`, { headers }));
  if (res.status === 429) throw new TmdbRateLimitError("TMDB rate limit");
  if (!res.ok) throw new Error(`TMDB svarade ${res.status} för ${path}`);
  return (await res.json()) as T;
}

export function fetchDiscoverPage(
  apiKey: string,
  service: TmdbService,
  kind: TmdbKind,
  page: number,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoverResponse> {
  return tmdbGet<DiscoverResponse>(
    apiKey,
    `/discover/${kind}`,
    {
      watch_region: "SE",
      with_watch_providers: String(TMDB_PROVIDERS[service]),
      with_watch_monetization_types: "flatrate|free",
      language: "sv-SE",
      // Stabil ordning, så att titlar inte flyttar mellan sidor medan körningen pågår.
      sort_by: kind === "movie" ? "original_title.asc" : "original_name.asc",
      page: String(page),
    },
    fetchFn,
  );
}

export function posterUrl(path: string | null | undefined): string | null {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

// Ett meddelande per sida och kombination av tjänst och typ.
export async function planTmdbPages(
  apiKey: string,
  seenAt: string,
  fetchFn: typeof fetch = fetch,
): Promise<TmdbPageMessage[]> {
  const messages: TmdbPageMessage[] = [];
  for (const service of Object.keys(TMDB_PROVIDERS) as TmdbService[]) {
    for (const kind of ["movie", "tv"] as const) {
      const first = await fetchDiscoverPage(apiKey, service, kind, 1, fetchFn);
      if (first.total_pages > MAX_PAGES) {
        console.warn(
          `TMDB ${service}/${kind} har ${first.total_results} träffar, mer än 10 000 når vi inte. Dela upp per årtal.`,
        );
      }
      const pages = Math.min(first.total_pages, MAX_PAGES);
      for (let page = 1; page <= pages; page++) messages.push({ service, kind, page, seenAt });
    }
  }
  return messages;
}

export function toCatalogRow(result: TmdbResult, kind: TmdbKind): CatalogRow {
  const title = (kind === "movie" ? result.title : result.name) ?? "";
  const original = kind === "movie" ? result.original_title : result.original_name;
  const date = kind === "movie" ? result.release_date : result.first_air_date;
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  return {
    id: `tmdb:${kind}:${result.id}`,
    kind: kind === "movie" ? "movie" : "series",
    title: title || original || "",
    originalTitle: original && original !== title ? original : null,
    year: Number.isNaN(year) ? null : year,
    popularity: result.popularity ?? null,
    poster: posterUrl(result.poster_path),
    tmdbId: result.id,
    svtId: null,
    url: null,
    validTo: null,
  };
}

// Det vi behöver av ett Cloudflare-kömeddelande; gör processorn testbar.
export interface PageMessage {
  body: TmdbPageMessage;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

// Hämtar varje sida i batchen och sparar resultatet. Sidor som misslyckas
// försöks igen senare. Om upserten misslyckas kastas felet, och hela
// batchen försöks igen.
export async function processTmdbPages(
  d1: D1Database,
  apiKey: string,
  messages: readonly PageMessage[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const groups = new Map<string, { service: TmdbService; seenAt: string; rows: CatalogRow[] }>();
  const fetched: PageMessage[] = [];

  for (const msg of messages) {
    const { service, kind, page, seenAt } = msg.body;
    try {
      const data = await fetchDiscoverPage(apiKey, service, kind, page, fetchFn);
      const key = `${service}|${seenAt}`;
      const group = groups.get(key) ?? { service, seenAt, rows: [] };
      group.rows.push(...data.results.map((r) => toCatalogRow(r, kind)));
      groups.set(key, group);
      fetched.push(msg);
    } catch (error) {
      console.warn(`TMDB ${service}/${kind} sida ${page}: ${(error as Error).message}`);
      msg.retry({ delaySeconds: error instanceof TmdbRateLimitError ? 10 : 30 });
    }
  }

  for (const { service, seenAt, rows } of groups.values()) {
    await upsertCatalog(d1, service, rows, seenAt);
  }
  for (const msg of fetched) msg.ack();
}
