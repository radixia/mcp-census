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
import { isWithinApex } from "../politeness.js";
import { type CheckContext, type CheckDeps, looksLikeHtml, parseJsonObject } from "./deps.js";
import { type CandidateOutcome, classifyStatus, rollUpOutcome } from "./outcome.js";
import { type CheckResult, errored, fail, pass, skip } from "./types.js";

export interface CandidateProbe {
  readonly candidateId: string;
  readonly host: string;
  readonly path: string;
  readonly normativity: string;
  readonly result: CandidateOutcome;
  readonly status?: number;
  readonly documentKeys?: readonly string[];
  readonly error?: string;
}

/**
 * Pull an endpoint URL out of a card, whatever shape the card happens to be.
 *
 * There is no agreed format — the wild contains at least the registry
 * `server.json` shape (`remotes[].url`), the AI Catalog shape, a bare
 * `endpoint`, and the client *configuration* format (`mcpServers`). We read all
 * of them rather than pretending one won.
 *
 * Only endpoints on the target apex are returned. A card pointing at a vendor's
 * host describes somebody else's server, and probing it would take us off the
 * domain we were asked to measure.
 */
export function endpointFromCard(
  document: Record<string, unknown>,
  apex: string,
): { host: string; path: string } | undefined {
  const urls: string[] = [];

  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      urls.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item);
    } else if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      for (const key of ["url", "endpoint", "uri", "href"]) collect(record[key]);
      for (const key of ["remotes", "servers", "mcpServers", "entries"]) {
        const nested = record[key];
        if (typeof nested === "object" && nested !== null) collect(Object.values(nested));
      }
    }
  };

  collect(document);

  for (const candidate of urls) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    if (!isWithinApex(parsed.hostname, apex)) continue;
    return { host: parsed.hostname, path: parsed.pathname === "" ? "/" : parsed.pathname };
  }

  return undefined;
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

    // An endpoint-relative card belongs to the server that serves the endpoint,
    // which is often `mcp.<apex>`. Asking the apex for it asks the wrong host.
    const host =
      candidate.kind === "endpoint-relative"
        ? (deps.client.endpointHost ?? context.apex)
        : context.apex;

    const outcome = await deps.client.fetchPath(path, "GET", host);
    const base = {
      candidateId: candidate.id,
      host,
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
    if (outcome.outcome === "redirect_off_apex") {
      probes.push({ ...base, result: "redirected_off_apex", error: outcome.to });
      continue;
    }

    const { response } = outcome;
    if (response.status < 200 || response.status >= 300) {
      probes.push({ ...base, result: classifyStatus(response.status), status: response.status });
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

    // A card usually names the endpoint it describes. Registering it is what
    // lets D5 confirm domains that publish a card but answer nothing at a
    // conventional path — cloudflare.com and sentry.io both look like that, and
    // relying on D3's 405 alone would leave them permanently unconfirmed.
    if (deps.client.endpointUrl === undefined) {
      const endpoint = endpointFromCard(document, context.apex);
      if (endpoint !== undefined) deps.client.endpointDiscovered(endpoint.path, endpoint.host);
    }
  }

  const latencyMs = deps.now() - started;
  const found = probes.filter((p) => p.result === "found");
  const evidence = {
    candidates: probes,
    respondedWith: found.map((p) => p.candidateId),
    outcome: rollUpOutcome(probes.map((p) => p.result)),
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
