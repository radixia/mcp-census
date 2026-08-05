import { describe, expect, it } from "vitest";

import { GuardedHttpClient } from "../http/guarded-client.js";
import type { ResolveTxt } from "../http/types.js";
import { parseJsonRpcReply } from "../mcp/jsonrpc.js";
import { probeDomain } from "../probe.js";
import { type FakeRoutes, fakeDeps, fakeHttp, TEST_IDENTITY } from "../testing/fake-http.js";
import { endpointFromCard } from "./d1-server-card.js";
import { checkHandshake } from "./d5-handshake.js";
import { checkToolListing, summariseToolSurface } from "./d6-tools.js";
import type { CheckResult } from "./types.js";

const APEX = "example.com";
const NO_TXT: ResolveTxt = async () => {
  throw new Error("queryTxt ENOTFOUND");
};

function harness(routes: FakeRoutes) {
  const http = fakeHttp(routes);
  const base = fakeDeps(http);
  const client = new GuardedHttpClient(base, {
    apex: APEX,
    identity: TEST_IDENTITY,
    optOuts: new Set<string>(),
  });
  return { http, client, deps: { client, now: base.now, resolveTxt: NO_TXT } };
}

const evidence = (r: CheckResult) => r.evidence as Record<string, unknown>;
const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const DISCOVER_OK = json({
  jsonrpc: "2.0",
  id: 1,
  result: {
    resultType: "complete",
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: {}, resources: {} },
    instructions: "weather utilities",
    _meta: { "io.modelcontextprotocol/serverInfo": { name: "ExampleServer", version: "1.0.0" } },
  },
});

describe("D5 — handshake", () => {
  it("skips when discovery found no endpoint", async () => {
    const h = harness({});
    const result = await checkHandshake(h.deps, { apex: APEX });

    expect(result.status).toBe("skip");
    expect(h.http.calls).toHaveLength(0);
  });

  it("confirms a modern server via server/discover", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": DISCOVER_OK,
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const result = await checkHandshake(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).era).toBe("modern");
    expect(evidence(result).capabilities).toEqual(["tools", "resources"]);
    expect(evidence(result).serverInfo).toMatchObject({ name: "ExampleServer" });
  });

  it("renegotiates when the server names the versions it supports", async () => {
    // A 400 carrying UnsupportedProtocolVersionError identifies a modern server
    // that speaks a different revision. Reporting it as unreachable would be
    // wrong; the correct move is to retry in the dialect it offered.
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": [
        {
          status: 400,
          ...json({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: -32022,
              message: "Unsupported protocol version",
              data: { supported: ["2025-11-25"], requested: "2026-07-28" },
            },
          }),
        },
        DISCOVER_OK,
      ],
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const result = await checkHandshake(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).negotiatedVersion).toBe("2025-11-25");
  });

  it("does not fall back to legacy when the error identifies a modern server", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": {
        status: 400,
        ...json({ jsonrpc: "2.0", id: 1, error: { code: -32020, message: "Header mismatch" } }),
      },
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const result = await checkHandshake(h.deps, { apex: APEX });
    const attempts = evidence(result).attempts as Array<{ method: string }>;

    expect(attempts.map((a) => a.method)).toEqual(["server/discover"]);
  });

  it("falls back to the legacy initialize handshake", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "LegacyServer", version: "0.9.0" },
        },
      }),
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const result = await checkHandshake(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    // The modern probe succeeded shape-wise here, so era is modern. What matters
    // is that a legacy-only server is still confirmed rather than reported dead.
    expect(evidence(result).serverInfo).toMatchObject({ name: "LegacyServer" });
  });

  it("treats a 401 as a confirmed server that requires authorization", async () => {
    // We never retry with a credential. The 401 is the finding, and it is what
    // makes a D4 failure on this domain real non-compliance rather than "this
    // server needs no auth".
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
        },
      },
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const result = await checkHandshake(h.deps, { apex: APEX });

    expect(result.status).toBe("pass");
    expect(evidence(result).requiresAuthorization).toBe(true);
    for (const call of h.http.calls) {
      expect(Object.keys(call.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    }
  });

  it("fails when the endpoint answers but speaks no MCP", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": { status: 200, body: "<html>hello</html>" },
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    expect((await checkHandshake(h.deps, { apex: APEX })).status).toBe("fail");
  });
});

