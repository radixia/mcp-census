/**
 * Politeness and prohibition guards.
 *
 * Politeness is a product requirement, not a nicety: a rude crawler destroys
 * this project's standing in exactly the community it is addressed to. Every
 * rule in docs/CRAWLER-ETHICS.md that can be expressed as code lives here.
 *
 * Two design rules, both deliberate:
 *
 *  1. Everything is an allowlist. A denylist silently permits whatever nobody
 *     thought to forbid; an allowlist fails closed when the protocol grows a
 *     new method or someone adds a probe in a hurry.
 *  2. These functions are pure and throw. They make no network calls and hold
 *     no state, so they can be asserted exhaustively in tests and cannot be
 *     satisfied by a caller that merely *intends* to be polite.
 */

import { allowedHttpPaths } from "./config/candidates.js";
import { CENSUS_VERSION } from "./version.js";

/** Where the crawler explains itself. Must resolve to docs/CRAWLER-ETHICS.md. */
export const CRAWLER_ETHICS_URL = "https://www.radixia.ai/census/crawler";

/**
 * Opt-out contact, published in every User-Agent we send.
 *
 * Must always be a live, monitored address: it is the only route a domain owner
 * has to reach us, and it appears in their access logs. `assertCrawlerIdentity`
 * refuses to build a User-Agent — and therefore any request — if this is ever
 * set back to a placeholder.
 */
export const OPT_OUT_EMAIL = "census@radixia.ai";

const PLACEHOLDER_MARKER = "PLACEHOLDER";

export const POLITENESS = {
  /** Hard ceiling per apex domain, regardless of how fast it responds. */
  maxRequestsPerSecondPerApex: 1,
  minDelayMsPerApexMs: 1000,
  /**
   * Ceiling across the entire crawl, not per worker.
   *
   * This bounds how many *different* apexes are probed at once; no site ever
   * sees more than the per-apex rate above. Runners must read this value
   * rather than pick their own, so the number the ethics document publishes is
   * the number that is actually enforced.
   */
  maxGlobalConcurrency: 64,
  connectTimeoutMs: 5_000,
  totalTimeoutMs: 10_000,
  maxRetries: 2,
  retryOnStatus: [429, 500, 502, 503, 504],
  /** One hop, and it must stay inside the target apex. */
  maxRedirects: 1,
  optOutHonouredWithinHours: 24,
} as const;

/** Protocol revisions we are willing to speak. See docs/SPEC-NOTES.md §2. */
export const MCP_PROTOCOL_VERSIONS = {
  modern: "2026-07-28",
  legacy: "2025-11-25",
} as const;

/**
 * The only JSON-RPC methods this project may ever send.
 *
 * `tools/call` is absent and must stay absent: calling a tool is a side effect
 * on someone else's system and turns a census into an intrusion. `server/discover`
 * and `initialize` are the modern and legacy era probes; `tools/list` is a
 * read-only enumeration.
 */
export const ALLOWED_JSONRPC_METHODS = ["server/discover", "initialize", "tools/list"] as const;

export type AllowedJsonRpcMethod = (typeof ALLOWED_JSONRPC_METHODS)[number];

/** Headers that would turn a probe into an authentication attempt. */
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD"]);

export type GuardRule =
  | "jsonrpc-method-allowlist"
  | "no-credentials"
  | "http-method-discipline"
  | "post-requires-discovery"
  | "path-allowlist"
  | "redirect-off-apex"
  | "redirect-hop-limit"
  | "optout-denylist"
  | "crawler-identity";

export class ProbeGuardError extends Error {
  readonly rule: GuardRule;

  constructor(rule: GuardRule, message: string) {
    super(message);
    this.name = "ProbeGuardError";
    this.rule = rule;
  }
}

/**
 * Refuse to identify ourselves with an unmonitored contact address.
 *
 * This is the interlock that keeps the placeholder opt-out email from reaching
 * a real domain: no User-Agent can be built until it is replaced.
 */
export function assertCrawlerIdentity(): void {
  if (OPT_OUT_EMAIL.includes(PLACEHOLDER_MARKER)) {
    throw new ProbeGuardError(
      "crawler-identity",
      "OPT_OUT_EMAIL is still a placeholder. Set a live, monitored address in " +
        "packages/core/src/politeness.ts before crawling any domain you do not own.",
    );
  }
}

/**
 * `MCPCensus/<version> (+<ethics url>; census research; opt-out: <email>)`
 *
 * The URL must resolve to a page explaining what we do and how to be excluded,
 * so that anyone reading their access log can act without contacting us.
 */
export function formatUserAgent(params: {
  readonly version: string;
  readonly ethicsUrl: string;
  readonly optOutEmail: string;
}): string {
  return `MCPCensus/${params.version} (+${params.ethicsUrl}; census research; opt-out: ${params.optOutEmail})`;
}

/**
 * Proof that a live opt-out contact exists.
 *
 * Header builders require one of these, and `resolveCrawlerIdentity` is the only
 * production route to obtaining it, so no request can be assembled while the
 * contact address is still a placeholder. Tests mint one directly; that is
 * visible in review precisely because it never appears in probe code.
 */
export interface CrawlerIdentity {
  readonly userAgent: string;
}

export function resolveCrawlerIdentity(): CrawlerIdentity {
  assertCrawlerIdentity();
  return {
    userAgent: formatUserAgent({
      version: CENSUS_VERSION,
      ethicsUrl: CRAWLER_ETHICS_URL,
      optOutEmail: OPT_OUT_EMAIL,
    }),
  };
}

export function buildUserAgent(): string {
  return resolveCrawlerIdentity().userAgent;
}

