import { defineHandler } from "void";
import { env } from "void/env";
import { isAuthorized } from "../../../src/admin-auth";
import { listImdbIds } from "../../../src/ingest/imdb";

// IMDb-id:n som scripts/update-ratings.ts ska hämta betyg för.
export const GET = defineHandler(async (c) => {
  if (!isAuthorized(c.req.header("authorization"), env.ADMIN_TOKEN)) return c.json({ error: "Unauthorized" }, 401);
  return { ids: await listImdbIds(c.env.DB) };
});
