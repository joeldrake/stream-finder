# stream-finder: plan och beslut

Arbetsdokument. Uppdateras när beslut tas eller ändras. Senast uppdaterad 2026-10-17.

## Mål

- Sök bland filmer och serier som finns på **SVT Play, Netflix, Disney+ och HBO Max** i Sverige.
- Varje sökträff visar vilka tjänster som har titeln.
- Katalogen ska vara så komplett som möjligt. **SVT Play prioriteras högst.**
- Sökningen ska gå blixtsnabbt. Allt söks lokalt i webbläsaren (local-first).
- Appen är **icke-kommersiell**.

## Översikt

```
TMDB discover (Netflix, Disney+, HBO Max) ─┐
                                            ├─► cron 1 gång/dygn ─► D1 (titlar + tillgänglighet)
SVT GraphQL (SVT Play) ────────────────────┘                              │
                                                                  bygg index + manifest
                                                                           │
                                                          storage (versionerad indexfil)
                                                                           │
                       Vue-klient: hämta manifest → ladda index vid ny version → IndexedDB → MiniSearch
```

## Beslut

| # | Beslut | Status |
|---|---|---|
| B1 | Indexet ligger lokalt i klienten och sökningen görs där | Beslutat |
| B2 | TMDB är källa för Netflix, Disney+ och HBO Max | Beslutat |
| B3 | SVT:s eget GraphQL-API är källa för SVT Play (hybrid) | Beslutat |
| B4 | Katalogen uppdateras en gång per dygn | Beslutat |
| B5 | Sökbiblioteket är MiniSearch, inte Fuse.js | Beslutat |
| B6 | Stacken är Void (Vite+ + Cloudflare: Workers, D1, cron, köer, storage) med Vue | Beslutat |
| B7 | Supabase används inte, åtminstone inte till att börja med | Preliminärt |
| B8 | Titlar har egna id:n, inte TMDB-id som primärnyckel | Beslutat |

### B1: Lokal sökning

Hela katalogen får plats i klienten. Uppmätt 2026-10-17: 16 584 titlar från TMDB blir **1,1 MB som kompakt JSON och 365 kB med gzip**. Med SVT:s titlar ovanpå hamnar vi gissningsvis under 500 kB med gzip. Indexet cachas i IndexedDB och laddas bara om när manifestets version ändras. Sökningen klarar sig då utan nätverk.

### B2: TMDB för de kommersiella tjänsterna

- Netflix, Disney+ och HBO Max har inga öppna katalog-API:er. Att skrapa dem bryter mot deras villkor.
- TMDB:s tillgänglighetsdata kommer från JustWatch, och **attribution till JustWatch krävs**.
- TMDB:s villkor tillåter icke-kommersiellt bruk gratis.
- Endpoint: `GET /3/discover/{movie|tv}?watch_region=SE&with_watch_providers={id}&with_watch_monetization_types=flatrate|free&language=sv-SE&page=N`
- Varje fråga ger max 500 sidor × 20 = 10 000 träffar. Ingen kombination når det i dag (Netflix-filmer är störst med 6 396). Om en kombination når taket måste frågan delas upp per årtal (`primary_release_date.gte/lte` respektive `first_air_date.gte/lte`).

**Provider-id:n i Sverige (TMDB):**

| Tjänst | id | Kommentar |
|---|---|---|
| Netflix | 8 | `175` Netflix Kids ingår inte |
| Disney+ | 337 | |
| HBO Max | 1899 | `1825` HBO Max Amazon Channel ingår inte |
| SVT Play | 493 | Används inte, se B3 |

**Mätning 2026-10-17** (`flatrate|free`):

| Tjänst | Filmer | Serier |
|---|---|---|
| Netflix | 6 396 | 2 812 |
| Disney+ | 2 498 | 987 |
| HBO Max | 965 | 1 252 |
| SVT Play | 1 364 | 959 |