export function assertJsonRpcMethodAllowed(method: string): asserts method is AllowedJsonRpcMethod {
  if (!(ALLOWED_JSONRPC_METHODS as readonly string[]).includes(method)) {
    throw new ProbeGuardError(
      "jsonrpc-method-allowlist",
      `JSON-RPC method ${JSON.stringify(method)} is not permitted. Allowed: ${ALLOWED_JSONRPC_METHODS.join(", ")}.`,
    );
  }
}

export function assertNoCredentials(headers: Readonly<Record<string, string>>): void {
  for (const name of Object.keys(headers)) {
    if (CREDENTIAL_HEADERS.has(name.toLowerCase())) {
      throw new ProbeGuardError(
        "no-credentials",
        `header ${name} must never be sent: every probe is unauthenticated by construction.`,
      );
    }
  }
}

export interface HttpMethodContext {
  /**
   * True only once D1-D3 have yielded a concrete MCP endpoint for this apex.
   * POST is permitted nowhere else.
   */
  readonly discoveryEstablished: boolean;
}

export function assertHttpMethodAllowed(method: string, context: HttpMethodContext): void {
  const upper = method.toUpperCase();

  if (SAFE_HTTP_METHODS.has(upper)) return;

  if (upper !== "POST") {
    throw new ProbeGuardError(
      "http-method-discipline",
      `HTTP ${upper} is never permitted. Discovery uses GET and HEAD; the MCP handshake uses POST.`,
    );
  }

  if (!context.discoveryEstablished) {
    throw new ProbeGuardError(
      "post-requires-discovery",
      "POST is permitted only against an endpoint that discovery already found.",
    );
  }
}

/**
 * Every path we fetch must appear in the versioned candidate list. This closes
 * the gap where a new probe is written but the candidate config is not updated,
 * which would put us on paths we never published or defended.
 */
export function assertPathAllowed(
  path: string,
  context: { apex: string; endpointPath?: string },
): void {
  const pathname = path.startsWith("http") ? new URL(path).pathname : path;
  if (!allowedHttpPaths(context).has(pathname)) {
    throw new ProbeGuardError(
      "path-allowlist",
      `path ${pathname} is not in the candidate list for ${context.apex}. Add it to config/candidates.ts and METHODOLOGY.md first.`,
    );
  }
}

/**
 * Host equals the apex, or is a subdomain of it.
 *
 * Deliberately does not consult a public suffix list: `apex` always comes from
 * our own frozen universe file, never from a redirect target, so a
 * suffix-comparison here cannot be tricked into treating `evil-example.com` as
 * part of `example.com`.
 */
export function isWithinApex(host: string, apex: string): boolean {
  const h = host.toLowerCase();
  const a = apex.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}

export function assertRedirectAllowed(params: {
  readonly to: string;
  readonly apex: string;
  readonly hop: number;
}): void {
  if (params.hop > POLITENESS.maxRedirects) {
    throw new ProbeGuardError(
      "redirect-hop-limit",
      `redirect hop ${params.hop} exceeds the limit of ${POLITENESS.maxRedirects}.`,
    );
  }

  const host = new URL(params.to).hostname;
  if (!isWithinApex(host, params.apex)) {
    throw new ProbeGuardError(
      "redirect-off-apex",
      `refusing to follow a redirect from ${params.apex} to ${host}: off-apex targets are out of scope.`,
    );
  }
}

/**
 * Opt-outs are honoured within 24 hours via a committed denylist the crawler
 * reads at start. Checked before any request for the apex, so an opted-out
 * domain costs us zero requests rather than one.
 */
export function assertNotOptedOut(apex: string, denylist: ReadonlySet<string>): void {
  const a = apex.toLowerCase();
  for (const entry of denylist) {
    if (isWithinApex(a, entry.toLowerCase())) {
      throw new ProbeGuardError("optout-denylist", `${apex} has opted out of the census.`);
    }
  }
}

/** Headers for a plain unauthenticated discovery read. */
export function buildDiscoveryHeaders(identity: CrawlerIdentity): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": identity.userAgent,
    accept: "application/json, text/plain;q=0.9, */*;q=0.1",
  };
  assertNoCredentials(headers);
  return headers;
}

/**
 * Headers for an MCP JSON-RPC POST.
 *
 * SEP-2243 makes `Mcp-Method` and `MCP-Protocol-Version` REQUIRED, validated
 * against the body, and a mismatch is rejected with 400 / -32020 HeaderMismatch.
 * A prober that omits them measures nothing but its own bug.
 *
 * `Mcp-Name` is deliberately not implemented: it is required only for
 * `tools/call`, `resources/read` and `prompts/get`, none of which are in
 * ALLOWED_JSONRPC_METHODS. If that ever changes this function must change too.
 */
export function buildMcpRequestHeaders(
  identity: CrawlerIdentity,
  params: {
    readonly method: string;
    readonly protocolVersion?: string;
  },
): Record<string, string> {
  assertJsonRpcMethodAllowed(params.method);

  const protocolVersion = params.protocolVersion ?? MCP_PROTOCOL_VERSIONS.modern;
  const headers: Record<string, string> = {
    "user-agent": identity.userAgent,
    "content-type": "application/json",
    // Both types are mandatory: a compliant server may answer either.
    accept: "application/json, text/event-stream",
    "mcp-method": params.method,
  };

  // The legacy era predates the header entirely; sending it would misrepresent
  // an `initialize` probe as a modern request.
  if (params.method !== "initialize") {
    headers["mcp-protocol-version"] = protocolVersion;
  }

  assertNoCredentials(headers);
  return headers;
}
