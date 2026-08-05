# 0006 — The skin is a package, and the default is neutral

**Date:** 2026-08-05
**Status:** accepted

## Context

The census's stylesheet was written by reading the live radixia.ai and retyping
the token values. Marco noticed the result looked adjacent to the site rather
than part of it — different buttons, different footer — and asked whether the
divergence was deliberate.

It was not. It was drift, and by the time we looked it had already produced
defects rather than merely cosmetic differences:

| | |
|---|---|
| `--violet`, `--dark-panel`, `--w-max`, `--w-prose` | never copied |
| button radius | took the card radius (10px); the site uses 3px |
| `--ink-3` | the pre-accessibility value, 4.37:1 — **under WCAG AA** |
| button background | `var(--magenta)` + white = 4.08:1 in dark mode — **under AA** |
| `[data-theme]` | omitted, so forcing light mode on radixia.ai and clicking into the census **left the census dark** |

The last two are the point. The site's `tokens.css` carries decisions with
measured contrast ratios in its comments, and a separate `--magenta-btn` exists
precisely because white-on-accent fails AA in dark mode. Transcribing the file
kept the values and dropped the reasoning, so the census reproduced the bugs the
site had already fixed.

radixia.ai has documented an **engine / skin / copy** separation since it was
built. The principle held inside that repo and failed across repos, because
nothing made it possible to *share* the skin — the site inlines all CSS
(`build.inlineStylesheets: "always"`), so there is no stylesheet to link to.

## Decision

**1. The brand is a package.** [`@radixia/brand`](https://github.com/radixia/brand)
holds tokens, `@font-face`, reset, typography, the button and the root-node mark
as framework-agnostic CSS plus generated JS/JSON tokens. The website consumes it;
so does the census. Sharing happens at source level because it cannot happen at
runtime.

**2. The census skin is a theme, and the default is neutral.** `packages/core/src/theme`
defines a `CensusTheme` of values only — no layout, no component rules. The
structural CSS is theme-independent and names no brand: `--accent`, not
`--magenta`. `neutral` is the default; `radixia` is selected by a deploy variable.

**3. Radixia's theme is generated, never hand-written.** `pnpm theme:sync` derives
it from the installed brand package; `pnpm theme:check` fails when it goes stale.
The brand package is a **devDependency**, so a fork never pulls it at runtime, and
the generated theme is committed so a clean clone builds.

## Why neutral by default

Not aesthetics. Shipping Radixia's palette, fonts and footer as the default would
mean every fork silently presents itself as operated by Radixia — a trademark
problem, not a styling preference. Neutral-by-default fixes it in behaviour rather
than in documentation, and a test asserts a page rendered with no theme contains
no mention of Radixia.

It also fixes a quieter bug: the `@font-face` block points at `/fonts/*.woff2`,
which resolves on www.radixia.ai and 404s everywhere else. Every non-Radixia
deployment was making failed font requests and falling back to system fonts —
which looks fine and is wrong. The neutral theme ships no `@font-face` at all.

## Consequences

- Changing a colour, font, radius or button now means editing `@radixia/brand` and
  bumping the dependency. Editing it in the census is how the two drift again.
- Two font copies exist by design: the package's canonical ones, and
  `public/fonts/` on the site serving them at stable `/fonts/` URLs, which the
  census's absolute `@font-face` and the site's preloads both depend on. The site
  has a checksum test for the seam.
- `--radius-btn` was added to the brand package as part of this, because the
  two-radius scale was only half machine-readable: `--radius` was a token and the
  3px button radius was a literal. A consumer reading the tokens saw one radius,
  and putting buttons on it is exactly the mistake made here.
- A test now walks every `var(--token)` in the structural CSS **and in rendered
  markup** and asserts each resolves in every theme. CSS does not error on an
  undefined custom property — it falls back to the initial value, so a colour
  turns black or transparent with nothing in any log. That is not hypothetical:
  `barChart` kept filling its bars with `var(--magenta)` after the rename, which
  renders them invisible, and the first version of this test scanned the wrong
  file and would not have caught it.

## Alternatives rejected

**Link to the site's stylesheet at runtime.** Impossible: the site inlines all CSS
under a build-time hashed CSP and exposes no linked sheet.

**Keep the brand values in a private overlay.** No secrecy to protect — the tokens
are readable via view-source on the live site — and it would cost a second repo, a
build step, and a public repo whose own production config could not be read.

**Corroborate the tokens by scraping the live site on each build.** Rejected: a
network-dependent build is a flaky build, and the deployed site can lag the branch
where the accessibility fixes actually landed. Deriving from a versioned package
is deterministic.
