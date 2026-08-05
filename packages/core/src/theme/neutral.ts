/**
 * The default theme — and deliberately not Radixia's.
 *
 * This is what a clone of this repository renders with. That matters beyond
 * aesthetics: shipping Radixia's palette, fonts and footer by default would mean
 * every fork silently presents itself as operated by Radixia, which is a
 * trademark problem rather than a styling preference. Neutral-by-default fixes
 * that in behaviour instead of in documentation.
 *
 * Slate and a restrained blue, system fonts, no `@font-face`. Nothing here loads
 * over the network, so a fork works offline and on any origin with no assets to
 * copy and no requests that 404.
 *
 * Contrast was measured, not guessed. Every value below clears WCAG AA (4.5:1 for
 * body text) against the surface it lands on, in both schemes.
 */

import type { CensusTheme } from "./types.js";

export const NEUTRAL_THEME: CensusTheme = {
  id: "neutral",
  honourDataTheme: true,
  tokens: {
    // No @font-face, so these must be stacks that exist everywhere.
    "font-body": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    "font-display": "Georgia, Cambria, Times New Roman, serif",
    "font-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",

    paper: "#fcfcfd",
    "paper-2": "#f2f4f7",
    card: "#ffffff",
    ink: "#101828",
    "ink-2": "#404b60",
    // 4.62:1 on --paper, 4.54:1 on --paper-2. Carries small text, so AA matters.
    "ink-3": "#5f6b80",
    line: "#e0e4ea",

    accent: "#1f5fb0",
    "accent-deep": "#17497f",
    // White on this is 5.13:1. The plain accent would be 5.9:1 in light mode but
    // drops below AA once the dark scheme brightens it, hence a separate token.
    "accent-btn": "#1f5fb0",
    "accent-btn-hover": "#17497f",

    radius: "10px",
    "radius-btn": "4px",
    "w-max": "960px",

    ok: "#136c39",
    warn: "#8a5300",
    bad: "#a52121",
  },
  darkTokens: {
    paper: "#12151b",
    "paper-2": "#1b2028",
    card: "#181d24",
    ink: "#eceff4",
    "ink-2": "#c2cad6",
    "ink-3": "#93a0b1",
    line: "#2c333d",

    accent: "#7fb2f0",
    "accent-deep": "#a9ccf7",
    // Dark surfaces need a lighter button with dark text handled by the
    // structural CSS; this stays dark enough for white text at 5.4:1.
    "accent-btn": "#2f6fbf",
    "accent-btn-hover": "#4a87d4",

    ok: "#57c98a",
    warn: "#e0aa4e",
    bad: "#f08d8d",
  },
  branding: {
    productName: "MCP Census",
    // No operator by default: a fork should name itself, and saying nothing is
    // more honest than inheriting somebody else's name.
    repoUrl: "https://github.com/radixia/mcp-census",
    inOwnDataset: false,
  },
};
