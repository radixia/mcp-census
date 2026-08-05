import { censusUrl, NEUTRAL_THEME, RADIXIA_THEME, THEMES } from "@mcp-census/core";
import { describe, expect, it } from "vitest";
import { fixesFor, normaliseDomain } from "../check.js";

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
