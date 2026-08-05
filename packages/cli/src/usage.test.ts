import { describe, expect, it } from "vitest";

import { isSubcommand, usage } from "./usage.js";

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
