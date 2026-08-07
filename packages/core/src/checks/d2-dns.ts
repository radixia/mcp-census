/**
 * D2 — DNS-based discovery.
 *
 * Two competing individual Internet-Drafts, neither with working-group
 * standing, both verified against their sources on 2026-08-05. They agree on
 * the `_mcp.` underscore label and the `v=mcp1` version tag, and disagree on
 * how the endpoint is named:
 *
 *   draft-serra-mcp-discovery-uri-04:
 *     _mcp.{domain} IN TXT "v=mcp1; src={url}[; auth={type}]"
 *     _mcp.{domain} IN TXT "v=mcp1; registry={url}"
 *
 *   draft-morrison-mcp-dns-discovery-01:
 *     _mcp.{domain} IN TXT "v=mcp1; url={url}[; proto=streamable-http][; pk=...]
 *                           [; epoch=N][; cap=...][; priority=N][; ttl=N]"
 *
 * One lookup therefore covers both, and which key a record uses tells us which
 * draft the operator implemented — a small finding we get for free.
 *
 * Expected hit rate is near zero. The check exists because a measured zero on a
 * named mechanism is a publishable result. See docs/SPEC-NOTES.md §6.
 */

import { candidatesForCheck, resolveCandidate } from "../config/candidates.js";
import type { CheckContext, DnsCheckDeps } from "./deps.js";
import { type CheckResult, errored, fail, pass } from "./types.js";

/** An MCP record, by the only marker every draft agrees on. */
function isMcpRecord(record: string): boolean {
  return /^\s*v\s*=\s*mcp/i.test(record);
}

/** Which draft's key names a record uses. */
export type TxtRecordDialect = "serra" | "morrison" | "both" | "unknown";

export interface McpTxtRecord {
  readonly raw: string;
  readonly version: string;
  readonly dialect: TxtRecordDialect;
  /** The endpoint, whichever key carried it. */
  readonly endpoint?: string;
  /** draft-serra: `src=` */
  readonly src?: string;
  /** draft-morrison: `url=` */
  readonly url?: string;
  readonly registry?: string;
  readonly auth?: string;
  readonly proto?: string;
}

/** Parse a `v=mcp1; key=value; ...` TXT record. Returns undefined if it is not one. */
export function parseMcpTxtRecord(raw: string): McpTxtRecord | undefined {
  const fields = new Map<string, string>();

  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    // Values may themselves contain `=` (base64url keys, query strings).
    const value = part.slice(separator + 1).trim();
    if (key !== "") fields.set(key, value);
  }

  const version = fields.get("v");
  if (version === undefined || !version.toLowerCase().startsWith("mcp")) return undefined;

  const src = fields.get("src");
  const url = fields.get("url");
  const registry = fields.get("registry");
  const auth = fields.get("auth");
  const proto = fields.get("proto");

  const endpoint = src ?? url;
  const isSerra = src !== undefined || registry !== undefined;
  const isMorrison = url !== undefined;
  const dialect: TxtRecordDialect =
    isSerra && isMorrison ? "both" : isSerra ? "serra" : isMorrison ? "morrison" : "unknown";

  return {
    raw,
    version,
    dialect,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(src === undefined ? {} : { src }),
    ...(url === undefined ? {} : { url }),
    ...(registry === undefined ? {} : { registry }),
    ...(auth === undefined ? {} : { auth }),
    ...(proto === undefined ? {} : { proto }),
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
      return fail(
        "D2",
        { name, records: [], otherRecordCount: 0, reason: "no TXT record" },
        deps.now() - started,
      );
    }
    return errored("D2", error, deps.now() - started);
  }

  // A TXT record arrives as chunks that must be concatenated before parsing.
  const records = chunks.map((parts) => parts.join(""));
  const parsed = records.map(parseMcpTxtRecord).filter((r): r is McpTxtRecord => r !== undefined);

  const latencyMs = deps.now() - started;

  // Publish the MCP records and a count of the rest — never the rest themselves.
  //
  // `_mcp.<apex>` usually holds only MCP records, but where a site puts
  // everything on one name we were redistributing whatever else was there:
  // 122 domains in the first census shipped their Google, Atlassian and similar
  // site-verification tokens inside a CC-BY dataset, because those strings
  // happened to share a TXT set with the record we came for. They are public in
  // DNS, so this is not a leak; it is collection we cannot justify, and the
  // crawler ethics we publish say we do not do it.
  const evidence = {
    name,
    records: parsed.length > 0 ? records.filter(isMcpRecord) : [],
    otherRecordCount: records.filter((r) => !isMcpRecord(r)).length,
    mcpRecords: parsed,
  };

  return parsed.length > 0 ? pass("D2", evidence, latencyMs) : fail("D2", evidence, latencyMs);
}
