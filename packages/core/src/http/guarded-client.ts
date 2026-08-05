/**
 * The only way a probe is allowed to touch the network.
 *
 * Every guard in `politeness.ts` is applied here, at the single choke point, so
 * that writing a new probe cannot accidentally skip one. The per-apex rate limit
 * lives here too, for the same reason: a limit enforced by the caller is a limit
 * that gets forgotten.
 *
 * Guard violations **throw** — they are bugs in our code, not facts about the
 * domain. Things that are facts about the domain (robots disallow, timeout,
 * connection refused) come back as outcomes the caller must handle.
 */

import {
  assertHttpMethodAllowed,
  assertJsonRpcMethodAllowed,
  assertNoCredentials,
  assertNotOptedOut,
  assertPathAllowed,
  assertRedirectAllowed,
  buildDiscoveryHeaders,
  buildMcpRequestHeaders,
  type CrawlerIdentity,
  POLITENESS,
} from "../politeness.js";
import {
  crawlDelayMs,
  EMPTY_ROBOTS,
  isAllowed,
  parseRobotsTxt,
  type RobotsTxt,
} from "../robots.js";
import type {
  FetchOptions,
  HttpFetch,
  HttpRequest,
  HttpResponse,
  SafeHttpMethod,
} from "./types.js";

/** The product token we match ourselves against in robots.txt. */
export const ROBOTS_TOKEN = "MCPCensus";

export type ProbeOutcome =
  | { readonly outcome: "response"; readonly response: HttpResponse }
  | { readonly outcome: "skipped_by_robots"; readonly path: string }
  | { readonly outcome: "transport_error"; readonly error: string };

export interface GuardedClientDeps {
  readonly fetch: HttpFetch;
  /** Injected so tests run instantly and core stays free of ambient timers. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

export interface GuardedClientContext {
  readonly apex: string;
  readonly identity: CrawlerIdentity;
  readonly optOuts: ReadonlySet<string>;
}

export class GuardedHttpClient {
  /**
   * One robots.txt per host, not per apex: `mcp.example.com` publishes its own
   * and is entitled to a different answer than `example.com`. Fetched lazily on
   * first contact with a host and cached for the lifetime of the probe.
   */
  readonly #robots = new Map<string, RobotsTxt>();
  #lastRequestAt = 0;
  #requestCount = 0;
  #endpointPath: string | undefined;
  #discoveryEstablished = false;

  constructor(
    private readonly deps: GuardedClientDeps,
    private readonly context: GuardedClientContext,
  ) {
    // An opted-out apex must cost zero requests, so this is checked at
    // construction rather than per call.
    assertNotOptedOut(context.apex, context.optOuts);
  }

  get requestCount(): number {
    return this.#requestCount;
  }

  get endpointPath(): string | undefined {
    return this.#endpointPath;
  }

  /** Robots for a host we have already contacted. Exposed so F2 can report it. */
  robotsFor(host: string): RobotsTxt | undefined {
    return this.#robots.get(host);
  }

  /**
   * Record that discovery found a real MCP endpoint. This is the only thing
   * that unlocks POST, and it widens the path allowlist to endpoint-relative
   * candidates.
   */
  endpointDiscovered(endpointPath: string): void {
    this.#endpointPath = endpointPath;
    this.#discoveryEstablished = true;
  }

  /** Fetch, and parse, a host's robots.txt. Safe to call repeatedly. */
  async loadRobots(host: string): Promise<RobotsTxt> {
    const cached = this.#robots.get(host);
    if (cached !== undefined) return cached;

    const url = new URL("/robots.txt", `https://${host}`).toString();
    let robots = EMPTY_ROBOTS;

    const result = await this.#send(
      { url, method: "GET", headers: buildDiscoveryHeaders(this.context.identity) },
      // robots.txt is the one document we fetch without first consulting
      // robots.txt. Anything else would not terminate.
      { checkRobots: false },
    );

    if (
      result.outcome === "response" &&
      result.response.status >= 200 &&
      result.response.status < 300
    ) {
      robots = parseRobotsTxt(result.response.body);
    }

