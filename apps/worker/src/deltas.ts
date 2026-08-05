/**
 * The debounce that makes the tracker trustworthy.
 *
 * A status change is published only once it has **persisted across two
 * consecutive complete runs**. See ADR 0004 for why this is not fussiness:
 * during the pilot, `otomoto.pl` answered `200` to the crawler and `403` to a
 * manual check an hour later. At a base rate near 1%, bot-mitigation flapping
 * produces more apparent changes than real adoption does, so a raw delta feed
 * would be mostly false — and a public feed that cries wolf is worse than none.
 *
 * The cost is a one-run confirmation lag, about a day. The methodology states it.
 *
 * `pending_changes` is the staging area and is never shown. `status_changes` is
 * what the site reads.
 */

import type { Env } from "./env.js";

/** Discovery events are rare and newsworthy; posture events keep the feed alive. */
function categoryOf(checkId: string): "discovery" | "posture" | "fallback" {
  if (checkId === "F2") return "posture";
  if (checkId === "F1") return "fallback";
  return "discovery";
}

interface Observed {
  apex: string;
  check_id: string;
  from_status: string;
  to_status: string;
}

/**
 * Compare a run against the previous usable one and move the debounce forward.
 *
 * Only runs flagged `usable_for_delta` take part: a partial run as a baseline
 * would make every domain it never reached look like it had just disappeared.
 */
export async function computeDeltas(
  env: Env,
  runId: number,
): Promise<{
  observed: number;
  confirmed: number;
  dropped: number;
}> {
  const current = await env.DB.prepare(
    `SELECT id FROM runs WHERE id = ? AND status = 'complete' AND usable_for_delta = 1`,
  )
    .bind(runId)
    .first<{ id: number }>();
  if (current === null) return { observed: 0, confirmed: 0, dropped: 0 };

  const previous = await env.DB.prepare(
    `SELECT id FROM runs
      WHERE id < ? AND status = 'complete' AND usable_for_delta = 1
      ORDER BY id DESC LIMIT 1`,
  )
    .bind(runId)
    .first<{ id: number }>();
  // Nothing to compare against yet. The first usable run is a baseline, not a
  // set of changes — publishing it as changes would announce the entire census.
  if (previous === null) return { observed: 0, confirmed: 0, dropped: 0 };

  const { results: observed } = await env.DB.prepare(
    `SELECT cur.apex, cur.check_id, prev.status AS from_status, cur.status AS to_status
       FROM (SELECT s.apex, cr.check_id, cr.status
               FROM scans s JOIN check_results cr ON cr.scan_id = s.id
              WHERE s.run_id = ?) AS cur
       JOIN (SELECT s.apex, cr.check_id, cr.status
               FROM scans s JOIN check_results cr ON cr.scan_id = s.id
              WHERE s.run_id = ?) AS prev
         ON prev.apex = cur.apex AND prev.check_id = cur.check_id
      WHERE cur.status <> prev.status
        -- A move into or out of skip/error is usually us, not them: robots
        -- changing, or a timeout. Only pass/fail transitions are findings.
        AND cur.status IN ('pass','fail')
        AND prev.status IN ('pass','fail')`,
  )
    .bind(runId, previous.id)
    .all<Observed>();

  const now = new Date().toISOString();
  const statements = [];
  let confirmed = 0;

  for (const change of observed) {
    // Already staged with the same shape? Then it has survived two runs.
    const staged = await env.DB.prepare(
      `SELECT first_seen_run FROM pending_changes
        WHERE apex = ? AND check_id = ? AND from_status = ? AND to_status = ?`,
    )
      .bind(change.apex, change.check_id, change.from_status, change.to_status)
      .first<{ first_seen_run: number }>();

    if (staged !== null) {
      confirmed++;
      statements.push(
        env.DB.prepare(
          `INSERT INTO status_changes
             (apex, check_id, from_status, to_status, first_seen_run, confirmed_run,
              confirmed_at, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          change.apex,
          change.check_id,
          change.from_status,
          change.to_status,
          staged.first_seen_run,
          runId,
          now,
          categoryOf(change.check_id),
        ),
        env.DB.prepare(`DELETE FROM pending_changes WHERE apex = ? AND check_id = ?`).bind(
          change.apex,
          change.check_id,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO pending_changes (apex, check_id, from_status, to_status, first_seen_run)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (apex, check_id) DO UPDATE SET
             from_status = excluded.from_status,
             to_status = excluded.to_status,
             first_seen_run = excluded.first_seen_run`,
        ).bind(change.apex, change.check_id, change.from_status, change.to_status, runId),
      );
    }
  }

  // A staged change that did *not* reappear was a flap. Drop it silently —
  // that is the whole point, and it must never reach status_changes.
  const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM pending_changes`).first<{
    n: number;
  }>();

  statements.push(
    env.DB.prepare(
      `DELETE FROM pending_changes
        WHERE first_seen_run < ?
          AND NOT EXISTS (
            SELECT 1 FROM scans s
              JOIN check_results cr ON cr.scan_id = s.id
             WHERE s.run_id = ?
               AND s.apex = pending_changes.apex
               AND cr.check_id = pending_changes.check_id
               AND cr.status = pending_changes.to_status
          )`,
    ).bind(runId, runId),
  );

  if (statements.length > 0) await env.DB.batch(statements);

  const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM pending_changes`).first<{
    n: number;
  }>();

  return {
    observed: observed.length,
    confirmed,
    dropped: Math.max(0, (before?.n ?? 0) + observed.length - confirmed - (after?.n ?? 0)),
  };
}

