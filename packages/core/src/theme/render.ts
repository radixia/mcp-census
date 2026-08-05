/**
 * Turn a theme into the CSS custom-property blocks that precede the structural
 * stylesheet.
 */

import type { CensusTheme, ThemeTokens } from "./types.js";

function declarations(tokens: Partial<ThemeTokens>, indent = "  "): string {
  return Object.entries(tokens)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join("\n");
}

/**
 * Render `:root`, the dark-mode overrides, and — when the theme asks for it — the
 * manual `[data-theme]` overrides.
 *
 * The dark values are emitted up to three times, which is duplication the CSS
 * cannot avoid: once for the system preference, once for a forced dark attribute,
 * and the system block has to exclude a forced *light* attribute so that choosing
 * light on a dark-mode OS actually works. Getting one of these wrong is invisible
 * until somebody uses the toggle, so they are generated from one object rather
 * than hand-written.
 */
export function renderThemeCss(theme: CensusTheme): string {
  const blocks: string[] = [];

  if (theme.fontFaces !== undefined && theme.fontFaces.trim() !== "") {
    blocks.push(theme.fontFaces.trim());
  }

  blocks.push(`:root {\n${declarations(theme.tokens)}\n  color-scheme: light;\n}`);

  const hasDark = Object.keys(theme.darkTokens).length > 0;
  if (hasDark) {
    const dark = `${declarations(theme.darkTokens, "    ")}\n    color-scheme: dark;`;
    const systemSelector = theme.honourDataTheme ? ':root:not([data-theme="light"])' : ":root";
    blocks.push(`@media (prefers-color-scheme: dark) {\n  ${systemSelector} {\n${dark}\n  }\n}`);
    if (theme.honourDataTheme) {
      blocks.push(`:root[data-theme="dark"] {\n${dark}\n}`);
    }
  }

  return blocks.join("\n\n");
}

/**
 * The script that mirrors a surrounding site's manual theme choice onto census
 * pages.
 *
 * Served as an external file because the Worker's CSP is `script-src 'self'` with
 * no `unsafe-inline` and no hashes. Everything still works with JavaScript
 * disabled — the page simply follows `prefers-color-scheme`, which is the correct
 * default. This only adds the case where a visitor has *overridden* that
 * preference elsewhere on the same origin.
 *
 * `storageKey` must match the surrounding site's own key or this does nothing.
 */
export function themeScript(storageKey: string): string {
  return `// Mirror the site-wide light/dark override onto census pages.
// Same origin, so this reads the key the main site writes. Degrades to
// prefers-color-scheme when absent, blocked, or JavaScript is off.
(function () {
  try {
    var v = localStorage.getItem(${JSON.stringify(storageKey)});
    if (v === "light" || v === "dark") document.documentElement.dataset.theme = v;
  } catch (e) {
    /* private mode, storage disabled, partitioned — the default is fine */
  }
})();
`;
}
