import { describe, expect, it } from "vitest";

import { handle } from "./index.js";
import { contentSecurityPolicy, SECURITY_HEADERS } from "./security.js";

const get = (path: string) => handle(new Request(`https://www.radixia.ai${path}`));

describe("content security policy", () => {
  it("denies everything by default", () => {
    expect(contentSecurityPolicy()).toContain("default-src 'none'");
  });

  it("permits no inline script or style", () => {
    // The main site's build-time hashes can never cover Worker-rendered HTML, so
    // we avoid needing hashes at all rather than reaching for unsafe-inline.
    const csp = contentSecurityPolicy();
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("cannot be framed and cannot retarget its own base URL", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
});

describe("worker responses", () => {
  it.each(Object.keys(SECURITY_HEADERS))("sets %s on a 200", async (header) => {
    const response = await get("/census/");
    expect(response.headers.get(header)).toBe(SECURITY_HEADERS[header]);
  });

  it.each(Object.keys(SECURITY_HEADERS))("sets %s on a 404 too", async (header) => {
    const response = await get("/not-ours");
    expect(response.status).toBe(404);
    expect(response.headers.get(header)).toBe(SECURITY_HEADERS[header]);
  });

  it("enables HSTS for a year, with subdomains", async () => {
    const response = await get("/census/");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("strict-transport-security")).toContain("includeSubDomains");
  });

  it("refuses to serve census content outside the routed prefix", async () => {
    expect((await get("/")).status).toBe(404);
    expect((await get("/blog/some-post")).status).toBe(404);
  });

  it("rejects unsafe methods", async () => {
    const response = await handle(
      new Request("https://www.radixia.ai/census/", { method: "DELETE" }),
    );
    expect(response.status).toBe(405);
  });
});
