import { defineHandler, type InferProps } from "void";
import { db, sql } from "void/db";
import { availability, titles } from "@schema";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async () => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(titles);
  const perService = await db
    .select({ service: availability.service, count: sql<number>`count(*)` })
    .from(availability)
    .groupBy(availability.service);
  return { titleCount: count, perService };
});
