/**
 * The on-demand check behind `/census/check`.
 *
 * Three tiers, because a full probe cannot fit in the ten seconds the page
 * promises. Our own rule is one request per second per apex and a full probe is
 * roughly twenty requests, so the arithmetic is not negotiable — the politeness
 * limit is the constraint, and it is the right one to keep.
 *
 *  1. **In the census** — a D1 lookup. Instant, and it is the published number.
 *  2. **Checked recently** — from KV. Instant.
 *  3. **Never measured** — a *reduced* live probe: robots, the well-known
 *     candidates, the text fallbacks. About ten requests, so about ten seconds.
 *     Labelled as a quick check, because it skips the conventional endpoint
 *     probes and the handshake and therefore cannot produce the same score.
 *
 * Self-submitted domains are recorded with `source = 'self_submitted'` and are
 * excluded from every published statistic. Letting on-demand checks into the
 * numbers would make the census a convenience sample, which is the exact flaw it
 * criticises in prior work.
 */

import {
  type CheckResult,
  candidatesForCheck,
  checkCrawlerPosture,
  checkOauthProtectedResource,
  checkServerCard,
  checkTextFallbacks,
  GuardedHttpClient,
  METHODOLOGY_VERSION,
  resolveCrawlerIdentity,
  scoreDomain,
} from "@mcp-census/core";

import { sleep, workerFetch } from "./adapters.js";
import type { Env } from "./env.js";
import { loadOptOuts } from "./store.js";

const CACHE_TTL_SECONDS = 3600;

/** Accepts what a person would type and returns a bare apex, or undefined. */
export function normaliseDomain(input: string): string | undefined {
  let value = input.trim().toLowerCase();
  if (value === "") return undefined;

  // Tolerate a pasted URL.
  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const slash = value.indexOf("/");
  if (slash !== -1) value = value.slice(0, slash);
  const colon = value.indexOf(":");
  if (colon !== -1) value = value.slice(0, colon);

  // A hostname, nothing else. Rejects anything that could be a probe at a path.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    return undefined;
  }
  if (value.length > 253) return undefined;
  return value;
}

export interface CheckOutcome {
  readonly apex: string;
  readonly score: number | null;
  readonly band: string | null;
  readonly assessed: boolean;
  readonly unassessedReason: string | null;
  readonly checks: Array<{ check_id: string; status: string; detail: string | null }>;
  readonly fixes: Array<{ title: string; detail: string }>;
  readonly known: boolean;
}

/**
 * The highest-value things this domain could do next, most valuable first.
 *
 * Deliberately generous: every finding ships with the fix, whether or not the
 * reader ever talks to us.
 */
export function fixesFor(checks: ReadonlyArray<{ check_id: string; status: string }>): Array<{
  title: string;
  detail: string;
}> {
  const status = (id: string) => checks.find((c) => c.check_id === id)?.status;
  const fixes: Array<{ title: string; detail: string }> = [];

  if (status("D1") !== "pass") {
    fixes.push({
      title: "Publish a server card at /.well-known/ai-catalog.json",
      detail:
        "This is the location the current MCP proposal defers to, and almost nobody has it yet. A small JSON document naming your MCP endpoint is enough for an agent to find you from your domain name alone.",
    });
  }
  if (status("D5") !== "pass" && status("D3") !== "pass") {
    fixes.push({
      title: "Expose the endpoint somewhere conventional",
      detail:
        "An agent that cannot guess your endpoint cannot reach it. Serving the streamable-HTTP endpoint at /mcp, or on mcp.<yourdomain>, makes you discoverable even to a client that has never heard of you.",
    });
  }
  if (status("F1") !== "pass") {
    fixes.push({
      title: "Add an llms.txt",
      detail:
        "A plain-text summary of what you do and where the important pages are. It is the cheapest thing on this list and the most widely read by current agents.",
    });
  }
  if (status("F2") !== "pass") {
    fixes.push({
      title: "State an AI crawler policy in robots.txt",
      detail:
        "Name the agents you allow or refuse. Either answer counts as a decision; silence means every crawler guesses. We score a considered 'no' exactly the same as a considered 'yes'.",
    });
  }

  return fixes.slice(0, 3);
}

