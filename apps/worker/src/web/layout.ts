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
<link rel="canonical" href="${esc(canonical)}">${
    // Only when the theme provides one. A browser given no icon asks for
    // /favicon.ico, which the surrounding site does not serve, so every page
    // logged a console 404.
    brand.faviconPath === undefined ? "" : `\n<link rel="icon" href="${esc(brand.faviconPath)}">`
  }
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
<nav>${NAV.map(([href, label]) => `<a href="${esc(censusUrl(href))}">${esc(label)}</a>`).join("")}${
    // The repository, in the nav rather than only in the footer. The whole claim
    // of this project is that you can check its work, and a link you have to
    // scroll to the bottom to find is not an invitation to do that. Comes from
    // branding so a fork points at its own code.
    `<a href="${esc(brand.repoUrl)}" rel="noopener">Source</a>`
  }</nav>
</div></header>
<main><div class="wrap">
${options.body}
</div></main>
<footer class="bot"><div class="wrap">
<p>A census of the agent-reachable web.${operator}
Code Apache-2.0, data CC-BY-4.0.
<a href="${esc(brand.repoUrl)}">${esc(brand.repoUrl.replace(/^https:\/\//, ""))}</a>.</p>
<p>Measuring, not scanning. We never call a tool, never authenticate, never test for weaknesses.
<a href="${esc(censusUrl("/crawler"))}">What our crawler does</a>.</p>
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

/**
 * A cumulative time series as inline SVG: filled area, line, end-point marker.
 *
 * No chart library and no client JavaScript, per the project's constraints, which
 * also means no tooltips — so the numbers a reader needs are drawn on the chart
 * and the whole series is repeated as a real table underneath. That table is not
 * a fallback nobody sees; it is the accessible version and the one you can copy.
 *
 * A `partial` point is drawn hollow and dashed. Without that, a snapshot taken on
 * the 5th of a month puts five days beside thirty and renders a cliff — the
 * easiest way to publish an accidental lie about a trend.
 */
export function areaChart(
  points: ReadonlyArray<{ label: string; value: number; partial?: boolean }>,
  options: { caption?: string; unit?: string } = {},
): string {
  if (points.length < 2) return "";

  const W = 720;
  const H = 260;
  const padL = 58;
  const padR = 14;
  const padT = 16;
  const padB = 34;
  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL},${(padT + innerH).toFixed(1)} Z`;

  // Three gridlines is enough to read a magnitude without becoming graph paper.
  const ticks = [0, 0.5, 1].map((f) => {
    const v = Math.round(max * f);
    const gy = y(v).toFixed(1);
    return `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="var(--line)" stroke-width="1"></line>
<text x="${padL - 8}" y="${(Number(gy) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="currentColor" opacity=".65">${esc(v.toLocaleString("en"))}</text>`;
  });

  // Label the ends and roughly the middle; every month would collide.
  const every = Math.ceil(points.length / 6);
  const xLabels = points
    .map((p, i) =>
      i % every === 0 || i === points.length - 1
        ? `<text x="${x(i).toFixed(1)}" y="${H - 10}" font-size="11" text-anchor="middle" fill="currentColor" opacity=".65">${esc(p.label)}</text>`
        : "",
    )
    .join("");

  const last = points[points.length - 1];
  const lastPartial = last?.partial === true;
  const dots = points
    .map((p, i) => {
      if (i !== points.length - 1) return "";
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4.5"
 fill="${lastPartial ? "var(--paper)" : "var(--accent)"}" stroke="var(--accent)" stroke-width="2"></circle>`;
    })
    .join("");

  const unit = options.unit ?? "";
  const label = `${points[0]?.label ?? ""} to ${last?.label ?? ""}: ${points[0]?.value.toLocaleString("en")} rising to ${last?.value.toLocaleString("en")}${unit}`;

  return `<figure>
<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
${ticks.join("\n")}
<path d="${area}" fill="var(--accent)" opacity=".13"></path>
<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5"
 stroke-linejoin="round" stroke-linecap="round"${lastPartial ? ' stroke-dasharray="none"' : ""}></path>
${dots}
${xLabels}
</svg>
${options.caption === undefined ? "" : `<figcaption>${esc(options.caption)}</figcaption>`}
</figure>`;
}

/** The same series as a table — the accessible version, and the copyable one. */
export function seriesTable(
  points: ReadonlyArray<{ label: string; value: number; added?: number; partial?: boolean }>,
  headers: { label: string; value: string; added?: string },
): string {
  return `<details><summary class="note">Show these numbers as a table</summary>
<div class="scroll"><table>
<thead><tr><th>${esc(headers.label)}</th>${headers.added === undefined ? "" : `<th class="num">${esc(headers.added)}</th>`}<th class="num">${esc(headers.value)}</th></tr></thead>
<tbody>
${points
  .map(
    (p) =>
      `<tr><td>${esc(p.label)}${p.partial === true ? ' <span class="pill skip">partial</span>' : ""}</td>${
        headers.added === undefined
          ? ""
          : `<td class="num">${p.added === undefined ? "\u2014" : esc(p.added.toLocaleString("en"))}</td>`
      }<td class="num">${esc(p.value.toLocaleString("en"))}</td></tr>`,
  )
  .join("\n")}
</tbody></table></div></details>`;
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
