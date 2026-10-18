import { describe, expect, it, vi } from "vite-plus/test";
import { upsertCatalog } from "./ingest/catalog";
import type { TmdbPageMessage } from "./ingest/tmdb";
import { testD1 } from "./ingest/test-d1";
import {
  getSyncStatus,
  messagesSettled,
  processTracked,
  startSync,
  STALE_AFTER_MS,
  type ImdbBody,
  type MatchBody,
  type SyncDeps,
  type TrackedMessage,
} from "./sync";

const NOW = new Date("2026-10-18T10:00:00Z");
const RUN = NOW.toISOString();

// SVT svarar 500; TMDB:s discover har en sida per tjänst och typ (6 sidor).
const fakeFetch = (async (input: Request | string) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("svt.se")) return new Response("", { status: 500 });
  return Response.json({ page: 1, total_pages: 1, total_results: 0, results: [] });
}) as typeof fetch;

function deps(d1: D1Database) {
  return {
    d1,
    apiKey: "key",
    sendTmdb: vi.fn(async (_bodies: TmdbPageMessage[]) => {}),
    sendMatch: vi.fn(async (_bodies: MatchBody[]) => {}),
    sendImdb: vi.fn(async (_bodies: ImdbBody[]) => {}),
    publish: vi.fn(async () => {}),
    fetchFn: fakeFetch,
  } satisfies SyncDeps;
}

const runRow = (db: ReturnType<typeof testD1>["db"]) => db.prepare("SELECT * FROM sync_runs WHERE id = ?").get(RUN);

describe("startSync", () => {
  it("köar TMDB-sidorna, sparar SVT-felet och tillåter bara en körning åt gången", async () => {
    const { db, d1 } = testD1();
    const d = deps(d1);

    expect(await startSync(d, NOW)).toBe(true);
    expect(d.sendTmdb.mock.calls[0][0]).toHaveLength(6);
    expect(d.sendTmdb.mock.calls[0][0][0]).toMatchObject({ seenAt: RUN });
    expect(runRow(db)).toMatchObject({ stage: "fetch", pending: 6, finished_at: null });
    expect((runRow(db) as { error: string }).error).toMatch(/^SVT: /);

    expect(await startSync(d, new Date(NOW.getTime() + 60_000))).toBe(false);
    expect((await getSyncStatus(d1, NOW)).running).toEqual({ startedAt: RUN, stage: "fetch" });
  });

  it("avslutar en körning som aldrig blev klar och startar en ny", async () => {
    const { db, d1 } = testD1();
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 1000).toISOString();
    db.exec(`INSERT INTO sync_runs (id, started_at, stage, pending) VALUES ('${old}', '${old}', 'fetch', 3)`);

    expect(await startSync(deps(d1), NOW)).toBe(true);
    expect(db.prepare("SELECT error FROM sync_runs WHERE id = ?").get(old)).toEqual({ error: "Blev aldrig klar" });
  });
});

describe("messagesSettled", () => {
  it("går vidare till IMDb-steget och sedan till publicering", async () => {
    const { db, d1 } = testD1();
    const d = deps(d1);
    await startSync(d, NOW);
    await upsertCatalog(
      d1,
      "netflix",
      [{ id: "tmdb:movie:1", kind: "movie", title: "A", originalTitle: null, year: null, popularity: 1, poster: null, tmdbId: 1, svtId: null, url: null, validTo: null }],
      RUN,
    );

    await messagesSettled(d, RUN, 5);
    expect(runRow(db)).toMatchObject({ stage: "fetch", pending: 1 });
    expect(d.sendImdb).not.toHaveBeenCalled();

    await messagesSettled(d, RUN, 1);
    expect(runRow(db)).toMatchObject({ stage: "imdb", pending: 1 });
    expect(d.sendImdb).toHaveBeenCalledWith([{ keys: ["tmdb:movie:1"], runId: RUN }]);
    expect(d.publish).not.toHaveBeenCalled();

    await messagesSettled(d, RUN, 1);
    expect(d.publish).toHaveBeenCalledOnce();
    expect(runRow(db)).toMatchObject({ stage: "publish" });
    const status = await getSyncStatus(d1, new Date());
    expect(status.running).toBeNull();
    expect(status.last?.startedAt).toBe(RUN);

    // Sena dubbletter påverkar inte en avslutad körning.
    await messagesSettled(d, RUN, 1);
    expect(d.publish).toHaveBeenCalledOnce();
  });

  it("publicerar direkt när inga titlar saknar IMDb-id", async () => {
    const { d1 } = testD1();
    const d = deps(d1);
    await startSync(d, NOW);
    await messagesSettled(d, RUN, 6);
    expect(d.sendImdb).not.toHaveBeenCalled();
    expect(d.publish).toHaveBeenCalledOnce();
  });

  it("avslutar körningen med fel om publiceringen misslyckas", async () => {
    const { db, d1 } = testD1();
    const d = deps(d1);
    d.publish.mockRejectedValueOnce(new Error("R2 nere"));
    await startSync(d, NOW);
    await messagesSettled(d, RUN, 6);
    expect((runRow(db) as { error: string; finished_at: string }).error).toMatch(/; R2 nere$/);
    expect((runRow(db) as { finished_at: string | null }).finished_at).not.toBeNull();
  });
});

describe("processTracked", () => {
  function msg(runId: string | undefined, attempts = 1) {
    return { body: { runId }, attempts, ack: vi.fn(), retry: vi.fn() } satisfies TrackedMessage<{ runId?: string }>;
  }
  const runIdOf = (b: { runId?: string }) => b.runId;

  it("räknar kvitterade meddelanden och sista försök, per körning", async () => {
    const [a, b, c, d, e] = [msg("r1"), msg("r1"), msg("r1", 6), msg("r2"), msg(undefined)];
    const settled = vi.fn(async () => {});
    await processTracked(
      [a, b, c, d, e],
      5,
      runIdOf,
      async ([a, b, c]) => {
        a.ack();
        b.retry(); // Kommer tillbaka.
        c.retry(); // Sista försöket.
        // d och e utan beslut: kvitteras när hanteraren lyckas.
      },
      settled,
    );
    expect(settled.mock.calls).toEqual([
      ["r1", 2],
      ["r2", 1],
    ]);
    expect(a.ack).toHaveBeenCalled();
    expect(b.retry).toHaveBeenCalled();
  });

  it("räknar bara sista försök när hanteraren kastar", async () => {
    const settled = vi.fn(async () => {});
    const run = processTracked(
      [msg("r1"), msg("r1", 6)],
      5,
      runIdOf,
      async () => {
        throw new Error("D1 nere");
      },
      settled,
    );
    await expect(run).rejects.toThrow("D1 nere");
    expect(settled.mock.calls).toEqual([["r1", 1]]);
  });
});
