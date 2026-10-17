import { compressPoster, serviceBit, type CatalogIndex, type CatalogItem } from "./format";

export interface CatalogRowWithMatch {
  id: string;
  kind: "movie" | "series";
  title: string;
  originalTitle: string | null;
  year: number | null;
  popularity: number | null;
  poster: string | null;
  services: string; // kommaseparerad, från group_concat
  svtUrl: string | null;
  matchKind: "movie" | "tv" | null;
  matchId: number | null;
  matchTitle: string | null;
  matchOriginalTitle: string | null;
  matchYear: number | null;
  matchPoster: string | null;
  matchPopularity: number | null;
}

const QUERY = `
SELECT
  t.id, t.kind, t.title, t.original_title AS originalTitle, t.year, t.popularity, t.poster,
  group_concat(a.service) AS services,
  max(CASE WHEN a.service = 'svt' THEN a.url END) AS svtUrl,
  m.tmdb_kind AS matchKind, m.tmdb_id AS matchId, m.title AS matchTitle,
  m.original_title AS matchOriginalTitle, m.year AS matchYear, m.poster AS matchPoster,
  m.popularity AS matchPopularity
FROM titles t
JOIN availability a ON a.title_id = t.id
LEFT JOIN svt_matches m ON m.svt_id = t.svt_id
GROUP BY t.id`;

// SVT:s popularitet ligger på en annan skala än TMDB:s; den här faktorn
// används bara för SVT-titlar som saknar TMDB-matchning.
const SVT_POPULARITY_WEIGHT = 0.5;

interface Draft {
  id: string;
  title: string;
  alts: Set<string>;
  year: number | null;
  series: boolean;
  popularity: number;
  services: number;
  poster: string | null;
  svtPath: string;
}

function servicesMask(services: string): number {
  return services.split(",").reduce((mask, s) => mask | serviceBit(s), 0);
}

function svtPath(url: string | null): string {
  return url ? url.replace("https://www.svtplay.se", "") : "";
}

// Slår ihop SVT-titlar med TMDB-titeln de matchats mot. Finns TMDB-titeln
// redan i katalogen (Netflix/Disney+/HBO Max) får den SVT som extra tjänst;
// annars blir SVT-titeln en egen post med TMDB:s affisch och år.
export function mergeCatalog(rows: CatalogRowWithMatch[], version: string): CatalogIndex {
  const drafts = new Map<string, Draft>();

  for (const r of rows) {
    if (r.id.startsWith("svt:")) continue;
    drafts.set(r.id, {
      id: r.id,
      title: r.title,
      alts: new Set(r.originalTitle ? [r.originalTitle] : []),
      year: r.year,
      series: r.kind === "series",
      popularity: r.popularity ?? 0,
      services: servicesMask(r.services),
      poster: r.poster,
      svtPath: "",
    });
  }

  for (const r of rows) {
    if (!r.id.startsWith("svt:")) continue;
    const key = r.matchId != null ? `tmdb:${r.matchKind}:${r.matchId}` : r.id;
    const existing = drafts.get(key);
    const svtTitles = [r.title, r.originalTitle, r.matchTitle, r.matchOriginalTitle].filter((t): t is string => !!t);

    if (existing) {
      existing.services |= servicesMask(r.services);
      existing.svtPath ||= svtPath(r.svtUrl);
      for (const t of svtTitles) existing.alts.add(t);
      continue;
    }
    drafts.set(key, {
      id: key,
      title: r.title,
      alts: new Set(svtTitles),
      year: r.year ?? r.matchYear,
      series: r.kind === "series",
      popularity: r.matchPopularity ?? (r.popularity ?? 0) * SVT_POPULARITY_WEIGHT,
      services: servicesMask(r.services),
      // TMDB har stående affischer; SVT bara liggande bilder.
      poster: r.matchPoster ?? r.poster,
      svtPath: svtPath(r.svtUrl),
    });
  }

  const items: CatalogItem[] = [...drafts.values()].map((d) => {
    d.alts.delete(d.title);
    return [
      d.id,
      d.title,
      [...d.alts].join(" / "),
      d.year ?? 0,
      d.series ? 1 : 0,
      Math.round(d.popularity * 10) / 10,
      d.services,
      compressPoster(d.poster),
      d.svtPath,
    ];
  });
  return { version, items };
}

export async function buildCatalog(d1: D1Database, now: Date): Promise<CatalogIndex> {
  const { results } = await d1.prepare(QUERY).all<CatalogRowWithMatch>();
  return mergeCatalog(results, now.toISOString());
}
