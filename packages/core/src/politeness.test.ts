import { describe, expect, it } from "vitest";

import {
  ALLOWED_JSONRPC_METHODS,
  assertCrawlerIdentity,
  assertHttpMethodAllowed,
  assertJsonRpcMethodAllowed,
  assertNoCredentials,
  assertNotOptedOut,
  assertPathAllowed,
  assertRedirectAllowed,
  buildDiscoveryHeaders,
  buildMcpRequestHeaders,
  CRAWLER_ETHICS_URL,
  type CrawlerIdentity,
  formatUserAgent,
  isWithinApex,
  MCP_PROTOCOL_VERSIONS,
  OPT_OUT_EMAIL,
  POLITENESS,
  ProbeGuardError,
  resolveCrawlerIdentity,
} from "./politeness.js";

/**
 * Test-only identity. Production code must obtain one from
 * `resolveCrawlerIdentity()`, which refuses to produce one while the opt-out
 * address is a placeholder.
 */
const TEST_IDENTITY: CrawlerIdentity = {
  userAgent: formatUserAgent({
    version: "0.0.0-test",
    ethicsUrl: "https://example.invalid/crawler",
    optOutEmail: "test@example.invalid",
  }),
};

describe("user agent", () => {
  it("names the project, the ethics page and an opt-out route", () => {
    const ua = formatUserAgent({
      version: "1.2.3",
      ethicsUrl: "https://www.radixia.ai/census/crawler",
      optOutEmail: "census@example.com",
    });

    expect(ua).toBe(
      "MCPCensus/1.2.3 (+https://www.radixia.ai/census/crawler; census research; opt-out: census@example.com)",
    );
  });

  it("is a single header-safe line", () => {
    expect(TEST_IDENTITY.userAgent).not.toMatch(/[\r\n]/);
  });
});

describe("crawler identity interlock", () => {
  it("has a live opt-out address configured", () => {
    expect(() => assertCrawlerIdentity()).not.toThrow();
  });

  it("publishes that address in the User-Agent, where a log reader will find it", () => {
    expect(resolveCrawlerIdentity().userAgent).toContain(OPT_OUT_EMAIL);
    expect(OPT_OUT_EMAIL).not.toMatch(/placeholder/i);
  });

  it("links to the ethics page from the User-Agent", () => {
    expect(resolveCrawlerIdentity().userAgent).toContain(CRAWLER_ETHICS_URL);
  });
});

describe("JSON-RPC method allowlist", () => {
  it.each([...ALLOWED_JSONRPC_METHODS])("permits %s", (method) => {
    expect(() => assertJsonRpcMethodAllowed(method)).not.toThrow();
  });

  it("never permits tools/call", () => {
    expect(() => assertJsonRpcMethodAllowed("tools/call")).toThrow(ProbeGuardError);
  });

  it.each([
    "resources/read",
    "prompts/get",
    "completion/complete",
    "subscriptions/listen",
    "tools/Call",
    "",
  ])("rejects %s", (method) => {
    expect(() => assertJsonRpcMethodAllowed(method)).toThrow(ProbeGuardError);
  });

  it("fails closed for methods the protocol has not invented yet", () => {
    expect(() => assertJsonRpcMethodAllowed("server/somethingNew")).toThrow(ProbeGuardError);
  });
});

describe("credentials", () => {
  it.each([
    "Authorization",
    "authorization",
    "Proxy-Authorization",
    "Cookie",
    "X-API-Key",
    "api-key",
  ])("refuses to send %s", (header) => {
    expect(() => assertNoCredentials({ [header]: "secret" })).toThrow(ProbeGuardError);
  });

  it("allows ordinary probe headers", () => {
    expect(() =>
      assertNoCredentials({ "user-agent": "MCPCensus/0", accept: "application/json" }),
    ).not.toThrow();
  });
});

describe("HTTP method discipline", () => {
  const undiscovered = { discoveryEstablished: false };
  const discovered = { discoveryEstablished: true };

  it.each(["GET", "HEAD", "get", "head"])("permits %s during discovery", (method) => {
    expect(() => assertHttpMethodAllowed(method, undiscovered)).not.toThrow();
  });

  it("refuses POST before an endpoint has been discovered", () => {
    expect(() => assertHttpMethodAllowed("POST", undiscovered)).toThrow(ProbeGuardError);
    expect(() => assertHttpMethodAllowed("POST", undiscovered)).toThrow(/discovery/i);
  });

  it("permits POST once discovery produced an endpoint", () => {
    expect(() => assertHttpMethodAllowed("POST", discovered)).not.toThrow();
  });

  it.each(["PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"])("never permits %s", (method) => {
    expect(() => assertHttpMethodAllowed(method, discovered)).toThrow(ProbeGuardError);
  });
});

