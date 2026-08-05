import { describe, expect, it } from "vitest";

import { CANONICAL_ORIGIN, CENSUS_BASE_PATH, CENSUS_BASE_URL, censusUrl } from "./site.js";

describe("canonical URLs", () => {
  it("uses the www host, which is canonical for the zone", () => {
    expect(new URL(CANONICAL_ORIGIN).hostname).toBe("www.radixia.ai");
  });

  it("is https", () => {
    expect(new URL(CANONICAL_ORIGIN).protocol).toBe("https:");
  });

  it("serves the census under its routed path prefix", () => {
    expect(CENSUS_BASE_URL).toBe("https://www.radixia.ai/census");
    expect(CENSUS_BASE_PATH).toBe("/census");
  });

  it.each([
    ["/", "https://www.radixia.ai/census/"],
    ["check", "https://www.radixia.ai/census/check"],
    ["/check", "https://www.radixia.ai/census/check"],
    ["/d/example.com", "https://www.radixia.ai/census/d/example.com"],
    ["/badge/example.com.svg", "https://www.radixia.ai/census/badge/example.com.svg"],
    ["/methodology", "https://www.radixia.ai/census/methodology"],
  ])("censusUrl(%s) === %s", (input, expected) => {
    expect(censusUrl(input)).toBe(expected);
  });

  it("defaults to the census root", () => {
    expect(censusUrl()).toBe("https://www.radixia.ai/census/");
  });

  it("never emits the bare apex, which a zone Redirect Rule would 301", () => {
    for (const path of ["/", "/check", "/results", "/d/x.test"]) {
      expect(censusUrl(path).startsWith("https://www.radixia.ai/census")).toBe(true);
    }
  });
});
