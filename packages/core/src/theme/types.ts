/**
 * The skin contract.
 *
 * The census separates engine (probes, scoring, queries), skin (this) and copy
 * (page text). A theme is *only* values: token names and their light/dark
 * settings, an optional `@font-face` block, and the operator's own identity. It
 * contains no layout and no component rules — those are structural, shared by
 * every theme, and live in the Worker's stylesheet.
 *
 * The default theme is deliberately neutral. Anyone who clones this repo and
 * deploys it gets a plain, competent-looking census under their own name, not
 * Radixia's colours and not a footer claiming Radixia operates it.
 */

/** Tokens the structural stylesheet requires. Every theme must set all of them. */
export interface ThemeTokens {
  readonly "font-body": string;
  readonly "font-display": string;
  readonly "font-mono": string;
  readonly paper: string;
  readonly "paper-2": string;
  readonly card: string;
  readonly ink: string;
  readonly "ink-2": string;
  readonly "ink-3": string;
  readonly line: string;
  /** The accent. Used for links, bars and the headline number. */
  readonly accent: string;
  readonly "accent-deep": string;
  /**
   * Button background, kept separate from `accent` on purpose. White text on a
   * mid-tone accent commonly fails WCAG AA in dark mode — Radixia's own accent is
   * 4.08:1 with white, under the 4.5:1 floor — so buttons get their own token
   * that is chosen for contrast rather than for brand vibrancy.
   */
  readonly "accent-btn": string;
  readonly "accent-btn-hover": string;
  readonly radius: string;
  /** Radius for buttons. Frequently differs from card radius; do not merge them. */
  readonly "radius-btn": string;
  readonly "w-max": string;
  /** Status colours for check pills. Must clear AA on `paper` and `card`. */
  readonly ok: string;
  readonly warn: string;
  readonly bad: string;
}

export interface ThemeBranding {
  /** The product name in the header. Not the operator's name. */
  readonly productName: string;
  /** Who runs this instance. Rendered in the footer; omit to say nothing. */
  readonly operator?: { readonly name: string; readonly url: string };
  /** Source repository, shown in the footer. */
  readonly repoUrl: string;
  /**
   * Whether this instance is itself in its own dataset. Radixia's is, and says
   * so; a fork measuring someone else's domains should not inherit that claim.
   */
  readonly inOwnDataset: boolean;
}

export interface CensusTheme {
  readonly id: string;
  readonly tokens: ThemeTokens;
  /** Overrides applied in dark mode. Anything omitted keeps its light value. */
  readonly darkTokens: Partial<ThemeTokens>;
  /**
   * An `@font-face` block, or undefined for system fonts only.
   *
   * A theme that references webfonts it does not serve produces a failed request
   * per family and silently falls back — which looks fine and is wrong. The
   * neutral theme therefore ships no `@font-face` at all rather than pointing at
   * paths that only exist on one origin.
   */
  readonly fontFaces?: string;
  readonly branding: ThemeBranding;
  /**
   * Honour a `data-theme` attribute set by a surrounding site, so a manual
   * light/dark toggle elsewhere on the same origin also governs census pages.
   */
  readonly honourDataTheme: boolean;
}
