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
  readonly host: string;
  readonly path: string;
  readonly result: "found" | "not_found" | "skipped_by_robots" | "transport_error" | "malformed";
  readonly status?: number;
  readonly authorizationServers?: readonly string[];
  readonly resourceMetadataHint?: string;
}

const ROOT_PATH = "/.well-known/oauth-protected-resource";

/**
 * Where to look for Protected Resource Metadata.
 *
 * RFC 9728 locates the document on the **resource server** — for MCP that is
 * the origin serving the MCP endpoint, commonly `mcp.<apex>` rather than the
 * apex. Probing only the apex is a false negative on the one check the
 * specification makes mandatory, so the endpoint's own origin is probed too,
 * in both the path-inserted and root forms.
 */
export function oauthTargets(context: {
  apex: string;
  endpointHost?: string;
  endpointPath?: string;
}): ReadonlyArray<{ candidateId: string; host: string; path: string }> {
  const targets = [
    { candidateId: "oauth-protected-resource-root", host: context.apex, path: ROOT_PATH },
  ];

  const { endpointHost, endpointPath } = context;
  if (endpointHost !== undefined && endpointPath !== undefined) {
    const normalised = endpointPath.endsWith("/") ? endpointPath.slice(0, -1) : endpointPath;

    if (normalised !== "") {
      targets.push({
        candidateId: "oauth-protected-resource-path-inserted",
        host: endpointHost,
        path: `${ROOT_PATH}${normalised}`,
      });
    }
    if (endpointHost !== context.apex) {
      targets.push({
        candidateId: "oauth-protected-resource-endpoint-root",
        host: endpointHost,
        path: ROOT_PATH,
      });
    }
  }

  return targets;
}

export async function checkOauthProtectedResource(
  deps: CheckDeps,
  context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const probes: OauthProbe[] = [];
  let challengeHint: string | undefined;

  const targets = oauthTargets({
    apex: context.apex,
    ...(deps.client.endpointHost === undefined ? {} : { endpointHost: deps.client.endpointHost }),
    ...(deps.client.endpointPath === undefined ? {} : { endpointPath: deps.client.endpointPath }),
  });

  for (const target of targets) {
    const { host, path } = target;
    const outcome = await deps.client.fetchPath(path, "GET", host);
    const base = { candidateId: target.candidateId, host, path } as const;

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
