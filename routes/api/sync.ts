import { defineHandler } from "void";
import { env } from "void/env";
import { getSyncStatus, startSync } from "../../src/sync";
import { syncDeps } from "../../src/sync-deps";
import { checkSyncPin } from "../../src/sync-pin";

// Status för synkningen: pågår den, och hur gick den senaste?
export const GET = defineHandler(async (c) => {
  c.header("cache-control", "no-store");
  return getSyncStatus(c.env.DB, new Date());
});

// Startar en synkning (knappen i UI:t): { pin: "1234" }. 409 om en redan pågår.
export const POST = defineHandler(async (c) => {
  const now = new Date();
  const body = (await c.req.json().catch(() => null)) as { pin?: unknown } | null;

  const pin = await checkSyncPin(c.env.DB, body?.pin, env.SYNC_PIN, now);
  if (!pin.ok) {
    if (pin.reason === "misconfigured") {
      console.error("SYNC_PIN saknas eller är inte exakt 4 tecken");
      return c.json({ error: "Synkning är inte konfigurerad på servern" }, 500);
    }
    if (pin.reason === "locked") {
      return c.json({ error: "För många felaktiga försök. Försök igen senare.", retryAt: pin.retryAt }, 429);
    }
    return c.json({ error: "Fel PIN-kod" }, 403);
  }

  try {
    if (!(await startSync(syncDeps(c.env.DB), now))) {
      return c.json({ error: "En synkning pågår redan", ...(await getSyncStatus(c.env.DB, now)) }, 409);
    }
  } catch (error) {
    return c.json({ error: (error as Error).message, ...(await getSyncStatus(c.env.DB, now)) }, 502);
  }
  return c.json(await getSyncStatus(c.env.DB, now), 202);
});