async function fromCensus(env: Env, apex: string): Promise<CheckOutcome | null> {
  const scan = await env.DB.prepare(
    `SELECT s.id, s.score, s.band, s.assessed, s.unassessed_reason
       FROM scans s JOIN runs r ON r.id = s.run_id
      WHERE s.apex = ? AND r.status = 'complete'
      ORDER BY s.run_id DESC LIMIT 1`,
  )
    .bind(apex)
    .first<{
      id: number;
      score: number | null;
      band: string | null;
      assessed: number;
      unassessed_reason: string | null;
    }>();

  if (scan === null) return null;

  const { results: checks } = await env.DB.prepare(
    `SELECT check_id, status, detail FROM check_results WHERE scan_id = ? ORDER BY check_id`,
  )
    .bind(scan.id)
    .all<{ check_id: string; status: string; detail: string | null }>();

  return {
    apex,
    score: scan.score,
    band: scan.band,
    assessed: scan.assessed === 1,
    unassessedReason: scan.unassessed_reason,
    checks,
    fixes: fixesFor(checks),
    known: true,
  };
}

/**
 * A reduced probe: robots, the domain-level well-known candidates, RFC 9728 and
 * the text fallbacks. No conventional-endpoint sweep and no handshake, which is
 * what keeps it inside ten seconds — and what means it cannot produce the census
 * score. Labelled as such wherever it is shown.
 */
async function quickProbe(env: Env, apex: string): Promise<CheckOutcome> {
  const optOuts = await loadOptOuts(env);
  const client = new GuardedHttpClient(
    { fetch: workerFetch(), sleep, now: () => Date.now() },
    { apex, identity: resolveCrawlerIdentity(), optOuts },
  );
  const deps = { client, now: () => Date.now() };
  const context = { apex };

  const results: CheckResult[] = [];
  for (const run of [
    () => checkCrawlerPosture(deps, context),
    () => checkServerCard(deps, context),
    () => checkOauthProtectedResource(deps, context),
    () => checkTextFallbacks(deps, context),
  ]) {
    results.push(await run());
  }

  const score = scoreDomain(results);
  const checks = results.map((c) => ({
    check_id: c.id,
    status: c.status,
    detail: ((c.evidence as { skipReason?: string }).skipReason ?? null) as string | null,
  }));

  return {
    apex,
    score: score.assessed ? score.score : null,
    band: score.assessed ? score.band : null,
    assessed: score.assessed,
    unassessedReason: score.assessed ? null : score.reason,
    checks,
    fixes: fixesFor(checks),
    known: false,
  };
}

/** How many candidate paths a quick probe touches, for the page's own copy. */
export const QUICK_PROBE_REQUESTS =
  candidatesForCheck("D1").filter((c) => !c.template.includes("{endpointPath}")).length +
  candidatesForCheck("D4").length +
  4;

export async function runCheck(env: Env, apex: string): Promise<CheckOutcome> {
  const known = await fromCensus(env, apex);
  if (known !== null) return known;

  // The version is in the key on purpose. Without it, a bump to the methodology
  // leaves results measured under the old one being served as current for the
  // whole TTL — the page would show a check set that no longer exists, and the
  // graph would render the missing rows as "not reached".
  const cacheKey = `check:${METHODOLOGY_VERSION}:${apex}`;
  const cached = await env.SCAN_CACHE.get(cacheKey, "json");
  if (cached !== null) return cached as CheckOutcome;

  const outcome = await quickProbe(env, apex);

  await env.SCAN_CACHE.put(cacheKey, JSON.stringify(outcome), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  // Recorded so a repeat visit is instant and so the domain can be considered
  // for a future universe — flagged self_submitted so it never enters a
  // published denominator.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO domains (apex, universe, source, first_seen)
     VALUES (?, 'self', 'self_submitted', ?)`,
  )
    .bind(apex, new Date().toISOString())
    .run();

  return outcome;
}

/**
 * Rate limit on-demand checks per client, so the magnet cannot be turned into a
 * way to make us crawl the web on somebody else's behalf.
 */
export async function withinRateLimit(env: Env, clientKey: string): Promise<boolean> {
  const key = `rl:${clientKey}`;
  const seen = await env.SCAN_CACHE.get(key);
  const count = seen === null ? 0 : Number.parseInt(seen, 10);
  if (Number.isFinite(count) && count >= 10) return false;

  await env.SCAN_CACHE.put(key, String(count + 1), { expirationTtl: 600 });
  return true;
}

export { CACHE_TTL_SECONDS };