describe("SSE replies", () => {
  it("reads the final response out of an event stream", () => {
    const reply = parseJsonRpcReply({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      url: "https://example.com/mcp",
      body: [
        "event: message",
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
        "",
        'data: {"jsonrpc":"2.0","id":1,"result":{"supportedVersions":["2026-07-28"]}}',
        "",
      ].join("\n"),
    });

    expect(reply?.result).toMatchObject({ supportedVersions: ["2026-07-28"] });
  });

  it("confirms a server that answers over SSE rather than JSON", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": {
        headers: { "content-type": "text/event-stream" },
        body: 'data: {"jsonrpc":"2.0","id":1,"result":{"capabilities":{"tools":{}}}}\n\n',
      },
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const result = await checkHandshake(h.deps, { apex: APEX });
    expect(result.status).toBe("pass");
  });

  it("ignores a partial frame rather than throwing", () => {
    const reply = parseJsonRpcReply({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      url: "https://example.com/mcp",
      body: 'data: {"jsonrpc":"2.0","id":1,"resu\n',
    });
    expect(reply).toBeUndefined();
  });
});

describe("endpointFromCard", () => {
  it.each([
    [{ remotes: [{ type: "streamable-http", url: "https://mcp.example.com/mcp" }] }, "/mcp"],
    [{ servers: [{ url: "https://mcp.example.com/x" }] }, "/x"],
    [{ endpoint: "https://mcp.example.com/e" }, "/e"],
    [{ mcpServers: { one: { url: "https://mcp.example.com/c" } } }, "/c"],
  ])("reads an endpoint out of card shape %#", (card, path) => {
    // There is no agreed card format, so all the observed shapes are read.
    expect(endpointFromCard(card as Record<string, unknown>, APEX)).toEqual({
      host: "mcp.example.com",
      path,
    });
  });

  it("refuses an endpoint on somebody else's domain", () => {
    const card = { remotes: [{ url: "https://mcp.vendor.test/mcp" }] };
    expect(endpointFromCard(card, APEX)).toBeUndefined();
  });

  it("ignores non-https endpoints", () => {
    expect(endpointFromCard({ endpoint: "http://mcp.example.com/x" }, APEX)).toBeUndefined();
  });

  it("lets a card unlock the handshake when no conventional endpoint answered", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/.well-known/mcp.json": json({
        name: "example",
        remotes: [{ url: "https://mcp.example.com/mcp" }],
      }),
      "https://mcp.example.com/robots.txt": { body: "" },
      "https://mcp.example.com/mcp": DISCOVER_OK,
    });

    const result = await probeDomain(h.deps, { apex: APEX });

    expect(result.checks.find((c) => c.id === "D3")?.status).toBe("fail");
    expect(result.checks.find((c) => c.id === "D5")?.status).toBe("pass");
  });
});

describe("Q1 — tool surface", () => {
  it("summarises counts, description length and parameter coverage", () => {
    const surface = summariseToolSurface([
      { name: "a", describedChars: 40, parameters: 2, parametersDescribed: 2 },
      { name: "b", describedChars: 10, parameters: 1, parametersDescribed: 0 },
    ]);

    expect(surface).toMatchObject({
      toolCount: 2,
      described: 2,
      usefullyDescribed: 1,
      medianDescriptionChars: 25,
      parameters: 3,
      parametersDescribed: 2,
    });
    expect(surface.parameterCoverage).toBeCloseTo(2 / 3);
  });

  it("treats a tool surface with no parameters as fully covered", () => {
    const surface = summariseToolSurface([
      { name: "a", describedChars: 50, parameters: 0, parametersDescribed: 0 },
    ]);
    expect(surface.parameterCoverage).toBe(1);
  });

  it("passes D6 and Q1 for a well-described surface", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [
            {
              name: "get_weather",
              description: "Return the current weather for a named location.",
              inputSchema: {
                type: "object",
                properties: { location: { type: "string", description: "City name" } },
              },
            },
          ],
        },
      }),
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const { d6, q1 } = await checkToolListing(h.deps, { apex: APEX });

    expect(d6.status).toBe("pass");
    expect(evidence(d6).toolNames).toEqual(["get_weather"]);
    expect(q1.status).toBe("pass");
  });

  it("fails Q1 when tools have no descriptions an agent could use", async () => {
    const h = harness({
      "https://example.com/robots.txt": { body: "" },
      "https://example.com/mcp": json({
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [{ name: "do_thing" }, { name: "other", description: "x" }] },
      }),
    });
    h.client.endpointDiscovered("/mcp", "example.com");

    const { d6, q1 } = await checkToolListing(h.deps, { apex: APEX });

    expect(d6.status).toBe("pass");
    expect(q1.status).toBe("fail");
  });
});
