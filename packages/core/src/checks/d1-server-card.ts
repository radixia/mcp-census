/**
 * D1 — MCP server card.
 *
 * No discovery mechanism has been standardised, so this probes every published
 * candidate and records **which one responded**. The distribution across
 * candidates is a finding in its own right; see
 * docs/DECISIONS/0001-probe-every-candidate-path.md.
 */

import { candidatesForCheck, resolveCandidate } from "../config/candidates.js";
import { headerValue } from "../http/types.js";
import { type CheckContext, type CheckDeps, looksLikeHtml, parseJsonObject } from "./deps.js";
import { type CheckResult, errored, fail, pass, skip } from "./types.js";

export interface CandidateProbe {
  readonly candidateId: string;
  readonly path: string;
  readonly normativity: string;
  readonly result:
    | "found"
    | "not_found"
    | "skipped_by_robots"
    | "transport_error"
    | "not_a_document";
  readonly status?: number;
  readonly documentKeys?: readonly string[];
  readonly error?: string;
}

export async function checkServerCard(
  deps: CheckDeps,
  context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const probes: CandidateProbe[] = [];

  for (const candidate of candidatesForCheck("D1")) {
    const endpointPath = deps.client.endpointPath;

    // Endpoint-relative candidates are meaningless until an endpoint is known.
    if (candidate.template.includes("{endpointPath}") && endpointPath === undefined) continue;

    const path = resolveCandidate(candidate, {
      apex: context.apex,
      ...(endpointPath === undefined ? {} : { endpointPath }),
    });

    const outcome = await deps.client.fetchPath(path);
    const base = {
      candidateId: candidate.id,
      path,
      normativity: candidate.normativity,
    } as const;

    if (outcome.outcome === "skipped_by_robots") {
      probes.push({ ...base, result: "skipped_by_robots" });
      continue;
    }
    if (outcome.outcome === "transport_error") {
      probes.push({ ...base, result: "transport_error", error: outcome.error });
      continue;
    }

    const { response } = outcome;
    if (response.status < 200 || response.status >= 300) {
      probes.push({ ...base, result: "not_found", status: response.status });
      continue;
    }

    const contentType = headerValue(response, "content-type");
    if (looksLikeHtml(contentType, response.body)) {
      // A 200 that is really the site's HTML catch-all, not a card.
      probes.push({ ...base, result: "not_a_document", status: response.status });
      continue;
    }

    const document = parseJsonObject(response.body);
    if (document === undefined) {
      probes.push({ ...base, result: "not_a_document", status: response.status });
      continue;
    }

    probes.push({
      ...base,
      result: "found",
      status: response.status,
      documentKeys: Object.keys(document).slice(0, 20),
    });
  }

  const latencyMs = deps.now() - started;
  const found = probes.filter((p) => p.result === "found");
  const evidence = {
    candidates: probes,
    respondedWith: found.map((p) => p.candidateId),
  };

  if (found.length > 0) return pass("D1", evidence, latencyMs);

  // We were told not to look. That is a fact about our crawl, not about the
  // domain, and must never be recorded as a negative finding against them.
  if (probes.length > 0 && probes.every((p) => p.result === "skipped_by_robots")) {
    return skip("D1", "skipped_by_robots", latencyMs);
  }

  // Everything we tried failed at the transport. We did not learn that the
  // domain has no card, only that we could not reach it.
  if (probes.length > 0 && probes.every((p) => p.result === "transport_error")) {
    return errored("D1", "all candidate probes failed at the transport", latencyMs);
  }

  return fail("D1", evidence, latencyMs);
}
