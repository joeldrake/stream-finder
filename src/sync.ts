import { KEYS_PER_MESSAGE, keysToLookup } from "./ingest/imdb";
import { TITLES_PER_MESSAGE, titlesToMatch, type SvtMatchInput } from "./ingest/match";
import { ingestSvt } from "./ingest/svt";
import { planTmdbPages, type TmdbPageMessage } from "./ingest/tmdb";

// En synkning startas med knappen i UI:t och går igenom tre steg (se
// sync_runs i db/schema.ts):
//
//   1. Läs in SVT, och köa TMDB-sidorna och SVT-titlarna som ska matchas.
//   2. När de köerna är tomma: köa uppslagningen av IMDb-id.
//   3. När den kön är tom: bygg och publicera katalogen.
//
// Köerna rapporterar hur många meddelanden som blivit klara, så att nästa steg
// kan starta så fort det föregående är färdigt.

// En körning som pågått så här länge räknas som avbruten (ett kömeddelande
// kan till exempel ha försvunnit), och då får en ny synkning startas.
export const STALE_AFTER_MS = 3 * 3_600_000;

export interface MatchBody {
  titles: SvtMatchInput[];
  runId?: string;
}

export interface ImdbBody {
  keys: string[];
  runId?: string;
}

export interface SyncDeps {
  d1: D1Database;
  apiKey: string;
  sendTmdb(bodies: TmdbPageMessage[]): Promise<void>;
  sendMatch(bodies: MatchBody[]): Promise<void>;
  sendImdb(bodies: ImdbBody[]): Promise<void>;
  publish(now: Date): Promise<void>;
  fetchFn?: typeof fetch;
}

export interface SyncStatus {
  running: { startedAt: string; stage: string } | null;
  last: { startedAt: string; finishedAt: string; error: string | null } | null;
}

type Stage = "starting" | "fetch" | "imdb" | "publish";

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function getSyncStatus(d1: D1Database, now: Date): Promise<SyncStatus> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const { results: running } = await d1
    .prepare(
      `SELECT started_at AS startedAt, stage FROM sync_runs
       WHERE finished_at IS NULL AND started_at > ?1 ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(staleBefore)
    .all<{ startedAt: string; stage: string }>();
  const { results: last } = await d1
    .prepare(
      `SELECT started_at AS startedAt, finished_at AS finishedAt, error FROM sync_runs
       WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
    )
    .bind()
    .all<{ startedAt: string; finishedAt: string; error: string | null }>();
  return { running: running[0] ?? null, last: last[0] ?? null };
}

// Skapar en körning, om ingen annan pågår. Gamla körningar som aldrig blev
// klara avslutas med ett fel.
async function beginRun(d1: D1Database, runId: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  await d1
    .prepare(
      `UPDATE sync_runs SET finished_at = ?1, error = 'Blev aldrig klar'
       WHERE finished_at IS NULL AND started_at <= ?2`,
    )
    .bind(now.toISOString(), staleBefore)
    .run();
  const { results } = await d1
    .prepare(
      `INSERT INTO sync_runs (id, started_at, stage, pending)
       SELECT ?1, ?1, 'starting', 0
       WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE finished_at IS NULL)
       RETURNING id`,
    )
    .bind(runId)
    .all();
  return results.length > 0;
}

// Byter steg om det nuvarande är klart. Bara ett anrop vinner, även om flera
// köbatchar blir klara samtidigt.
async function claimStage(d1: D1Database, runId: string, from: Stage, to: Stage, pending: number): Promise<boolean> {
  const { results } = await d1
    .prepare(
      `UPDATE sync_runs SET stage = ?3, pending = ?4
       WHERE id = ?1 AND stage = ?2 AND pending <= 0 AND finished_at IS NULL
       RETURNING id`,
    )
    .bind(runId, from, to, pending)
    .all();
  return results.length > 0;
}

async function finishRun(d1: D1Database, runId: string, now: Date, error: string | null): Promise<void> {
  await d1
    .prepare(
      `UPDATE sync_runs SET finished_at = ?2,
         error = CASE WHEN ?3 IS NULL THEN error ELSE coalesce(error || '; ', '') || ?3 END
       WHERE id = ?1 AND finished_at IS NULL`,
    )
    .bind(runId, now.toISOString(), error)
    .run();
}

