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

/**
 * Cacheability of a document we already fetched, as categories rather than
 * values.
 *
 * `experimental-ext-server-card#33` adopted ETag and conditional requests as a
 * SHOULD for card and catalog endpoints on 2026-07-24. Nobody has measured
 * whether publishers follow it. We receive these headers anyway, so recording
 * their shape costs no request — and shape is all we keep: an ETag value is an
 * opaque per-resource identifier and belongs to the publisher, not in our
 * dataset.
 */
export interface DocumentCacheability {
  readonly etag: "present" | "absent";
  readonly lastModified: "present" | "absent";
  readonly cacheControl: "public_revalidatable" | "public_fresh" | "private_or_no_store" | "absent";
  readonly contentTypeFamily: "json" | "html" | "text" | "other" | "absent";
}

export function cacheabilityOf(headers: Readonly<Record<string, string>>): DocumentCacheability {
  const get = (n: string) => headers[n]?.toLowerCase();
  const cc = get("cache-control");
  const type = get("content-type");

  let cacheControl: DocumentCacheability["cacheControl"] = "absent";
  if (cc !== undefined) {
    if (cc.includes("no-store") || cc.includes("private")) cacheControl = "private_or_no_store";
    else if (cc.includes("no-cache") || cc.includes("must-revalidate"))
      cacheControl = "public_revalidatable";
    else cacheControl = "public_fresh";
  }

  let contentTypeFamily: DocumentCacheability["contentTypeFamily"] = "absent";
  if (type !== undefined) {
    if (type.includes("json")) contentTypeFamily = "json";
    else if (type.includes("html")) contentTypeFamily = "html";
    else if (type.startsWith("text/")) contentTypeFamily = "text";
    else contentTypeFamily = "other";
  }

  return {
    etag: get("etag") === undefined ? "absent" : "present",
    lastModified: get("last-modified") === undefined ? "absent" : "present",
    cacheControl,
    contentTypeFamily,
  };
}