    this.#robots.set(host, robots);
    return robots;
  }

  /** Fetch a candidate path. `host` defaults to the apex. */
  async fetchPath(
    path: string,
    method: SafeHttpMethod = "GET",
    host = this.context.apex,
  ): Promise<ProbeOutcome> {
    const pathContext = {
      apex: this.context.apex,
      ...(this.#endpointPath === undefined ? {} : { endpointPath: this.#endpointPath }),
    };

    assertPathAllowed(path, pathContext);
    assertHttpMethodAllowed(method, { discoveryEstablished: this.#discoveryEstablished });

    const robots = await this.loadRobots(host);
    if (!isAllowed(robots, ROBOTS_TOKEN, path)) {
      return { outcome: "skipped_by_robots", path };
    }

    const url = new URL(path, `https://${host}`).toString();
    return this.#send({ url, method, headers: buildDiscoveryHeaders(this.context.identity) });
  }

  /**
   * Unauthenticated JSON-RPC against an endpoint discovery already found.
   *
   * The method allowlist and the discovery precondition are both enforced
   * before anything leaves the process, so there is no code path from here to
   * `tools/call`.
   */
  async postJsonRpc(params: {
    readonly url: string;
    readonly method: string;
    readonly protocolVersion?: string;
    readonly id?: string | number;
  }): Promise<ProbeOutcome> {
    assertJsonRpcMethodAllowed(params.method);
    assertHttpMethodAllowed("POST", { discoveryEstablished: this.#discoveryEstablished });

    const target = new URL(params.url);
    const robots = await this.loadRobots(target.hostname);
    if (!isAllowed(robots, ROBOTS_TOKEN, target.pathname)) {
      return { outcome: "skipped_by_robots", path: target.pathname };
    }

    const headers = buildMcpRequestHeaders(this.context.identity, {
      method: params.method,
      ...(params.protocolVersion === undefined ? {} : { protocolVersion: params.protocolVersion }),
    });

    const body = JSON.stringify(jsonRpcBody(params.method, params.id ?? 1, params.protocolVersion));
    return this.#send({ url: params.url, method: "POST", headers, body });
  }

  async #send(
    request: HttpRequest,
    options: { checkRobots?: boolean } = {},
  ): Promise<ProbeOutcome> {
    assertNoCredentials(request.headers);

    const fetchOptions: FetchOptions = { timeoutMs: POLITENESS.totalTimeoutMs };
    let attempt = 0;

    while (true) {
      await this.#waitForSlot(new URL(request.url).hostname);

      let response: HttpResponse;
      try {
        this.#requestCount += 1;
        response = await this.deps.fetch(request, fetchOptions);
      } catch (error) {
        if (attempt < POLITENESS.maxRetries) {
          attempt += 1;
          await this.deps.sleep(backoffMs(attempt));
          continue;
        }
        return {
          outcome: "transport_error",
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (
        (POLITENESS.retryOnStatus as readonly number[]).includes(response.status) &&
        attempt < POLITENESS.maxRetries
      ) {
        attempt += 1;
        await this.deps.sleep(retryAfterMs(response) ?? backoffMs(attempt));
        continue;
      }

      const redirected = await this.#followRedirect(
        request,
        response,
        options.checkRobots !== false,
      );
      return redirected ?? { outcome: "response", response };
    }
  }

  /**
   * One hop, and only within the target apex.
   *
   * The redirect target does not have to be on the candidate list: the site
   * chose it, we did not guess it. Leaving the apex is refused outright.
   */
  async #followRedirect(
    request: HttpRequest,
    response: HttpResponse,
    checkRobots: boolean,
  ): Promise<ProbeOutcome | undefined> {
    if (response.status < 300 || response.status >= 400) return undefined;

    const location = response.headers.location;
    if (location === undefined || location === "") return undefined;

    const target = new URL(location, request.url);

    // Throws if the target is off-apex: a decision we refuse to make, rather
    // than a transport failure to paper over.
    assertRedirectAllowed({ to: target.toString(), apex: this.context.apex, hop: 1 });

    if (checkRobots) {
      const robots = await this.loadRobots(target.hostname);
      if (!isAllowed(robots, ROBOTS_TOKEN, target.pathname)) {
        return { outcome: "skipped_by_robots", path: target.pathname };
      }
    }

    await this.#waitForSlot(target.hostname);
    try {
      this.#requestCount += 1;
      const followed = await this.deps.fetch(
        { ...request, url: target.toString() },
        { timeoutMs: POLITENESS.totalTimeoutMs },
      );
      return { outcome: "response", response: followed };
    } catch (error) {
      return {
        outcome: "transport_error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * At most one request per second, or slower if robots.txt asks.
   *
   * The budget is per apex, not per host: subdomains belong to the same operator
   * and usually the same origin infrastructure.
   */
  async #waitForSlot(host: string): Promise<void> {
    const robots = this.#robots.get(host);
    const required = Math.max(
      POLITENESS.minDelayMsPerApexMs,
      (robots && crawlDelayMs(robots, ROBOTS_TOKEN)) ?? 0,
    );

    const elapsed = this.deps.now() - this.#lastRequestAt;
    if (this.#lastRequestAt !== 0 && elapsed < required) {
      await this.deps.sleep(required - elapsed);
    }
    this.#lastRequestAt = this.deps.now();
  }
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}

function retryAfterMs(response: HttpResponse): number | undefined {
  const header = response.headers["retry-after"];
  if (header === undefined) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30_000) : undefined;
}

function jsonRpcBody(method: string, id: string | number, protocolVersion?: string) {
  // The legacy handshake has its own params shape and predates `_meta`.
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "MCPCensus", version: "0.1.0" },
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": protocolVersion ?? "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "MCPCensus", version: "0.1.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}
