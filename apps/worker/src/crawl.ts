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
import type { CrawlMessage, Env } from "./env.js";
import { closeRun, loadOptOuts, openRun, persistScan } from "./store.js";

/**
 * Which domains to probe tonight. Tiered per ADR 0004: the watchlist daily, the
 * full universe weekly, because nothing changes daily on a domain that has been
 * Absent for six months.
 */
async function selectDomains(env: Env, full: boolean, limit: number): Promise<string[]> {
  const query = full
    ? `SELECT apex FROM domains
        WHERE opted_out_at IS NULL AND source = 'universe'
        ORDER BY rank IS NULL, rank
        LIMIT ?`
    : // The watchlist: anything that has ever shown a discovery signal, plus the
      // conference cohort, which is small and always worth being current on.
      `SELECT DISTINCT d.apex FROM domains d
        LEFT JOIN scans s ON s.apex = d.apex
        LEFT JOIN check_results cr
               ON cr.scan_id = s.id
              AND cr.check_id IN ('D1','D3','D4','D5')
              AND cr.status = 'pass'
        WHERE d.opted_out_at IS NULL
          AND d.source = 'universe'
          AND (cr.scan_id IS NOT NULL OR d.universe = 'D')
        LIMIT ?`;

  const { results } = await env.DB.prepare(query).bind(limit).all<{ apex: string }>();
  return results.map((r) => r.apex);
}

export async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  // Sunday is the full universe; every other day is the watchlist.
  const full = new Date(event.scheduledTime).getUTCDay() === 0;
  const domains = await selectDomains(env, full, full ? 8000 : 2000);
  if (domains.length === 0) return;

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
        // Anything else may be transient — let the queue retry it.
        console.error(`probe failed ${apex}: ${String(error)}`);
        message.retry();
      }
    }),
  );

  // Close the run once every planned domain has a row. Cheap to check, and it
  // is what marks the run usable as a delta baseline.
  const runIds = [...new Set(batch.messages.map((m) => m.body.runId))];
  for (const runId of runIds) {
    const row = await env.DB.prepare(
      `SELECT domains_planned AS planned, domains_completed AS done, status
         FROM runs WHERE id = ?`,
    )
      .bind(runId)
      .first<{ planned: number; done: number; status: string }>();

    if (row !== null && row.status === "running" && row.done >= row.planned) {
      await closeRun(env, runId);
    }
  }
}
