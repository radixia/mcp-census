/**
 * Load a local run's JSONL into D1 as a numbered run.
 *
 * **It does not write R2.** This docstring used to say "into D1 and R2", and the
 * rows it emits set `scans.evidence_key` as though the object existed, so run 3
 * — the first full census — spent two days with 7,422 dangling evidence
 * pointers. Nothing was lost, but the reproducibility claim was false for the
 * only run the headline is computed from. If you use this, upload the evidence
 * yourself and say so in the release notes. Two commands, and they are the whole
 * procedure:
 *
 *     wrangler r2 object put mcp-census-artifacts/evidence/bundles/run-<N>.jsonl.gz \
 *       --file out/<run>/results.jsonl.gz --content-type application/x-ndjson \
 *       --content-encoding gzip --remote
 *     wrangler kv key put --binding SCAN_CACHE --remote evidence-backfill '{"runs":[<N>]}'
 *
 * The first puts the evidence somewhere other than a laptop. The second asks the
 * Worker to expand it into the per-domain objects `evidence_key` points at, on
 * its next cron: see `apps/worker/src/evidence-backfill.ts` for why that beats
 * doing it from here.
 *
 * The Worker's queue path is the production route and is proven end to end. This
 * exists for the case the queue cannot serve: a bulk backfill of thousands of
 * domains, where driving the crawl locally is resumable, watchable, and finishes
 * in one sitting. The probe code is identical — the same `packages/core` — so the
 * rows are the same rows.
 *
 *   node pilot/import.ts --jsonl out/full/results.jsonl --run 3
 *
 * Emits SQL on stdout rather than talking to D1 itself, so the insert goes
 * through `wrangler d1 execute` and there is one authenticated path to the
 * database rather than two.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    jsonl: { type: "string" },
    run: { type: "string" },
    out: { type: "string", default: "out/import.sql" },
  },
  allowPositionals: true,
});

interface Check {
  id: string;
  status: string;
  evidence: Record<string, unknown>;
  latencyMs: number;
}

interface Row {
  apex?: string;
  methodologyVersion?: string;
  candidatesVersion?: string;
  checks?: Check[];
  requestCount?: number;
  durationMs?: number;
  score?: { assessed: boolean; score?: number; band?: string; reason?: string };
  /** Stamped by the runner as each domain finishes. Absent on runs 3 and 6. */
  observedAt?: string;
}

const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;

/** Mirrors apps/worker/src/store.ts — a short reason, never a blob. */
function detailOf(check: Check): string | null {
  const e = check.evidence;
  if (typeof e.skipReason === "string") return e.skipReason;
  if (check.id === "D5") {
    if (e.requiresAuthorization === true) return "requires_authorization";
    if (typeof e.era === "string") return e.era;
  }
  if (check.id === "D3" && typeof e.endpointHost === "string") return "endpoint_found";
  if (check.id === "C1" && check.status === "fail") {
    const fields = (e.contradictedFields ?? []) as string[];
    const version = fields.includes("version");
    const protocol = fields.includes("protocolVersion");
    if (version && protocol) return "version_and_protocol_contradict";
    if (protocol) return "protocol_version_contradicts";
    if (version) return "version_contradicts";
  }
  if (check.id === "D7" && check.status === "fail") {
    // A 2xx with nothing in it records no `result`, and "fail" alone reads as
    // an error rather than as the ordinary case of a page that simply does not
    // advertise a catalog.
    if (typeof e.result === "string") return e.result;
    if (typeof e.status === "number") return "no_advertisement";
  }
  if (check.status === "fail" && typeof e.outcome === "string") return e.outcome;
  return null;
}

