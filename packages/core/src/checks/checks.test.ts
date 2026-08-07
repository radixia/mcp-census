import { describe, expect, it } from "vitest";

import { GuardedHttpClient } from "../http/guarded-client.js";
import type { ResolveTxt } from "../http/types.js";
import { probeDomain } from "../probe.js";
import { scoreDomain } from "../scoring.js";
import { type FakeRoutes, fakeDeps, fakeHttp, TEST_IDENTITY } from "../testing/fake-http.js";
import { checkServerCard } from "./d1-server-card.js";
import { checkDnsDiscovery, parseMcpTxtRecord } from "./d2-dns.js";
import { checkConventionalEndpoint } from "./d3-endpoint.js";
import { checkOauthProtectedResource, oauthTargets, parseResourceMetadata } from "./d4-oauth.js";
import { checkRootAdvertisement, relationOf } from "./d7-root-advertisement.js";
import { checkTextFallbacks } from "./f1-text-fallbacks.js";
import { checkCrawlerPosture } from "./f2-crawler-posture.js";
import { classifyStatus, rollUpOutcome } from "./outcome.js";
import type { CheckResult } from "./types.js";

const APEX = "example.com";
const NO_TXT: ResolveTxt = async () => {
  throw new Error("queryTxt ENOTFOUND");
};

function harness(routes: FakeRoutes, resolveTxt: ResolveTxt = NO_TXT) {
  const http = fakeHttp(routes);
  const base = fakeDeps(http);
  const client = new GuardedHttpClient(base, {
    apex: APEX,
    identity: TEST_IDENTITY,
    optOuts: new Set<string>(),
  });
  return { http, client, deps: { client, now: base.now, resolveTxt } };
}

const evidence = (result: CheckResult) => result.evidence as Record<string, unknown>;

describe("D7 — root-document catalog advertisement", () => {
  it("finds a catalog advertised in the Link header", async () => {
    const h = harness({
      "https://example.com/": {
        headers: {
          "content-type": "text/html",
          link: '<https://example.com/catalog.json>; rel="ai-catalog"',
        },
        body: "<html></html>",
      },
    });
    const result = await checkRootAdvertisement(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    const ev = evidence(result);
    expect(ev.advertisements).toEqual([
      { source: "link_header", rel: "ai-catalog", relation: "same_origin" },
    ]);
    // The number the working group is missing.
    expect(ev.beyondWellKnown).toBe(true);
  });

  it("finds one in the HTML head, and stops at </head>", async () => {
    const h = harness({
      "https://example.com/": {
        headers: { "content-type": "text/html; charset=utf-8" },
        body: [
          "<html><head>",
          '<link rel="ai-catalog" href="/custom/catalog.json">',
          "</head><body>",
          '<link rel="ai-catalog" href="https://evil.example.net/x.json">',
          "</body></html>",
        ].join(""),
      },
    });
    const result = await checkRootAdvertisement(h.deps, { apex: APEX });

    const ads = evidence(result).advertisements as unknown[];
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({ source: "html_link", relation: "same_origin" });
  });

  it("never publishes the advertised URL, only its relation to the apex", async () => {
    const h = harness({
      "https://example.com/": {
        headers: {
          "content-type": "text/html",
          link: '<https://tracker.example.net/pixel?who=me>; rel="ai-catalog"',
        },
        body: "<html></html>",
      },
    });
    const result = await checkRootAdvertisement(h.deps, { apex: APEX });

    const serialised = JSON.stringify(result.evidence);
    // A publisher chooses this string. It must not reach a CC-BY dataset.
    expect(serialised).not.toContain("tracker.example.net");
    expect(serialised).not.toContain("who=me");
    expect(evidence(result).advertisements).toEqual([
      { source: "link_header", rel: "ai-catalog", relation: "third_party" },
    ]);
  });

  it("separates an advertisement that only repeats the well-known path", () => {
    expect(relationOf("/.well-known/ai-catalog.json", APEX)).toBe("well_known_path");
    expect(relationOf("https://example.com/.well-known/ai-catalog.json", APEX)).toBe(
      "well_known_path",
    );
    expect(relationOf("https://mcp.example.com/c.json", APEX)).toBe("subdomain");
    expect(relationOf("https://other.test/c.json", APEX)).toBe("third_party");
    // `malformed` is nearly unreachable: with a valid base, almost any string
    // resolves. A scheme we cannot fetch is the case that actually occurs.
    expect(relationOf("javascript:alert(1)", APEX)).toBe("not_http");
    expect(relationOf("data:application/json,{}", APEX)).toBe("not_http");
  });

  it("does not move the score, which is the claim the methodology makes", async () => {
    const withD7 = [
      { id: "D1", status: "fail", evidence: {}, latencyMs: 1 },
      { id: "D3", status: "fail", evidence: {}, latencyMs: 1 },
      { id: "D7", status: "pass", evidence: {}, latencyMs: 1 },
    ] as const;
    const withoutD7 = withD7.filter((c) => c.id !== "D7");

    expect(scoreDomain(withD7 as unknown as CheckResult[])).toEqual(
      scoreDomain(withoutD7 as unknown as CheckResult[]),
    );
  });

  it("ignores link relations that name something other than a catalog", async () => {
    const h = harness({
      "https://example.com/": {
        headers: {
          "content-type": "text/html",
          link: "<https://example.com/s.css>; rel=stylesheet",
        },
        body: '<html><head><link rel="icon" href="/favicon.ico"></head></html>',
      },
    });
    const result = await checkRootAdvertisement(h.deps, { apex: APEX });
    expect(result.status).toBe("fail");
    expect(evidence(result).advertisements).toEqual([]);
  });
});

describe("evidence redaction", () => {
  it("publishes MCP TXT records and counts the rest, never the rest", async () => {
    const h = harness({}, async () => [
      ["v=MCPv1; k=ed25519; p=abc"],
      ["google-site-verification=SECRET-TOKEN"],
      ["v=spf1 include:_spf.example.com ~all"],
    ]);
    const result = await checkDnsDiscovery(h.deps, { apex: APEX });

    const ev = evidence(result);
    expect(ev.records).toEqual(["v=MCPv1; k=ed25519; p=abc"]);
    expect(ev.otherRecordCount).toBe(2);
    // The bug this guards: 122 domains in the first census shipped somebody
    // else's verification tokens in a CC-BY dataset.
    expect(JSON.stringify(ev)).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(ev)).not.toContain("spf1");
  });
});

