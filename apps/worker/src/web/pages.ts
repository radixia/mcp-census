/**
 * The census pages.
 *
 * Each is a pure function from data to HTML. No framework, no client JS, no
 * inline style — the Worker's CSP forbids all three, and every page must render
 * with JavaScript disabled.
 */

import { CENSUS_VERSION, censusUrl, METHODOLOGY_VERSION } from "@mcp-census/core";

import { barChart, ctaCard, esc, type PageChrome, page, statGrid, statusPill } from "./layout.js";

/** Provenance of each candidate path, so the fragmentation chart is legible. */
const CANDIDATE_LABELS: Record<string, string> = {
  "mcp-json": "/.well-known/mcp.json",
  "mcp-server-card-json": "/.well-known/mcp/server-card.json",
  "ai-catalog": "/.well-known/ai-catalog.json",
  "mcp-bare": "/.well-known/mcp",
  "mcp-server-serra": "/.well-known/mcp-server",
  "server-card-endpoint-relative": "<endpoint>/server-card",
  "dns-txt-serra": "_mcp TXT record",
};

const CANDIDATE_NOTES: Record<string, string> = {
  "mcp-json": "superseded",
  "mcp-server-card-json": "in no specification",
  "ai-catalog": "current direction",
  "mcp-bare": "never adopted",
  "mcp-server-serra": "draft",
  "server-card-endpoint-relative": "draft",
  "dns-txt-serra": "draft",
};

export interface HeadlineData {
  readonly assessed: number;
  readonly unassessed: number;
  readonly anyDiscovery: number;
  readonly card: number;
  readonly confirmed: number;
  readonly nothing: number;
}

const pct = (n: number, d: number): string => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

export function landingPage(data: {
  chrome?: PageChrome;
  headline: HeadlineData;
  candidates: Array<{ candidate_id: string; n: number }>;
  runFinishedAt: string | null;
}): string {
  const h = data.headline;
  const cardTotal = data.candidates.reduce((n, c) => n + c.n, 0);

  const body = `
<p class="eyebrow">A census of the agent-reachable web</p>
<h1>The ecosystem built the servers and forgot the front door.</h1>

<div class="headline">
  <span class="big">${pct(h.nothing, h.assessed)}</span>
  <p class="said">of the organisations that <strong>provably run an MCP server</strong> publish
  nothing an agent could use to find it. ${h.nothing} of ${h.assessed} measured.</p>
</div>

<p class="lede">We do not ask how many big websites have an MCP server — that number is
approximately zero and already well measured. We ask the question nobody has answered: of the
organisations that demonstrably run one, how many can an agent actually reach?</p>

${statGrid([
  { n: String(h.assessed), k: "organisations assessed" },
  { n: pct(h.card, h.assessed), k: "publish a server card" },
  { n: pct(h.confirmed, h.assessed), k: "answer a handshake" },
  { n: String(h.unassessed), k: "not assessable" },
])}

<p><a class="btn" href="${esc(censusUrl("/check"))}">Check your own domain</a></p>

<h2>Nobody implements where the specification is heading</h2>
<p>Every card we find is on one path or another, and the paths do not agree. The most-deployed
one was superseded in flight; the next appears in <strong>no specification document at all</strong>
and propagated through blog posts.</p>
${
  cardTotal === 0
    ? '<p class="note">No cards found in this run yet.</p>'
    : `<figure>${barChart(
        data.candidates.map((c) => ({
          label: CANDIDATE_LABELS[c.candidate_id] ?? c.candidate_id,
          value: c.n,
          note:
            CANDIDATE_NOTES[c.candidate_id] === undefined
              ? ""
              : `· ${CANDIDATE_NOTES[c.candidate_id]}`,
        })),
      )}<figcaption>Server cards found, by the path that answered. ${cardTotal} in total.</figcaption></figure>`
}

<h2>How to read this</h2>
<p>Every number here excludes domains we were not permitted or not able to measure — a domain that
blocked our crawler is reported as its own category, never as a zero. The population is
organisations the official MCP Registry proves run a server, which is plausibly the most
MCP-engaged population that exists; that makes a low reachability figure a
<em>conservative</em> one.</p>
<p><a href="${esc(censusUrl("/methodology"))}">Read the methodology</a> ·
<a href="${esc(censusUrl("/data"))}">Get the data</a> ·
<a href="${esc(censusUrl("/results"))}">See every domain</a></p>
${
  data.runFinishedAt === null
    ? ""
    : `<p class="note">Last complete run: ${esc(data.runFinishedAt)}. Methodology ${esc(METHODOLOGY_VERSION)}.</p>`
}

${ctaCard(data.chrome)}
`;

  return page({
    title: "The agent-reachable web, measured",
    description:
      "Of the organisations that provably run an MCP server, how many can an agent actually find? An open, reproducible census.",
    path: "/",
    ...(data.chrome === undefined ? {} : { chrome: data.chrome }),
    body,
  });
}