/**
 * Precompute the numbers the public chart reads, per run and per universe, so
 * no page ever aggregates the whole history at request time.
 */
export async function computeAggregates(env: Env, runId: number): Promise<number> {
  const metrics = await env.DB.prepare(
    `WITH per AS (
       SELECT d.universe, s.id, s.assessed, s.band,
              MAX(CASE WHEN cr.check_id='D1' AND cr.status='pass' THEN 1 ELSE 0 END) AS d1,
              MAX(CASE WHEN cr.check_id='D5' AND cr.status='pass' THEN 1 ELSE 0 END) AS d5,
              MAX(CASE WHEN cr.check_id IN ('D1','D2','D3','D4') AND cr.status='pass' THEN 1 ELSE 0 END) AS disc
         FROM scans s
         JOIN domains d ON d.apex = s.apex
         LEFT JOIN check_results cr ON cr.scan_id = s.id
        WHERE s.run_id = ?
        GROUP BY s.id
     )
     SELECT universe,
            SUM(assessed) AS assessed,
            SUM(CASE WHEN assessed=1 AND d1=1 THEN 1 ELSE 0 END) AS d1_pass,
            SUM(CASE WHEN assessed=1 AND d5=1 THEN 1 ELSE 0 END) AS d5_pass,
            SUM(CASE WHEN assessed=1 AND disc=0 THEN 1 ELSE 0 END) AS no_discovery
       FROM per GROUP BY universe`,
  )
    .bind(runId)
    .all<{
      universe: string;
      assessed: number;
      d1_pass: number;
      d5_pass: number;
      no_discovery: number;
    }>();

  const statements = [];
  for (const row of metrics.results) {
    for (const [metric, value] of [
      ["D1_pass", row.d1_pass],
      ["D5_pass", row.d5_pass],
      ["no_discovery", row.no_discovery],
    ] as const) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO run_aggregates (run_id, universe, metric, value, denominator)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (run_id, universe, metric) DO UPDATE SET
             value = excluded.value, denominator = excluded.denominator`,
        ).bind(runId, row.universe, metric, value, row.assessed),
      );
    }
  }

  // The adoption-by-mechanism curve, which is the finding this project exists
  // to track over time.
  const { results: candidates } = await env.DB.prepare(
    `SELECT d.universe, ch.candidate_id, COUNT(*) AS n
       FROM candidate_hits ch
       JOIN scans s ON s.id = ch.scan_id
       JOIN domains d ON d.apex = s.apex
      WHERE s.run_id = ?
      GROUP BY d.universe, ch.candidate_id`,
  )
    .bind(runId)
    .all<{ universe: string; candidate_id: string; n: number }>();

  const denominators = new Map(metrics.results.map((r) => [r.universe, r.assessed]));
  for (const row of candidates) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO run_aggregates (run_id, universe, metric, value, denominator)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (run_id, universe, metric) DO UPDATE SET
           value = excluded.value, denominator = excluded.denominator`,
      ).bind(
        runId,
        row.universe,
        `candidate:${row.candidate_id}`,
        row.n,
        denominators.get(row.universe) ?? 0,
      ),
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);
  return statements.length;
}
