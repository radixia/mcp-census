/**
 * Bumped whenever a check is added or removed, or its pass/fail semantics
 * change. Every published row carries this value so a result can always be
 * traced back to the rules that produced it.
 *
 * No check may change without a corresponding METHODOLOGY.md revision.
 */
/**
 * Bumped from 0.2.0-draft on 2026-08-05, when the first full-population census
 * ran and its limitations were written from measurement rather than expectation.
 * A release that calls itself immutable cannot cite a draft.
 */
export const METHODOLOGY_VERSION = "0.4.0";

/** Crawler build identity. Surfaced in the User-Agent. */
export const CENSUS_VERSION = "0.1.0";

/**
 * Date the MCP specification and discovery proposals were last verified
 * against primary sources. See docs/SPEC-NOTES.md.
 */
export const SPEC_VERIFIED_ON = "2026-08-04";
