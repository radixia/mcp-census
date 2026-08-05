/**
 * Read queries for the public pages.
 *
 * "Current" is always a view over the newest complete run, never a mutated row —
 * nothing in this schema is updated in place. Every rate excludes unassessed
 * domains from its denominator, because a domain we were not allowed to measure
 * is not evidence about that domain.
 */

import type { Env } from "./env.js";

export interface LatestRun {
  readonly id: number;
  readonly finished_at: string | null;
  readonly methodology_version: string;
  readonly candidates_version: string;
  readonly domains_completed: number;
}

export async function latestRun(env: Env): Promise<LatestRun | null> {
  return env.DB.prepare(
    `SELECT id, finished_at, methodology_version, candidates_version, domains_completed
       FROM runs
      WHERE status = 'complete'
      ORDER BY id DESC
      LIMIT 1`,
  ).first<LatestRun>();
}

export interface Headline {
  readonly assessed: number;
  readonly unassessed: number;
  readonly anyDiscovery: number;
  readonly card: number;
  readonly confirmed: number;
  readonly nothing: number;
}

/**
 * The headline: of the domains we could assess, how many publish anything an
 * agent could use to find them.
 */
export async function headline(env: Env, runId: number): Promise<Headline> {
  const row = await env.DB.prepare(
    `WITH per AS (
       SELECT s.id,
              s.assessed,
              MAX(CASE WHEN cr.check_id IN ('D1','D2','D3','D4') AND cr.status='pass' THEN 1 ELSE 0 END) AS discovery,
              MAX(CASE WHEN cr.check_id='D1' AND cr.status='pass' THEN 1 ELSE 0 END) AS card,
              MAX(CASE WHEN cr.check_id='D5' AND cr.status='pass' THEN 1 ELSE 0 END) AS confirmed
         FROM scans s
         LEFT JOIN check_results cr ON cr.scan_id = s.id
        WHERE s.run_id = ?
        GROUP BY s.id
     )
     SELECT
       SUM(assessed) AS assessed,
       SUM(CASE WHEN assessed=0 THEN 1 ELSE 0 END) AS unassessed,
       SUM(CASE WHEN assessed=1 AND discovery=1 THEN 1 ELSE 0 END) AS anyDiscovery,
       SUM(CASE WHEN assessed=1 AND card=1 THEN 1 ELSE 0 END) AS card,
       SUM(CASE WHEN assessed=1 AND confirmed=1 THEN 1 ELSE 0 END) AS confirmed,
       -- Quoted: 'nothing' is a reserved word in D1's SQLite dialect.
       SUM(CASE WHEN assessed=1 AND discovery=0 THEN 1 ELSE 0 END) AS "nothing"
     FROM per`,
  )
    .bind(runId)
    .first<Headline>();

  return row ?? { assessed: 0, unassessed: 0, anyDiscovery: 0, card: 0, confirmed: 0, nothing: 0 };
}

/** Which discovery mechanism answered, across the run. The fragmentation chart. */
export async function candidateDistribution(
  env: Env,
  runId: number,
): Promise<Array<{ candidate_id: string; n: number }>> {
  const { results } = await env.DB.prepare(
    `SELECT ch.candidate_id, COUNT(*) AS n
       FROM candidate_hits ch
       JOIN scans s ON s.id = ch.scan_id
      WHERE s.run_id = ?
      GROUP BY ch.candidate_id
      ORDER BY n DESC`,
  )
    .bind(runId)
    .all<{ candidate_id: string; n: number }>();
  return results;
}

export interface LeaderRow {
  readonly apex: string;
  readonly score: number | null;
  readonly band: string | null;
  readonly unassessed_reason: string | null;
  readonly universe: string;
}

export async function leaderboard(
  env: Env,
  runId: number,
  options: { universe?: string; limit: number },
): Promise<LeaderRow[]> {
  const universe = options.universe;
  const { results } = await env.DB.prepare(
    `SELECT s.apex, s.score, s.band, s.unassessed_reason, d.universe
       FROM scans s
       JOIN domains d ON d.apex = s.apex
      WHERE s.run_id = ?
        AND (? IS NULL OR d.universe = ?)
      ORDER BY s.assessed DESC, s.score DESC, s.apex
      LIMIT ?`,
  )
    .bind(runId, universe ?? null, universe ?? null, options.limit)
    .all<LeaderRow>();
  return results;
}

export interface DomainDetail {
  readonly apex: string;
  readonly universe: string;
  readonly score: number | null;
  readonly band: string | null;
  readonly assessed: number;
  readonly unassessed_reason: string | null;
  readonly run_id: number;
  readonly finished_at: string | null;
  readonly methodology_version: string;
  readonly evidence_key: string | null;
  readonly checks: Array<{ check_id: string; status: string; detail: string | null }>;
  readonly history: Array<{ run_id: number; score: number | null; finished_at: string | null }>;
}

export async function domainDetail(env: Env, apex: string): Promise<DomainDetail | null> {
  const scan = await env.DB.prepare(
    `SELECT s.apex, d.universe, s.score, s.band, s.assessed, s.unassessed_reason,
            s.run_id, s.evidence_key, r.finished_at, r.methodology_version
       FROM scans s
       JOIN domains d ON d.apex = s.apex
       JOIN runs r ON r.id = s.run_id
      WHERE s.apex = ? AND r.status = 'complete'
      ORDER BY s.run_id DESC
      LIMIT 1`,
  )
    .bind(apex)
    .first<Omit<DomainDetail, "checks" | "history">>();

  if (scan === null) return null;

  const [{ results: checks }, { results: history }] = await Promise.all([
    env.DB.prepare(
      `SELECT cr.check_id, cr.status, cr.detail
         FROM check_results cr
         JOIN scans s ON s.id = cr.scan_id
        WHERE s.apex = ? AND s.run_id = ?
        ORDER BY cr.check_id`,
    )
      .bind(apex, scan.run_id)
      .all<{ check_id: string; status: string; detail: string | null }>(),
    env.DB.prepare(
      `SELECT s.run_id, s.score, r.finished_at
         FROM scans s JOIN runs r ON r.id = s.run_id
        WHERE s.apex = ? AND r.status = 'complete'
        ORDER BY s.run_id DESC
        LIMIT 30`,
    )
      .bind(apex)
      .all<{ run_id: number; score: number | null; finished_at: string | null }>(),
  ]);

  return { ...scan, checks, history };
}

/** Recent debounced changes. Only confirmed ones are ever shown. */
export async function recentChanges(
  env: Env,
  limit: number,
): Promise<
  Array<{
    apex: string;
    check_id: string;
    from_status: string;
    to_status: string;
    confirmed_at: string;
    category: string;
  }>
> {
  const { results } = await env.DB.prepare(
    `SELECT apex, check_id, from_status, to_status, confirmed_at, category
       FROM status_changes
      ORDER BY confirmed_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all<{
      apex: string;
      check_id: string;
      from_status: string;
      to_status: string;
      confirmed_at: string;
      category: string;
    }>();
  return results;
}

/** The adoption curve, read from precomputed aggregates rather than raw scans. */
export async function adoptionSeries(
  env: Env,
): Promise<Array<{ run_id: number; metric: string; value: number; denominator: number }>> {
  const { results } = await env.DB.prepare(
    `SELECT run_id, metric, value, denominator
       FROM run_aggregates
      WHERE universe = 'R' AND metric IN ('D1_pass', 'D5_pass')
      ORDER BY run_id, metric`,
  ).all<{ run_id: number; metric: string; value: number; denominator: number }>();
  return results;
}
