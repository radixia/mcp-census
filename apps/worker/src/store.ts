/**
 * Writing a probe result to D1 and R2.
 *
 * The split is ADR 0005: D1 gets what every page reads, R2 gets the evidence
 * that one page in a thousand opens. Nothing here is ever updated in place — a
 * run is append-only, and "current" is a view over the newest complete run.
 */

import type { CheckResult, DomainProbeResult } from "@mcp-census/core";

import type { Env } from "./env.js";

/** `evidence/<apex>/<run_id>.json` — apex-first so an opt-out is a prefix delete. */
export function evidenceKey(apex: string, runId: number): string {
  return `evidence/${apex}/${runId}.json`;
}

/**
 * A short, closed-vocabulary reason where the status alone is not informative.
 * Never a blob: that is what R2 is for.
 */
function detailOf(check: CheckResult): string | null {
  const evidence = check.evidence as Record<string, unknown>;
  const skipReason = evidence.skipReason;
  if (typeof skipReason === "string") return skipReason;

  if (check.id === "D5") {
    if (evidence.requiresAuthorization === true) return "requires_authorization";
    if (typeof evidence.era === "string") return evidence.era;
  }
  if (check.id === "D3" && typeof evidence.endpointHost === "string") return "endpoint_found";

  // C1 fails on a field, and which one is the whole finding: a version conflict
  // is a stale card, a protocol conflict can make a client refuse a server it
  // could have talked to. A bare "fail" on the check most likely to be
  // questioned is the one place a missing detail costs the most.
  if (check.id === "C1" && check.status === "fail") {
    const fields = (evidence.contradictedFields ?? []) as string[];
    const version = fields.includes("version");
    const protocol = fields.includes("protocolVersion");
    if (version && protocol) return "version_and_protocol_contradict";
    if (protocol) return "protocol_version_contradicts";
    if (version) return "version_contradicts";
  }

  // D7 records why the root did not yield an advertisement.
  if (check.id === "D7" && check.status === "fail") {
    // A 2xx with nothing in it records no `result`, and "fail" alone reads as
    // an error rather than as the ordinary case of a page that simply does not
    // advertise a catalog.
    if (typeof evidence.result === "string") return evidence.result;
    if (typeof evidence.status === "number") return "no_advertisement";
  }

  // Why a candidate check came back negative. Only meaningful on a fail: a pass
  // needs no excuse, and a skip already carries its reason above.
  if (check.status === "fail" && typeof evidence.outcome === "string") {
    return evidence.outcome;
  }

  return null;
}

/** Candidate ids that responded, normalised out of D1's evidence blob. */
function candidateHits(
  result: DomainProbeResult,
): Array<{ id: string; host: string; path: string }> {
  const d1 = result.checks.find((c) => c.id === "D1");
  if (d1 === undefined) return [];

  const candidates = (d1.evidence as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];

  return candidates
    .filter(
      (c): c is { candidateId: string; host: string; path: string; result: string } =>
        typeof c === "object" && c !== null && (c as { result?: unknown }).result === "found",
    )
    .map((c) => ({ id: c.candidateId, host: c.host, path: c.path }));
}

