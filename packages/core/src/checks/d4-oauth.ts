/**
 * D4 — OAuth Protected Resource metadata (RFC 9728).
 *
 * The only MUST-level discovery signal in the whole MCP specification: an MCP
 * server is *required* to implement RFC 9728 to advertise its authorization
 * servers. That makes this the highest-confidence check we have, and it is why
 * D4 is treated as primary rather than auxiliary.
 *
 * A `401` carrying `WWW-Authenticate: ... resource_metadata="..."` is a positive
 * detection, not a failure. Reading a response header is not an authentication
 * attempt: we never send a credential and never follow the challenge.
 */

import { candidatesForCheck, resolveCandidate } from "../config/candidates.js";
import { headerValue } from "../http/types.js";
import { type CheckContext, type CheckDeps, parseJsonObject } from "./deps.js";
import { type CheckResult, errored, fail, pass, skip } from "./types.js";

/**
 * Pull `resource_metadata` out of a WWW-Authenticate challenge.
 * Tolerates quoted and unquoted forms, and multiple challenges in one header.
 */
export function parseResourceMetadata(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /resource_metadata\s*=\s*("([^"]*)"|([^\s,]+))/i.exec(header);
  return match?.[2] ?? match?.[3];
}

interface OauthProbe {
  readonly candidateId: string;
  readonly path: string;
  readonly result: "found" | "not_found" | "skipped_by_robots" | "transport_error" | "malformed";
  readonly status?: number;
  readonly authorizationServers?: readonly string[];
  readonly resourceMetadataHint?: string;
}

export async function checkOauthProtectedResource(
  deps: CheckDeps,
  context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const probes: OauthProbe[] = [];
  let challengeHint: string | undefined;

  for (const candidate of candidatesForCheck("D4")) {
    const endpointPath = deps.client.endpointPath;
    if (candidate.template.includes("{endpointPath}") && endpointPath === undefined) continue;

    const path = resolveCandidate(candidate, {
      apex: context.apex,
      ...(endpointPath === undefined ? {} : { endpointPath }),
    });

    const outcome = await deps.client.fetchPath(path);
    const base = { candidateId: candidate.id, path } as const;

    if (outcome.outcome === "skipped_by_robots") {
      probes.push({ ...base, result: "skipped_by_robots" });
      continue;
    }
    if (outcome.outcome === "transport_error") {
      probes.push({ ...base, result: "transport_error" });
      continue;
    }

    const { response } = outcome;

    // A challenge pointing at the metadata document is itself evidence of a
    // compliant server, even when the document is somewhere we did not guess.
    const hint = parseResourceMetadata(headerValue(response, "www-authenticate"));
    if (hint !== undefined) challengeHint = hint;

    if (response.status < 200 || response.status >= 300) {
      probes.push({
        ...base,
        result: "not_found",
        status: response.status,
        ...(hint === undefined ? {} : { resourceMetadataHint: hint }),
      });
      continue;
    }

    const document = parseJsonObject(response.body);
    const servers = document?.authorization_servers;

    // RFC 9728 requires at least one authorization server. A document without
    // one is a misconfiguration, and we record it as such rather than as a pass.
    if (!Array.isArray(servers) || servers.length === 0) {
      probes.push({ ...base, result: "malformed", status: response.status });
      continue;
    }

    probes.push({
      ...base,
      result: "found",
      status: response.status,
      authorizationServers: servers.filter((s): s is string => typeof s === "string").slice(0, 10),
    });
  }

  const latencyMs = deps.now() - started;
  const found = probes.filter((p) => p.result === "found");
  const evidence = {
    candidates: probes,
    ...(challengeHint === undefined ? {} : { wwwAuthenticateResourceMetadata: challengeHint }),
  };

  if (found.length > 0 || challengeHint !== undefined) return pass("D4", evidence, latencyMs);

  if (probes.length > 0 && probes.every((p) => p.result === "skipped_by_robots")) {
    return skip("D4", "skipped_by_robots", latencyMs);
  }

  if (probes.length > 0 && probes.every((p) => p.result === "transport_error")) {
    return errored("D4", "all candidate probes failed at the transport", latencyMs);
  }

  return fail("D4", evidence, latencyMs);
}
