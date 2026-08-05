import { describe, expect, it } from "vitest";

import { POLITENESS, ProbeGuardError } from "../politeness.js";
import { fakeDeps, fakeHttp, TEST_IDENTITY } from "../testing/fake-http.js";
import { GuardedHttpClient } from "./guarded-client.js";

const APEX = "example.com";

function client(
  routes: Record<
    string,
    { status?: number; headers?: Record<string, string>; body?: string; throws?: string }
  >,
  optOuts = new Set<string>(),
) {
  const http = fakeHttp(routes);
  const deps = fakeDeps(http);
  return {
    http,
    deps,
    client: new GuardedHttpClient(deps, { apex: APEX, identity: TEST_IDENTITY, optOuts }),
  };
}

describe("opt-out", () => {
  it("refuses to construct for an opted-out apex, so it costs zero requests", () => {
    const http = fakeHttp({});
    expect(
      () =>
        new GuardedHttpClient(fakeDeps(http), {
          apex: APEX,
          identity: TEST_IDENTITY,
          optOuts: new Set([APEX]),
        }),
    ).toThrow(ProbeGuardError);
    expect(http.calls).toHaveLength(0);
  });
});

describe("robots.txt", () => {
  it("is fetched before anything else and gates the request", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /" },
      "https://example.com/llms.txt": { body: "hello" },
    });

    const outcome = await c.client.fetchPath("/llms.txt");

    expect(outcome.outcome).toBe("skipped_by_robots");
    expect(c.http.urls()).toEqual(["https://example.com/robots.txt"]);
  });

  it("is fetched once per host, not once per request", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": { body: "hello" },
      "https://example.com/AGENTS.md": { body: "hello" },
    });

    await c.client.fetchPath("/llms.txt");
    await c.client.fetchPath("/AGENTS.md");

    expect(c.http.urls().filter((u) => u.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("consults each host's own file, because a subdomain may answer differently", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://mcp.example.com/robots.txt": { body: "User-agent: *\nDisallow: /" },
      "https://mcp.example.com/mcp": { status: 405 },
    });

    const outcome = await c.client.fetchPath("/mcp", "GET", "mcp.example.com");
    expect(outcome.outcome).toBe("skipped_by_robots");
  });

  it("treats a missing robots.txt as permission, not prohibition", async () => {
    const c = client({ "https://example.com/llms.txt": { body: "hello there" } });
    const outcome = await c.client.fetchPath("/llms.txt");
    expect(outcome.outcome).toBe("response");
  });
});

describe("guards", () => {
  it("refuses a path that is not on the candidate list", async () => {
    const c = client({});
    await expect(c.client.fetchPath("/wp-admin")).rejects.toThrow(ProbeGuardError);
  });

  it("refuses POST before discovery has produced an endpoint", async () => {
    const c = client({});
    await expect(
      c.client.postJsonRpc({ url: "https://example.com/mcp", method: "server/discover" }),
    ).rejects.toThrow(/discovery/i);
  });

  it("refuses tools/call even after discovery", async () => {
    const c = client({ "https://example.com/robots.txt": { body: "" } });
    c.client.endpointDiscovered("/mcp", "example.com");
    await expect(
      c.client.postJsonRpc({ url: "https://example.com/mcp", method: "tools/call" }),
    ).rejects.toThrow(ProbeGuardError);
  });

  it("sends the SEP-2243 headers and no credentials on an allowed POST", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": { status: 200, body: "{}" },
    });
    c.client.endpointDiscovered("/mcp", "example.com");

    await c.client.postJsonRpc({ url: "https://example.com/mcp", method: "server/discover" });

    const post = c.http.calls.find((call) => call.method === "POST");
    expect(post?.headers["mcp-method"]).toBe("server/discover");
    expect(post?.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(post?.headers.accept).toContain("text/event-stream");
    expect(Object.keys(post?.headers ?? {})).not.toContain("authorization");
    expect(JSON.parse(post?.body ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      method: "server/discover",
    });
  });

  it("identifies itself on every request", async () => {
    const c = client({ "https://example.com/llms.txt": { body: "hello there" } });
    await c.client.fetchPath("/llms.txt");
    for (const call of c.http.calls) {
      expect(call.headers["user-agent"]).toBe(TEST_IDENTITY.userAgent);
    }
  });
});