Det är 865 sidor totalt. Med 8 parallella anrop tog en full hämtning cirka 2 minuter, utan fel. Efter dubblettrensning blev det 16 584 unika titlar. 624 av dem finns på mer än en tjänst.

### B3: SVT Play via SVT:s eget API (hybrid)

Först var tanken att använda bara TMDB. Mätningen visade att TMDB inte räcker för SVT Play.

**TMDB-täckning av SVT:s faktiska utbud** (SVT:s A–Ö 2026-10-17, matchat på normaliserat namn):

| SVT-typ | Antal hos SVT | Hittas i TMDB som SVT Play |
|---|---|---|
| Single (filmer, dokumentärer, enskilda program) | 1 944 | 51 % |
| TvSeries | 1 159 | 51 % |
| KidsTvShow | 205 | 39 % |
| TvSeriesStandaloneSeasons | 78 | 38 % |
| TvShow | 265 | 9 % |
| CurrentAffairs | 185 | 0 % |
| **Totalt** | **3 846** | **45 %** |

Ett stickprov på 25 missade titlar kontrollerades manuellt mot TMDB:
- 19 finns inte alls i TMDB (svenskt arkiv, dokumentärer och SVT-egna produktioner).
- 5 finns i TMDB men saknar SVT-markering. Flera är från 2026, så JustWatch ligger efter.
- 1 berodde på att titeln stavas olika.

Dessutom pekar 570 av TMDB:s 2 323 SVT-titlar på titlar som inte finns i SVT:s A–Ö just nu, troligen utgångna.

**Slutsats:** SVT:s eget API ger 100 % av utbudet med korrekta utgångsdatum, och det kostar ett anrop per dygn. SVT-titlar som saknas i TMDB tas ändå med i indexet.

**API:t:** `POST https://contento.svt.se/graphql`. Det är öppet, kräver ingen nyckel och tar emot egna frågor (introspection fungerar). API:t är **inofficiellt och kan ändras utan förvarning**, och det har vi accepterat.

| Fråga | Titlar (2026-10-17) | Svarstid |
|---|---|---|
| `programAtillO { flat { … } }` | 3 846 | ~0,8 s |
| `allTitlesForSearchIndexer { … }` | 4 116 | ~0,6 s |

Vi använder unionen av båda, cirka 4 200 titlar, hämtade i en och samma GraphQL-fråga (~2 MB utan avsnittslistor). Båda listorna innehåller titlar som inte går att se, så de filtreras:
- **Filmer (`Single`):** `validTo` måste ligga i framtiden.
- **Serier (övriga typer):** `numberOfActiveEpisodes` måste vara större än 0.

Efter filtret återstår **3 972 titlar** (2026-10-17). Av de 333 extra titlarna från `allTitlesForSearchIndexer` var flera utgångna filmer eller serier utan avsnitt, och A–Ö innehöll själv 92 serier med 0 aktiva avsnitt.

Bilder finns som `https://www.svtstatic.se/image/custom/{bredd}/{image.id}/{image.changed}`. Det är liggande bilder, inte affischer.

Användbara fält på `Content`/`Single`: `svtId`, `name`, `titleType`, `urls.svtplay`, `genres`, `countriesOfOrigin`, `popularity`, `barn`, `oppetArkiv`, och för `Single` även `productionYear`, `originalProgramTitle` och `validTo`. För serier finns år och `validTo` per avsnitt via `episodes`.

Exempelfråga:

```graphql
{
  programAtillO {
    flat {
      svtId name titleType slug popularity barn oppetArkiv
      urls { svtplay }
      genres { name }
      ... on Single { productionYear originalProgramTitle validTo }
      episodes { validTo productionYear }
    }
  }
}
```

**Använd inte SVT:s sitemaps som källa.** `sitemap-details*.xml` innehåller över 16 000 URL:er, och stickprov visade att många är utgångna ("inte tillgängligt längre").

**Skyddsnät:** om SVT-anropet misslyckas eller ger misstänkt få titlar (under ~3 000) behålls gårdagens SVT-data och en varning loggas.

