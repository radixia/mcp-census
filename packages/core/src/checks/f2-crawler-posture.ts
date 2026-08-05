/**
 * F2 — declared AI crawler posture.
 *
 * Reports what a domain has said, per agent, in `robots.txt`. Deliberately
 * takes no view on whether allowing or blocking is the right answer: a
 * considered "no" is a declared posture and scores the same as a considered
 * "yes". What we measure is whether the domain has decided at all.
 *
 * Also records our own standing, which is how `skipped_by_robots` becomes a
 * reportable public category instead of a silent gap.
 */

import { AI_CRAWLER_TOKENS, AI_CRAWLER_TOKENS_VERSION } from "../config/ai-crawlers.js";
import { ROBOTS_TOKEN } from "../http/guarded-client.js";
import { type AgentPosture, agentPosture, isAllowed } from "../robots.js";
import type { CheckContext, CheckDeps } from "./deps.js";
import { type CheckResult, fail, pass } from "./types.js";

export interface AgentPostureRow {
  readonly token: string;
  readonly vendor: string;
  readonly purpose: string;
  readonly posture: AgentPosture;
}

export async function checkCrawlerPosture(
  deps: CheckDeps,
  context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const robots = await deps.client.loadRobots(context.apex);
  const latencyMs = deps.now() - started;

  const agents: AgentPostureRow[] = AI_CRAWLER_TOKENS.map((entry) => ({
    token: entry.token,
    vendor: entry.vendor,
    purpose: entry.purpose,
    posture: agentPosture(robots, entry.token),
  }));

  const declared = agents.filter((a) => a.posture !== "not_mentioned");
  const disallowed = agents.filter((a) => a.posture === "explicitly_disallowed");

  const evidence = {
    tokenListVersion: AI_CRAWLER_TOKENS_VERSION,
    hasRobotsTxt: !robots.empty,
    agents,
    declaredCount: declared.length,
    disallowedCount: disallowed.length,
    sitemaps: robots.sitemaps.slice(0, 10),
    self: {
      token: ROBOTS_TOKEN,
      posture: agentPosture(robots, ROBOTS_TOKEN),
      allowedAtRoot: isAllowed(robots, ROBOTS_TOKEN, "/"),
    },
  };

  // The domain has an opinion about at least one AI agent, either way.
  return declared.length > 0 ? pass("F2", evidence, latencyMs) : fail("F2", evidence, latencyMs);
}