export async function persistScan(
  env: Env,
  runId: number,
  result: DomainProbeResult,
  startedAt: string,
): Promise<void> {
  const key = evidenceKey(result.apex, runId);

  // Evidence first. If this fails the row is not written, so we never publish a
  // score whose evidence cannot be re-examined.
  await env.ARTIFACTS.put(
    key,
    JSON.stringify({
      apex: result.apex,
      runId,
      methodologyVersion: result.methodologyVersion,
      candidatesVersion: result.candidatesVersion,
      checks: result.checks,
    }),
    { httpMetadata: { contentType: "application/json" } },
  );

  const score = result.score;
  const finishedAt = new Date().toISOString();

  const scanInsert = env.DB.prepare(
    `INSERT INTO scans
       (run_id, apex, started_at, finished_at, request_count, duration_ms,
        evidence_key, assessed, score, band, unassessed_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (run_id, apex) DO NOTHING`,
  ).bind(
    runId,
    result.apex,
    startedAt,
    finishedAt,
    result.requestCount,
    result.durationMs,
    key,
    score.assessed ? 1 : 0,
    score.assessed ? score.score : null,
    score.assessed ? score.band : null,
    score.assessed ? null : score.reason,
  );

  const inserted = await scanInsert.run();
  const scanId = inserted.meta.last_row_id;
  if (typeof scanId !== "number" || scanId === 0) return;

  const statements = [
    ...result.checks.map((check) =>
      env.DB.prepare(
        `INSERT INTO check_results (scan_id, check_id, status, detail, latency_ms)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(scanId, check.id, check.status, detailOf(check), check.latencyMs),
    ),
    ...candidateHits(result).map((hit) =>
      env.DB.prepare(
        `INSERT INTO candidate_hits (scan_id, candidate_id, host, path) VALUES (?, ?, ?, ?)`,
      ).bind(scanId, hit.id, hit.host, hit.path),
    ),
    env.DB.prepare(`UPDATE runs SET domains_completed = domains_completed + 1 WHERE id = ?`).bind(
      runId,
    ),
  ];

  await env.DB.batch(statements);
}

/**
 * Record a domain we could not probe, so the run can still close.
 *
 * The counter that decides when a run is finished lives inside `persistScan`, so
 * any path that returns without writing a row leaves `domains_completed` short of
 * `domains_planned` **for ever**: the run never closes, `usable_for_delta` stays
 * 0, and every later run keeps comparing against an older baseline. The visible
 * symptom is an empty changes feed, which is indistinguishable from a working
 * system that found nothing.
 *
 * `unreachable` is the honest word here and the schema already allows it: we made
 * our attempts and never got an answer. It is deliberately NOT used for a guard
 * violation — that is our bug, not a fact about the domain, and the published
 * dataset must not say otherwise. Those are handled by the run watchdog instead.
 */
export async function persistUnreachable(
  env: Env,
  runId: number,
  apex: string,
  startedAt: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO scans
         (run_id, apex, started_at, finished_at, request_count, duration_ms,
          evidence_key, assessed, score, band, unassessed_reason)
       VALUES (?, ?, ?, ?, 0, NULL, NULL, 0, NULL, NULL, 'unreachable')
       ON CONFLICT (run_id, apex) DO NOTHING`,
    ).bind(runId, apex, startedAt, new Date().toISOString()),
    env.DB.prepare(`UPDATE runs SET domains_completed = domains_completed + 1 WHERE id = ?`).bind(
      runId,
    ),
  ]);
}

export async function openRun(
  env: Env,
  params: {
    methodologyVersion: string;
    candidatesVersion: string;
    universeFilter: string | null;
    planned: number;
  },
): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO runs
       (started_at, methodology_version, candidates_version, universe_filter,
        domains_planned, status)
     VALUES (?, ?, ?, ?, ?, 'running')`,
  )
    .bind(
      new Date().toISOString(),
      params.methodologyVersion,
      params.candidatesVersion,
      params.universeFilter,
      params.planned,
    )
    .run();

  const id = result.meta.last_row_id;
  if (typeof id !== "number") throw new Error("could not open a run");
  return id;
}

/**
 * Close a run, marking it usable for deltas only if every planned domain was
 * actually visited. A partial run as a delta baseline would make every domain
 * it never reached look like it had just disappeared.
 */
export async function closeRun(env: Env, runId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE runs
        SET finished_at = ?,
            status = 'complete',
            usable_for_delta = CASE WHEN domains_completed >= domains_planned THEN 1 ELSE 0 END
      WHERE id = ?`,
  )
    .bind(new Date().toISOString(), runId)
    .run();
}

export async function loadOptOuts(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare(`SELECT apex FROM optouts`).all<{ apex: string }>();
  return new Set(results.map((r) => r.apex.toLowerCase()));
}