### B4: Uppdatering en gång per dygn

Det räcker för användningen och håller anropen till TMDB och SVT nere. Ett cron-jobb lägger TMDB-sidorna i en kö, eftersom ett enda Worker-anrop inte hinner med 865 anrop.

### B5: MiniSearch

- Fuse.js har inget index. Den jämför sökordet mot varje titel vid varje tangenttryck, vilket blir ungefär 50 000 jämförelser med två titelfält per titel. Det kan kännas segt på mobil.
- MiniSearch har ett inverterat index med prefix- och fuzzy-matchning per ord och ger träffar på under en millisekund.
- Indexet kan serialiseras (`toJSON`/`loadJSON`) och byggas färdigt på servern.
- Popularitet vägs in med `boostDocument`.
- Normalisera å/ä/ö och diakritiska tecken konsekvent.
- Sökningen ska ligga bakom en egen funktion `search(query)`, så att biblioteket går att byta.

### B6–B7: Stack

- **Void** bygger på Vite och deployar till Cloudflare. Det ger D1, storage, köer, schemalagda jobb och en Vue-adapter, och täcker därmed allt pipelinen behöver.
- **Supabase** blir aktuellt först om vi behöver inloggning eller användardata (bevakningslistor, "mina tjänster"). Kontrollera i så fall först om det går att lösa i Void. Void har också en egen auth (`void/auth`).

**Uppsättning (2026-10-17):**
- Void 1.1.11 (släpptes 2026-10-15, alltså mycket nytt), `@void/vue`, Vite+ 1.3.0 (`vp dev`/`vp build`), pnpm 10.
- Pages-läge: `pages/*.vue` med en `*.server.ts` bredvid för loaders. D1-schemat ligger i `db/schema.ts` (Drizzle) och migreringarna i `db/migrations/`.
- Miljövariabler: schemat i `env.ts`, lokala värden i `.env`, produktionsvärden via `void secret put`. Void läser inte `.env.example`.
- `void init` är interaktiv och väljer Cloudflare-deploy som standard, vilket startar en inloggning. Projektet scaffoldades därför med Voids interna `scaffoldPagesApp(root, 'pnpm', 'vue', 'sqlite', 'vite-plus')` följt av `void init --tsconfig`. Deploy-målet är inte valt än: kör `void deploy --platform cloudflare` första gången.
- Void genererar `allowBuilds` i `pnpm-workspace.yaml`, men pnpm 10.10 läser bara `onlyBuiltDependencies`, så båda står med.
- Vanliga kommandon: `pnpm dev`, `pnpm void db generate`, `pnpm void db migrate`, `pnpm void db seed`. Voids egen dokumentation finns lokalt i `node_modules/void/docs/`.

### B8: Egna id:n

SVT-titlar saknar ofta TMDB-motsvarighet, så id:n är oberoende av källan:
- `tmdb:movie:{id}` och `tmdb:tv:{id}` för TMDB-titlar
- `svt:{svtId}` för SVT-titlar utan TMDB-matchning

**Matchning SVT ↔ TMDB:** i första hand originaltitel + år, i andra hand svensk titel + år, och för filmer typen `Single`, för serier övriga typer. Vid träff slås SVT:s tillgänglighet ihop med TMDB-titeln, så att posters och övriga tjänster följer med. Utan träff blir det en egen SVT-post. Hur bra matchningen blir är inte mätt än.

## Datamodell (utkast, D1)

```sql
titles (
  id            TEXT PRIMARY KEY,   -- tmdb:movie:123 | tmdb:tv:456 | svt:jnG14JK
  kind          TEXT NOT NULL,      -- movie | series
  title         TEXT NOT NULL,      -- svensk titel
  original_title TEXT,
  year          INTEGER,
  popularity    REAL,
  poster        TEXT,               -- TMDB poster_path eller SVT-bild-URL
  tmdb_id       INTEGER,
  svt_id        TEXT
)

availability (
  title_id   TEXT NOT NULL REFERENCES titles(id),
  service    TEXT NOT NULL,         -- svt | netflix | disney | hbomax
  url        TEXT,                  -- direktlänk där den finns (SVT)
  valid_to   TEXT,                  -- utgångsdatum där det finns (SVT)
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  PRIMARY KEY (title_id, service)
)
```

