import { describe, expect, it } from "vitest";

import { isSubcommand, normaliseDomain, usage } from "./usage.js";

describe("subcommands", () => {
  it("recognises check", () => {
    expect(isSubcommand("check")).toBe(true);
  });

  it("rejects anything else, leaving room for compare and badge later", () => {
    expect(isSubcommand("compare")).toBe(false);
    expect(isSubcommand("")).toBe(false);
  });
});

describe("usage text", () => {
  it("shows the invocation the docs and stickers use", () => {
    expect(usage()).toContain("mcpcensus check <domain>");
  });

  it("points at the methodology and the crawler ethics page", () => {
    expect(usage()).toContain("https://www.radixia.ai/census/methodology");
    expect(usage()).toContain("https://www.radixia.ai/census/crawler");
  });
});

describe("domain normalisation", () => {
  it.each([
    ["example.com", "example.com"],
    ["HTTPS://WWW.Example.com/path?q=1", "example.com"],
    ["example.com:8443", "example.com"],
    ["mcp.example.co.uk", "mcp.example.co.uk"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected);
  });

  it.each(["", "localhost", "not a domain", "-bad.com", "a..b"])("rejects %s", (input) => {
    expect(normaliseDomain(input)).toBeUndefined();
  });
});

describe("usage text", () => {
  it("documents the exit code that means we were not allowed to look", () => {
    // A domain that excluded us is not a zero, and the CLI must not imply it is.
    expect(usage()).toContain("2  not assessable");
  });
});