export function checkPage(options: {
  chrome?: PageChrome;
  domain?: string;
  result?: {
    apex: string;
    score: number | null;
    band: string | null;
    assessed: boolean;
    unassessedReason: string | null;
    checks: Array<{ check_id: string; status: string; detail: string | null }>;
    fixes: Array<{ title: string; detail: string }>;
    known: boolean;
  };
  error?: string;
}): string {
  const form = `
<form class="check" method="get" action="${esc(censusUrl("/check"))}">
  <label class="note" for="domain" hidden>Domain</label>
  <input id="domain" name="domain" type="text" inputmode="url" autocapitalize="off" spellcheck="false"
    placeholder="example.com" value="${esc(options.domain ?? "")}" required>
  <button class="btn" type="submit">Check it</button>
</form>`;

  let result = "";

  if (options.error !== undefined) {
    result = `<div class="card"><p>${esc(options.error)}</p></div>`;
  } else if (options.result !== undefined) {
    const r = options.result;
    const score = r.assessed ? `${r.score} / 100` : "not assessable";

    result = `
<div class="card">
  <p class="eyebrow">${esc(r.apex)}</p>
  <h2>${esc(score)}${r.band === null ? "" : ` — <span class="pill band">${esc(r.band)}</span>`}</h2>
  ${
    r.assessed
      ? ""
      : `<p>We could not assess this domain: <code>${esc(r.unassessedReason ?? "unknown")}</code>.
         That is a fact about our crawl, not a finding about the site.</p>`
  }
  <div class="scroll"><table>
    <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
    <tbody>${r.checks
      .map(
        (c) =>
          `<tr><td class="mono">${esc(c.check_id)}</td><td>${statusPill(c.status)}</td><td class="note">${esc(
            c.detail ?? "",
          )}</td></tr>`,
      )
      .join("")}</tbody>
  </table></div>
  ${
    r.known
      ? `<p class="note">From the census. <a href="${esc(censusUrl(`/d/${r.apex}`))}">Permalink and history</a>.</p>`
      : `<p class="note">This domain is not in a frozen universe, so it is recorded as
         self-submitted and is excluded from every published statistic.</p>`
  }
</div>

${
  r.fixes.length === 0
    ? ""
    : `<h2>The highest-value things to fix</h2>${r.fixes
        .map((f) => `<div class="fix"><h3>${esc(f.title)}</h3><p>${esc(f.detail)}</p></div>`)
        .join("")}`
}`;
  }

  const body = `
<p class="eyebrow">The lead magnet</p>
<h1>Are you in the census?</h1>
<p class="lede">Enter a domain. No sign-up, nothing stored against you, and the same probe that
produced every published number.</p>
${form}
${result}
<p class="note">We check what you published on purpose, at the locations a specification or a public
proposal told you to publish it. We never call a tool, never authenticate, and never test for
weaknesses — <a href="${esc(censusUrl("/crawler"))}">exactly what we do</a>.</p>

${
  // Only after a real measurement. On the empty form there is nothing to
  // react to yet, and leading with a pitch would read as the point of the page.
  options.result === undefined ? "" : ctaCard(options.chrome)
}
`;

  return page({
    title: options.domain ?? "Check a domain",
    description:
      "Check whether an AI agent could discover and connect to an MCP server for a domain.",
    path: "/check",
    ...(options.chrome === undefined ? {} : { chrome: options.chrome }),
    body,
  });
}

