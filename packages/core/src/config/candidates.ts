/**
 * Versioned inventory of every discovery mechanism we probe.
 *
 * As of 2026-08-04 no MCP server-card discovery mechanism has been
 * standardised: SEP-2127 is an open Draft, SEP-1649 was folded into it, and
 * SEP-1960 was never adopted. The probe therefore tries every candidate and
 * records *which one responded*, because the distribution of what is actually
 * deployed is itself one of our findings.
 *
 * Adding or removing a candidate is a methodology change. Bump
 * CANDIDATES_VERSION and METHODOLOGY_VERSION together.
 *
 * See docs/SPEC-NOTES.md §4 for the provenance of each entry.
 */

export const CANDIDATES_VERSION = "2026-08-04";

export type CandidateKind =
  /** Absolute path below the apex's `/.well-known/`. */
  | "well-known"
  /** Path resolved relative to an already-discovered MCP endpoint. */
  | "endpoint-relative"
  /** DNS TXT lookup, not an HTTP fetch. */
  | "dns-txt";

export type Normativity =
  /** Required by the published specification. */
  | "must"
  /** Live proposal, not yet accepted. */
  | "draft"
  /** Superseded but plausibly still deployed. */
  | "historical"
  /** Circulated by secondary sources; appears in no primary document. */
  | "unattested";

export interface DiscoveryCandidate {
  readonly id: string;
  readonly check: "D1" | "D2" | "D4";
  readonly kind: CandidateKind;
  /** Template. `{endpointPath}` is substituted for endpoint-relative entries. */
  readonly template: string;
  readonly normativity: Normativity;
  readonly provenance: string;
  readonly source: string;
}

export const DISCOVERY_CANDIDATES: readonly DiscoveryCandidate[] = [
  {
    id: "oauth-protected-resource-root",
    check: "D4",
    kind: "well-known",
    template: "/.well-known/oauth-protected-resource",
    normativity: "must",
    provenance: "RFC 9728, made mandatory for MCP servers by the authorization spec",
    source:
      "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery",
  },
  {
    id: "oauth-protected-resource-path-inserted",
    check: "D4",
    kind: "endpoint-relative",
    template: "/.well-known/oauth-protected-resource{endpointPath}",
    normativity: "must",
    provenance: "RFC 9728 path-insertion form; takes precedence over the root form",
    source: "https://datatracker.ietf.org/doc/html/rfc9728",
  },
  {
    id: "server-card-endpoint-relative",
    check: "D1",
    kind: "endpoint-relative",
    template: "{endpointPath}/server-card",
    normativity: "draft",
    provenance: "SEP-2127 recommended location; cards may live at any unreserved URI",
    source: "https://github.com/modelcontextprotocol/experimental-ext-server-card",
  },
  {
    id: "ai-catalog",
    check: "D1",
    kind: "well-known",
    template: "/.well-known/ai-catalog.json",
    normativity: "draft",
    provenance: "AI Catalog (Linux Foundation); the domain-level entry point SEP-2127 defers to",
    source: "https://ai-catalog.io/",
  },
  {
    id: "mcp-server-serra",
    check: "D1",
    kind: "well-known",
    template: "/.well-known/mcp-server",
    normativity: "draft",
    provenance: "draft-serra-mcp-discovery-uri-04, individual I-D with no IETF standing",
    source: "https://datatracker.ietf.org/doc/draft-serra-mcp-discovery-uri/",
  },
  {
    id: "mcp-json",
    check: "D1",
    kind: "well-known",
    template: "/.well-known/mcp.json",
    normativity: "historical",
    provenance: "original SEP-1649/2127 shape, superseded in-flight and never accepted",
    source: "https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649",
  },
  {
    id: "mcp-bare",
    check: "D1",
    kind: "well-known",
    template: "/.well-known/mcp",
    normativity: "historical",
    provenance: "SEP-1960, open issue, never adopted",
    source: "https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1960",
  },
  {
    id: "mcp-server-card-json",
    check: "D1",
    kind: "well-known",
    template: "/.well-known/mcp/server-card.json",
    normativity: "unattested",
    provenance:
      "asserted as the settled consensus path by several third-party blogs; appears in no primary document. Probed to measure how much stale-spec cargo-culting is deployed.",
    source: "docs/SPEC-NOTES.md#4",
  },
  {
    id: "dns-txt-serra",
    check: "D2",
    kind: "dns-txt",
    template: "_mcp.{apex}",
    normativity: "draft",
    provenance: "draft-serra-mcp-discovery-uri-04: `v=mcp1; src={url}` or `v=mcp1; registry={url}`",
    source: "https://datatracker.ietf.org/doc/draft-serra-mcp-discovery-uri/",
  },
] as const;

