import { describe, expect, it } from "vitest";

import type { CheckId, CheckResult, CheckStatus } from "./checks/types.js";
import { bandFor, POINTS, scoreDomain } from "./scoring.js";

const r = (id: CheckId, status: CheckStatus): CheckResult => ({
  id,
  status,
  evidence: {},
  latencyMs: 0,
});

/** A domain we looked at and found nothing on. */
const NOTHING: CheckResult[] = [
  r("D1", "fail"),
  r("D2", "fail"),
  r("D3", "fail"),
  r("D4", "fail"),
  r("F1", "fail"),
  r("F2", "fail"),
];

function scoreOf(results: CheckResult[]): number {
  const result = scoreDomain(results);
  if (!result.assessed) throw new Error("expected an assessed score");
  return result.score;
}

describe("bands", () => {
  it.each([
    [0, "Absent"],
    [1, "Text-only"],
    [30, "Text-only"],
    [31, "Discoverable"],
    [69, "Discoverable"],
    [70, "Connectable"],
    [89, "Connectable"],
    [90, "Agent-ready"],
    [100, "Agent-ready"],
  ] as const)("scores %i as %s", (score, band) => {
    expect(bandFor(score)).toBe(band);
  });
});

describe("scoring", () => {
  it("gives a domain with nothing a zero and the Absent band", () => {
    const result = scoreDomain(NOTHING);
    expect(result).toMatchObject({ assessed: true, score: 0, band: "Absent" });
  });

  it("weights discovery far above everything else", () => {
    const fallbacksOnly = scoreOf([...NOTHING.slice(0, 4), r("F1", "pass"), r("F2", "pass")]);
    const discoveryOnly = scoreOf([r("D1", "pass"), ...NOTHING.slice(1)]);

    expect(fallbacksOnly).toBeLessThan(discoveryOnly);
    expect(discoveryOnly).toBe(POINTS.publishedDiscoveryDocument);
  });

  it("cannot reach Discoverable on text fallbacks alone", () => {
    const result = scoreDomain([...NOTHING.slice(0, 4), r("F1", "pass"), r("F2", "pass")]);
    expect(result).toMatchObject({ band: "Text-only" });
  });

  it("ranks an unconfirmed 405 below a published discovery document", () => {
    // D3 alone is consistent with any POST-only endpoint, so it must not buy
    // the same credit as a card the domain actually published. See ADR 0002.
    const endpointOnly = scoreOf([r("D3", "pass"), ...NOTHING.filter((c) => c.id !== "D3")]);
    const documentOnly = scoreOf([r("D4", "pass"), ...NOTHING.filter((c) => c.id !== "D4")]);

    expect(endpointOnly).toBe(POINTS.endpointShapedOnly);
    expect(endpointOnly).toBeLessThan(documentOnly);
  });

  it("awards the full connection tier only for a confirmed handshake", () => {
    const confirmed = scoreOf([r("D5", "pass"), ...NOTHING]);
    expect(confirmed).toBe(POINTS.confirmedConnection);
    expect(bandFor(confirmed)).toBe("Connectable");
  });

  it("does not double-count discovery tiers", () => {
    const everything = scoreOf([r("D1", "pass"), r("D3", "pass"), r("D5", "pass"), ...NOTHING]);
    expect(everything).toBe(POINTS.confirmedConnection);
  });

  it("reaches Agent-ready only with a connection, tools and fallbacks", () => {
    const result = scoreDomain([
      r("D1", "pass"),
      r("D5", "pass"),
      r("D6", "pass"),
      r("Q1", "pass"),
      r("F1", "pass"),
      r("F2", "pass"),
    ]);

    expect(result).toMatchObject({ assessed: true, score: 100, band: "Agent-ready" });
  });

  it("is deterministic", () => {
    const once = scoreDomain(NOTHING);
    const twice = scoreDomain([...NOTHING].reverse());
    expect(once).toEqual(twice);
  });
});

describe("refusing to score", () => {
  it("returns no score when robots.txt shut us out of every discovery check", () => {
    const result = scoreDomain([
      r("D1", "skip"),
      r("D2", "skip"),
      r("D3", "skip"),
      r("D4", "skip"),
      r("F2", "pass"),
    ]);

    expect(result).toEqual({ assessed: false, reason: "skipped_by_robots" });
  });

  it("still refuses when only DNS was measurable, since DNS ignores robots.txt", () => {
    // Publishing "Absent" for a domain that blocked every HTTP probe would be a
    // finding about our own crawl dressed up as a finding about their site.
    const result = scoreDomain([
      r("D1", "skip"),
      r("D2", "fail"),
      r("D3", "skip"),
      r("D4", "skip"),
    ]);

    expect(result).toEqual({ assessed: false, reason: "skipped_by_robots" });
  });

  it("scores a domain whose DNS record we did find, even if HTTP was blocked", () => {
    const result = scoreDomain([
      r("D1", "skip"),
      r("D2", "pass"),
      r("D3", "skip"),
      r("D4", "skip"),
    ]);

    expect(result).toMatchObject({ assessed: true, band: "Discoverable" });
  });

  it("returns no score when the domain was unreachable", () => {
    const result = scoreDomain([
      r("D1", "error"),
      r("D2", "error"),
      r("D3", "error"),
      r("D4", "error"),
    ]);

    expect(result).toEqual({ assessed: false, reason: "unreachable" });
  });

  it("scores normally as soon as one discovery check produced a real answer", () => {
    const result = scoreDomain([
      r("D1", "fail"),
      r("D2", "skip"),
      r("D3", "error"),
      r("D4", "error"),
    ]);

    expect(result.assessed).toBe(true);
  });
});
