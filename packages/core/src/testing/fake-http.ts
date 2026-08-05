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

export type FakeRoutes = Record<string, FakeRoute>;

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

  const fetch: HttpFetch = async (request) => {
    calls.push(request);

    const route = routes[request.url];
    if (route === undefined) {
      return { status: 404, headers: {}, body: "not found", url: request.url };
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
