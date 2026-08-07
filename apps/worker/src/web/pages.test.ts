import { censusUrl, NEUTRAL_THEME, RADIXIA_THEME, THEMES } from "@mcp-census/core";
import { describe, expect, it } from "vitest";
import { fixesFor, normaliseDomain } from "../check.js";
import { discoveryGraph, stateOf } from "./graph.js";

import { areaChart, barChart, ctaCard, esc, page } from "./layout.js";
import { badgeSvg, checkPage, domainPage, landingPage, resultsPage } from "./pages.js";
import { censusStylesheet, STRUCTURE_CSS } from "./styles.js";

const HEADLINE = {
  assessed: 400,
  unassessed: 12,
  anyDiscovery: 133,
  card: 69,
  confirmed: 8,
  nothing: 267,
};

describe("escaping", () => {
  it("escapes everything that could break out of markup", () => {
    expect(esc(`<script>alert("x")&'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;");
  });

  it("escapes a hostile domain name before it reaches a page", () => {
    // A domain arrives from a query string, so this is the injection path that
    // matters most.
    const html = domainPage({
      apex: '"><script>alert(1)</script>',
      score: 0,
      band: "Absent",
      assessed: 1,
      unassessedReason: null,
      universe: "R",
      methodologyVersion: "0.2.0-draft",
      finishedAt: null,
      checks: [],
      history: [],
    });

    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("pages render without JavaScript", () => {
  const pages = [
    ["landing", landingPage({ headline: HEADLINE, candidates: [], runFinishedAt: null })],
    ["check", checkPage({})],
    ["results", resultsPage({ rows: [], total: 0, offset: 0, bandCounts: [], letterCounts: {} })],
  ] as const;

  it.each(pages)("%s has no script tag at all", (_name, html) => {
    expect(html).not.toMatch(/<script/i);
  });

  it.each(pages)("%s has no inline style, which the CSP forbids", (_name, html) => {
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle="/i);
  });

  it.each(pages)("%s links the external stylesheet on the canonical host", (_name, html) => {
    expect(html).toContain('href="https://www.radixia.ai/census/assets/census.css"');
  });

  it.each(pages)("%s declares a canonical URL on the www host", (_name, html) => {
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/www\.radixia\.ai\/census/);
  });

  it.each(pages)("%s never emits a bare-apex URL", (_name, html) => {
    // A zone Redirect Rule would 301 it, but a printed or mailed URL is never
    // re-canonicalised, so we must not emit one.
    expect(html).not.toMatch(/https:\/\/radixia\.ai/);
  });
});

describe("the headline", () => {
  it("leads with the share that publish nothing findable", () => {
    const html = landingPage({ headline: HEADLINE, candidates: [], runFinishedAt: null });
    expect(html).toContain("67%");
    expect(html).toContain("267 of 400");
  });

  it("does not divide by zero before the first run", () => {
    const html = landingPage({
      headline: { assessed: 0, unassessed: 0, anyDiscovery: 0, card: 0, confirmed: 0, nothing: 0 },
      candidates: [],
      runFinishedAt: null,
    });
    expect(html).toContain("—");
    expect(html).not.toContain("NaN");
  });

  it("names each candidate path with its provenance", () => {
    const html = landingPage({
      headline: HEADLINE,
      candidates: [
        { candidate_id: "mcp-json", n: 44 },
        { candidate_id: "ai-catalog", n: 6 },
      ],
      runFinishedAt: null,
    });

    expect(html).toContain("/.well-known/mcp.json");
    expect(html).toContain("superseded");
    expect(html).toContain("current direction");
  });
});

describe("the check page", () => {
  it("works as a plain GET form, no JS required", () => {
    const html = checkPage({});
    expect(html).toContain('method="get"');
    expect(html).toContain('name="domain"');
  });

  it("shows an unassessed domain as a fact about our crawl", () => {
    const html = checkPage({
      domain: "blocked.test",
      result: {
        apex: "blocked.test",
        score: null,
        band: null,
        assessed: false,
        unassessedReason: "skipped_by_robots",
        checks: [],
        fixes: [],
        known: true,
      },
    });

    expect(html).toContain("not assessable");
    expect(html).toContain("not a finding about the site");
  });

  it("labels a self-submitted domain as excluded from the statistics", () => {
    const html = checkPage({
      domain: "new.test",
      result: {
        apex: "new.test",
        score: 10,
        band: "Text-only",
        assessed: true,
        unassessedReason: null,
        checks: [],
        fixes: [],
        known: false,
      },
    });

    expect(html).toContain("self-submitted");
    expect(html).toContain("excluded from every published statistic");
  });
});

describe("fixes offered", () => {
  it("offers the current spec path first when no card exists", () => {
    const fixes = fixesFor([{ check_id: "D1", status: "fail" }]);
    expect(fixes[0]?.title).toContain("ai-catalog.json");
  });

  it("offers at most three, so the advice stays actionable", () => {
    const fixes = fixesFor(
      ["D1", "D3", "D5", "F1", "F2"].map((id) => ({ check_id: id, status: "fail" })),
    );
    expect(fixes).toHaveLength(3);
  });

  it("offers nothing when everything passes", () => {
    const fixes = fixesFor(
      ["D1", "D3", "D5", "F1", "F2"].map((id) => ({ check_id: id, status: "pass" })),
    );
    expect(fixes).toEqual([]);
  });
});

describe("domain normalisation", () => {
  it.each([
    ["example.com", "example.com"],
    ["EXAMPLE.COM", "example.com"],
    ["  example.com  ", "example.com"],
    ["https://example.com", "example.com"],
    ["https://www.example.com/some/path", "example.com"],
    ["example.com:8443", "example.com"],
    ["mcp.example.co.uk", "mcp.example.co.uk"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected);
  });

  it.each(["", "   ", "not a domain", "localhost", "../etc/passwd", "a..b", "-x.com", "x-.com"])(
    "rejects %s",
    (input) => {
      expect(normaliseDomain(input)).toBeUndefined();
    },
  );

  it("rejects anything carrying a path, so a check cannot become a probe", () => {
    expect(normaliseDomain("example.com/../../admin")).toBe("example.com");
  });
});

describe("badge", () => {
  it("is self-contained SVG with an accessible label", () => {
    const svg = badgeSvg("mcp census", "85/100", "#1b7f4b");
    expect(svg).toContain("<svg");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>mcp census: 85/100</title>");
    expect(svg).not.toContain("<script");
  });

  it("escapes its inputs", () => {
    expect(badgeSvg("x", '"><script>', "#000")).not.toContain("<script>");
  });
});

describe("charts", () => {
  it("renders inline SVG with no library and no script", () => {
    const svg = barChart([{ label: "a", value: 3 }]);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<script");
  });

  it("renders nothing rather than an empty frame", () => {
    expect(barChart([])).toBe("");
  });

  it("never produces a zero-width bar for a nonzero value", () => {
    const svg = barChart([{ label: "tiny", value: 1 }], { max: 10_000 });
    expect(svg).toMatch(/width="[1-9]/);
  });
});

describe("stylesheet", () => {
  const neutral = censusStylesheet(NEUTRAL_THEME);
  const radixia = censusStylesheet(RADIXIA_THEME);

  it("has no brand-specific token names in the structural layer", () => {
    // The structure must be re-themable by supplying values, never by editing
    // rules. A `--magenta` here would mean a fork has to fork the CSS too.
    for (const brandy of ["--magenta", "--violet", "--od-", "--dark-panel", "--link-hover"]) {
      expect(STRUCTURE_CSS).not.toContain(brandy);
    }
  });

  it("resolves every var(--token) it uses, in every theme", () => {
    // CSS does not error on an undefined custom property: the declaration is
    // invalid at computed-value time and silently falls back to the initial
    // value, so a colour turns black and nothing appears in any log. This test
    // exists because exactly that happened — barChart kept filling bars with
    // var(--magenta) after the rename, which renders them transparent.
    // Scan the structural CSS *and* rendered markup: inline SVG carries
    // fill="var(--accent)" attributes, and that is precisely where the bug was.
    const rendered = [
      STRUCTURE_CSS,
      // Non-empty candidates so barChart actually emits its <rect fill=…>.
      landingPage({
        headline: HEADLINE,
        candidates: [{ candidate_id: "mcp-json", n: 839 }],
        runFinishedAt: "2026-08-05T10:26:00Z",
      }),
      resultsPage({
        rows: [
          {
            apex: "example.com",
            score: 85,
            band: "Connectable",
            unassessed_reason: null,
            universe: "R",
          },
        ],
        total: 1,
        offset: 0,
        bandCounts: [{ band: "Connectable", n: 1 }],
        letterCounts: { e: 1 },
      }),
      checkPage({}),
    ].join("\n");
    const used = new Set(
      [...rendered.matchAll(/var\((--[\w-]+)/g)].map((m) => (m[1] as string).slice(2)),
    );
    expect(used.size).toBeGreaterThan(10);
    for (const theme of Object.values(THEMES)) {
      for (const token of used) {
        expect(Object.keys(theme.tokens), `${theme.id} is missing --${token}`).toContain(token);
      }
    }
  });

  it("defaults to neutral, never to somebody else's brand", () => {
    // A fork that deploys this must not ship Radixia's identity by accident.
    expect(neutral).not.toContain("#d6117e");
    expect(neutral).not.toContain("Fraunces");
    expect(neutral).not.toContain("@font-face");
    expect(page({ title: "x", description: "d", path: "/", body: "" })).not.toContain("Radixia");
  });

  it("supports dark mode in both themes", () => {
    expect(neutral).toContain("prefers-color-scheme: dark");
    expect(radixia).toContain("prefers-color-scheme: dark");
  });

  it("honours a forced light choice, not just the system preference", () => {
    // The bug this fixes: the census read only prefers-color-scheme, so forcing
    // light mode on radixia.ai and clicking through left the census dark.
    expect(radixia).toContain(':root:not([data-theme="light"])');
    expect(radixia).toContain(':root[data-theme="dark"]');
  });

  it("keeps button and card radii distinct", () => {
    // Merging them was the most visible drift: buttons are 3px, cards 10px.
    expect(RADIXIA_THEME.tokens["radius-btn"]).not.toBe(RADIXIA_THEME.tokens.radius);
    expect(STRUCTURE_CSS).toContain("border-radius:var(--radius-btn)");
  });

  it("gives buttons a contrast-chosen background, not the raw accent", () => {
    // White on --accent is 4.08:1 in Radixia's dark mode, under WCAG AA.
    expect(STRUCTURE_CSS).toContain("background:var(--accent-btn)");
    expect(STRUCTURE_CSS).not.toContain("background:var(--accent);color:#fff");
  });

  it("only references fonts on the same origin, which the CSP requires", () => {
    expect(radixia).toContain('url("/fonts/');
    expect(radixia).not.toMatch(/url\("https?:/);
  });
});

describe("getting back out, and the pitch", () => {
  const radixia = { theme: RADIXIA_THEME, themeScript: false };

  it("offers a way up to the parent site", () => {
    // A census served under somebody's domain is a dead end without this.
    const html = page({ title: "x", description: "d", path: "/", body: "", chrome: radixia });
    expect(html).toContain('class="up" href="https://www.radixia.ai"');
    expect(html).toContain("Radixia");
  });

  it("renders no back-link and no CTA when the theme names no operator", () => {
    const html = page({ title: "x", description: "d", path: "/", body: "" });
    expect(html).not.toContain('class="up"');
    expect(ctaCard(undefined)).toBe("");
    expect(ctaCard({ theme: NEUTRAL_THEME, themeScript: false })).toBe("");
  });

  it("renders the operator's CTA when there is one", () => {
    const card = ctaCard(radixia);
    expect(card).toContain('class="card cta"');
    expect(card).toContain("https://www.radixia.ai/enterprise-ai");
    expect(card).toContain('class="btn"');
  });

  it("keeps the CTA free of threat language", () => {
    // The project's line is that someone else is defining how agents talk to your
    // brand — never that you are under attack. A CTA that traded on alarm would
    // undo the positioning everything else is careful about.
    const text = ctaCard(radixia).toLowerCase();
    for (const word of ["attack", "vulnerable", "exposed", "risk", "threat", "breach", "danger"]) {
      expect(text, `CTA should not say "${word}"`).not.toContain(word);
    }
  });
});

describe("results are all reachable", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    apex: `d${i}.example`,
    score: 50,
    band: "Discoverable",
    unassessed_reason: null,
    universe: "R",
  }));
  const base = {
    rows,
    total: 7422,
    offset: 0,
    bandCounts: [
      { band: "Absent", n: 2288 },
      { band: "Agent-ready", n: 408 },
    ],
    letterCounts: { a: 300, z: 12 },
  };

  it("says which slice of the total is on screen", () => {
    // The bug: the table was capped at the top 500 by score with no way to reach
    // the other 6,922, and because hundreds tie on score it looked like the list
    // simply stopped mid-alphabet.
    expect(resultsPage(base)).toContain("Showing 1\u2013100 of 7422 domains");
    expect(resultsPage({ ...base, offset: 7400 })).toContain("Showing 7401\u20137422");
  });

  it("pages forward and back, and does not offer either at the ends", () => {
    const first = resultsPage(base);
    expect(first).toContain("offset=100");
    expect(first).toContain('<span class="pill skip">\u2190 Previous</span>');

    const last = resultsPage({ ...base, offset: 7400 });
    expect(last).toContain('<span class="pill skip">Next \u2192</span>');
  });

  it("keeps other filters when paging", () => {
    const html = resultsPage({ ...base, band: "Absent", universe: "R" });
    expect(html).toMatch(/offset=100[^"]*/);
    const nextHref = /href="([^"]*offset=100[^"]*)"/.exec(html)?.[1] ?? "";
    expect(nextHref).toContain("band=Absent");
    expect(nextHref).toContain("universe=R");
  });

  it("dims letters with nothing behind them instead of linking to an empty page", () => {
    const html = resultsPage(base);
    expect(html).toContain('<span class="pill skip">b</span>');
    expect(html).toContain("letter=a");
  });

  it("offers band clusters with their counts", () => {
    const html = resultsPage(base);
    expect(html).toContain("Absent 2288");
    expect(html).toContain("Agent-ready 408");
  });

  it("points at the bulk download, which beats paging for real questions", () => {
    expect(resultsPage(base)).toContain(censusUrl("/data"));
  });
});

describe("where the CTA appears", () => {
  const chrome = { theme: RADIXIA_THEME, themeScript: false };

  it("shows on pages where the reader just learned something", () => {
    expect(
      landingPage({ chrome, headline: HEADLINE, candidates: [], runFinishedAt: null }),
    ).toContain("card cta");
    expect(
      checkPage({
        chrome,
        domain: "x.com",
        result: {
          apex: "x.com",
          score: 85,
          band: "Connectable",
          assessed: true,
          unassessedReason: null,
          checks: [],
          fixes: [],
          known: true,
        },
      }),
    ).toContain("card cta");
  });

  it("stays off the empty check form, where there is nothing to react to", () => {
    // Leading with a pitch before any measurement would read as the point of the
    // page, which is exactly the positioning this project protects.
    expect(checkPage({ chrome })).not.toContain("card cta");
  });
});

describe("the growth chart", () => {
  const GROWTH = [
    { month: "2025-09", added: 787, cumulative: 787, partial: 0, snapshot_date: "2026-08-05" },
    { month: "2026-07", added: 18952, cumulative: 63052, partial: 0, snapshot_date: "2026-08-05" },
    { month: "2026-08", added: 2735, cumulative: 65787, partial: 1, snapshot_date: "2026-08-05" },
  ];
  const land = (growth?: typeof GROWTH) =>
    landingPage({
      headline: HEADLINE,
      candidates: [],
      runFinishedAt: null,
      ...(growth === undefined ? {} : { registryGrowth: growth }),
    });

  it("plots the series and names the end points", () => {
    const html = land(GROWTH);
    expect(html).toContain("<svg");
    expect(html).toContain("65,787");
    expect(html).toContain("787");
  });

  it("marks the incomplete month instead of letting it read as a crash", () => {
    // A snapshot on the 5th puts five days beside thirty. Unflagged, the last
    // point looks like the ecosystem collapsed.
    const html = land(GROWTH);
    expect(html).toContain("still in progress");
    expect(html).toContain('<span class="pill skip">partial</span>');
    // Hollow end marker: filled with the page colour, not the accent.
    expect(html).toContain('fill="var(--paper)" stroke="var(--accent)"');
  });

  it("attributes the number to the registry, not to us", () => {
    // Conflating the registry's server count with our reachability measurement
    // would be the most damaging error this page could make.
    const html = land(GROWTH);
    expect(html).toContain("registry's own count");
    expect(html).toContain("not ours");
  });

  it("cites the snapshot date it came from", () => {
    expect(land(GROWTH)).toContain("2026-08-05");
  });

  it("renders nothing at all rather than a trend from one point", () => {
    expect(land()).not.toContain("The ecosystem is growing");
    expect(land([GROWTH[0] as (typeof GROWTH)[0]])).not.toContain("The ecosystem is growing");
    expect(areaChart([{ label: "a", value: 1 }])).toBe("");
  });

  it("repeats the series as a real table, which is the accessible version", () => {
    const html = land(GROWTH);
    expect(html).toContain("<details>");
    expect(html).toContain("New servers");
    expect(html).toContain("18,952");
  });

  it("gives the svg an accessible label", () => {
    expect(land(GROWTH)).toMatch(/role="img" aria-label="[^"]+"/);
  });
});

describe("the favicon", () => {
  it("declares the operator's icon under the radixia theme", () => {
    // Without any icon a browser asks for /favicon.ico, which the surrounding site
    // does not serve, so every census page logged a console 404.
    const html = page({
      title: "x",
      description: "d",
      path: "/",
      body: "",
      chrome: { theme: RADIXIA_THEME, themeScript: false },
    });
    const icons = html.match(/<link rel="icon"[^>]*>/g) ?? [];
    expect(icons).toHaveLength(1);
    expect(icons[0]).toContain('href="/favicon.png"');
  });

  it("declares none under the neutral theme", () => {
    // A fork must not inherit somebody else's mark. Absent, not a placeholder.
    const html = page({ title: "x", description: "d", path: "/", body: "" });
    expect(html).not.toContain('rel="icon"');
  });

  it("points outside the census prefix, because the surrounding site serves it", () => {
    const html = page({
      title: "x",
      description: "d",
      path: "/",
      body: "",
      chrome: { theme: RADIXIA_THEME, themeScript: false },
    });
    expect(html).toContain('<link rel="icon" href="/favicon.png">');
    expect(html).not.toContain('rel="icon" href="/census/');
  });
});

describe("the claims on the landing page", () => {
  const CANDIDATES = [
    { candidate_id: "mcp-server-card-json", n: 866 },
    { candidate_id: "mcp-json", n: 839 },
    { candidate_id: "mcp-bare", n: 157 },
    { candidate_id: "ai-catalog", n: 127 },
  ];
  const land = () =>
    landingPage({ headline: HEADLINE, candidates: CANDIDATES, runFinishedAt: null });

  it("attributes 'in no specification' to the path that actually leads", () => {
    // The prose used to say the most-deployed path was superseded and the
    // runner-up was the unattested one. Exactly backwards: server-card.json leads
    // at 866 and is unattested, mcp.json follows at 839 and is superseded. The
    // sentence is now derived from the counts and the candidate inventory.
    const html = land();
    expect(html).toContain("/.well-known/mcp/server-card.json");
    expect(html).toContain("appears in no specification document");
    expect(html).not.toContain("was superseded while the ecosystem was still adopting it");
  });

  it("follows the data when the ranking changes", () => {
    const flipped = [
      { candidate_id: "mcp-json", n: 900 },
      { candidate_id: "mcp-server-card-json", n: 100 },
    ];
    const html = landingPage({ headline: HEADLINE, candidates: flipped, runFinishedAt: null });
    expect(html).toContain("/.well-known/mcp.json");
    expect(html).toContain("was superseded");
  });

  it("does not let the document count be read as a domain count", () => {
    // 2,017 documents sit on 1,507 domains, because 510 organisations publish on
    // more than one path. Printing only the larger number next to "20% publish a
    // server card" invites a contradiction a reader cannot resolve.
    const html = land();
    const total = CANDIDATES.reduce((n, c) => n + c.n, 0);
    expect(html).toContain(`${total} documents across ${HEADLINE.card} domains`);
  });

  it("claims no superlative it cannot defend", () => {
    const html = land().toLowerCase();
    for (const phrase of [
      "nobody has answered",
      "plausibly the most",
      "nobody implements",
      "the only",
    ]) {
      expect(html, `landing page should not claim "${phrase}"`).not.toContain(phrase);
    }
  });

  it("prints a date a person can read, not a log line", () => {
    const html = landingPage({
      headline: HEADLINE,
      candidates: CANDIDATES,
      runFinishedAt: "2026-08-05T10:41:42.223Z",
    });
    expect(html).toContain("5 August 2026");
    expect(html).not.toContain("10:41:42.223Z");
  });

  it("keeps em-dashes out of body prose, as the site does", () => {
    // Two commits on radixia/website exist purely to strip these, so it is a
    // house rule rather than a preference of mine. Scoped to the body: the
    // <title> separator is typography and the main site uses one there too, and a
    // lone dash standing in for a missing value is a glyph, not prose.
    const withGrowth = landingPage({
      headline: HEADLINE,
      candidates: CANDIDATES,
      runFinishedAt: "2026-08-05T10:41:42.223Z",
      registryGrowth: [
        { month: "2025-09", added: 787, cumulative: 787, partial: 0, snapshot_date: "2026-08-05" },
        {
          month: "2026-08",
          added: 2735,
          cumulative: 65787,
          partial: 1,
          snapshot_date: "2026-08-05",
        },
      ],
    });
    // Both themes and both pages: the first version of this test used the neutral
    // theme, which carries no CTA, so it never saw the dash in the CTA copy. It
    // also never rendered /results, which had one of its own.
    const radixia = { theme: RADIXIA_THEME, themeScript: false };
    const surfaces = [
      withGrowth,
      landingPage({
        chrome: radixia,
        headline: HEADLINE,
        candidates: CANDIDATES,
        runFinishedAt: null,
      }),
      resultsPage({
        chrome: radixia,
        rows: [],
        total: 0,
        offset: 0,
        bandCounts: [],
        letterCounts: {},
      }),
    ];
    // Each document's head must be stripped BEFORE joining. Slicing from the
    // first <body> across a concatenation drags in every later document's
    // <head>, and the <title> separator there is deliberate typography — which
    // is how this test spent a while failing on copy that was already clean.
    const body = surfaces.map((html) => html.slice(html.indexOf("<body>"))).join("\n");
    const prose = body.replace(/>[\s]*[—–][\s]*</g, "><").replace(/<[^>]+>/g, " ");
    expect(prose).not.toContain("—");
    expect(prose).not.toContain("–");
  });
});

describe("the check table a visitor actually reads", () => {
  const ROWS = [
    { check_id: "D1", status: "pass", detail: null },
    { check_id: "D2", status: "fail", detail: null },
    { check_id: "D6", status: "skip", detail: "handshake_did_not_succeed" },
    { check_id: "F2", status: "pass", detail: null },
  ];
  const html = () =>
    domainPage({
      apex: "example.com",
      score: 55,
      band: "Discoverable",
      assessed: true,
      unassessedReason: null,
      universe: "R",
      methodologyVersion: "0.2.0",
      finishedAt: "2026-08-05T10:41:42.223Z",
      checks: ROWS,
      history: [],
    } as never);

  it("names every check, not just its id", () => {
    // "D2 fail" tells a reader nothing, and the people most likely to open a
    // domain page are the ones who were sent the link and never read the
    // methodology.
    const out = html();
    expect(out).toContain("Server card");
    expect(out).toContain("DNS record");
    expect(out).toContain("Crawler posture");
  });

  it("translates detail identifiers written for a database column", () => {
    expect(html()).toContain("the handshake did not succeed");
    expect(html()).not.toContain("handshake_did_not_succeed");
  });

  it("says a skip is not a failure, and links the definitions", () => {
    const out = html();
    expect(out).toContain("is not a failure");
    expect(out).toContain(censusUrl("/methodology"));
  });

  it("shows an unmapped detail rather than swallowing it", () => {
    const out = domainPage({
      apex: "example.com",
      score: 10,
      band: "Text-only",
      assessed: true,
      unassessedReason: null,
      universe: "R",
      methodologyVersion: "0.2.0",
      finishedAt: null,
      history: [],
      checks: [{ check_id: "D1", status: "fail", detail: "something_new_we_added" }],
    } as never);
    expect(out).toContain("something_new_we_added");
  });
});

describe("what a public page must never say", () => {
  it("carries no internal go-to-market vocabulary", () => {
    // "The lead magnet" was rendered as the eyebrow above the check page's own
    // heading, lifted from the GTM notes. It told visitors they were being farmed,
    // on the page whose entire job is to be useful first. This project's standing
    // rests on being a measurement rather than marketing.
    const surfaces = [
      checkPage({}),
      landingPage({ headline: HEADLINE, candidates: [], runFinishedAt: null }),
      resultsPage({ rows: [], total: 0, offset: 0, bandCounts: [], letterCounts: {} }),
    ].join(" ");
    for (const phrase of ["lead magnet", "funnel", "conversion", "top of funnel", "CTA"]) {
      expect(surfaces.toLowerCase(), `a public page should not say "${phrase}"`).not.toContain(
        phrase.toLowerCase(),
      );
    }
  });

  it("puts the source repository in the nav, not only the footer", () => {
    // An open-source census that says "you can check our work" should not make you
    // scroll to the bottom to find the work.
    const html = page({
      title: "x",
      description: "d",
      path: "/",
      body: "",
      chrome: { theme: RADIXIA_THEME, themeScript: false },
    });
    const nav = /<nav>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    expect(nav).toContain("github.com/radixia/mcp-census");
    expect(nav).toContain("Source");
  });

  it("lists checks in methodology order, whatever order they arrive in", () => {
    const html = domainPage({
      apex: "e.com",
      score: 10,
      band: "Text-only",
      assessed: true,
      unassessedReason: null,
      universe: "R",
      methodologyVersion: "0.2.0",
      finishedAt: null,
      history: [],
      checks: [
        { check_id: "F2", status: "fail", detail: null },
        { check_id: "D5", status: "fail", detail: null },
        { check_id: "D1", status: "pass", detail: null },
      ],
    } as never);
    const order = [...html.matchAll(/class="mono">([DFQ]\d)</g)].map((m) => m[1]);
    expect(order).toEqual(["D1", "D5", "F2"]);
  });
});

describe("discovery graph", () => {
  const rows = (...r: Array<[string, string, string | null]>) =>
    r.map(([check_id, status, detail]) => ({ check_id, status, detail }));

  it("says a refusal is inconclusive rather than an absence", () => {
    expect(stateOf({ check_id: "D1", status: "fail", detail: "inconclusive_blocked" })).toBe(
      "blocked",
    );
    expect(stateOf({ check_id: "D1", status: "fail", detail: "absent_at_every_candidate" })).toBe(
      "absent",
    );
    expect(stateOf({ check_id: "D1", status: "skip", detail: null })).toBe("not_attempted");
  });

  it("does not claim we tried a check that the run predates", () => {
    // cloudflare.com rendered "not reached" for D7 the day D7 shipped, because
    // its stored result had no such row. That reads as "we tried and failed".
    expect(stateOf(undefined)).toBe("not_in_run");
    expect(discoveryGraph(rows(["D1", "pass", null]))).toContain("not in this run");
  });

  it("does not let a four-check answer look like a nine-check one", () => {
    // The quick check runs F2, D1, D4 and F1. Rendering the other five as
    // "not reached" claimed we tried; "not in this run" implied it was merely
    // stale. Both overstated the evidence behind the answer.
    // Both checks the quick profile actually runs, so anything still unlabelled
    // is genuinely outside the profile rather than merely missing.
    const html = discoveryGraph(rows(["D1", "pass", null], ["D4", "fail", null]), "on_demand");
    expect(html).toContain("not run here");
    expect(html).toContain("four of the nine");
    expect(html).toContain("A DNS lookup is not available");
    expect(html).not.toContain("not in this run");
  });

  it("marks an advertised catalog as seen and not followed", () => {
    // The distinction a status column cannot carry, and the reason this exists.
    expect(stateOf({ check_id: "D7", status: "pass", detail: null })).toBe("observed_not_followed");
    expect(stateOf({ check_id: "D1", status: "pass", detail: null })).toBe("observed");
  });

  it("shows the routes it did not take instead of omitting them", () => {
    const html = discoveryGraph(rows(["D1", "fail", "absent_at_every_candidate"]));
    expect(html).toContain("Not measured here");
    expect(html).toContain("outside_profile");
    // Absence of a node would read as absence of the mechanism.
    expect(html).toContain("Fetching an advertised catalog");
  });

  it("names every state in words, never in colour alone", () => {
    const html = discoveryGraph(
      rows(["D1", "pass", null], ["D7", "pass", null], ["D3", "fail", "inconclusive_blocked"]),
    );
    for (const word of ["observed", "observed, not followed", "inconclusive"]) {
      expect(html).toContain(word);
    }
  });

  it("leaves the cross-check out when there was nothing to compare", () => {
    expect(discoveryGraph(rows(["D1", "fail", null]))).not.toContain("against each other");
    expect(discoveryGraph(rows(["C1", "pass", null]))).toContain("against each other");
  });

  it("escapes everything it renders", () => {
    const html = discoveryGraph(rows(["<script>", "fail", "<img onerror=1>"]));
    expect(html).not.toContain("<script>");
  });
});
