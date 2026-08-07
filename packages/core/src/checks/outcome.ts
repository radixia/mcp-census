/**
 * Why a candidate probe came back negative, and what that licenses us to say.
 *
 * The checks used to record every non-2xx as `not_found`. That is a real
 * measurement error, not a wording problem: a `403` and a `404` support opposite
 * conclusions. A `404` at a published candidate path is evidence that the
 * document is not there. A `403` is evidence that we were not allowed to look,
 * which tells us nothing about the domain and everything about our own crawl.
 * Collapsing the two let "we were refused" be published as "they have nothing".
 *
 * Nothing here changes what is requested — the classification runs on responses
 * we had already received. It also cannot move a score: `scoreDomain` reads only
 * the four check statuses and never touches these labels, so bands stay
 * comparable across the methodology bump that introduces them.
 */

/** How a single candidate probe ended. Stable; goes in the public evidence. */
export type CandidateOutcome =
  | "found"
  /** `404` or `410`: the candidate is not there. A reportable negative. */
  | "absent"
  /** Refused, throttled or broken upstream. We learned nothing about the domain. */
  | "blocked"
  /** A non-2xx we did not anticipate. Kept separate rather than assumed absent. */
  | "unexpected_status"
  /** Something was served, and it was not a document we could parse. */
  | "not_a_document"
  | "skipped_by_robots"
  | "transport_error"
  | "redirected_off_apex";

/**
 * Statuses that mean "you may not look", not "there is nothing here".
 *
 * `402` is on the list because it is common in this population: hosts that have
 * suspended an account answer every path with it, including candidate paths, and
 * counting those as absence would attribute a hosting dispute to the brand.
 */
const REFUSED = new Set([401, 402, 403, 407, 429, 451]);

/** Classify a non-2xx response. `>= 500` is the server failing, not answering. */
export function classifyStatus(status: number): CandidateOutcome {
  if (status === 404 || status === 410) return "absent";
  if (REFUSED.has(status) || status >= 500) return "blocked";
  return "unexpected_status";
}

/**
 * The domain-level reading of a failed check, from its probes.
 *
 * Ordered by what the reader is entitled to conclude, strongest claim last:
 * if any candidate was blocked we cannot claim absence at all, whatever the
 * other candidates did.
 */
export type CheckOutcome =
  | "absent_at_every_candidate"
  | "inconclusive_blocked"
  | "invalid_document"
  | "mixed_negative";

export function rollUpOutcome(probes: readonly CandidateOutcome[]): CheckOutcome {
  if (probes.some((p) => p === "blocked" || p === "transport_error")) {
    return "inconclusive_blocked";
  }
  if (probes.length > 0 && probes.every((p) => p === "absent")) {
    return "absent_at_every_candidate";
  }
  if (probes.some((p) => p === "not_a_document")) return "invalid_document";
  return "mixed_negative";
}
