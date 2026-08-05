/**
 * Deterministic scoring.
 *
 * In one sentence: **a domain earns 70 of 100 points for being connectable at
 * all, and the remaining 30 for the quality of what an agent finds once
 * connected.**
 *
 * A pure function of recorded evidence, so any published score can be recomputed
 * from the dataset without re-crawling. Changing anything here is a methodology
 * change: bump METHODOLOGY_VERSION and update METHODOLOGY.md in the same commit.
 */

import type { CheckId, CheckResult } from "./checks/types.js";

export const POINTS = {
  /** D5 confirmed a real MCP server answered. */
  confirmedConnection: 70,
  /** The domain published a discovery document (D1, D2 or D4). */
  publishedDiscoveryDocument: 35,
  /**
   * D3 only: something endpoint-shaped, unconfirmed. Deliberately worth less
   * than a published document — a 405 is consistent with any POST-only
   * endpoint. See docs/DECISIONS/0002-d3-detects-405.md.
   */
  endpointShapedOnly: 20,
  toolSurface: 15,
  textFallbacks: 10,
  crawlerPosture: 5,
} as const;

export type Band = "Absent" | "Text-only" | "Discoverable" | "Connectable" | "Agent-ready";

export interface ScoreComponents {
  readonly discovery: number;
  readonly toolSurface: number;
  readonly textFallbacks: number;
  readonly crawlerPosture: number;
}

export type ScoreResult =
  | {
      readonly assessed: false;
      /** Why no score is defensible for this domain. */
      readonly reason: "skipped_by_robots" | "opted_out" | "unreachable";
    }
  | {
      readonly assessed: true;
      readonly score: number;
      readonly band: Band;
      readonly components: ScoreComponents;
    };

const DISCOVERY_CHECKS: readonly CheckId[] = ["D1", "D2", "D3", "D4"];

/**
 * The checks that carry the weight of the census question.
 *
 * D2 is excluded because DNS is not gated by `robots.txt`: a domain that blocks
 * us over HTTP still yields a clean D2 negative, and letting that alone qualify
 * as "assessed" would let us publish "Absent" for a domain we were barely
 * allowed to look at.
 */
const HTTP_DISCOVERY_CHECKS: readonly CheckId[] = ["D1", "D3", "D4"];

function statusOf(results: readonly CheckResult[], id: CheckId) {
  return results.find((r) => r.id === id)?.status;
}

function passed(results: readonly CheckResult[], id: CheckId): boolean {
  return statusOf(results, id) === "pass";
}

export function bandFor(score: number): Band {
  if (score <= 0) return "Absent";
  if (score <= 30) return "Text-only";
  if (score <= 69) return "Discoverable";
  if (score <= 89) return "Connectable";
  return "Agent-ready";
}

export function scoreDomain(results: readonly CheckResult[]): ScoreResult {
  const anyDiscoveryPassed = DISCOVERY_CHECKS.some((id) => passed(results, id));
  const httpResults = HTTP_DISCOVERY_CHECKS.map((id) => statusOf(results, id));

  // If we never actually looked, there is no number to report. Scoring an
  // unmeasured domain zero would silently turn our own exclusions into findings
  // about somebody else's site. A positive finding anywhere overrides this: if
  // we found something, we know something worth publishing.
  if (!anyDiscoveryPassed) {
    if (httpResults.every((s) => s === undefined || s === "skip")) {
      return { assessed: false, reason: "skipped_by_robots" };
    }
    if (httpResults.every((s) => s === undefined || s === "skip" || s === "error")) {
      return { assessed: false, reason: "unreachable" };
    }
  }

  const publishedDocument = passed(results, "D1") || passed(results, "D2") || passed(results, "D4");

  let discovery = 0;
  if (passed(results, "D5")) discovery = POINTS.confirmedConnection;
  else if (publishedDocument) discovery = POINTS.publishedDiscoveryDocument;
  else if (passed(results, "D3")) discovery = POINTS.endpointShapedOnly;

  const components: ScoreComponents = {
    discovery,
    toolSurface: passed(results, "D6") && passed(results, "Q1") ? POINTS.toolSurface : 0,
    textFallbacks: passed(results, "F1") ? POINTS.textFallbacks : 0,
    crawlerPosture: passed(results, "F2") ? POINTS.crawlerPosture : 0,
  };

  const score =
    components.discovery +
    components.toolSurface +
    components.textFallbacks +
    components.crawlerPosture;

  return { assessed: true, score, band: bandFor(score), components };
}