async function main(): Promise<void> {
  if (values.jsonl === undefined || values.run === undefined) {
    throw new Error("pass --jsonl <file> --run <id>");
  }
  const runId = Number.parseInt(values.run, 10);

  const text = await readFile(values.jsonl, "utf8");
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line) as Row);
    } catch {
      // A torn final line from an interrupted run. Skip it.
    }
  }

  const statements: string[] = [];
  const checkIdsSeen = new Set<string>();
  const now = new Date().toISOString();

  // Deduplicate: a resumed run can append the same apex twice, and the schema's
  // UNIQUE(run_id, apex) would reject the batch rather than the row.
  const seen = new Set<string>();

  for (const row of rows) {
    const apex = row.apex;
    if (apex === undefined || seen.has(apex)) continue;
    seen.add(apex);

    const score = row.score;
    const assessed = score?.assessed === true;

    statements.push(
      `INSERT OR IGNORE INTO scans (run_id, apex, started_at, finished_at, request_count,` +
        ` duration_ms, evidence_key, assessed, score, band, unassessed_reason) SELECT ${runId},` +
        ` ${quote(apex)}, ${quote(row.observedAt ?? now)}, ${quote(row.observedAt ?? now)},` +
        ` ${row.requestCount ?? 0},` +
        ` ${row.durationMs ?? 0}, ${quote(`evidence/${apex}/${runId}.json`)}, ${assessed ? 1 : 0},` +
        ` ${assessed ? (score?.score ?? 0) : "NULL"},` +
        ` ${assessed ? quote(score?.band ?? "") : "NULL"},` +
        ` ${assessed ? "NULL" : quote(score?.reason ?? "unreachable")}` +
        ` WHERE EXISTS (SELECT 1 FROM domains WHERE apex = ${quote(apex)});`,
    );

    for (const check of row.checks ?? []) {
      checkIdsSeen.add(check.id);
      const detail = detailOf(check);
      statements.push(
        `INSERT OR IGNORE INTO check_results (scan_id, check_id, status, detail, latency_ms)` +
          ` SELECT id, ${quote(check.id)}, ${quote(check.status)},` +
          ` ${detail === null ? "NULL" : quote(detail)}, ${check.latencyMs ?? 0}` +
          ` FROM scans WHERE run_id = ${runId} AND apex = ${quote(apex)};`,
      );
    }

    const d1 = (row.checks ?? []).find((c) => c.id === "D1");
    const candidates = d1?.evidence.candidates;
    if (Array.isArray(candidates)) {
      for (const c of candidates as Array<Record<string, string>>) {
        if (c.result !== "found") continue;
        statements.push(
          `INSERT OR IGNORE INTO candidate_hits (scan_id, candidate_id, host, path)` +
            ` SELECT id, ${quote(c.candidateId ?? "")}, ${quote(c.host ?? "")}, ${quote(c.path ?? "")}` +
            ` FROM scans WHERE run_id = ${runId} AND apex = ${quote(apex)};`,
        );
      }
    }
  }

  // Only checks this run actually produced. A zero for a check that did not
  // exist yet would draw a rise out of nothing.
  statements.push(...aggregateStatements(runId, [...checkIdsSeen].sort()));

  statements.push(
    `UPDATE runs SET domains_completed = (SELECT COUNT(*) FROM scans WHERE run_id = ${runId})` +
      ` WHERE id = ${runId};`,
    `UPDATE runs SET finished_at = ${quote(now)}, status = 'complete',` +
      ` usable_for_delta = CASE WHEN domains_completed >= domains_planned THEN 1 ELSE 0 END` +
      ` WHERE id = ${runId};`,
  );

  await writeFile(values.out as string, `${statements.join("\n")}\n`, "utf8");
  process.stderr.write(`${seen.size} domains, ${statements.length} statements -> ${values.out}\n`);
}

await main();

/**
 * The time-series aggregates.
 *
 * The Worker writes these on every crawl it drives; this script did not, so the
 * two full-population runs were missing from `run_aggregates` entirely and the
 * public adoption chart plotted the nightly watchlist instead — 52.1% of
 * domains publishing a card, against 20.4% on the real population, under a
 * caption that said "assessed domains".
 *
 * A check the run never ran gets no row at all. Writing a zero would draw a rise
 * from nothing where the truth is that nobody looked: `C1` and `D7` did not
 * exist when run 3 happened.
 */
function aggregateStatements(runId: number, checkIds: readonly string[]): string[] {
  const out: string[] = [];
  const upsert = `ON CONFLICT (run_id, universe, metric) DO UPDATE SET
     value = excluded.value, denominator = excluded.denominator;`;

  for (const check of checkIds) {
    out.push(`INSERT INTO run_aggregates (run_id, universe, metric, value, denominator)
SELECT ${runId}, d.universe, '${check}_pass',
       SUM(CASE WHEN cr.status = 'pass' THEN 1 ELSE 0 END), COUNT(*)
  FROM scans s JOIN domains d ON d.apex = s.apex
  LEFT JOIN check_results cr ON cr.scan_id = s.id AND cr.check_id = '${check}'
 WHERE s.run_id = ${runId} AND s.assessed = 1
 GROUP BY d.universe
${upsert}`);
  }

  out.push(`INSERT INTO run_aggregates (run_id, universe, metric, value, denominator)
SELECT ${runId}, d.universe, 'no_discovery',
       SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM check_results c2 WHERE c2.scan_id = s.id
          AND c2.check_id IN ('D1','D2','D3','D4') AND c2.status = 'pass') THEN 1 ELSE 0 END),
       COUNT(*)
  FROM scans s JOIN domains d ON d.apex = s.apex
 WHERE s.run_id = ${runId} AND s.assessed = 1
 GROUP BY d.universe
${upsert}`);

  out.push(`INSERT INTO run_aggregates (run_id, universe, metric, value, denominator)
SELECT ${runId}, d.universe, 'candidate:' || ch.candidate_id, COUNT(DISTINCT s.apex),
       (SELECT COUNT(*) FROM scans s2 JOIN domains d2 ON d2.apex = s2.apex
         WHERE s2.run_id = ${runId} AND s2.assessed = 1 AND d2.universe = d.universe)
  FROM candidate_hits ch JOIN scans s ON s.id = ch.scan_id JOIN domains d ON d.apex = s.apex
 WHERE s.run_id = ${runId}
 GROUP BY d.universe, ch.candidate_id
${upsert}`);

  return out;
}