describe("path allowlist", () => {
  const context = { apex: "example.com" };

  it.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/ai-catalog.json",
    "/.well-known/mcp-server",
    "/.well-known/mcp.json",
    "/.well-known/mcp",
    "/.well-known/mcp/server-card.json",
    "/llms.txt",
    "/robots.txt",
    "/mcp",
  ])("permits the published candidate %s", (path) => {
    expect(() => assertPathAllowed(path, context)).not.toThrow();
  });

  it.each(["/admin", "/wp-login.php", "/.git/config", "/.env", "/api/v1/users"])(
    "refuses the unpublished path %s",
    (path) => {
      expect(() => assertPathAllowed(path, context)).toThrow(ProbeGuardError);
    },
  );

  it("accepts an absolute URL and checks only its pathname", () => {
    expect(() => assertPathAllowed("https://example.com/llms.txt", context)).not.toThrow();
    expect(() => assertPathAllowed("https://example.com/secret", context)).toThrow(ProbeGuardError);
  });

  it("permits an endpoint-relative candidate only once an endpoint is known", () => {
    expect(() => assertPathAllowed("/mcp/server-card", context)).toThrow(ProbeGuardError);
    expect(() =>
      assertPathAllowed("/mcp/server-card", { ...context, endpointPath: "/mcp" }),
    ).not.toThrow();
  });
});

describe("apex containment", () => {
  it.each([
    ["example.com", "example.com", true],
    ["mcp.example.com", "example.com", true],
    ["a.b.example.com", "example.com", true],
    ["EXAMPLE.COM", "example.com", true],
    ["notexample.com", "example.com", false],
    ["example.com.evil.test", "example.com", false],
    ["evil-example.com", "example.com", false],
  ] as const)("isWithinApex(%s, %s) === %s", (host, apex, expected) => {
    expect(isWithinApex(host, apex)).toBe(expected);
  });
});

describe("redirects", () => {
  it("follows one hop inside the apex", () => {
    expect(() =>
      assertRedirectAllowed({
        to: "https://www.example.com/llms.txt",
        apex: "example.com",
        hop: 1,
      }),
    ).not.toThrow();
  });

  it("refuses to leave the apex", () => {
    expect(() =>
      assertRedirectAllowed({ to: "https://cdn.other.test/x", apex: "example.com", hop: 1 }),
    ).toThrow(/off-apex/);
  });

  it("refuses a second hop", () => {
    expect(() =>
      assertRedirectAllowed({
        to: "https://www.example.com/llms.txt",
        apex: "example.com",
        hop: POLITENESS.maxRedirects + 1,
      }),
    ).toThrow(/hop/);
  });
});

describe("opt-out denylist", () => {
  const denylist = new Set(["optedout.test", "example.org"]);

  it("skips an opted-out apex", () => {
    expect(() => assertNotOptedOut("optedout.test", denylist)).toThrow(ProbeGuardError);
  });

  it("skips subdomains of an opted-out apex", () => {
    expect(() => assertNotOptedOut("shop.example.org", denylist)).toThrow(ProbeGuardError);
  });

  it("is case-insensitive", () => {
    expect(() => assertNotOptedOut("OptedOut.test", denylist)).toThrow(ProbeGuardError);
  });

  it("lets everyone else through", () => {
    expect(() => assertNotOptedOut("example.com", denylist)).not.toThrow();
  });
});

describe("request headers", () => {
  it("sends no credentials on a discovery read", () => {
    const headers = buildDiscoveryHeaders(TEST_IDENTITY);
    expect(headers["user-agent"]).toBe(TEST_IDENTITY.userAgent);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("sets the SEP-2243 mandatory headers on a modern probe", () => {
    const headers = buildMcpRequestHeaders(TEST_IDENTITY, { method: "server/discover" });

    expect(headers["mcp-method"]).toBe("server/discover");
    expect(headers["mcp-protocol-version"]).toBe(MCP_PROTOCOL_VERSIONS.modern);
    expect(headers["content-type"]).toBe("application/json");
  });

  it("accepts both response content types the spec permits", () => {
    const headers = buildMcpRequestHeaders(TEST_IDENTITY, { method: "tools/list" });

    expect(headers.accept).toContain("application/json");
    expect(headers.accept).toContain("text/event-stream");
  });

  it("omits the protocol-version header on a legacy initialize probe", () => {
    // The header postdates the legacy era; sending it would mislabel the probe.
    const headers = buildMcpRequestHeaders(TEST_IDENTITY, { method: "initialize" });

    expect(headers["mcp-protocol-version"]).toBeUndefined();
    expect(headers["mcp-method"]).toBe("initialize");
  });

  it("refuses to build headers for a forbidden method", () => {
    expect(() => buildMcpRequestHeaders(TEST_IDENTITY, { method: "tools/call" })).toThrow(
      ProbeGuardError,
    );
  });
});
