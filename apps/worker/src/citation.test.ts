import { describe, expect, it } from "vitest";

import type { Env } from "./env.js";
import { handle } from "./index.js";

// `/data` reads constants, not bindings, but `handle` refuses to serve anything
// without a `DB` — so the stub is only there to get past that gate.
const env = { DB: {} as unknown } as unknown as Env;

const dataPage = async (): Promise<string> => {
  const response = await handle(new Request("https://www.radixia.ai/census/data"), env);
  return await response.text();
};

describe("the data page says how to cite the release", () => {
  it("gives the version DOI as well as the concept DOI", async () => {
    // A number quoted from a release travels with the DOI of that release. The
    // concept DOI moves to whatever we deposit next, so on its own it would
    // silently re-point a quotation at data the author never saw.
    const html = await dataPage();
    expect(html).toContain("10.5281/zenodo.22830292");
    expect(html).toContain("10.5281/zenodo.22830291");
  });

  it("resolves the DOI through doi.org rather than a zenodo.org address", async () => {
    // doi.org is the part that survives Zenodo moving its own URLs, which is
    // most of the reason to have a DOI at all.
    const html = await dataPage();
    expect(html).toContain("https://doi.org/10.5281/zenodo.22830292");
  });

  it("carries the release date into the citation", async () => {
    const html = await dataPage();
    expect(html).toContain("Version 2026-09-13");
  });
});
