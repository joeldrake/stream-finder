import { defineSeed } from "void/seed";

export default defineSeed<typeof import("./schema")>(async ({ db, schema }) => {
  const now = new Date().toISOString();
  await db.insert(schema.titles).values({
    id: "tmdb:movie:438631",
    kind: "movie",
    title: "Dune",
    originalTitle: "Dune",
    year: 2021,
    tmdbId: 438631,
  });
  await db.insert(schema.availability).values({
    titleId: "tmdb:movie:438631",
    service: "hbomax",
    firstSeen: now,
    lastSeen: now,
  });
});