Med `first_seen`/`last_seen` går det att räkna fram "nytt" och "har försvunnit". Med `valid_to` går det att visa "försvinner snart" för SVT.

## Indexformat (utkast)

En kompakt rad per titel: `[id, titel, originaltitel (tom om samma), år, popularitet, tjänster]`. Tjänsterna kan lagras som bitmask. `manifest.json` innehåller `{ version, url, count, builtAt }`.

## Öppna frågor

- [ ] Hur många SVT-titlar matchar mot TMDB med strategin under B8?
- [ ] Går de 333 titlarna som bara finns i `allTitlesForSearchIndexer` att se?
- [ ] Hur många av TMDB:s titlar för Netflix, Disney+ och HBO Max är inaktuella, alltså samma problem som de 570 för SVT?
- [x] Hur sköter Void schemalagda jobb och köer? Cron-jobb ligger i `crons/*.ts` (`export const cron` + `defineScheduled`), köer i `queues/*.ts` (`defineQueue<T>`) och skickas med `queues.<namn>.send()`. Lokalt triggas de via `POST /__void/scheduled` och `/__void/queue` med den token som dev-servern skriver ut. Det finns ingen dead-letter-kö som standard.
- [ ] Var och hur visar vi attributionen till JustWatch och TMDB?
- [ ] Ska nyheter, sport och samhällsprogram från SVT (till exempel "Svenska nyheter" och "Bordtennis-EM") vara sökbara? I dag kommer de med. SVT:s `titleType` sparas inte, så om vi vill filtrera på typ måste den läggas till i schemat.
- [ ] Workers CPU-gräns: gratisplanen har 10 ms CPU per anrop. Att tolka SVT:s ~2 MB JSON kan ta längre tid än så. Mät efter första deploy, och räkna med att Workers Paid kan behövas.

**Tester:** kör `pnpm test`. Vitest använder [vitest.config.ts](../vitest.config.ts) utan `voidPlugin()`, eftersom Cloudflare-pluginet inte går att starta i Vitest. Importera från `vite-plus/test`, inte från `vitest`. SQL-upserten testas mot riktig SQLite (`node:sqlite`) med migrationerna i `db/migrations`.

**Köra ett cron-jobb lokalt:** med `pnpm dev` igång:
```
curl -X POST http://localhost:5173/__void/scheduled -H "Content-Type: application/json" \
  -H "x-void-dev-trigger: $(cat .void/dev-trigger-token)" \
  -d '{"cron":"0 4 * * *","scheduledTime":'"$(date +%s000)"'}'
```

## Nästa steg

1. ~~Sätt upp ett Void-projekt med Vue.~~ Klart 2026-10-17: schemat `titles`/`availability` är migrerat och startsidan visar antal titlar.
2. Inläsning: SVT-jobb, TMDB-jobb via kö, upsert till D1.
   - ~~SVT-jobbet~~ Klart 2026-10-17: [crons/ingest-svt.ts](../crons/ingest-svt.ts) körs 04:00 UTC, logiken ligger i [src/ingest/svt.ts](../src/ingest/svt.ts). Upsert sker med `json_each`, så att en hel chunk om 1 000 rader går i en fråga. Det håller nere antalet D1-frågor per körning. En lokal körning tar ~0,7 s.
   - TMDB-jobbet via kö.
3. Matchning mellan SVT och TMDB, och mät hur bra den blir.
4. Bygg index och manifest.
5. Vue-klient med IndexedDB och MiniSearch.
6. Finlir: filter per tjänst, "nytt/försvinner snart", attribution.
