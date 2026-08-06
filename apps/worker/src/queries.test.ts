import { describe, expect, it } from "vitest";

import { latestFullRun, latestRun } from "./queries.js";

/**
 * A fake D1 that records the SQL it was handed. Enough to assert which runs a
 * query is willing to consider, which is the property that matters here.
 */
function spy() {
  const seen: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        seen.push(sql);
        return { first: async () => null };
      },
    },
  } as never;
  return { env, seen };
}

describe("which run the headline is allowed to use", () => {
  it("latestFullRun considers only whole-population runs", async () => {
    // The bug this prevents: the first nightly watchlist run flipped the live
    // headline from "61% publish nothing, 4,495 of 7,421" to "2%, 64 of 2,928"
    // overnight, with the framing sentence unchanged. Nothing had improved — the
    // page had silently switched to a population that, by construction, has a
    // discovery signal. A census cannot publish a biased subset under the full
    // population's sentence.
    const { env, seen } = spy();
    await latestFullRun(env);
    // Both spellings: crawl.ts writes NULL, the seeded first census wrote 'full'.
    // Matching only NULL excluded the one full run and shipped "0 of 0" live.
    expect(seen[0]).toContain("universe_filter IS NULL");
    expect(seen[0]).toContain("universe_filter = 'full'");
    expect(seen[0]).toContain("status = 'complete'");
  });

  it("latestRun deliberately does not filter, and is not for statistics", async () => {
    const { env, seen } = spy();
    await latestRun(env);
    expect(seen[0]).not.toContain("universe_filter");
  });
});