/**
 * Conventional MCP endpoint locations for D3.
 *
 * A modern endpoint answers GET and HEAD with `405 Method Not Allowed`, so a
 * 405 here is *positive* evidence rather than a failure. See
 * docs/DECISIONS/0002-d3-detects-405.md.
 */
export const CONVENTIONAL_ENDPOINTS: readonly string[] = [
  "/mcp",
  "/api/mcp",
  "/.well-known/mcp-endpoint",
  // Probed only on conventional MCP subdomains (`mcp.<apex>`), where the server
  // frequently sits at the root. It is on the shared allowlist because the guard
  // matches on path alone, so it is technically reachable on the apex too — the
  // least intrusive request that exists, and still governed by robots.txt.
  "/",
] as const;

/** Conventional MCP subdomains for D3, prefixed to the apex. */
export const CONVENTIONAL_SUBDOMAINS: readonly string[] = ["mcp", "api"] as const;

/** Plain-text agent fallbacks probed by F1. */
export const TEXT_FALLBACKS: readonly string[] = [
  "/llms.txt",
  "/llms-full.txt",
  "/AGENTS.md",
] as const;

const ENDPOINT_PLACEHOLDER = "{endpointPath}";
const APEX_PLACEHOLDER = "{apex}";

/** Every candidate belonging to one check, in probe order. */
export function candidatesForCheck(check: DiscoveryCandidate["check"]): DiscoveryCandidate[] {
  return DISCOVERY_CANDIDATES.filter((c) => c.check === check);
}

/**
 * Resolve a candidate template into a concrete path or DNS name.
 *
 * @throws if the template needs an endpoint path and none was supplied. A
 * silently-empty substitution would probe the wrong URL and corrupt the row.
 */
export function resolveCandidate(
  candidate: DiscoveryCandidate,
  context: { apex: string; endpointPath?: string },
): string {
  let out = candidate.template;

  if (out.includes(APEX_PLACEHOLDER)) {
    out = out.replaceAll(APEX_PLACEHOLDER, context.apex);
  }

  if (out.includes(ENDPOINT_PLACEHOLDER)) {
    const endpointPath = context.endpointPath;
    if (endpointPath === undefined || endpointPath === "") {
      throw new Error(
        `candidate ${candidate.id} requires an endpointPath; probe it only after an endpoint is known`,
      );
    }
    const normalised = endpointPath.endsWith("/") ? endpointPath.slice(0, -1) : endpointPath;
    out = out.replaceAll(ENDPOINT_PLACEHOLDER, normalised);
  }

  return out;
}

/** Every HTTP path we are ever permitted to fetch for a given apex. */
export function allowedHttpPaths(context: { apex: string; endpointPath?: string }): Set<string> {
  const paths = new Set<string>();

  for (const candidate of DISCOVERY_CANDIDATES) {
    if (candidate.kind === "dns-txt") continue;
    if (candidate.template.includes(ENDPOINT_PLACEHOLDER) && !context.endpointPath) continue;
    paths.add(resolveCandidate(candidate, context));
  }

  for (const path of CONVENTIONAL_ENDPOINTS) paths.add(path);
  for (const path of TEXT_FALLBACKS) paths.add(path);
  paths.add("/robots.txt");

  return paths;
}