// Startar en synkning. Ger false om en annan redan pågår.
export async function startSync(deps: SyncDeps, now: Date): Promise<boolean> {
  const { d1 } = deps;
  const runId = now.toISOString();
  if (!(await beginRun(d1, runId, now))) return false;

  try {
    let warning: string | null = null;
    try {
      await ingestSvt(d1, now, deps.fetchFn);
    } catch (error) {
      // Den senaste SVT-datan ligger kvar, och resten av synkningen körs ändå.
      warning = `SVT: ${message(error)}`;
      console.warn(warning);
    }

    // seenAt är körningens id; TMDB-sidorna bär det redan.
    const tmdb = await planTmdbPages(deps.apiKey, runId, deps.fetchFn);
    const match = chunk(await titlesToMatch(d1, now), TITLES_PER_MESSAGE).map((titles) => ({ titles, runId }));

    // Antalet sätts innan meddelandena skickas, så att räkningen inte hinner gå under 0.
    await d1
      .prepare("UPDATE sync_runs SET stage = 'fetch', pending = ?2, error = ?3 WHERE id = ?1")
      .bind(runId, tmdb.length + match.length, warning)
      .run();
    await deps.sendTmdb(tmdb);
    await deps.sendMatch(match);
    console.log(`Synkning ${runId}: ${tmdb.length} TMDB-sidor och ${match.length} matchningsmeddelanden köade`);

    if (tmdb.length + match.length === 0) await advance(deps, runId, "fetch");
    return true;
  } catch (error) {
    await finishRun(d1, runId, new Date(), message(error));
    throw error;
  }
}

// Anropas av köerna när meddelanden i en körning är klara.
export async function messagesSettled(deps: SyncDeps, runId: string, count: number): Promise<void> {
  const { results } = await deps.d1
    .prepare(
      `UPDATE sync_runs SET pending = pending - ?2
       WHERE id = ?1 AND finished_at IS NULL
       RETURNING stage, pending`,
    )
    .bind(runId, count)
    .all<{ stage: Stage; pending: number }>();
  const run = results[0];
  if (!run || run.pending > 0) return;

  try {
    await advance(deps, runId, run.stage);
  } catch (error) {
    // Kastas inte vidare: då skulle kön försöka igen och räkna meddelandena två gånger.
    console.error(`Synkning ${runId}: ${message(error)}`);
    await finishRun(deps.d1, runId, new Date(), message(error));
  }
}

async function advance(deps: SyncDeps, runId: string, stage: Stage): Promise<void> {
  const { d1 } = deps;
  if (stage === "fetch") {
    const keys = await keysToLookup(d1, new Date());
    const imdb = chunk(keys, KEYS_PER_MESSAGE).map((keys) => ({ keys, runId }));
    if (!(await claimStage(d1, runId, "fetch", "imdb", imdb.length))) return;
    console.log(`Synkning ${runId}: ${keys.length} titlar köade för IMDb-id`);
    if (imdb.length > 0) return deps.sendImdb(imdb);
    stage = "imdb";
  }
  if (stage === "imdb") {
    if (!(await claimStage(d1, runId, "imdb", "publish", 0))) return;
    const now = new Date();
    await deps.publish(now);
    await finishRun(d1, runId, now, null);
    console.log(`Synkning ${runId}: klar`);
  }
}

export interface TrackedMessage<B> {
  readonly body: B;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

// Kör process på en köbatch och räknar, per körning, hur många meddelanden
// som blev klara: kvitterade, eller på sitt sista försök (då kommer de inte
// tillbaka). Meddelanden utan eget beslut kvitteras om process lyckas och
// försöks igen om den kastar.
export async function processTracked<B>(
  messages: readonly TrackedMessage<B>[],
  maxRetries: number,
  runIdOf: (body: B) => string | undefined,
  process: (messages: TrackedMessage<B>[]) => Promise<void>,
  onSettled: (runId: string, count: number) => Promise<void>,
): Promise<void> {
  const decided = new Set<TrackedMessage<B>>();
  const settled: TrackedMessage<B>[] = [];
  const isLastAttempt = (msg: TrackedMessage<B>) => msg.attempts > maxRetries;

  const wrapped = messages.map(
    (msg): TrackedMessage<B> => ({
      body: msg.body,
      attempts: msg.attempts,
      ack() {
        if (!decided.has(msg)) settled.push(msg);
        decided.add(msg);
        msg.ack();
      },
      retry(options) {
        if (!decided.has(msg) && isLastAttempt(msg)) settled.push(msg);
        decided.add(msg);
        msg.retry(options);
      },
    }),
  );

  let failure: { error: unknown } | null = null;
  try {
    await process(wrapped);
  } catch (error) {
    failure = { error };
  }
  for (const msg of messages) {
    if (!decided.has(msg) && (!failure || isLastAttempt(msg))) settled.push(msg);
  }

  const counts = new Map<string, number>();
  for (const msg of settled) {
    const runId = runIdOf(msg.body);
    if (runId) counts.set(runId, (counts.get(runId) ?? 0) + 1);
  }
  for (const [runId, count] of counts) await onSettled(runId, count);

  if (failure) throw failure.error;
}
