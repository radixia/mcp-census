/**
 * D3 — conventional MCP endpoint.
 *
 * A modern MCP endpoint is POST-only and **SHOULD** answer `GET`/`HEAD` with
 * `405 Method Not Allowed`, so a successful GET means we found something that is
 * *not* an MCP endpoint. The `405` is the signal. See
 * docs/DECISIONS/0002-d3-detects-405.md for why we detect it this way rather
 * than POSTing at undiscovered paths.
 *
 * D3 alone is weak evidence — any POST-only endpoint answers the same way. Its
 * job is to locate an endpoint for the handshake to confirm, and it must never
 * be scored as a confirmed MCP server on its own.
 */

import { CONVENTIONAL_ENDPOINTS, CONVENTIONAL_SUBDOMAINS } from "../config/candidates.js";
import { headerValue } from "../http/types.js";
import type { CheckContext, CheckDeps } from "./deps.js";
import { parseJsonObject } from "./deps.js";
import { type CheckResult, fail, pass, skip } from "./types.js";

/** JSON-RPC error codes that only a modern MCP server emits. */
const MODERN_ERROR_CODES = new Set([
  -32022, // UnsupportedProtocolVersionError
  -32020, // HeaderMismatch
]);

interface EndpointProbe {
  readonly host: string;
  readonly path: string;
  readonly result:
    | "method_not_allowed"
    | "modern_jsonrpc_error"
    | "not_found"
    | "other_status"
    | "skipped_by_robots"
    | "transport_error"
    | "redirected_off_apex";
  readonly status?: number;
  readonly jsonRpcErrorCode?: number;
}

/** Apex first, then the conventional subdomains. */
export function endpointTargets(apex: string): ReadonlyArray<{ host: string; path: string }> {
  const targets: Array<{ host: string; path: string }> = [
    { host: apex, path: "/mcp" },
    { host: apex, path: "/api/mcp" },
  ];

  for (const label of CONVENTIONAL_SUBDOMAINS) {
    const host = `${label}.${apex}`;
    // On a host literally named `mcp`, the root is as likely as `/mcp`.
    if (label === "mcp") targets.push({ host, path: "/" });
    targets.push({ host, path: "/mcp" });
  }

  return targets.filter((t) => CONVENTIONAL_ENDPOINTS.includes(t.path));
}

export async function checkConventionalEndpoint(
  deps: CheckDeps,
  context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const probes: EndpointProbe[] = [];
  let discovered: { host: string; path: string } | undefined;

  for (const target of endpointTargets(context.apex)) {
    const outcome = await deps.client.fetchPath(target.path, "GET", target.host);
    const base = { host: target.host, path: target.path } as const;

    if (outcome.outcome === "skipped_by_robots") {
      probes.push({ ...base, result: "skipped_by_robots" });
      continue;
    }
    if (outcome.outcome === "transport_error") {
      // Overwhelmingly a subdomain that does not resolve. Expected, not an error.
      probes.push({ ...base, result: "transport_error" });
      continue;
    }
    if (outcome.outcome === "redirect_off_apex") {
      probes.push({ ...base, result: "redirected_off_apex" });
      continue;
    }

    const { response } = outcome;

    if (response.status === 405) {
      probes.push({ ...base, result: "method_not_allowed", status: 405 });
      discovered ??= target;
      continue;
    }

    if (response.status === 400 || response.status === 404) {
      const code = modernJsonRpcErrorCode(response.body, headerValue(response, "content-type"));
      if (code !== undefined) {
        probes.push({
          ...base,
          result: "modern_jsonrpc_error",
          status: response.status,
          jsonRpcErrorCode: code,
        });
        discovered ??= target;
        continue;
      }
      probes.push({ ...base, result: "not_found", status: response.status });
      continue;
    }

    probes.push({ ...base, result: "other_status", status: response.status });
  }

  const latencyMs = deps.now() - started;
  const evidence = {
    probes,
    ...(discovered === undefined
      ? {}
      : {
          endpointHost: discovered.host,
          endpointPath: discovered.path,
          endpointUrl: `https://${discovered.host}${discovered.path}`,
          // Explicit, because it is the single most misreadable thing here.
          confidence: "weak: a 405 is consistent with any POST-only endpoint",
        }),
  };

  if (discovered !== undefined) {
    // Unlocks the endpoint-relative candidates in D1 and D4. It does not by
    // itself unlock POST — only a confirmed handshake does that.
    deps.client.endpointDiscovered(discovered.path, discovered.host);
    return pass("D3", evidence, latencyMs);
  }

  if (probes.length > 0 && probes.every((p) => p.result === "skipped_by_robots")) {
    return skip("D3", "skipped_by_robots", latencyMs);
  }

  return fail("D3", evidence, latencyMs);
}

function modernJsonRpcErrorCode(body: string, contentType: string | undefined): number | undefined {
  if (contentType !== undefined && !contentType.toLowerCase().includes("json")) return undefined;

  const document = parseJsonObject(body);
  const error = document?.error;
  if (typeof error !== "object" || error === null) return undefined;

  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && MODERN_ERROR_CODES.has(code) ? code : undefined;
}
