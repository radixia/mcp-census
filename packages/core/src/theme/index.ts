/**
 * The theme registry.
 *
 * `neutral` is the default and `resolveTheme` falls back to it for an unknown id,
 * because a typo in a deploy variable should produce a plain census rather than a
 * broken one — and should never silently produce somebody else's branding.
 */

import { NEUTRAL_THEME } from "./neutral.js";
import { RADIXIA_THEME } from "./radixia.js";
import type { CensusTheme } from "./types.js";

export const THEMES: Readonly<Record<string, CensusTheme>> = {
  neutral: NEUTRAL_THEME,
  radixia: RADIXIA_THEME,
};

export const DEFAULT_THEME_ID = "neutral";

/**
 * Look up a theme by id.
 *
 * Returns the neutral theme for undefined, empty or unrecognised ids. Deliberately
 * does not throw: the alternative is a Worker that 500s every page because a
 * variable was misspelled.
 */
export function resolveTheme(id: string | undefined): CensusTheme {
  if (id === undefined || id === "") return NEUTRAL_THEME;
  return THEMES[id] ?? NEUTRAL_THEME;
}
