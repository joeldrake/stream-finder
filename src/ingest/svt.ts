import { upsertCatalog, type CatalogRow } from "./catalog";

// SVT:s öppna men inofficiella GraphQL-API (se docs/PLAN.md B3).
const SVT_GRAPHQL_URL = "https://contento.svt.se/graphql";
const USER_AGENT = "stream-finder/0.1 (personal, non-commercial)";

// Färre än så här tyder på att API:t har ändrats eller svarat ofullständigt.
// Då skrivs inget, och gårdagens data ligger kvar. Normalt ~4 000.
export const MIN_EXPECTED_TITLES = 3000;

const FIELDS = `
  svtId name titleType popularity numberOfActiveEpisodes
  urls { svtplay }
  image { id changed }
  ... on Single { productionYear originalProgramTitle validTo }`;

const QUERY = `{
  programAtillO { flat { ${FIELDS} } }
  allTitlesForSearchIndexer { ${FIELDS} }
}`;

export interface SvtContent {
  svtId: string;
  name: string;
  titleType: string;
  popularity: number;
  numberOfActiveEpisodes: number;
  urls: { svtplay: string };
  image: { id: string; changed: number } | null;
  productionYear?: number | null;
  originalProgramTitle?: string | null;
  validTo?: string | null;
}

interface SvtResponse {
  data?: {
    programAtillO?: { flat?: SvtContent[] };
    allTitlesForSearchIndexer?: SvtContent[];
  };
  errors?: { message: string }[];
}

// Unionen av A–Ö och sökindexet; A–Ö vinner vid dubbletter.
export async function fetchSvtCatalog(fetchFn: typeof fetch = fetch): Promise<SvtContent[]> {
  const res = await fetchFn(SVT_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`SVT GraphQL svarade ${res.status}`);

  const body = (await res.json()) as SvtResponse;
  if (body.errors?.length) {
    throw new Error(`SVT GraphQL-fel: ${body.errors.map((e) => e.message).join("; ")}`);
  }

  const byId = new Map<string, SvtContent>();
  for (const item of [
    ...(body.data?.programAtillO?.flat ?? []),
    ...(body.data?.allTitlesForSearchIndexer ?? []),
  ]) {
    if (!byId.has(item.svtId)) byId.set(item.svtId, item);
  }
  return [...byId.values()];
}

// Båda listorna innehåller titlar som inte går att se: utgångna filmer och
// serier utan sändbara avsnitt.
export function isAvailable(item: SvtContent, now: Date): boolean {
  if (item.titleType === "Single") {
    return item.validTo != null && Date.parse(item.validTo) > now.getTime();
  }
  return item.numberOfActiveEpisodes > 0;
}

export function toCatalogRow(item: SvtContent): CatalogRow {
  const original = item.originalProgramTitle?.trim();
  return {
    id: `svt:${item.svtId}`,
    // "Single" är filmer men också dokumentärer och enskilda program.
    kind: item.titleType === "Single" ? "movie" : "series",
    title: item.name,
    originalTitle: original && original !== item.name ? original : null,
    year: item.productionYear ?? null,
    popularity: item.popularity,
    poster: item.image
      ? `https://www.svtstatic.se/image/custom/400/${item.image.id}/${item.image.changed}`
      : null,
    tmdbId: null,
    svtId: item.svtId,
    url: `https://www.svtplay.se${item.urls.svtplay}`,
    validTo: item.validTo ?? null,
  };
}

export async function ingestSvt(
  d1: D1Database,
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<{ fetched: number; available: number }> {
  const items = await fetchSvtCatalog(fetchFn);
  const rows = items.filter((item) => isAvailable(item, now)).map(toCatalogRow);

  if (rows.length < MIN_EXPECTED_TITLES) {
    throw new Error(
      `SVT gav bara ${rows.length} tillgängliga titlar (av ${items.length}), väntade minst ${MIN_EXPECTED_TITLES}. Inget skrevs.`,
    );
  }

  await upsertCatalog(d1, "svt", rows, now.toISOString());
  return { fetched: items.length, available: rows.length };
}
