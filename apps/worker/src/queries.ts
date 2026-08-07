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

/**
 * The newest complete run over the WHOLE population.
 *
 * The headline and the results table must never come from a watchlist run. The
 * watchlist is, by construction, "every domain that has ever shown a discovery
 * signal", so essentially all of it has one — and reporting that under the
 * headline's framing, "of the organisations that provably run an MCP server",
 * describes a population the run did not measure.
 *
 * This is not hypothetical. The first nightly watchlist run flipped the live
 * headline from "61% publish nothing, 4,495 of 7,421" to "2%, 64 of 2,928"
 * overnight, with the framing text unchanged. Nothing improved; the page had
 * silently switched populations. A census whose entire value is methodological
 * care cannot publish a biased subset under the full population's sentence.
 *
 * Two spellings of "full" exist in the data and both must match. crawl.ts passes
 * NULL for the full universe, while run 3 — the first census, seeded by
 * scripts/pilot/import.ts — carries the string 'full'. Filtering on NULL alone
 * excluded the only full run there was and put "0 of 0" on the live homepage,
 * which is how this comment came to be written.
 */
export async function latestFullRun(env: Env): Promise<LatestRun | null> {
  return env.DB.prepare(
    `SELECT id, finished_at, methodology_version, candidates_version, domains_completed
       FROM runs
      WHERE status = 'complete' AND (universe_filter IS NULL OR universe_filter = 'full')
      ORDER BY id DESC
      LIMIT 1`,
  ).first<LatestRun>();
}

/**
 * The newest complete run of ANY population.
 *
 * For "when did we last do anything", not for statistics. If you are about to
 * compute a percentage with this, you want `latestFullRun` instead.
 */
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

/**
 * How the results table is narrowed. Every field is optional and bound as a
 * parameter, never interpolated.
 */
export interface ResultsFilter {
  readonly universe?: string;
  readonly band?: string;
  /** First character of the apex: "a".."z", or "#" for anything non-alphabetic. */
  readonly letter?: string;
}

/**
 * Shared WHERE fragment plus its bindings.
 *
 * Kept in one place because the row query, the count and the band tallies must
 * agree exactly — a count that disagrees with its own page produces pagination
 * that runs off the end, which is worse than no pagination.
 */
function resultsWhere(runId: number, f: ResultsFilter): { sql: string; binds: unknown[] } {
  const clauses = ["s.run_id = ?"];
  const binds: unknown[] = [runId];

  if (f.universe !== undefined) {
    clauses.push("d.universe = ?");
    binds.push(f.universe);
  }
  if (f.band !== undefined) {
    if (f.band === "unassessed") clauses.push("s.assessed = 0");
    else {
      clauses.push("s.band = ?");
      binds.push(f.band);
    }
  }
  if (f.letter !== undefined) {
    if (f.letter === "#") clauses.push("LOWER(SUBSTR(s.apex, 1, 1)) NOT BETWEEN 'a' AND 'z'");
    else {
      clauses.push("LOWER(SUBSTR(s.apex, 1, 1)) = ?");
      binds.push(f.letter);
    }
  }
  return { sql: clauses.join(" AND "), binds };
}

/**
 * One page of results.
 *
 * Paged rather than capped. The previous version took the top 500 by score with
 * no way to reach the rest, which on 7,422 domains hid 6,922 of them — and because
 * hundreds tie on score, the alphabetical tiebreak made it look like the table
 * simply stopped in the middle of the alphabet.
 *
 * Ordering follows intent: an alphabetical filter means the reader is looking for
 * a specific domain, so sort by name; otherwise the interesting end is the top, so
 * sort by score.
 */
