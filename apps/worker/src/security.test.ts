import { SEARCH_INDEXING_ENABLED } from "@mcp-census/core";
import { describe, expect, it } from "vitest";

import { handle } from "./index.js";
import { contentSecurityPolicy, SECURITY_HEADERS } from "./security.js";
import { landingPage } from "./web/pages.js";

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

describe("search indexing", () => {
  it("is disabled before launch", () => {
    // DELETE THIS TEST when going live on 2026-09-17. It exists so nobody ships
    // an indexable census by accident — flipping SEARCH_INDEXING_ENABLED without
    // noticing this test would be exactly that accident.
    expect(SEARCH_INDEXING_ENABLED).toBe(false);
  });

  it("sends X-Robots-Tag on a page", async () => {
    const response = await get("/census/");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("sends it on a 404 too, so a stray URL cannot be indexed", async () => {
    const response = await get("/not-ours");
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("puts the matching meta tag in the markup", () => {
    // Belt and braces: some crawlers read markup rather than headers, and the
    // header alone would miss anything served through a cache that strips it.
    const html = landingPage({
      headline: { assessed: 1, unassessed: 0, anyDiscovery: 0, card: 0, confirmed: 0, nothing: 1 },
      candidates: [],
      runFinishedAt: null,
    });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
  });

  it("still declares a canonical URL, so the eventual index is on the right host", () => {
    const html = landingPage({
      headline: { assessed: 1, unassessed: 0, anyDiscovery: 0, card: 0, confirmed: 0, nothing: 1 },
      candidates: [],
      runFinishedAt: null,
    });
    expect(html).toContain('rel="canonical" href="https://www.radixia.ai/census/"');
  });
});
