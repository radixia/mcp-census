/**
 * Runs every check for one domain, in the order they depend on each other.
 *
 * Ordering is not cosmetic:
 *
 *  1. **F2** first, because it loads `robots.txt`, which gates everything else.
 *  2. **D3** next, because finding an endpoint unlocks the endpoint-relative
 *     candidates in D1 (`<endpoint>/server-card`) and D4 (the RFC 9728
 *     path-insertion form). Running D1 first would silently skip them.
 *  3. D1, D4, then D2 and F1, which are independent.
 *
 * The whole domain is probed sequentially so the one-request-per-second budget
 * is respected. Parallelism belongs *across* domains, in the runner.
 */

import { checkServerCard } from "./checks/d1-server-card.js";
import { checkDnsDiscovery } from "./checks/d2-dns.js";
import { checkConventionalEndpoint } from "./checks/d3-endpoint.js";
import { checkOauthProtectedResource } from "./checks/d4-oauth.js";
import { checkHandshake } from "./checks/d5-handshake.js";
import { checkToolListing } from "./checks/d6-tools.js";
import type { CheckContext, DnsCheckDeps } from "./checks/deps.js";
import { checkTextFallbacks } from "./checks/f1-text-fallbacks.js";
import { checkCrawlerPosture } from "./checks/f2-crawler-posture.js";
import { type CheckResult, errored, skip } from "./checks/types.js";
import { CANDIDATES_VERSION } from "./config/candidates.js";
import { ProbeGuardError } from "./politeness.js";
import { type ScoreResult, scoreDomain } from "./scoring.js";
import { METHODOLOGY_VERSION } from "./version.js";

export interface DomainProbeResult {
  readonly apex: string;
  readonly methodologyVersion: string;
  readonly candidatesVersion: string;
  readonly checks: readonly CheckResult[];
  readonly score: ScoreResult;
  readonly requestCount: number;
  readonly durationMs: number;
}

export async function probeDomain(
  deps: DnsCheckDeps,
  context: CheckContext,
): Promise<DomainProbeResult> {
  const started = deps.now();
  const checks: CheckResult[] = [];

  const steps = [
    { id: "F2", run: () => checkCrawlerPosture(deps, context) },
    { id: "D3", run: () => checkConventionalEndpoint(deps, context) },
    { id: "D1", run: () => checkServerCard(deps, context) },
    { id: "D4", run: () => checkOauthProtectedResource(deps, context) },
    { id: "D2", run: () => checkDnsDiscovery(deps, context) },
    { id: "F1", run: () => checkTextFallbacks(deps, context) },
    // Last, because it needs whatever endpoint D3 or D1 turned up, and because
    // it is the only step that POSTs.
    { id: "D5", run: () => checkHandshake(deps, context) },
  ] as const;

  for (const step of steps) {
    try {
      checks.push(await step.run());
    } catch (error) {
      // A guard violation is our bug, not a fact about the domain. Let it out:
      // silently recording it as an "error" row would bury exactly the mistake
      // we most need to see.
      if (error instanceof ProbeGuardError) throw error;
      checks.push(errored(step.id, error, 0));
    }
  }

  // Tools are only worth asking for once a server has actually answered.
  const handshake = checks.find((c) => c.id === "D5");
  if (handshake?.status === "pass") {
    try {
      const sessionId = (handshake.evidence as { sessionId?: unknown }).sessionId;
      const { d6, q1 } = await checkToolListing(
        deps,
        context,
        typeof sessionId === "string" ? sessionId : undefined,
      );
      checks.push(d6, q1);
    } catch (error) {
      if (error instanceof ProbeGuardError) throw error;
      checks.push(errored("D6", error, 0));
    }
  } else {
    checks.push(skip("D6", "handshake_did_not_succeed"), skip("Q1", "handshake_did_not_succeed"));
  }

  return {
    apex: context.apex,
    methodologyVersion: METHODOLOGY_VERSION,
    candidatesVersion: CANDIDATES_VERSION,
    checks,
    score: scoreDomain(checks),
    requestCount: deps.client.requestCount,
    durationMs: deps.now() - started,
  };
}