export async function leaderboard(
  env: Env,
  runId: number,
  options: ResultsFilter & { limit: number; offset?: number },
): Promise<LeaderRow[]> {
  const { sql, binds } = resultsWhere(runId, options);
  const order =
    options.letter === undefined ? "s.assessed DESC, s.score DESC, s.apex" : "s.apex, s.score DESC";

  const { results } = await env.DB.prepare(
    `SELECT s.apex, s.score, s.band, s.unassessed_reason, d.universe
       FROM scans s
       JOIN domains d ON d.apex = s.apex
      WHERE ${sql}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
  )
    .bind(...binds, options.limit, options.offset ?? 0)
    .all<LeaderRow>();
  return results;
}

/** Total matching the same filter, so pagination knows where to stop. */
export async function leaderboardCount(
  env: Env,
  runId: number,
  filter: ResultsFilter,
): Promise<number> {
  const { sql, binds } = resultsWhere(runId, filter);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scans s JOIN domains d ON d.apex = s.apex WHERE ${sql}`,
  )
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Counts per band, for the filter pills. Respects the universe filter only. */
export async function bandCounts(
  env: Env,
  runId: number,
  filter: Pick<ResultsFilter, "universe">,
): Promise<Array<{ band: string; n: number }>> {
  const { sql, binds } = resultsWhere(runId, filter);
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(s.band, 'unassessed') AS band, COUNT(*) AS n
       FROM scans s JOIN domains d ON d.apex = s.apex
      WHERE ${sql}
      GROUP BY COALESCE(s.band, 'unassessed')`,
  )
    .bind(...binds)
    .all<{ band: string; n: number }>();
  return results;
}

/** How many domains start with each letter, so empty letters can be dimmed. */
export async function letterCounts(
  env: Env,
  runId: number,
  filter: ResultsFilter,
): Promise<Record<string, number>> {
  const { sql, binds } = resultsWhere(runId, filter);
  const { results } = await env.DB.prepare(
    `SELECT CASE WHEN LOWER(SUBSTR(s.apex,1,1)) BETWEEN 'a' AND 'z'
                 THEN LOWER(SUBSTR(s.apex,1,1)) ELSE '#' END AS l,
            COUNT(*) AS n
       FROM scans s JOIN domains d ON d.apex = s.apex
      WHERE ${sql}
      GROUP BY l`,
  )
    .bind(...binds)
    .all<{ l: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.l, r.n]));
}

export interface RegistryGrowthRow {
  readonly month: string;
  readonly added: number;
  readonly cumulative: number;
  readonly partial: number;
  readonly snapshot_date: string;
}

/**
 * Monthly growth of the official MCP Registry.
 *
 * Somebody else's count of servers, not our count of reachable domains — see
 * apps/worker/schema/0002. Populated by scripts/registry/growth.ts from a
 * snapshot, so it changes only when the registry is re-pulled.
 */
export async function registryGrowth(env: Env): Promise<RegistryGrowthRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT month, added, cumulative, partial, snapshot_date
       FROM registry_growth ORDER BY month`,
  ).all<RegistryGrowthRow>();
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
    // Full-population runs only, the same rule `latestFullRun` enforces and for
    // the same reason. The nightly watchlist is, by construction, every domain
    // that has ever shown a discovery signal, so its share of anything is near
    // 100% and means nothing. This chart plotted it for two runs under the
    // caption "share of assessed domains": 52.1% publish a card, against 20.4%
    // on the real population. A line that silently changes population is worse
    // than no line.
    //
    // Both spellings of a full run, because `crawl.ts` writes NULL and the
    // importer writes 'full'.
    `SELECT a.run_id, a.metric, a.value, a.denominator
       FROM run_aggregates a
       JOIN runs r ON r.id = a.run_id
      WHERE a.universe = 'R'
        AND a.metric IN ('D1_pass', 'D5_pass')
        AND r.status = 'complete'
        AND (r.universe_filter IS NULL OR r.universe_filter = 'full')
      ORDER BY a.run_id, a.metric`,
  ).all<{ run_id: number; metric: string; value: number; denominator: number }>();
  return results;
}