describe("outcome taxonomy", () => {
  it("does not read a refusal as an absence", () => {
    expect(classifyStatus(404)).toBe("absent");
    expect(classifyStatus(410)).toBe("absent");
    expect(classifyStatus(403)).toBe("blocked");
    expect(classifyStatus(401)).toBe("blocked");
    expect(classifyStatus(429)).toBe("blocked");
    expect(classifyStatus(503)).toBe("blocked");
    // Suspended hosting answers every path with this. Counting it as absence
    // would attribute a billing dispute to the brand.
    expect(classifyStatus(402)).toBe("blocked");
    expect(classifyStatus(418)).toBe("unexpected_status");
  });

  it("lets one blocked candidate defeat any number of clean 404s", () => {
    expect(rollUpOutcome(["absent", "absent", "absent"])).toBe("absent_at_every_candidate");
    expect(rollUpOutcome(["absent", "absent", "blocked"])).toBe("inconclusive_blocked");
    expect(rollUpOutcome(["absent", "transport_error"])).toBe("inconclusive_blocked");
    expect(rollUpOutcome(["absent", "not_a_document"])).toBe("invalid_document");
    expect(rollUpOutcome([])).toBe("mixed_negative");
  });

  it("reaches the published evidence: a 403 candidate makes D1 inconclusive", async () => {
    const h = harness({
      "https://example.com/.well-known/mcp.json": { status: 403, body: "forbidden" },
    });
    const result = await checkServerCard(h.deps, { apex: APEX });

    expect(result.status).toBe("fail");
    // The bug this guards: every non-2xx used to be recorded as `not_found`,
    // so a refusal was published as "this domain has no card".
    expect(evidence(result).outcome).toBe("inconclusive_blocked");
    // The other candidates legitimately 404. What matters is that the refused
    // one is not filed alongside them.
    const candidates = evidence(result).candidates as Array<{ path: string; result: string }>;
    const refused = candidates.find((c) => c.path === "/.well-known/mcp.json");
    expect(refused?.result).toBe("blocked");
  });

  it("still calls a clean 404 an absence", async () => {
    const h = harness({});
    const result = await checkServerCard(h.deps, { apex: APEX });
    expect(result.status).toBe("fail");
    expect(evidence(result).outcome).toBe("absent_at_every_candidate");
  });
});

