import { describe, expect, it } from "vite-plus/test";
import { testD1 } from "./ingest/test-d1";
import { checkSyncPin, FAILURE_WINDOW_MS, MAX_FAILURES } from "./sync-pin";

const NOW = new Date("2026-10-18T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe("checkSyncPin", () => {
  it("godtar rätt kod och nekar fel kod", async () => {
    const { d1 } = testD1();
    expect(await checkSyncPin(d1, "4711", "4711", NOW)).toEqual({ ok: true });
    expect(await checkSyncPin(d1, "1234", "4711", NOW)).toEqual({ ok: false, reason: "wrong" });
    expect(await checkSyncPin(d1, 4711, "4711", NOW)).toEqual({ ok: false, reason: "wrong" });
    expect(await checkSyncPin(d1, undefined, "4711", NOW)).toEqual({ ok: false, reason: "wrong" });
  });

  it("nekar allt när serverns kod saknas eller har fel längd", async () => {
    const { d1 } = testD1();
    expect(await checkSyncPin(d1, "", "", NOW)).toMatchObject({ reason: "misconfigured" });
    expect(await checkSyncPin(d1, undefined, undefined, NOW)).toMatchObject({ reason: "misconfigured" });
    expect(await checkSyncPin(d1, "12345", "12345", NOW)).toMatchObject({ reason: "misconfigured" });
  });

  it("spärrar efter för många fel, även för rätt kod, tills det äldsta felet är en timme gammalt", async () => {
    const { d1 } = testD1();
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect(await checkSyncPin(d1, "0000", "4711", later(i * 60_000))).toMatchObject({ reason: "wrong" });
    }
    expect(await checkSyncPin(d1, "4711", "4711", later(10 * 60_000))).toEqual({
      ok: false,
      reason: "locked",
      retryAt: later(FAILURE_WINDOW_MS).toISOString(),
    });
    expect(await checkSyncPin(d1, "4711", "4711", later(FAILURE_WINDOW_MS + 1))).toEqual({ ok: true });
  });
});
