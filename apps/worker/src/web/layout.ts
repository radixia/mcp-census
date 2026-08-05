/**
 * The HTML shell.
 *
 * Server-rendered, no framework, no client JavaScript at all — every page must
 * work with JS disabled. Charts are inline SVG generated here rather than by a
 * chart library.
 *
 * Every link is built with `censusUrl` so the canonical `www` host lives in one
 * constant and nothing here concatenates a URL.
 */

import { censusUrl, SEARCH_INDEXING_ENABLED } from "@mcp-census/core";

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
  readonly title: string;
  readonly description: string;
  /** Canonical path relative to the census root, e.g. `/results`. */
  readonly path: string;
  readonly body: string;
}

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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
${SEARCH_INDEXING_ENABLED ? "" : '<meta name="robots" content="noindex, nofollow, noarchive">'}
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="${esc(censusUrl("/assets/census.css"))}">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
</head>
<body>
<header class="top"><div class="wrap">
<a class="brand" href="${esc(censusUrl("/"))}">MCP Census</a>
<nav>${NAV.map(([href, label]) => `<a href="${esc(censusUrl(href))}">${esc(label)}</a>`).join("")}</nav>
</div></header>
<main><div class="wrap">
${options.body}
</div></main>
<footer class="bot"><div class="wrap">
<p>A census of the agent-reachable web. Run by
<a href="https://www.radixia.ai">Radixia</a>, which is
<a href="${esc(censusUrl("/methodology"))}">in its own dataset</a>.
Code Apache-2.0, data CC-BY-4.0 —
<a href="https://github.com/radixia/mcp-census">github.com/radixia/mcp-census</a>.</p>
<p>Measuring, not scanning. We never call a tool, never authenticate, never test for weaknesses —
<a href="${esc(censusUrl("/crawler"))}">what our crawler does</a>.</p>
</div></footer>
</body>
</html>`;
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
<rect x="${labelW}" y="${y + 4}" width="${w}" height="15" rx="2" fill="var(--magenta)"></rect>
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
