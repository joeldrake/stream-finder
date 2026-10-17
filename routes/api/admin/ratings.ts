import { defineHandler } from "void";
import { env } from "void/env";
import { isAuthorized } from "../../../src/admin-auth";
import { applyRatings, isImdbRating } from "../../../src/ingest/imdb";

// Tar emot IMDb-betyg från scripts/update-ratings.ts: { ratings: [[imdbId, betyg, röster], ...] }.
export const POST = defineHandler(async (c) => {
  if (!isAuthorized(c.req.header("authorization"), env.ADMIN_TOKEN)) return c.json({ error: "Unauthorized" }, 401);

  const body = (await c.req.json().catch(() => null)) as { ratings?: unknown } | null;
  if (!Array.isArray(body?.ratings) || !body.ratings.every(isImdbRating)) {
    return c.json({ error: "Förväntade { ratings: [[imdbId, betyg, röster], ...] }" }, 400);
  }
  await applyRatings(c.env.DB, body.ratings, new Date().toISOString());
  return { received: body.ratings.length };
});