describe("D1 — server card", () => {
  it("records which candidate responded, not merely that one did", async () => {
    const h = harness({
      "https://example.com/.well-known/ai-catalog.json": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ $schema: "https://ai-catalog.io/v1", entries: [] }),
      },
    });

    const result = await checkServerCard(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).respondedWith).toEqual(["ai-catalog"]);
  });

  it("probes every candidate, including the ones we expect to be dead", async () => {
    const h = harness({});
    await checkServerCard(h.deps, { apex: APEX });

    const probed = h.http.urls();
    // The unattested path is probed deliberately, to measure cargo-culting.
    expect(probed).toContain("https://example.com/.well-known/mcp/server-card.json");
    expect(probed).toContain("https://example.com/.well-known/mcp.json");
    expect(probed).toContain("https://example.com/.well-known/mcp-server");
  });

  it("does not count a 200 HTML catch-all as a card", async () => {
    const h = harness({
      "https://example.com/.well-known/mcp.json": {
        headers: { "content-type": "text/html" },
        body: "<!doctype html><html><body>Page not found</body></html>",
      },
    });

    const result = await checkServerCard(h.deps, { apex: APEX });
    expect(result.status).toBe("fail");
  });

  it("does not count a 200 whose body is not JSON", async () => {
    const h = harness({
      "https://example.com/.well-known/mcp.json": {
        headers: { "content-type": "application/json" },
        body: "not json at all",
      },
    });

    expect((await checkServerCard(h.deps, { apex: APEX })).status).toBe("fail");
  });

  it("skips endpoint-relative candidates until an endpoint is known", async () => {
    const h = harness({});
    await checkServerCard(h.deps, { apex: APEX });
    expect(h.http.urls()).not.toContain("https://example.com/mcp/server-card");

    h.client.endpointDiscovered("/mcp", "example.com");
    await checkServerCard(h.deps, { apex: APEX });
    expect(h.http.urls()).toContain("https://example.com/mcp/server-card");
  });

  it("asks the endpoint's own host for the endpoint-relative card", async () => {
    // Regression: resolving it against the apex asks a server that does not
    // host the endpoint, and silently misses every card on an mcp.* subdomain.
    const h = harness({
      "https://mcp.example.com/mcp/server-card": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "example", version: "1.0.0" }),
      },
    });
    h.client.endpointDiscovered("/mcp", "mcp.example.com");

    const result = await checkServerCard(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(h.http.urls()).toContain("https://mcp.example.com/mcp/server-card");
    expect(h.http.urls()).not.toContain("https://example.com/mcp/server-card");
  });
});

describe("D3 — conventional endpoint", () => {
  it("treats 405 as the positive signal, because the endpoint is POST-only", async () => {
    const h = harness({ "https://example.com/mcp": { status: 405 } });

    const result = await checkConventionalEndpoint(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).endpointUrl).toBe("https://example.com/mcp");
    expect(String(evidence(result).confidence)).toContain("weak");
  });

  it("does not treat a plain 200 as an endpoint", async () => {
    const h = harness({
      "https://example.com/mcp": { status: 200, body: "<html>marketing page</html>" },
    });
    expect((await checkConventionalEndpoint(h.deps, { apex: APEX })).status).toBe("fail");
  });

  it("recognises a modern JSON-RPC error body as an endpoint", async () => {
    const h = harness({
      "https://example.com/mcp": {
        status: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32022, message: "Unsupported protocol version" },
        }),
      },
    });

    const result = await checkConventionalEndpoint(h.deps, { apex: APEX });
    expect(result.status).toBe("pass");
  });

  it("finds a server at the root of the mcp subdomain", async () => {
    const h = harness({ "https://mcp.example.com/": { status: 405 } });

    const result = await checkConventionalEndpoint(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).endpointHost).toBe("mcp.example.com");
  });

  it("unlocks the endpoint-relative candidates for later checks", async () => {
    const h = harness({ "https://example.com/mcp": { status: 405 } });
    await checkConventionalEndpoint(h.deps, { apex: APEX });
    expect(h.client.endpointPath).toBe("/mcp");
  });

  it("treats a non-resolving subdomain as expected, not as an error", async () => {
    const h = harness({
      "https://example.com/mcp": { status: 404 },
      "https://mcp.example.com/robots.txt": { throws: "ENOTFOUND" },
    });

    const result = await checkConventionalEndpoint(h.deps, { apex: APEX });
    expect(result.status).toBe("fail");
  });
});

