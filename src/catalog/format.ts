// Det kompakta katalogformatet som skickas till webbläsaren. Delas av
// servern (bygger) och klienten (läser).

export const SERVICES = ["svt", "netflix", "disney", "hbomax"] as const;
export type ServiceName = (typeof SERVICES)[number];

// [id, titel, alternativa titlar, år (0 = okänt), 0 = film / 1 = serie,
//  popularitet, tjänster som bitmask, poster (komprimerad), SVT-sökväg,
//  IMDb-betyg × 10 (0 = saknas)]
export type CatalogItem = [string, string, string, number, 0 | 1, number, number, string, string, number];

export interface CatalogIndex {
  version: string;
  items: CatalogItem[];
}

const TMDB_POSTER = "https://image.tmdb.org/t/p/w342";
const SVT_IMAGE = "https://www.svtstatic.se/image/custom/400/";

// Poster-URL:er står för en stor del av indexet, så prefixen kortas ned.
export function compressPoster(url: string | null): string {
  if (!url) return "";
  if (url.startsWith(TMDB_POSTER)) return `t${url.slice(TMDB_POSTER.length)}`;
  if (url.startsWith(SVT_IMAGE)) return `s${url.slice(SVT_IMAGE.length)}`;
  return url;
}

export function expandPoster(compact: string): string | null {
  if (!compact) return null;
  if (compact[0] === "t") return TMDB_POSTER + compact.slice(1);
  if (compact[0] === "s") return SVT_IMAGE + compact.slice(1);
  return compact;
}

export function servicesOf(mask: number): ServiceName[] {
  return SERVICES.filter((_, i) => mask & (1 << i));
}

export function serviceBit(service: string): number {
  const i = SERVICES.indexOf(service as ServiceName);
  return i < 0 ? 0 : 1 << i;
}
