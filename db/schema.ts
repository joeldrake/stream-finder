import { index, integer, primaryKey, real, sqliteTable, text } from "void/schema-d1";

// En titel per film/serie. id är källoberoende (se docs/PLAN.md B8):
// "tmdb:movie:123" | "tmdb:tv:456" | "svt:jnG14JK"
export const titles = sqliteTable("titles", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["movie", "series"] }).notNull(),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  year: integer("year"),
  popularity: real("popularity"),
  poster: text("poster"),
  tmdbId: integer("tmdb_id"),
  svtId: text("svt_id"),
});

export const availability = sqliteTable(
  "availability",
  {
    titleId: text("title_id")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    service: text("service", { enum: ["svt", "netflix", "disney", "hbomax"] }).notNull(),
    url: text("url"),
    validTo: text("valid_to"),
    firstSeen: text("first_seen").notNull(),
    lastSeen: text("last_seen").notNull(),
  },
  (t) => [primaryKey({ columns: [t.titleId, t.service] }), index("availability_service_idx").on(t.service)],
);

// Resultatet av att söka upp en SVT-titel i TMDB. Ligger separat från titles,
// så att SVT-jobbets dagliga upsert inte skriver över det. tmdb_id är null när
// sökningen inte gav någon träff; checked_at styr när vi söker igen.
export const svtMatches = sqliteTable("svt_matches", {
  svtId: text("svt_id").primaryKey(),
  tmdbKind: text("tmdb_kind", { enum: ["movie", "tv"] }),
  tmdbId: integer("tmdb_id"),
  title: text("title"),
  originalTitle: text("original_title"),
  year: integer("year"),
  poster: text("poster"),
  popularity: real("popularity"),
  checkedAt: text("checked_at").notNull(),
});

// IMDb-betyg per TMDB-titel ("tmdb:movie:123"). IMDb-id:t hämtas från TMDB
// av Workern (imdb_id är null om TMDB saknar det); betygen laddas upp av
// scripts/update-ratings.ts, som körs utanför Workern (se docs/PLAN.md).
export const imdbRatings = sqliteTable(
  "imdb_ratings",
  {
    tmdbKey: text("tmdb_key").primaryKey(),
    imdbId: text("imdb_id"),
    checkedAt: text("checked_at").notNull(),
    rating: real("rating"),
    votes: integer("votes"),
    ratedAt: text("rated_at"),
  },
  (t) => [index("imdb_ratings_imdb_id_idx").on(t.imdbId)],
);

// En synkning, startad med knappen i UI:t (POST /api/sync). Stegen körs i
// ordning: "fetch" (TMDB-sidor och SVT-matchning i köer), "imdb" (IMDb-id i
// kö) och "publish" (bygg katalogen). pending är antalet kömeddelanden som
// återstår i det pågående steget; när det når 0 startar nästa steg.
export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  stage: text("stage", { enum: ["starting", "fetch", "imdb", "publish"] }).notNull(),
  pending: integer("pending").notNull(),
  error: text("error"),
});

// Felaktiga PIN-koder till POST /api/sync. Efter för många fel inom en timme
// spärras synkknappen tillfälligt, så att koden inte kan gissas.
export const syncPinFailures = sqliteTable("sync_pin_failures", {
  failedAt: text("failed_at").notNull(),
});