describe("D4 — RFC 9728 protected resource", () => {
  it("passes on a metadata document listing an authorization server", async () => {
    const h = harness({
      "https://example.com/.well-known/oauth-protected-resource": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resource: "https://example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
        }),
      },
    });

    const result = await checkOauthProtectedResource(h.deps, { apex: APEX });
    expect(result.status).toBe("pass");
  });

  it("rejects a document with no authorization_servers as malformed, not as a pass", async () => {
    const h = harness({
      "https://example.com/.well-known/oauth-protected-resource": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource: "https://example.com/mcp", authorization_servers: [] }),
      },
    });

    expect((await checkOauthProtectedResource(h.deps, { apex: APEX })).status).toBe("fail");
  });

  it("looks on the endpoint's own origin, which is the resource server", async () => {
    // Regression: RFC 9728 locates the document on the resource server. For MCP
    // that is usually mcp.<apex>, so probing only the apex is a false negative
    // on the one check the specification makes mandatory.
    const h = harness({
      "https://mcp.example.com/.well-known/oauth-protected-resource": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorization_servers: ["https://auth.example.com"] }),
      },
    });
    h.client.endpointDiscovered("/mcp", "mcp.example.com");

    const result = await checkOauthProtectedResource(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(h.http.urls()).toContain(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("enumerates apex root, endpoint path-inserted and endpoint root", () => {
    expect(
      oauthTargets({ apex: "example.com", endpointHost: "mcp.example.com", endpointPath: "/mcp" }),
    ).toEqual([
      {
        candidateId: "oauth-protected-resource-root",
        host: "example.com",
        path: "/.well-known/oauth-protected-resource",
      },
      {
        candidateId: "oauth-protected-resource-path-inserted",
        host: "mcp.example.com",
        path: "/.well-known/oauth-protected-resource/mcp",
      },
      {
        candidateId: "oauth-protected-resource-endpoint-root",
        host: "mcp.example.com",
        path: "/.well-known/oauth-protected-resource",
      },
    ]);
  });

  it("does not duplicate the root probe when the endpoint is on the apex", () => {
    const targets = oauthTargets({
      apex: "example.com",
      endpointHost: "example.com",
      endpointPath: "/mcp",
    });
    expect(targets).toHaveLength(2);
  });

  it("reads a 401 challenge as a positive detection", async () => {
    // Reading a response header is not an authentication attempt: we send no
    // credential and never follow the challenge.
    const h = harness({
      "https://example.com/.well-known/oauth-protected-resource": {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"',
        },
      },
    });

    const result = await checkOauthProtectedResource(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).wwwAuthenticateResourceMetadata).toContain("oauth-protected-resource");
  });

  it.each([
    ['Bearer resource_metadata="https://a.test/x"', "https://a.test/x"],
    ["Bearer resource_metadata=https://a.test/x", "https://a.test/x"],
    ['Bearer realm="r", resource_metadata="https://a.test/x"', "https://a.test/x"],
    ["Bearer error=invalid_token", undefined],
    [undefined, undefined],
  ])("parses %s", (header, expected) => {
    expect(parseResourceMetadata(header)).toBe(expected);
  });
});

describe("D2 — DNS TXT", () => {
  it("parses the draft-serra record format", () => {
    expect(parseMcpTxtRecord("v=mcp1; src=https://mcp.example.com/mcp; auth=oauth2")).toMatchObject(
      {
        version: "mcp1",
        dialect: "serra",
        endpoint: "https://mcp.example.com/mcp",
        auth: "oauth2",
      },
    );
  });

  it("parses the draft-morrison format, which uses url= instead of src=", () => {
    expect(
      parseMcpTxtRecord("v=mcp1; url=https://mcp.example.com; proto=streamable-http; priority=1"),
    ).toMatchObject({
      dialect: "morrison",
      endpoint: "https://mcp.example.com",
      proto: "streamable-http",
    });
  });

  it("records which of the two competing drafts an operator implemented", () => {
    // They share the _mcp. label, so one lookup covers both and the key name
    // tells us which proposal won on that domain.
    expect(parseMcpTxtRecord("v=mcp1; src=https://a.test")?.dialect).toBe("serra");
    expect(parseMcpTxtRecord("v=mcp1; url=https://a.test")?.dialect).toBe("morrison");
    expect(parseMcpTxtRecord("v=mcp1; src=https://a.test; url=https://a.test")?.dialect).toBe(
      "both",
    );
    expect(parseMcpTxtRecord("v=mcp1")?.dialect).toBe("unknown");
  });

  it("keeps a base64 value containing = intact", () => {
    const record = parseMcpTxtRecord("v=mcp1; url=https://a.test; pk=ed25519:AbC123==");
    expect(record?.endpoint).toBe("https://a.test");
  });

  it("parses the registry variant", () => {
    expect(parseMcpTxtRecord("v=mcp1; registry=https://registry.example.com")).toMatchObject({
      registry: "https://registry.example.com",
    });
  });

  it("ignores unrelated TXT records", () => {
    expect(parseMcpTxtRecord("v=spf1 include:_spf.google.com ~all")).toBeUndefined();
    expect(parseMcpTxtRecord("google-site-verification=abc")).toBeUndefined();
  });

  it("joins the chunks of a long record before parsing", async () => {
    const resolveTxt: ResolveTxt = async () => [["v=mcp1; src=https://mcp.exa", "mple.com/mcp"]];
    const h = harness({}, resolveTxt);

    const result = await checkDnsDiscovery(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).mcpRecords).toMatchObject([{ src: "https://mcp.example.com/mcp" }]);
  });

  it("treats NXDOMAIN as a clean negative, not an error", async () => {
    const h = harness({}, NO_TXT);
    expect((await checkDnsDiscovery(h.deps, { apex: APEX })).status).toBe("fail");
  });

  it("reports a real resolver failure as an error", async () => {
    const resolveTxt: ResolveTxt = async () => {
      throw new Error("ESERVFAIL");
    };
    const h = harness({}, resolveTxt);
    expect((await checkDnsDiscovery(h.deps, { apex: APEX })).status).toBe("error");
  });
});

