/**
 * Routing for everything under `/census/`.
 *
 * Server-rendered with the Cache API and `stale-while-revalidate`, because
 * thousands of per-domain permalinks need to be crawlable and fast. No SPA, no
 * client JS, and every response carries the full security header set.
 */

import {
  CANDIDATES_VERSION,
  CENSUS_BASE_PATH,
  censusUrl,
  METHODOLOGY_VERSION,
  resolveTheme,
  themeScript,
} from "@mcp-census/core";
import { normaliseDomain, runCheck, withinRateLimit } from "./check.js";
import type { Env } from "./env.js";
import {
  adoptionSeries,
  bandCounts,
  candidateDistribution,
  domainDetail,
  headline,
  latestRun,
  leaderboard,
  leaderboardCount,
  letterCounts,
  recentChanges,
  registryGrowth,
} from "./queries.js";
import { esc, type PageChrome } from "./web/layout.js";
import {
  badgeSvg,
  changesPage,
  checkPage,
  domainPage,
  landingPage,
  RESULTS_PAGE_SIZE,
  resultsPage,
  staticPage,
} from "./web/pages.js";
import { censusStylesheet } from "./web/styles.js";

const HTML = "text/html; charset=utf-8";

/** Cached at the edge, revalidated in the background, so a warm hit is fast. */
function cacheable(body: string, contentType: string, maxAge: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
    },
  });
}

function notFound(message: string, chrome: PageChrome): Response {
  return new Response(
    staticPage({
      chrome,
      title: "Not found",
      description: "Not found.",
      path: "/",
      body: `<h1>Not found</h1><p>${esc(message)}</p><p><a href="${esc(censusUrl("/"))}">Back to the census</a></p>`,
    }),
    { status: 404, headers: { "content-type": HTML } },
  );
}