describe("redirects", () => {
  it("follows one hop inside the apex", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": { status: 301, headers: { location: "/docs/llms.txt" } },
      "https://example.com/docs/llms.txt": { body: "the real thing" },
    });

    const outcome = await c.client.fetchPath("/llms.txt");
    expect(outcome).toMatchObject({ outcome: "response", response: { body: "the real thing" } });
  });

  it("reports leaving the apex as an outcome, not a crash", async () => {
    // Auth-walled sites bounce every path to an identity provider. That is a
    // fact about the domain; throwing would abort the whole probe.
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": {
        status: 302,
        headers: { location: "https://cdn.elsewhere.test/llms.txt" },
      },
    });

    const outcome = await c.client.fetchPath("/llms.txt");
    expect(outcome).toEqual({ outcome: "redirect_off_apex", to: "cdn.elsewhere.test" });
  });

  it("allows a redirect to a subdomain of the apex", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": {
        status: 302,
        headers: { location: "https://www.example.com/llms.txt" },
      },
      "https://www.example.com/llms.txt": { body: "moved" },
    });

    const outcome = await c.client.fetchPath("/llms.txt");
    expect(outcome).toMatchObject({ outcome: "response", response: { body: "moved" } });
  });
});

describe("rate limiting and retries", () => {
  it("waits at least a second between requests to the same apex", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": { body: "hello there" },
      "https://example.com/AGENTS.md": { body: "hello there" },
    });

    await c.client.fetchPath("/llms.txt");
    await c.client.fetchPath("/AGENTS.md");

    expect(c.deps.elapsed()).toBeGreaterThanOrEqual(2 * POLITENESS.minDelayMsPerApexMs);
  });

  it("obeys a Crawl-delay that is slower than our own limit", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "User-agent: *\nCrawl-delay: 5" },
      "https://example.com/llms.txt": { body: "hello there" },
    });

    await c.client.fetchPath("/llms.txt");
    expect(c.deps.elapsed()).toBeGreaterThanOrEqual(5000);
  });

  it("retries a 503 and then gives up, rather than hammering", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": { status: 503 },
    });

    const outcome = await c.client.fetchPath("/llms.txt");

    expect(outcome).toMatchObject({ outcome: "response", response: { status: 503 } });
    const attempts = c.http.urls().filter((u) => u.endsWith("/llms.txt"));
    expect(attempts).toHaveLength(POLITENESS.maxRetries + 1);
  });

  it("honours Retry-After", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": { status: 429, headers: { "retry-after": "7" } },
    });

    await c.client.fetchPath("/llms.txt");
    expect(c.deps.elapsed()).toBeGreaterThanOrEqual(7000);
  });

  it("does not retry a name that does not resolve", async () => {
    // At census scale this dominates: most domains have no mcp.* subdomain, and
    // retrying each nonexistent one costs three requests and six seconds of
    // backoff to re-learn what DNS already said.
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://mcp.example.com/robots.txt": { throws: "ENOTFOUND: fetch failed" },
    });

    const outcome = await c.client.fetchPath("/mcp", "GET", "mcp.example.com");

    expect(outcome).toMatchObject({ outcome: "transport_error" });
    expect(c.http.urls().filter((u) => u.includes("mcp.example.com"))).toHaveLength(1);
  });

  it("answers later probes to an unresolvable host without touching the network", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://mcp.example.com/robots.txt": { throws: "ENOTFOUND: fetch failed" },
    });

    await c.client.fetchPath("/", "GET", "mcp.example.com");
    const before = c.http.calls.length;
    await c.client.fetchPath("/mcp", "GET", "mcp.example.com");

    expect(c.http.calls.length).toBe(before);
  });

  it("still retries a transient failure", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": { throws: "ECONNRESET: socket hang up" },
    });

    await c.client.fetchPath("/llms.txt");

    expect(c.http.urls().filter((u) => u.endsWith("/llms.txt"))).toHaveLength(
      POLITENESS.maxRetries + 1,
    );
  });

  it("reports a connection failure as a transport error, not a negative finding", async () => {
    const c = client({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/llms.txt": { throws: "ECONNREFUSED" },
    });

    const outcome = await c.client.fetchPath("/llms.txt");
    expect(outcome).toMatchObject({ outcome: "transport_error" });
  });
});