export const RESULTS_PAGE_SIZE = 100;

const LETTERS = [..."abcdefghijklmnopqrstuvwxyz", "#"];

/** Bands in narrative order, worst to best, with the unassessed bucket last. */
const BANDS = ["Absent", "Text-only", "Discoverable", "Connectable", "Agent-ready", "unassessed"];

export function resultsPage(data: {
  chrome?: PageChrome;
  rows: Array<{
    apex: string;
    score: number | null;
    band: string | null;
    unassessed_reason: string | null;
    universe: string;
  }>;
  total: number;
  offset: number;
  bandCounts: Array<{ band: string; n: number }>;
  letterCounts: Record<string, number>;
  universe?: string;
  band?: string;
  letter?: string;
}): string {
  const { total, offset } = data;
  const size = RESULTS_PAGE_SIZE;

  /** Build a results URL preserving the other filters. Omitted keys are cleared. */
  const url = (over: { universe?: string; band?: string; letter?: string; offset?: number }) => {
    const q = new URLSearchParams();
    const universe = "universe" in over ? over.universe : data.universe;
    const band = "band" in over ? over.band : data.band;
    const letter = "letter" in over ? over.letter : data.letter;
    if (universe !== undefined && universe !== "") q.set("universe", universe);
    if (band !== undefined && band !== "") q.set("band", band);
    if (letter !== undefined && letter !== "") q.set("letter", letter);
    if (over.offset !== undefined && over.offset > 0) q.set("offset", String(over.offset));
    const qs = q.toString();
    return censusUrl(qs === "" ? "/results" : `/results?${qs}`);
  };

  const chip = (label: string, href: string, active: boolean, n?: number) =>
    active
      ? `<span class="pill band">${esc(label)}${n === undefined ? "" : ` ${esc(n)}`}</span> `
      : `<a class="pill" href="${esc(href)}">${esc(label)}${n === undefined ? "" : ` ${esc(n)}`}</a> `;

  const byBand = new Map(data.bandCounts.map((b) => [b.band, b.n]));
  const universes: ReadonlyArray<readonly [string, string]> = [
    ["", "All"],
    ["R", "Registry organisations"],
    ["D", "AGNTCon cohort"],
  ];

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + size, total);
  const prev = offset - size;
  const next = offset + size;

  const body = `
<h1>Results</h1>
<p class="lede">Every domain in the newest complete run. We name domains, because a census that
does not is a survey.</p>

<h3>Population</h3>
<p>${universes.map(([v, l]) => chip(l, url({ universe: v, offset: 0 }), v === (data.universe ?? ""))).join("")}</p>

<h3>Band</h3>
<p>${chip("All bands", url({ band: "", offset: 0 }), data.band === undefined)}${BANDS.filter(
    (b) => (byBand.get(b) ?? 0) > 0,
  )
    .map((b) => chip(b, url({ band: b, offset: 0 }), data.band === b, byBand.get(b)))
    .join("")}</p>

<h3>Starts with</h3>
<p>${chip("Any", url({ letter: "", offset: 0 }), data.letter === undefined)}${LETTERS.map((l) => {
    const n = data.letterCounts[l] ?? 0;
    // Dimmed and unlinked when nothing matches, rather than offering a dead end.
    if (n === 0) return `<span class="pill skip">${esc(l)}</span> `;
    return chip(l, url({ letter: l, offset: 0 }), data.letter === l);
  }).join("")}</p>

<p class="note">${
    total === 0
      ? "Nothing matches this combination."
      : `Showing ${esc(from)}\u2013${esc(to)} of ${esc(total)} domains.`
  }</p>

<div class="scroll"><table>
<thead><tr><th>Domain</th><th class="num">Score</th><th>Band</th><th>Universe</th></tr></thead>
<tbody>
${data.rows
  .map(
    (r) => `<tr>
