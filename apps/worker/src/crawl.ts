/**
 * Cron trigger and queue consumer.
 *
 * The cron opens a run and fans domains out one message each; the consumer
 * probes them. One domain per message is deliberate: a slow site holds up only
 * itself, and a retry re-probes one domain rather than a batch.
 *
 * Politeness is unchanged from the pilot. The per-apex rate limit lives inside
 * the guarded client, so it holds however many consumers run; `max_concurrency`
 * in wrangler.jsonc bounds how many *different* apexes are in flight, well
 * inside the 64 the ethics document publishes.
 */

import {
  CANDIDATES_VERSION,
  GuardedHttpClient,
  METHODOLOGY_VERSION,
  ProbeGuardError,
  probeDomain,
  resolveCrawlerIdentity,
} from "@mcp-census/core";

import { dohResolveTxt, sleep, workerFetch } from "./adapters.js";
import { computeAggregates, computeDeltas } from "./deltas.js";
import type { CrawlMessage, Env } from "./env.js";
import { closeRun, loadOptOuts, openRun, persistScan, persistUnreachable } from "./store.js";

/**
 * Upper bounds on a night's work.
 *
 * These are backstops against a runaway run, not the intended size. If a real
 * population ever exceeds one, the run is silently incomplete — so
 * `selectDomains` reports the shortfall instead of truncating quietly. A census
 * that drops domains without saying so is indistinguishable from one that
 * measured them and found nothing.
 */
const MAX_FULL = 12_000;
/**
 * Initial delivery plus `max_retries` from wrangler.jsonc. Kept in step with that
 * file by hand, because the consumer cannot read its own queue configuration.
 */
const MAX_ATTEMPTS = 3;
/**
 * How long a run may stay open before the watchdog closes it.
 *
 * The full census takes about 95 minutes and the watchlist about 33, so six hours
 * is far outside normal and only trips on something genuinely stuck — a guard
 * violation, which acks without writing a row, or a message lost some other way.
 * Without this a single such domain freezes the delta pipeline permanently.
 */
const RUN_WATCHDOG_MS = 6 * 60 * 60 * 1000;
const MAX_WATCHLIST = 6_000;

/**
 * Which domains to probe tonight. Tiered per ADR 0004: the watchlist daily, the
 * full universe weekly, because nothing changes daily on a domain that has been
 * Absent for six months.
 *
 * Both queries order deterministically. An unordered LIMIT lets SQLite return a
 * different subset each night, which does not corrupt a delta — the comparison
 * inner-joins on apex, so a domain missing from either side simply yields no
 * change — but it does mean real transitions get missed at random, which is worse
 * than missing them predictably.
 */
async function selectDomains(
  env: Env,
  full: boolean,
  limit: number,
): Promise<{ domains: string[]; available: number }> {
  const from = full
    ? `FROM domains d WHERE d.opted_out_at IS NULL AND d.source = 'universe'`
    : // The watchlist: anything that has ever shown a discovery signal, plus the
      // conference cohort, which is small and always worth being current on.
      `FROM domains d
        WHERE d.opted_out_at IS NULL
          AND d.source = 'universe'
          AND (d.universe = 'D' OR EXISTS (
                SELECT 1 FROM scans s
                  JOIN check_results cr ON cr.scan_id = s.id
                 WHERE s.apex = d.apex
                   AND cr.check_id IN ('D1','D3','D4','D5')
                   AND cr.status = 'pass'))`;

  const total = await env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).first<{ n: number }>();

  const { results } = await env.DB.prepare(
    `SELECT d.apex ${from}
      ORDER BY ${full ? "d.rank IS NULL, d.rank, d.apex" : "d.apex"}
      LIMIT ?`,
  )
    .bind(limit)
    .all<{ apex: string }>();

  return { domains: results.map((r) => r.apex), available: total?.n ?? results.length };
}

/**
 * Close runs that will never finish, before opening tonight's.
 *
 * This has to live in the cron rather than only in the queue consumer. The
 * consumer's own check runs when a message for that run arrives — and the stuck
 * case is precisely the one where no message ever arrives again, because the
 * last one was acked without writing a row or was lost. A watchdog that only
 * fires while work is flowing cannot catch a run that has stopped.
 *
 * closeRun derives usable_for_delta from completed >= planned, so a swept run is
 * correctly marked unusable as a baseline instead of pretending to be complete.
 */
