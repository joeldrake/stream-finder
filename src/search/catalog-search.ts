import MiniSearch from "minisearch";
import { expandPoster, SERVICES, servicesOf, type CatalogIndex, type ServiceName } from "../catalog/format";

export const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 48;

export interface SearchHit {
  id: string;
  title: string;
  alts: string;
  year: number | null;
  series: boolean;
  services: ServiceName[];
  poster: string | null;
  svtUrl: string | null;
  imdbRating: number | null;
}

// "Åberg", "aberg" och "ÅBERG" ska ge samma sökterm.
function normalize(term: string): string {
  return term.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export interface CatalogSearch {
  size: number;
  // När katalogen byggdes (ISO-tid).
  version: string;
  // Antal titlar per tjänst.
  serviceCounts: Record<ServiceName, number>;
  search(query: string): SearchHit[];
}

// Bygger sökindexet i webbläsaren. Det tar ett par hundra millisekunder för
// ~18 000 titlar, och sedan går varje sökning på någon millisekund.
export function createCatalogSearch(index: CatalogIndex): CatalogSearch {
  const items = index.items;
  // Popularitet som en mild förstärkning: kända titlar före obskyra vid lika träff.
  const boost = items.map(([, , , , , popularity]) => 1 + Math.log10(1 + Math.max(0, popularity)) / 2);

  const mini = new MiniSearch<{ i: number; title: string; alts: string }>({
    idField: "i",
    fields: ["title", "alts"],
    processTerm: (term) => normalize(term) || null,
    searchOptions: {
      boost: { title: 3 },
      prefix: true,
      // Felstavningar tolereras bara i längre ord: på korta ord ger ett
      // enda fel för många träffar ("dune" → "Dude", "June").
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      weights: { fuzzy: 0.2, prefix: 0.5 },
      combineWith: "AND",
      boostDocument: (i) => boost[i as number],
    },
  });
  mini.addAll(items.map(([, title, alts], i) => ({ i, title, alts })));

  const serviceCounts = Object.fromEntries(SERVICES.map((s) => [s, 0])) as Record<ServiceName, number>;
  for (const [, , , , , , services] of items) {
    for (const s of servicesOf(services)) serviceCounts[s]++;
  }

  return {
    size: items.length,
    version: index.version,
    serviceCounts,
    search(query) {
      if (query.trim().length < MIN_QUERY_LENGTH) return [];
      return mini
        .search(query)
        .slice(0, MAX_RESULTS)
        .map(({ id }) => {
          const [itemId, title, alts, year, series, , services, poster, svtPath, imdb] = items[id as number];
          return {
            id: itemId,
            title,
            alts,
            year: year || null,
            series: series === 1,
            services: servicesOf(services),
            poster: expandPoster(poster),
            svtUrl: svtPath ? `https://www.svtplay.se${svtPath}` : null,
            // Saknas i kataloger som cachades innan betygen fanns.
            imdbRating: imdb ? imdb / 10 : null,
          };
        });
    },
  };
}
