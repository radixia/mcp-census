/**
 * Bumped whenever a check is added or removed, or its pass/fail semantics
 * change. Every published row carries this value so a result can always be
 * traced back to the rules that produced it.
 *
 * No check may change without a corresponding METHODOLOGY.md revision.
 */
export const METHODOLOGY_VERSION = "0.2.0-draft";

/** Crawler build identity. Surfaced in the User-Agent. */
export const CENSUS_VERSION = "0.1.0";

/**
 * Date the MCP specification and discovery proposals were last verified
 * against primary sources. See docs/SPEC-NOTES.md.
 */
export const SPEC_VERIFIED_ON = "2026-08-04";
