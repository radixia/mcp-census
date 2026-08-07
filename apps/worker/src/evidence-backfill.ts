/**
 * Expand an evidence bundle into per-domain objects, inside the Worker.
 *
 * `scans.evidence_key` promises `evidence/<apex>/<run>.json` for every row. The
 * two runs loaded by `scripts/pilot/import.ts` had none: the importer set the
 * column and wrote nothing. The bundle is the safety copy; these are the
 * artifact, because the opt-out promise — "delete everything about this domain"
 * — has to be a prefix delete rather than a rewrite of a shared archive.
 *
 * ## Why this is not a shell script
 *
 * It was, briefly. `scripts/evidence/upload.sh` spawns one `wrangler` per
 * object: 7,422 node processes, about 1.1 per second, and at sixteen in parallel
 * **3,320 of them failed** — 45%, while the same keys succeeded one at a time.
 * Two hours per run to get half a result.
 *
 * Here the bundle is already in R2 and so is the destination, so nothing leaves
 * Cloudflare's network and each write is a binding call rather than a process.
 * The whole run takes seconds and needs no credentials, which is also why this
 * beats the S3 route: R2 access keys would work, but they are a new secret to
 * create, hold and rotate for a job that needs neither.
 *
 * ## Safety
 *
 * There is no endpoint. Work is picked up from a KV key that has to be seeded by
 * hand, and with no key this is a no-op — so the daily cron carries the code and
 * does nothing until someone deliberately asks for a backfill.
 *
 *     wrangler kv key put --binding SCAN_CACHE evidence-backfill '{"runs":[6,3]}'
 *
 * One run per invocation: expanding a bundle and driving a crawl in the same
 * night is two long jobs sharing one budget, and there is no hurry.
 *
 * It is resumable: the cursor is the number of lines already handled, and a
 * gzip stream cannot be seeked, so a resumed pass re-reads and discards the
 * prefix. Discarding two megabytes is cheaper than any bookkeeping that would
 * avoid it.
 */

import type { Env } from "./env.js";

const STATE_KEY = "evidence-backfill";

/**
 * Objects per invocation, sized to finish a run in one pass.
 *
 * The population is 7,422 and these are binding writes rather than subrequests,
 * so the work is I/O the runtime is happy to wait on. The cap exists so an
 * unexpectedly large bundle degrades into two nights instead of one timeout.
 */
const BATCH = 8000;

/** Concurrent R2 writes. Binding calls, not subrequests. */
const CONCURRENCY = 100;

interface BackfillState {
  /** Runs still to expand, in order. The first is in progress. */
  readonly runs: readonly number[];
  readonly cursor?: number;
}

interface BundleRow {
  readonly apex: string;
  readonly methodologyVersion?: string;
  readonly candidatesVersion?: string;
  readonly checks?: unknown;
}

export interface BackfillResult {
  readonly run: number;
  readonly written: number;
  readonly cursor: number;
  readonly done: boolean;
  /** Runs still waiting, this one included while it is unfinished. */
  readonly queued: number;
}

/**
 * Read the bundle line by line without ever holding it whole.
 *
 * 2 MB compressed is 38 MB of JSON, and a Worker has 128 MB. Decoding it into
 * one string would work until the population grew.
 */
async function* bundleLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream())
    .getReader();

  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim() !== "") yield buffer;
}

/**
 * One pass. Returns `null` when no backfill was requested, which is the state
 * this is in for all but a few minutes of its life.
 */
export async function runEvidenceBackfill(env: Env): Promise<BackfillResult | null> {
  const raw = await env.SCAN_CACHE.get(STATE_KEY, "json");
  if (raw === null) return null;

  const state = raw as BackfillState;
  const run = state.runs[0];
  if (run === undefined) {
    await env.SCAN_CACHE.delete(STATE_KEY);
    return null;
  }
  const cursor = state.cursor ?? 0;

  const bundle = await env.ARTIFACTS.get(`evidence/bundles/run-${run}.jsonl.gz`);
  if (bundle === null) {
    // Drop this run rather than retrying a missing bundle every night, but keep
    // the rest of the queue: one bad entry should not cancel the others.
    await env.SCAN_CACHE.put(STATE_KEY, JSON.stringify({ runs: state.runs.slice(1) }));
    throw new Error(`no bundle for run ${run}`);
  }

  let seen = 0;
  let written = 0;
  let pending: Array<Promise<unknown>> = [];

  const flush = async () => {
    if (pending.length === 0) return;
    await Promise.all(pending);
    pending = [];
  };

  for await (const line of bundleLines(bundle.body)) {
    seen++;
    if (seen <= cursor) continue;
    if (written >= BATCH) break;
    if (line.trim() === "") continue;

    const row = JSON.parse(line) as BundleRow;
    // The same shape `store.ts` writes on the queue path, so a reader cannot
    // tell which route produced a given run's evidence.
    const object = JSON.stringify({
      apex: row.apex,
      runId: run,
      methodologyVersion: row.methodologyVersion,
      candidatesVersion: row.candidatesVersion,
      checks: row.checks ?? [],
    });

    pending.push(
      env.ARTIFACTS.put(`evidence/${row.apex}/${run}.json`, object, {
        httpMetadata: { contentType: "application/json" },
      }),
    );
    written++;
    if (pending.length >= CONCURRENCY) await flush();
  }
  await flush();

  const next = cursor + written;
  // `seen` stops advancing once the batch fills, so "done" means the stream ran
  // out before the cap did.
  const done = written < BATCH;

  const remaining = done ? state.runs.slice(1) : state.runs;
  if (remaining.length === 0) await env.SCAN_CACHE.delete(STATE_KEY);
  else {
    await env.SCAN_CACHE.put(
      STATE_KEY,
      JSON.stringify(done ? { runs: remaining } : { runs: remaining, cursor: next }),
    );
  }

  return { run, written, cursor: next, done, queued: remaining.length };
}