function relative(pathname: string): string {
  const rest = pathname.slice(CENSUS_BASE_PATH.length);
  return rest === "" ? "/" : rest;
}

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = relative(url.pathname);

  const theme = resolveTheme(env.CENSUS_THEME);
  const hasThemeKey = env.THEME_STORAGE_KEY !== undefined && env.THEME_STORAGE_KEY !== "";
  const chrome = { theme, themeScript: theme.honourDataTheme && hasThemeKey };

  if (path === "/assets/census.css") {
    return cacheable(censusStylesheet(theme), "text/css; charset=utf-8", 86400);
  }

  // Only served when a surrounding site actually has an override to mirror.
  // Without the key there is nothing to read, so we 404 rather than ship a
  // script that provably does nothing.
  if (path === "/assets/theme.js") {
    const key = env.THEME_STORAGE_KEY;
    if (key === undefined || key === "") return new Response("Not found", { status: 404 });
    return cacheable(themeScript(key), "text/javascript; charset=utf-8", 86400);
  }

  // Release downloads, streamed from R2.
  //
  // An allowlist of filenames rather than a pass-through: the bucket also holds
  // per-scan evidence blobs, and a route that forwarded any key would publish
  // them. Releases are immutable once cut, so they are cached hard.
  const release = /^\/data\/(\d{4}-\d{2}-\d{2})\/([\w.-]+)$/.exec(path);
  if (release !== null) {
    const [, date, file] = release;
    const ALLOWED = new Set([
      "summary.json",
      "census.csv",
      "census.jsonl.gz",
      "universe.csv",
      "to-parquet.sql",
      "README.md",
      "zenodo.json",
    ]);
    if (file === undefined || !ALLOWED.has(file)) {
      return notFound("That is not a file in a census release.", chrome);
    }
    const object = await env.ARTIFACTS.get(`releases/${date}/${file}`);
    if (object === null)
      return notFound(`There is no ${esc(file)} in the ${esc(date)} release.`, chrome);

    const TYPES: Record<string, string> = {
      ".json": "application/json; charset=utf-8",
      ".csv": "text/csv; charset=utf-8",
      ".gz": "application/gzip",
      ".sql": "text/plain; charset=utf-8",
      ".md": "text/markdown; charset=utf-8",
    };
    const ext = file.slice(file.lastIndexOf("."));
    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        // Immutable by policy: a correction ships as a new dated release.
        "cache-control": "public, max-age=31536000, immutable",
        "content-disposition": `attachment; filename="mcp-census-${date}-${file}"`,
      },
    });
  }

  if (path === "/health") {
    const runs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs`).first<{ n: number }>();
    const scans = await env.DB.prepare(`SELECT COUNT(*) AS n FROM scans`).first<{ n: number }>();
    return new Response(
      JSON.stringify(
        { status: "ok", methodologyVersion: METHODOLOGY_VERSION, runs: runs?.n, scans: scans?.n },
        null,
        2,
      ),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  if (path === "/") {
    const run = await latestRun(env);
    if (run === null) {
      return cacheable(
        landingPage({
          chrome,
          headline: {
            assessed: 0,
            unassessed: 0,
            anyDiscovery: 0,
            card: 0,
            confirmed: 0,
            nothing: 0,
          },
          candidates: [],
          runFinishedAt: null,
        }),
        HTML,
        60,
      );
    }
    const [h, candidates, growth] = await Promise.all([
      headline(env, run.id),
      candidateDistribution(env, run.id),
      registryGrowth(env),
    ]);
    return cacheable(
      landingPage({
        chrome,
        headline: h,
        candidates,
        runFinishedAt: run.finished_at,
        registryGrowth: growth,
      }),
      HTML,
      600,
    );
  }

  if (path === "/changes") {
    const [changes, adoption] = await Promise.all([recentChanges(env, 100), adoptionSeries(env)]);
    return cacheable(changesPage({ chrome, changes, adoption }), HTML, 600);
  }

  if (path === "/results") {
    const param = (k: string) => {
      const v = url.searchParams.get(k);
      return v === null || v === "" ? undefined : v;
    };
    const universe = param("universe");
    const band = param("band");
    // Lower-cased and length-checked so an arbitrary query string cannot widen
    // the filter; anything else is simply ignored rather than erroring.
    const rawLetter = param("letter")?.toLowerCase();
    const letter =
      rawLetter !== undefined && (rawLetter === "#" || /^[a-z]$/.test(rawLetter))
        ? rawLetter
        : undefined;
    const parsedOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
    const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    const filter = {
      ...(universe === undefined ? {} : { universe }),
      ...(band === undefined ? {} : { band }),
      ...(letter === undefined ? {} : { letter }),
    };

    const run = await latestRun(env);
    if (run === null) {
      return cacheable(
        resultsPage({ chrome, rows: [], total: 0, offset: 0, bandCounts: [], letterCounts: {} }),
        HTML,
        60,
      );
    }

    const [rows, total, bands, letters] = await Promise.all([
      leaderboard(env, run.id, { ...filter, limit: RESULTS_PAGE_SIZE, offset }),
      leaderboardCount(env, run.id, filter),
      bandCounts(env, run.id, universe === undefined ? {} : { universe }),
      // Letter tallies ignore the letter filter itself, so the index keeps
      // showing every reachable letter rather than only the selected one.
      letterCounts(env, run.id, {
        ...(universe === undefined ? {} : { universe }),
        ...(band === undefined ? {} : { band }),
      }),
    ]);

    return cacheable(
      resultsPage({
        chrome,
        rows,
        total,
        offset,
        bandCounts: bands,
        letterCounts: letters,
        ...filter,
      }),
      HTML,
      600,
    );
  }

  if (path === "/check") {
    const raw = url.searchParams.get("domain");
    if (raw === null || raw.trim() === "") {
      return cacheable(checkPage({ chrome }), HTML, 3600);
    }

    const apex = normaliseDomain(raw);
    if (apex === undefined) {
      return new Response(
        checkPage({
          chrome,
          domain: raw,
          error: "That does not look like a domain name. Try example.com.",
        }),
        { status: 400, headers: { "content-type": HTML } },
      );
    }

    // Keyed on the connecting IP so the magnet cannot be used to make us crawl
    // the web on somebody else's behalf.
    const clientKey = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await withinRateLimit(env, clientKey))) {
      return new Response(
        checkPage({
          chrome,
          domain: apex,
          error: "That is a lot of checks in a short time. Try again in a few minutes.",
        }),
        { status: 429, headers: { "content-type": HTML } },
      );
    }

    const result = await runCheck(env, apex);
    // Not cached at the edge: it is per-visitor and already cached in KV.
    return new Response(checkPage({ chrome, domain: apex, result }), {
      status: 200,
      headers: { "content-type": HTML, "cache-control": "private, no-store" },
    });
  }

  if (path.startsWith("/d/")) {
    const apex = normaliseDomain(decodeURIComponent(path.slice(3)));
    if (apex === undefined) return notFound("That is not a domain name we could parse.", chrome);

    const detail = await domainDetail(env, apex);
    if (detail === null) {
      return notFound(
        `${apex} is not in the census yet. You can check it on the check page instead.`,
        chrome,
      );
    }

    return cacheable(
      domainPage({
        chrome,
        apex: detail.apex,
        score: detail.score,
        band: detail.band,
        assessed: detail.assessed,
        unassessedReason: detail.unassessed_reason,
        universe: detail.universe,
        methodologyVersion: detail.methodology_version,
        finishedAt: detail.finished_at,
        checks: detail.checks,
        history: detail.history,
      }),
      HTML,
      600,
    );
  }

  if (path.startsWith("/badge/") && path.endsWith(".svg")) {
    const apex = normaliseDomain(decodeURIComponent(path.slice(7, -4)));
    if (apex === undefined) {
      return new Response(badgeSvg("mcp census", "invalid", "#9c2b2b"), {
        status: 400,
        headers: { "content-type": "image/svg+xml; charset=utf-8" },
      });
    }

    const detail = await domainDetail(env, apex);
    const value =
      detail === null
        ? "not measured"
        : detail.assessed === 1
          ? `${detail.score}/100`
          : "not assessed";
    const colour =
      detail === null || detail.assessed !== 1
        ? "#7d7188"
        : (detail.score ?? 0) >= 70
          ? "#1b7f4b"
          : (detail.score ?? 0) >= 31
            ? "#a86b00"
            : "#9c2b2b";

    return cacheable(badgeSvg("mcp census", value, colour), "image/svg+xml; charset=utf-8", 3600);
  }

  const staticRoute = STATIC_PAGES[path];
  if (staticRoute !== undefined) return cacheable(staticRoute(chrome), HTML, 3600);

  return notFound("There is no page at that address.", chrome);
}

const REPO = "https://github.com/radixia/mcp-census";

/**
 * The newest cut release.
 *
 * Hard-coded rather than derived from R2, because a release is a deliberate
 * editorial act: files land in the bucket first and are announced here second,
 * so an interrupted upload cannot publish a half-release. Sizes are stated so a
 * reader can tell a truncated download from a complete one.
 */
const LATEST_RELEASE = {
  date: "2026-08-05",
  domains: 7422,
  assessed: 7421,
  methodology: METHODOLOGY_VERSION,
  candidates: CANDIDATES_VERSION,
  files: [
    { name: "summary.json", what: "The headline numbers and per-check pass rates", size: "805 B" },
    { name: "census.csv", what: "One row per domain: score, band, every check", size: "800 KB" },
    {
      name: "census.jsonl.gz",
      what: "Per-domain rows with full evidence, one JSON object per line",
      size: "1.6 MB",
    },
    { name: "universe.csv", what: "The frozen population, with provenance", size: "437 KB" },
    { name: "to-parquet.sql", what: "DuckDB script: any of the above to Parquet", size: "621 B" },
    { name: "README.md", what: "What is in the release and how to cite it", size: "1.7 KB" },
    { name: "zenodo.json", what: "Deposition metadata for archiving", size: "1.1 KB" },
  ],
} as const;

const STATIC_PAGES: Record<string, (chrome: PageChrome) => string> = {
  "/methodology": (chrome) =>
    staticPage({
      chrome,
      title: "Methodology",
      description: "How the MCP Census measures, scores, and what weakens its own findings.",
      path: "/methodology",
      body: `
<h1>Methodology</h1>
<p class="lede">Versioned, published before any score, and argued with in public. Currently
<code>${esc(METHODOLOGY_VERSION)}</code>.</p>

<h2>Conflict of interest — read this first</h2>
<p>This census is run by <a href="https://www.radixia.ai">Radixia</a>, a commercial AI and cloud
consultancy, and <code>radixia.ai</code> is <strong>included in the measured population</strong>
rather than excluded from it. We sell services related to the thing being measured and have an
obvious interest in the subject appearing important. Prior work in this space tends to exclude the
authors' own properties; excluding ourselves precisely where we happen to score well would read as
less honest, not more. Discount our own row accordingly — everything needed to check it is public.</p>
<p>Our own row has been wrong twice, and both are recorded in the repository: a catch-all that made
a correct absence look like a broken document, and two server cards on paths that no current
specification names.</p>

<h2>What is measured</h2>
<p>For each domain in a frozen population: could an agent, starting from nothing but the domain
name, discover and connect to an MCP server for that brand? It is a census, not a site audit, and
emphatically <strong>not</strong> a security assessment.</p>

<h2>Scoring, in one sentence</h2>
<p>A domain earns 70 of 100 points for being connectable at all, and the remaining 30 for the
quality of what an agent finds once connected. Discovery is weighted far above everything else
because that is the census question.</p>
<p>Discovery tiers are exclusive: a confirmed handshake is 70, a published discovery document 35,
and an endpoint-shaped 405 only 20 — a 405 is consistent with any POST-only endpoint, so on its own
it is a hint rather than a finding.</p>

<h2>When we refuse to score</h2>
<p>A domain gets <strong>no score at all</strong> — not a zero — when we were not permitted or not
able to look. Recording our own exclusion as a negative would publish a finding about our crawl
dressed up as a finding about somebody's site. Unassessed domains are their own category and are
excluded from every denominator.</p>

<h2>Limitations that weaken our own findings</h2>
<p>The full list lives with the methodology in the repository and is not a formality. The ones that
matter most: a negative is not proof of absence, because a brand may be reachable through a
marketplace or private agreement; we see one vantage point, so bot mitigation makes some rows
time-dependent; a <code>D4</code> failure is inconclusive, since RFC 9728 binds only servers that
implement authorization and authorization is itself optional; and the population is
registry-derived, so it measures organisations that both run <em>and</em> registered a server.</p>

<p><a href="${REPO}/blob/main/METHODOLOGY.md">The full methodology</a> ·
<a href="${REPO}/blob/main/docs/SPEC-NOTES.md">what the specification actually says today</a> ·
<a href="${REPO}/tree/main/docs/DECISIONS">the decisions and why</a></p>`,
    }),

  "/data": (chrome) =>
    staticPage({
      chrome,
      title: "Data",
      description: "The raw per-domain dataset, openly licensed and reproducible.",
      path: "/data",
      body: `
<h1>Data</h1>
<p class="lede">The whole point is that you can check our work. Code is Apache-2.0, data is
CC-BY-4.0, and a stranger should be able to reproduce the headline number.</p>

<h2>Reproducing it</h2>
<p>The population is derived from the official MCP Registry's own public API, so — unlike anything
built on a ranked domain list — the frozen universe can be republished in full and you do not need
to source a licensed input to repeat the work.</p>
<pre class="mono">git clone ${REPO}
pnpm install &amp;&amp; pnpm test</pre>

<h2>What is published</h2>
<p>Per-domain rows with every check result, the frozen input universes with their provenance and
download dates, and the methodology version that produced each row. Releases are immutable
snapshots; corrections appear in the next release rather than rewriting a citable one.</p>

<h2>Download the ${LATEST_RELEASE.date} release</h2>
<p>${esc(LATEST_RELEASE.domains.toLocaleString("en"))} domains, ${esc(
        LATEST_RELEASE.assessed.toLocaleString("en"),
      )} assessed. Methodology ${esc(LATEST_RELEASE.methodology)}, candidate set ${esc(
        LATEST_RELEASE.candidates,
      )}.
Immutable: a correction ships as a new dated release rather than rewriting this one.</p>

<div class="scroll"><table>
<thead><tr><th>File</th><th>What it is</th><th class="num">Size</th></tr></thead>
<tbody>
${LATEST_RELEASE.files
  .map(
    (f) => `<tr>
<td><a href="${esc(censusUrl(`/data/${LATEST_RELEASE.date}/${f.name}`))}"><code>${esc(f.name)}</code></a></td>
<td>${esc(f.what)}</td>
<td class="num">${esc(f.size)}</td>
</tr>`,
  )
  .join("\n")}
</tbody></table></div>

<p class="note">The per-domain rows are gzipped JSONL rather than JSON: same data, one object per
line, and 33.5&nbsp;MB becomes 1.6&nbsp;MB. <code>to-parquet.sql</code> turns any of it into Parquet
with DuckDB, so nobody has to trust a query service of ours to re-derive a statistic.</p>

<p><a href="${REPO}/tree/main/data/universe">Frozen universes</a> ·
<a href="${REPO}/tree/main/data/releases">Releases in git</a> ·
<a href="${REPO}">The code</a></p>`,
    }),

  "/crawler": (chrome) =>
    staticPage({
      chrome,
      title: "Crawler",
      description: "What the MCP Census crawler does, and how to be excluded from it.",
      path: "/crawler",
      body: `
<h1>Crawler ethics</h1>
<p class="lede">This page is linked from every request we send. If you found us in an access log,
you are in the right place.</p>
<p><strong>Contact:</strong> <code>census@radixia.ai</code></p>

<h2>This is not a security scanner</h2>
<p>We never call an MCP tool, never send an <code>Authorization</code> header or any credential,
never attempt authentication, never fuzz or brute-force anything, and never probe a path that is not
on our published candidate list. Every request is a plain unauthenticated read of a document you
published on purpose, at a location a specification or a public proposal told you to publish it.</p>

<h2>How politely</h2>
<ul>
<li><strong>One request per second</strong>, maximum, per domain.</li>
<li><strong>At most 64 domains</strong> in flight crawl-wide — that bounds how many
<em>different</em> sites we visit at once; yours never sees more than the rate above.</li>
<li>5s connect, 10s total timeout. Exponential backoff on 429 and 5xx, then we give up.</li>
<li>One redirect hop, and only if it stays on your domain.</li>
<li><code>robots.txt</code> respected for <strong>every</strong> path, including
<code>.well-known</code>. <code>Crawl-delay</code> honoured when stricter than our own limit.</li>
</ul>

<h2>How to opt out</h2>
<p>Any one of these works, and we honour it within 24 hours for your domain and all subdomains:</p>
<ul>
<li>Email <code>census@radixia.ai</code> — one line is enough.</li>
<li>Disallow us: <code>User-agent: MCPCensus</code> then <code>Disallow: /</code></li>
<li>Open a pull request against <a href="${REPO}/blob/main/data/optouts.txt">data/optouts.txt</a>.</li>
</ul>
<p>If you are already in a published dataset when you opt out, we remove your rows from the live
site and from later releases. We will not rewrite an already-citable frozen snapshot, because that
would break the reproducibility the project rests on — but we note the removal.</p>

<h2>Corrections</h2>
<p>If we got something wrong about your domain we would rather hear it than not. Being publicly
wrong about a named domain is the failure mode we care most about avoiding.</p>

<p><a href="${REPO}/blob/main/docs/CRAWLER-ETHICS.md">The full ethics document</a></p>`,
    }),

  "/agntcon-2026": (chrome) =>
    staticPage({
      chrome,
      title: "AGNTCon + MCPCon Europe 2026",
      description: "How the AGNTCon + MCPCon Europe sponsors and speakers score.",
      path: "/agntcon-2026",
      body: `
<h1>AGNTCon + MCPCon Europe 2026</h1>
<p class="lede">17–18 September 2026, RAI Amsterdam. The sponsors and speaking organisations are
their own frozen universe, compiled from the public programme.</p>
<p>This is the one cohort that cannot argue MCP is irrelevant to them — and it looks nothing like
the open web. Server cards are an order of magnitude more common here, and the only adopters we
have found anywhere of <code>/.well-known/ai-catalog.json</code>, the location the current proposal
actually defers to, are in this list.</p>
<p><a href="${esc(censusUrl("/results?universe=D"))}">See the cohort's results</a></p>
<p class="note">Compiled from the published programme on 2026-08-05. Several domain mappings are
inferred rather than confirmed and are flagged as such in the frozen universe; they are safe for
aggregate statistics and are hand-checked before any row names a company.</p>
<p><a href="${REPO}/blob/main/data/universe/D-agntcon-mcpcon-europe-2026.provenance.md">Provenance</a></p>`,
    }),
};
