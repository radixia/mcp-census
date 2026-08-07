/**
 * The shape of every check result. These are the rows of the published dataset:
 * `id` is a stable public column name and `evidence` must stay
 * JSON-serialisable, because it is written to D1 and exported verbatim.
 */

export type CheckId =
  | "D1"
  | "D2"
  | "D3"
  | "D4"
  | "D5"
  | "D6"
  /** Added in methodology 0.4.0. Measured, deliberately not scored. */
  | "D7"
  | "Q1"
  | "F1"
  | "F2"
  | "S1";

export type CheckStatus =
  /** The thing this check looks for was found. */
  | "pass"
  /** We looked and it was not there. A real, reportable negative. */
  | "fail"
  /** We did not look. Never counted as a negative. */
  | "skip"
  /** We looked but could not tell — timeout, transport failure, unparseable. */
  | "error";

/**
 * Why a check did not run. Kept as a closed set because these become public
 * categories, and "skipped" figures that cannot be broken down are not
 * defensible.
 */
export type SkipReason =
  | "skipped_by_robots"
  | "opted_out"
  | "no_endpoint_discovered"
  | "handshake_did_not_succeed"
  | "not_implemented";

export interface CheckResult {
  readonly id: CheckId;
  readonly status: CheckStatus;
  /** JSON-serialisable. Whatever a reader would need to audit the verdict. */
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly latencyMs: number;
}

export function pass(
  id: CheckId,
  evidence: Record<string, unknown>,
  latencyMs: number,
): CheckResult {
  return { id, status: "pass", evidence, latencyMs };
}

export function fail(
  id: CheckId,
  evidence: Record<string, unknown>,
  latencyMs: number,
): CheckResult {
  return { id, status: "fail", evidence, latencyMs };
}

export function skip(id: CheckId, reason: SkipReason, latencyMs = 0): CheckResult {
  return { id, status: "skip", evidence: { skipReason: reason }, latencyMs };
}

export function errored(id: CheckId, error: unknown, latencyMs: number): CheckResult {
  return {
    id,
    status: "error",
    evidence: { error: error instanceof Error ? error.message : String(error) },
    latencyMs,
  };
}
