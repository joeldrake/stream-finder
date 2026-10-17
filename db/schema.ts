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
