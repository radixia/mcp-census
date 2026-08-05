/**
 * The HTML shell.
 *
 * Server-rendered, no framework. Every page must work with JavaScript disabled;
 * charts are inline SVG generated here rather than by a chart library.
 *
 * The single exception is the optional theme script, which mirrors a surrounding
 * site's manual light/dark override. It is progressive: without it, or with JS
 * off, pages follow `prefers-color-scheme`, which is the right default anyway.
 *
 * Every link is built with `censusUrl` so the canonical `www` host lives in one
 * constant and nothing here concatenates a URL.
 */

import {
  type CensusTheme,
  censusUrl,
  NEUTRAL_THEME,
  SEARCH_INDEXING_ENABLED,
} from "@mcp-census/core";

/** Minimal HTML escaping. Every interpolated value goes through this. */
export function esc(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface PageOptions {
  /**
   * Page-specific part of the title only. `page()` appends the product name from
   * the theme, so a fork's <title> and its header agree instead of the title
   * quietly saying "MCP Census" under somebody else's masthead.
   */
  readonly title: string;
  readonly description: string;
  /** Canonical path relative to the census root, e.g. `/results`. */
  readonly path: string;
  readonly body: string;
  readonly chrome?: PageChrome;
}

/**
 * Everything skin-related a page needs, in one field so adding to it later does
 * not touch every page signature again.
 */
export interface PageChrome {
  readonly theme: CensusTheme;
  /** True when the Worker serves `/assets/theme.js`; see Env.THEME_STORAGE_KEY. */
  readonly themeScript: boolean;
}

/** Neutral skin, no theme script. What a page renders as when nothing is passed. */
export const DEFAULT_CHROME: PageChrome = { theme: NEUTRAL_THEME, themeScript: false };

const NAV: ReadonlyArray<[string, string]> = [
  ["/check", "Check a domain"],
  ["/results", "Results"],
  ["/changes", "What changed"],
  ["/agntcon-2026", "AGNTCon"],
  ["/methodology", "Methodology"],
  ["/data", "Data"],
  ["/crawler", "Crawler"],
];

export function page(options: PageOptions): string {
  const canonical = censusUrl(options.path);
  const chrome = options.chrome ?? DEFAULT_CHROME;
  const brand = chrome.theme.branding;
  const fullTitle =
    options.title === "" ? brand.productName : `${options.title} — ${brand.productName}`;

  // The operator line is omitted entirely rather than guessed. A fork that has
  // not set its own operator says nothing, which is true, instead of naming
  // somebody else, which is not.
  const operator =
    brand.operator === undefined
      ? ""
      : ` Run by <a href="${esc(brand.operator.url)}">${esc(brand.operator.name)}</a>,${
          brand.inOwnDataset
            ? ` which is <a href="${esc(censusUrl("/methodology"))}">in its own dataset</a>.`
            : "."
        }`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(options.description)}">
${SEARCH_INDEXING_ENABLED ? "" : '<meta name="robots" content="noindex, nofollow, noarchive">'}
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="${esc(censusUrl("/assets/census.css"))}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">${
    chrome.themeScript
      ? // In <head> and NOT deferred: it sets data-theme before first paint, so a
        // visitor who forced light mode does not get a flash of dark first.
        `\n<script src="${esc(censusUrl("/assets/theme.js"))}"></script>`
      : ""
  }
</head>
<body>
<header class="top"><div class="wrap">${
    brand.operator === undefined
      ? ""
      : // A census served under somebody's domain is a dead end without a way
        // back up to it. Rendered as a breadcrumb rather than a nav item so the
        // direction is obvious.
        `\n<a class="up" href="${esc(brand.operator.url)}">\u2190 ${esc(brand.operator.name)}</a>`
  }
<a class="brand" href="${esc(censusUrl("/"))}">${esc(brand.productName)}</a>
<nav>${NAV.map(([href, label]) => `<a href="${esc(censusUrl(href))}">${esc(label)}</a>`).join("")}</nav>
</div></header>
<main><div class="wrap">
${options.body}
</div></main>
<footer class="bot"><div class="wrap">
<p>A census of the agent-reachable web.${operator}
Code Apache-2.0, data CC-BY-4.0 —
<a href="${esc(brand.repoUrl)}">${esc(brand.repoUrl.replace(/^https:\/\//, ""))}</a>.</p>
<p>Measuring, not scanning. We never call a tool, never authenticate, never test for weaknesses —
<a href="${esc(censusUrl("/crawler"))}">what our crawler does</a>.</p>
</div></footer>
</body>
</html>`;
}

/**
 * The operator's call to action, or nothing at all.
 *
 * Returns an empty string when the theme declares no CTA, which is the neutral
 * default — a fork must not inherit somebody else's pitch. Shown only on pages
 * where the reader has just learned something concrete about a domain; putting it
 * on the methodology or crawler pages would undercut them.
 */
export function ctaCard(chrome: PageChrome | undefined): string {
  const cta = (chrome ?? DEFAULT_CHROME).theme.branding.cta;
  if (cta === undefined) return "";
  return `<aside class="card cta">
<h2>${esc(cta.heading)}</h2>
<p>${esc(cta.body)}</p>
<p><a class="btn" href="${esc(cta.url)}">${esc(cta.label)}</a></p>
</aside>`;
}

/** A horizontal bar chart as inline SVG. No chart library, no client JS. */
export function barChart(
  rows: ReadonlyArray<{ label: string; value: number; note?: string }>,
  options: { max?: number; unit?: string } = {},
): string {
  if (rows.length === 0) return "";

  const max = options.max ?? Math.max(...rows.map((r) => r.value), 1);
  const rowH = 30;
  const labelW = 210;
  const barW = 420;
  const height = rows.length * rowH + 8;
  const unit = options.unit ?? "";

  const bars = rows
    .map((row, i) => {
      const y = i * rowH + 4;
      const w = Math.max(1, Math.round((row.value / max) * barW));
      const value = `${row.value}${unit}`;
      return `<text x="0" y="${y + 15}" font-size="13" fill="currentColor">${esc(row.label)}</text>
<rect x="${labelW}" y="${y + 4}" width="${w}" height="15" rx="2" fill="var(--accent)"></rect>
<text x="${labelW + w + 7}" y="${y + 16}" font-size="12" fill="currentColor" opacity=".75">${esc(value)}${
        row.note === undefined ? "" : ` ${esc(row.note)}`
      }</text>`;
    })
    .join("\n");

  return `<svg viewBox="0 0 ${labelW + barW + 110} ${height}" role="img" width="100%">${bars}</svg>`;
}

export function statGrid(stats: ReadonlyArray<{ n: string; k: string }>): string {
  return `<div class="grid">${stats
    .map(
      (s) =>
        `<div class="stat"><span class="n">${esc(s.n)}</span><span class="k">${esc(s.k)}</span></div>`,
    )
    .join("")}</div>`;
}

export function statusPill(status: string): string {
  const cls = status === "pass" ? "pass" : status === "fail" ? "fail" : "skip";
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}
