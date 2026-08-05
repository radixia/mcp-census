/**
 * Test doubles. Excluded from the published build.
 *
 * Fixtures are keyed by absolute URL so a test reads as a description of a
 * site's actual surface, which is what makes probe tests worth trusting.
 */

import type { GuardedClientDeps } from "../http/guarded-client.js";
import type { HttpFetch, HttpRequest, HttpResponse } from "../http/types.js";
import { type CrawlerIdentity, formatUserAgent } from "../politeness.js";

export interface FakeRoute {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** Simulates a connection failure or timeout. */
  readonly throws?: string;
}

/**
 * A route is either one fixed response, or a sequence consumed in order — which
 * is how protocol negotiation is exercised: the first POST is refused with the
 * versions on offer, the second succeeds. The last entry repeats once exhausted.
 */
export type FakeRoutes = Record<string, FakeRoute | readonly FakeRoute[]>;

export const TEST_IDENTITY: CrawlerIdentity = {
  userAgent: formatUserAgent({
    version: "0.0.0-test",
    ethicsUrl: "https://example.invalid/crawler",
    optOutEmail: "test@example.invalid",
  }),
};

export interface FakeHttp {
  readonly fetch: HttpFetch;
  readonly calls: HttpRequest[];
  urls(): string[];
}

/** Any URL without a fixture answers 404, like most of the web. */
export function fakeHttp(routes: FakeRoutes): FakeHttp {
  const calls: HttpRequest[] = [];
  const consumed = new Map<string, number>();

  const fetch: HttpFetch = async (request) => {
    calls.push(request);

    const entry = routes[request.url];
    if (entry === undefined) {
      return { status: 404, headers: {}, body: "not found", url: request.url };
    }

    let route: FakeRoute;
    if (Array.isArray(entry)) {
      const n = consumed.get(request.url) ?? 0;
      consumed.set(request.url, n + 1);
      route = entry[Math.min(n, entry.length - 1)] as FakeRoute;
    } else {
      route = entry as FakeRoute;
    }

    if (route.throws !== undefined) {
      throw new Error(route.throws);
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(route.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }

    const response: HttpResponse = {
      status: route.status ?? 200,
      headers,
      body: route.body ?? "",
      url: request.url,
    };
    return response;
  };

  return { fetch, calls, urls: () => calls.map((c) => c.url) };
}

/**
 * Deps with an instant clock. Time advances only when the code under test
 * sleeps, so rate-limit behaviour stays observable without tests taking
 * seconds.
 */
export function fakeDeps(http: FakeHttp): GuardedClientDeps & { elapsed: () => number } {
  let clock = 1_000_000;
  return {
    fetch: http.fetch,
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    elapsed: () => clock - 1_000_000,
  };
}
