import { describe, expect, it } from "vitest";

import {
  allowedHttpPaths,
  candidatesForCheck,
  DISCOVERY_CANDIDATES,
  type DiscoveryCandidate,
  resolveCandidate,
} from "./candidates.js";

/** Fails loudly if a candidate id is renamed, rather than asserting on undefined. */
function candidateById(id: string): DiscoveryCandidate {
  const found = DISCOVERY_CANDIDATES.find((c) => c.id === id);
  if (found === undefined) {
    throw new Error(`no candidate with id ${id}; ids are public dataset columns, rename with care`);
  }
  return found;
}

describe("candidate inventory", () => {
  it("has unique ids, because ids ship in the public dataset", () => {
    const ids = DISCOVERY_CANDIDATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records provenance and a source for every candidate", () => {
    for (const candidate of DISCOVERY_CANDIDATES) {
      expect(candidate.provenance.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.source.length, candidate.id).toBeGreaterThan(0);
    }
  });

  it("marks exactly the RFC 9728 paths as normative", () => {
    // Nothing else in the discovery space is MUST-level as of 2026-08-04.
    // If this fails, the spec moved: re-read docs/SPEC-NOTES.md before editing.
    const must = DISCOVERY_CANDIDATES.filter((c) => c.normativity === "must").map((c) => c.id);
    expect(must).toEqual([
      "oauth-protected-resource-root",
      "oauth-protected-resource-path-inserted",
    ]);
  });

  it("keeps the unattested path flagged as unattested", () => {
    expect(candidateById("mcp-server-card-json").normativity).toBe("unattested");
  });

  it("groups candidates by check", () => {
    expect(candidatesForCheck("D1").length).toBeGreaterThan(0);
    expect(candidatesForCheck("D2").every((c) => c.kind === "dns-txt")).toBe(true);
    expect(candidatesForCheck("D4").length).toBe(2);
  });
});

describe("resolveCandidate", () => {
  it("substitutes the apex into a DNS template", () => {
    const dns = candidateById("dns-txt-serra");
    expect(resolveCandidate(dns, { apex: "example.com" })).toBe("_mcp.example.com");
  });

  it("substitutes the endpoint path into the RFC 9728 path-insertion form", () => {
    const candidate = candidateById("oauth-protected-resource-path-inserted");
    expect(resolveCandidate(candidate, { apex: "example.com", endpointPath: "/public/mcp" })).toBe(
      "/.well-known/oauth-protected-resource/public/mcp",
    );
  });

  it("strips a trailing slash so we never emit a doubled separator", () => {
    const candidate = candidateById("server-card-endpoint-relative");
    expect(resolveCandidate(candidate, { apex: "example.com", endpointPath: "/mcp/" })).toBe(
      "/mcp/server-card",
    );
  });

  it("throws rather than silently probing the wrong URL", () => {
    const candidate = candidateById("server-card-endpoint-relative");
    expect(() => resolveCandidate(candidate, { apex: "example.com" })).toThrow(/endpointPath/);
    expect(() => resolveCandidate(candidate, { apex: "example.com", endpointPath: "" })).toThrow(
      /endpointPath/,
    );
  });
});

describe("allowedHttpPaths", () => {
  it("excludes DNS candidates, which are not fetched over HTTP", () => {
    const paths = allowedHttpPaths({ apex: "example.com" });
    expect([...paths].some((p) => p.startsWith("_mcp."))).toBe(false);
  });

  it("always includes robots.txt, which gates everything else", () => {
    expect(allowedHttpPaths({ apex: "example.com" })).toContain("/robots.txt");
  });

  it("widens only once an endpoint is known", () => {
    const before = allowedHttpPaths({ apex: "example.com" });
    const after = allowedHttpPaths({ apex: "example.com", endpointPath: "/mcp" });
    expect(after.size).toBeGreaterThan(before.size);
    expect(after).toContain("/mcp/server-card");
  });
});