<td><a href="${esc(censusUrl(`/d/${r.apex}`))}">${esc(r.apex)}</a></td>
<td class="num">${r.score === null ? "\u2014" : esc(r.score)}</td>
<td>${r.band === null ? `<span class="pill skip">${esc(r.unassessed_reason ?? "not assessed")}</span>` : `<span class="pill band">${esc(r.band)}</span>`}</td>
<td class="note">${esc(r.universe)}</td>
</tr>`,
  )
  .join("\n")}
</tbody></table></div>

<nav class="pager">
${prev >= 0 ? `<a class="pill" href="${esc(url({ offset: prev }))}">\u2190 Previous</a>` : `<span class="pill skip">\u2190 Previous</span>`}
${next < total ? `<a class="pill" href="${esc(url({ offset: next }))}">Next \u2192</a>` : `<span class="pill skip">Next \u2192</span>`}
</nav>

<p class="note">Every row is reachable: filter by band or first letter, or page through.
The full dataset is also a <a href="${esc(censusUrl("/data"))}">single download</a>, which is
usually the faster way to answer a question about thousands of domains.</p>
<p class="note">Think a row is wrong? It probably is \u2014 <a href="${esc(censusUrl("/crawler"))}">tell us</a>,
or open an issue. Being publicly wrong about a named domain is the failure we care most about.</p>
${ctaCard(data.chrome)}
`;

  return page({
    title: "Results",
    description: "Every domain measured by the MCP Census, with its score and band.",
    path: "/results",
    ...(data.chrome === undefined ? {} : { chrome: data.chrome }),
    body,
  });
}

export function domainPage(data: {
  chrome?: PageChrome;
  apex: string;
  score: number | null;
  band: string | null;
  assessed: number;
  unassessedReason: string | null;
  universe: string;
  methodologyVersion: string;
  finishedAt: string | null;
  checks: Array<{ check_id: string; status: string; detail: string | null }>;
  history: Array<{ run_id: number; score: number | null }>;
}): string {
  const body = `
<p class="eyebrow">${esc(data.universe === "D" ? "AGNTCon cohort" : "Registry organisation")}</p>
<h1>${esc(data.apex)}</h1>

<div class="headline">
  <span class="big">${data.assessed === 1 ? esc(data.score) : "—"}</span>
  <p class="said">${
    data.assessed === 1
      ? `out of 100 — <span class="pill band">${esc(data.band ?? "")}</span>`
      : `not assessable: <code>${esc(data.unassessedReason ?? "unknown")}</code>`
  }</p>
</div>

<div class="scroll"><table>
<thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
<tbody>${data.checks
    .map(
      (c) =>
        `<tr><td class="mono">${esc(c.check_id)}</td><td>${statusPill(c.status)}</td><td class="note">${esc(c.detail ?? "")}</td></tr>`,
    )
    .join("")}</tbody>
</table></div>

${
  data.history.length > 1
    ? `<h2>History</h2><figure>${barChart(
        data.history
          .slice()
          .reverse()
          .map((h) => ({ label: `run ${h.run_id}`, value: h.score ?? 0 })),
        { max: 100 },
      )}<figcaption>Score by run. A change is only published once it persists across two consecutive runs.</figcaption></figure>`
    : ""
}

<h2>Badge</h2>
<p><img src="${esc(censusUrl(`/badge/${data.apex}.svg`))}" alt="MCP Census score for ${esc(data.apex)}" width="176" height="20"></p>
<p class="note mono">${esc(censusUrl(`/badge/${data.apex}.svg`))}</p>

<p class="note">Measured with methodology ${esc(data.methodologyVersion)}${
    data.finishedAt === null ? "" : ` on ${esc(data.finishedAt)}`
  }. Wrong? <a href="${esc(censusUrl("/crawler"))}">Tell us</a> — we would rather hear it from you.</p>

${ctaCard(data.chrome)}
`;

  return page({
    title: data.apex,
    description: `Whether an AI agent could discover and connect to an MCP server for ${data.apex}.`,
    path: `/d/${data.apex}`,
    ...(data.chrome === undefined ? {} : { chrome: data.chrome }),
    body,
  });
}