async function sweepStalledRuns(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - RUN_WATCHDOG_MS).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, domains_planned AS planned, domains_completed AS done
       FROM runs
      WHERE status = 'running' AND started_at < ?`,
  )
    .bind(cutoff)
    .all<{ id: number; planned: number; done: number }>();

  for (const run of results) {
    console.warn(
      `[census] run ${run.id} closed by watchdog: ${run.done}/${run.planned} domains. ` +
        `Not usable as a delta baseline.`,
    );
    await closeRun(env, run.id);
  }
}

export async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  // Before anything else, so a stuck run cannot block deltas indefinitely.
  await sweepStalledRuns(env);

  // Sunday is the full universe; every other day is the watchlist.
  const full = new Date(event.scheduledTime).getUTCDay() === 0;
  const { domains, available } = await selectDomains(env, full, full ? MAX_FULL : MAX_WATCHLIST);
  if (domains.length === 0) return;
  if (domains.length < available) {
    // Loud, because the alternative is a run that looks complete and is not.
    console.warn(
      `[census] ${full ? "full" : "watchlist"} run truncated: ` +
        `probing ${domains.length} of ${available} eligible domains. Raise the cap.`,
    );
  }

  const runId = await openRun(env, {
    methodologyVersion: METHODOLOGY_VERSION,
    candidatesVersion: CANDIDATES_VERSION,
    universeFilter: full ? null : "watchlist",
    planned: domains.length,
  });

  // Queue sendBatch caps at 100 messages per call.
  for (let i = 0; i < domains.length; i += 100) {
    await env.CRAWL_QUEUE.sendBatch(
      domains.slice(i, i + 100).map((apex) => ({ body: { runId, apex } })),
    );
  }
}

export async function consume(batch: MessageBatch<CrawlMessage>, env: Env): Promise<void> {
  const optOuts = await loadOptOuts(env);
  const identity = resolveCrawlerIdentity();
  const deps = { fetch: workerFetch(), sleep, now: () => Date.now() };

  // Concurrently, not sequentially. Every message is a different apex and the
  // rate limit is per apex, so serialising a batch buys no politeness and costs
  // a great deal of wall clock: at ~60s a domain, a batch of ten took ten
  // minutes and the queue barely moved.
  //
  // The published cap is what bounds real concurrency: batch size x
  // max_concurrency in wrangler.jsonc is set to exactly
  // POLITENESS.maxGlobalConcurrency, so no more different sites are in flight
  // than the ethics document promises.
  await Promise.all(
    batch.messages.map(async (message) => {
      const { runId, apex } = message.body;
      const startedAt = new Date().toISOString();

      try {
        const client = new GuardedHttpClient(deps, { apex, identity, optOuts });
        const result = await probeDomain(
          { client, now: () => Date.now(), resolveTxt: dohResolveTxt() },
          { apex },
        );
        await persistScan(env, runId, result, startedAt);
        message.ack();
      } catch (error) {
        // A guard violation is our bug. Retrying would just repeat it, and it
        // must be impossible to miss, so the message is acked and logged loudly.
        if (error instanceof ProbeGuardError) {
          console.error(`GUARD VIOLATION ${apex}: ${error.rule}: ${error.message}`);
          message.ack();
          return;
        }
        // Anything else may be transient, so retry — but only while retries are
        // left. Letting the last attempt fall off the queue writes no row, and
        // the run's completion counter then never reaches its plan: it stays
        // open for ever, never becomes a delta baseline, and the changes feed
        // silently dies. Record the domain as unreachable instead, which is both
        // true and enough for the run to close.
        console.error(`probe failed ${apex} (attempt ${message.attempts}): ${String(error)}`);
        if (message.attempts >= MAX_ATTEMPTS) {
          await persistUnreachable(env, runId, apex, startedAt);
          message.ack();
          return;
        }
        message.retry();
      }
    }),
  );

  // Close the run once every planned domain has a row. Cheap to check, and it
  // is what marks the run usable as a delta baseline.
  const runIds = [...new Set(batch.messages.map((m) => m.body.runId))];
  for (const runId of runIds) {
    const row = await env.DB.prepare(
      `SELECT domains_planned AS planned, domains_completed AS done, status, started_at
         FROM runs WHERE id = ?`,
    )
      .bind(runId)
      .first<{ planned: number; done: number; status: string; started_at: string }>();

    if (row === null || row.status !== "running") continue;

    // A run whose plan will never be met has to be closed anyway, or it blocks
    // every future delta. closeRun already sets usable_for_delta from
    // completed >= planned, so a watchdog close is correctly marked unusable as a
    // baseline rather than quietly pretending to be complete.
    const startedMs = Date.parse(row.started_at);
    const stalled =
      Number.isFinite(startedMs) &&
      Date.now() - startedMs > RUN_WATCHDOG_MS &&
      row.done < row.planned;
    if (stalled) {
      console.warn(
        `[census] run ${runId} closed by watchdog: ${row.done}/${row.planned} after ` +
          `${Math.round((Date.now() - startedMs) / 60000)} minutes. Not usable as a delta baseline.`,
      );
    }

    if (row.done >= row.planned || stalled) {
      await closeRun(env, runId);
      // Only meaningful once the run is closed and flagged usable for deltas.
      const deltas = await computeDeltas(env, runId);
      const aggregates = await computeAggregates(env, runId);
      console.log(
        `run ${runId} closed: ${deltas.confirmed} changes confirmed, ` +
          `${deltas.observed} observed, ${deltas.dropped} flaps dropped, ` +
          `${aggregates} aggregates written`,
      );
    }
  }
}