describe("F1 — text fallbacks", () => {
  it("finds llms.txt", async () => {
    const h = harness({
      "https://example.com/llms.txt": {
        headers: { "content-type": "text/plain" },
        body: "# Example\n\nWe make examples.",
      },
    });

    const result = await checkTextFallbacks(h.deps, { apex: APEX });
    expect(result.status).toBe("pass");
    expect(evidence(result).found).toEqual(["/llms.txt"]);
  });

  it("rejects the HTML soft-404 that many sites return for any unknown path", async () => {
    const h = harness({
      "https://example.com/llms.txt": {
        headers: { "content-type": "text/html; charset=utf-8" },
        body: "<!DOCTYPE html><html><head><title>404</title></head></html>",
      },
    });

    expect((await checkTextFallbacks(h.deps, { apex: APEX })).status).toBe("fail");
  });

  it("rejects an empty 200", async () => {
    const h = harness({
      "https://example.com/llms.txt": { headers: { "content-type": "text/plain" }, body: "  " },
    });
    expect((await checkTextFallbacks(h.deps, { apex: APEX })).status).toBe("fail");
  });
});

describe("F2 — crawler posture", () => {
  it("passes when the domain has an opinion about any AI crawler, either way", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "User-agent: GPTBot\nDisallow: /" },
    });

    const result = await checkCrawlerPosture(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).disallowedCount).toBe(1);
  });

  it("fails when no AI crawler is mentioned at all", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /admin" },
    });

    const result = await checkCrawlerPosture(h.deps, { apex: APEX });
    expect(result.status).toBe("fail");
    expect(evidence(result).hasRobotsTxt).toBe(true);
  });

  it("records our own standing so skipped_by_robots is reportable", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "User-agent: MCPCensus\nDisallow: /" },
    });

    const result = await checkCrawlerPosture(h.deps, { apex: APEX });
    expect(evidence(result).self).toMatchObject({
      posture: "explicitly_disallowed",
      allowedAtRoot: false,
    });
  });
});

describe("probeDomain", () => {
  it("runs D3 before D1 so endpoint-relative candidates are reachable", async () => {
    const h = harness({
      "https://example.com/mcp": { status: 405 },
      "https://example.com/mcp/server-card": {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "example", version: "1.0.0" }),
      },
    });

    const result = await probeDomain(h.deps, { apex: APEX });

    expect(result.checks.map((c) => c.id)).toEqual([
      "F2",
      "D3",
      "D1",
      "D4",
      "D2",
      "D7",
      "F1",
      "D5",
      "D6",
      "Q1",
    ]);
    expect(result.checks.find((c) => c.id === "D1")?.status).toBe("pass");
    expect(evidence(result.checks.find((c) => c.id === "D1") as CheckResult).respondedWith).toEqual(
      ["server-card-endpoint-relative"],
    );
  });

  it("stamps the methodology and candidate versions on every result", async () => {
    const h = harness({});
    const result = await probeDomain(h.deps, { apex: APEX });

    expect(result.methodologyVersion).toBeTruthy();
    expect(result.candidatesVersion).toBeTruthy();
    expect(result.requestCount).toBeGreaterThan(0);
  });

  it("produces no score for a domain that shut us out entirely", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /" },
      "https://mcp.example.com/robots.txt": { body: "User-agent: *\nDisallow: /" },
      "https://api.example.com/robots.txt": { body: "User-agent: *\nDisallow: /" },
    });

    const result = await probeDomain(h.deps, { apex: APEX });

    // Scoring an unmeasured domain zero would turn our own exclusion into a
    // finding about their site.
    expect(result.score.assessed).toBe(false);
  });
});
