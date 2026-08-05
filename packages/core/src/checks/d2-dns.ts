/**
 * D2 — DNS-based discovery.
 *
 * Per draft-serra-mcp-discovery-uri-04, an individual IETF Internet-Draft with
 * no working-group standing:
 *
 *   _mcp.{domain} IN TXT "v=mcp1; src={url}[; auth={type}]"
 *   _mcp.{domain} IN TXT "v=mcp1; registry={url}"
 *
 * Expected hit rate is near zero. The check exists because a measured zero on a
 * named mechanism is a publishable result, and because a second competing draft
 * (draft-morrison-mcp-dns-discovery) may specify a different record format —
 * that one is unverified and deliberately not guessed at. See
 * docs/SPEC-NOTES.md §6.
 */

import { candidatesForCheck, resolveCandidate } from "../config/candidates.js";
import type { CheckContext, DnsCheckDeps } from "./deps.js";
import { type CheckResult, errored, fail, pass } from "./types.js";

export interface McpTxtRecord {
  readonly raw: string;
  readonly version: string;
  readonly src?: string;
  readonly registry?: string;
  readonly auth?: string;
}

/** Parse a `v=mcp1; key=value; ...` TXT record. Returns undefined if it is not one. */
export function parseMcpTxtRecord(raw: string): McpTxtRecord | undefined {
  const fields = new Map<string, string>();

  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (key !== "") fields.set(key, value);
  }

  const version = fields.get("v");
  if (version === undefined || !version.toLowerCase().startsWith("mcp")) return undefined;

  const src = fields.get("src");
  const registry = fields.get("registry");
  const auth = fields.get("auth");

  return {
    raw,
    version,
    ...(src === undefined ? {} : { src }),
    ...(registry === undefined ? {} : { registry }),
    ...(auth === undefined ? {} : { auth }),
  };
}

export async function checkDnsDiscovery(
  deps: DnsCheckDeps,
  context: CheckContext,
): Promise<CheckResult> {
  const started = deps.now();
  const [candidate] = candidatesForCheck("D2");

  if (candidate === undefined) {
    return errored("D2", "no D2 candidate configured", deps.now() - started);
  }

  const name = resolveCandidate(candidate, { apex: context.apex });

  let chunks: string[][];
  try {
    chunks = await deps.resolveTxt(name);
  } catch (error) {
    // NXDOMAIN is the overwhelmingly common case and is a clean negative, not a
    // failure to measure.
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOTFOUND|ENODATA|NXDOMAIN/i.test(message)) {
      return fail("D2", { name, records: [], reason: "no TXT record" }, deps.now() - started);
    }
    return errored("D2", error, deps.now() - started);
  }

  // A TXT record arrives as chunks that must be concatenated before parsing.
  const records = chunks.map((parts) => parts.join(""));
  const parsed = records.map(parseMcpTxtRecord).filter((r): r is McpTxtRecord => r !== undefined);

  const latencyMs = deps.now() - started;
  const evidence = { name, records, mcpRecords: parsed };

  return parsed.length > 0 ? pass("D2", evidence, latencyMs) : fail("D2", evidence, latencyMs);
}