/** An SVG badge. Fixed geometry so it needs no text measurement. */
export function badgeSvg(label: string, value: string, colour: string): string {
  const labelW = 92;
  const valueW = Math.max(34, value.length * 8 + 16);
  const total = labelW + valueW;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${total}" height="20" rx="3" fill="#3a3040"/>
<rect x="${labelW}" width="${valueW}" height="20" rx="3" fill="${esc(colour)}"/>
<rect x="${labelW}" width="4" height="20" fill="${esc(colour)}"/>
<g font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" fill="#fff">
<text x="6" y="14">${esc(label)}</text>
<text x="${labelW + 8}" y="14">${esc(value)}</text>
</g>
</svg>`;
}

export function staticPage(options: {
  title: string;
  path: string;
  description: string;
  body: string;
  chrome?: PageChrome;
}): string {
  return page(options);
}

export const CENSUS_BUILD = { CENSUS_VERSION, METHODOLOGY_VERSION };

export function changesPage(data: {
  chrome?: PageChrome;
  changes: Array<{
    apex: string;
    check_id: string;
    from_status: string;
    to_status: string;
    confirmed_at: string;
    category: string;
  }>;
  adoption: Array<{ run_id: number; metric: string; value: number; denominator: number }>;
}): string {
  const CHECK_WORDS: Record<string, string> = {
    D1: "server card",
    D2: "DNS discovery",
    D3: "conventional endpoint",
    D4: "RFC 9728 metadata",
    D5: "handshake",
    D6: "tool listing",
    Q1: "tool surface quality",
    F1: "text fallbacks",
    F2: "declared crawler posture",
  };

  const body = `
<h1>What changed</h1>
<p class="lede">A change appears here only after it has persisted across two consecutive complete
runs. During the pilot a domain answered us and then refused an hour later, purely from bot
mitigation — at these base rates that kind of flapping produces more apparent change than real
adoption does, so a raw feed would be mostly false. The cost is that we are about a day behind
reality, which is the better trade.</p>

${
  data.changes.length === 0
    ? `<div class="card"><p>Nothing confirmed yet. The first run is a baseline, not a set of
       changes — publishing it as changes would announce the entire census as news.</p></div>`
    : `<div class="scroll"><table>
<thead><tr><th>Domain</th><th>What</th><th>Change</th><th>Confirmed</th></tr></thead>
<tbody>${data.changes
        .map(
          (c) => `<tr>
<td><a href="${esc(censusUrl(`/d/${c.apex}`))}">${esc(c.apex)}</a></td>
<td>${esc(CHECK_WORDS[c.check_id] ?? c.check_id)}</td>
<td>${
            c.to_status === "pass"
              ? '<span class="pill pass">started</span>'
              : '<span class="pill fail">stopped</span>'
          }</td>
<td class="note">${esc(c.confirmed_at.slice(0, 10))}</td>
</tr>`,
        )
        .join("")}</tbody></table></div>`
}

<h2>Adoption over time</h2>
${
  data.adoption.length === 0
    ? '<p class="note">Needs at least two complete runs.</p>'
    : `<figure>${barChart(
        data.adoption.map((a) => ({
          label: `run ${a.run_id} ${a.metric.replace("candidate:", "")}`,
          value: a.denominator === 0 ? 0 : Math.round((a.value / a.denominator) * 1000) / 10,
        })),
        { unit: "%" },
      )}<figcaption>Share of assessed domains, by run.</figcaption></figure>`
}
`;

  return page({
    title: "What changed",
    description: "Confirmed changes in MCP adoption, debounced across two consecutive runs.",
    path: "/changes",
    ...(data.chrome === undefined ? {} : { chrome: data.chrome }),
    body,
  });
}
