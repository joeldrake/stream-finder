import { constantTimeEqual } from "./admin-auth";

// En PIN-kod på 4 tecken går att gissa, så felaktiga försök räknas i D1
// (gemensamt för alla, oberoende av IP). Efter MAX_FAILURES fel inom en
// timme spärras synkningen tills det äldsta felet är en timme gammalt.
export const PIN_LENGTH = 4;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 3_600_000;

export type PinCheck = { ok: true } | { ok: false; reason: "wrong" | "locked" | "misconfigured"; retryAt?: string };

export async function checkSyncPin(
  d1: D1Database,
  pin: unknown,
  secret: string | undefined,
  now: Date,
): Promise<PinCheck> {
  // Utan en riktig kod på servern ska ingen kunna synka, inte ens med en tom kod.
  if (!secret || [...secret].length !== PIN_LENGTH) return { ok: false, reason: "misconfigured" };

  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS).toISOString();
  const { results } = await d1
    .prepare(
      `SELECT failed_at AS failedAt FROM sync_pin_failures
       WHERE failed_at > ?1 ORDER BY failed_at LIMIT ?2`,
    )
    .bind(windowStart, MAX_FAILURES)
    .all<{ failedAt: string }>();
  // Spärren prövas före koden, så att en spärrad gissning inte avslöjar något.
  if (results.length >= MAX_FAILURES) {
    const retryAt = new Date(Date.parse(results[0].failedAt) + FAILURE_WINDOW_MS).toISOString();
    return { ok: false, reason: "locked", retryAt };
  }

  if (typeof pin === "string" && constantTimeEqual(pin, secret)) return { ok: true };

  await d1.batch([
    d1.prepare("DELETE FROM sync_pin_failures WHERE failed_at <= ?1").bind(windowStart),
    d1.prepare("INSERT INTO sync_pin_failures (failed_at) VALUES (?1)").bind(now.toISOString()),
  ]);
  return { ok: false, reason: "wrong" };
}
