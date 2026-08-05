# CLAUDE.md — MCP Census

**Purpose:** measure, for a frozen and reproducible population of domains, whether
an AI agent could discover and connect to an MCP server for that brand — and
publish the raw dataset openly, naming domains.

**Launch: 2026-09-17, 07:00 CEST.** Timed to AGNTCon + MCPCon Europe (confirmed
17–18 September 2026, RAI Amsterdam). **The date does not move.** When schedule and
scope collide, cut scope and say explicitly what was cut.

---

## ⚠️ Read this first

**This repository is public, and so is the site.** Keep competitive analysis,
commercial reasoning and undecided strategy out of both — including out of commit
messages. Those live in `NOTES.local.md` and `GTM.local.md`, which are gitignored.

**The headline population is Universe R**: organisations the official MCP Registry
proves run a server. Measuring the web's top domains was abandoned because the
answer is ~1% and Cloudflare already published it at 200k scale; the current
question is *of the organisations that demonstrably run a server, how many can an
agent reach?* Prior art is documented factually in
[docs/SPEC-NOTES.md](docs/SPEC-NOTES.md) §9.

---

## Positioning — hold this line

- **A census, not a scanner.** A defined, frozen, reproducible population;
  per-domain measurement; a small number of well-defended statistics. Not another
  general-purpose "is my site AI-ready" checker.
- **Readiness, not security.** We never call a tool, never authenticate, never
  fuzz, never test for weaknesses. Every probe is a plain unauthenticated read of
  something the domain owner published on purpose. If you find yourself writing
  code that probes for a weakness, **stop and ask.**
- **Prior art is cited, not cloned.** [agent-ready.dev](https://agent-ready.dev/)
  has 69 checks, a CLI, extensions and its own MCP server. We do not compete on
  check count. Cloudflare's Agent Readiness dataset is cited as supporting
  evidence, not treated as a rival.
- **Shadow MCP framing is legal as well as editorial.** The claim is *"someone
  else is defining how agents talk to your brand, and you don't know about it"* —
  never *"you are under attack"*. Many third-party servers are legitimate
  wrappers over public APIs. Flag any copy that drifts.
- **We are in our own dataset.** `radixia.ai` is included, never excluded, and the
  conflict of interest is disclosed at the top of `METHODOLOGY.md`. Before any
  large crawl, run the D1 probe against `www.radixia.ai` and show Marco the raw
  result.

---

## Crawler ethics — non-negotiable

These are product requirements, not niceties: a rude crawler destroys this
project's standing in exactly the community it is addressed to. Implemented in
[`packages/core/src/politeness.ts`](packages/core/src/politeness.ts), documented
publicly in [docs/CRAWLER-ETHICS.md](docs/CRAWLER-ETHICS.md).

- **User agent:** `MCPCensus/<version> (+https://www.radixia.ai/census/crawler; census research; opt-out: <email>)`
- **Respect `robots.txt`** for every path, including `.well-known`. A disallowed
  domain is recorded as `skipped_by_robots` and reported as its own category. This
  slightly hurts our numbers. Do it anyway.
- **Rate:** max 1 request/second/apex, hard global concurrency cap, exponential
  backoff on 429/5xx, give up after 2 retries.
- **Timeouts:** 5s connect, 10s total.
- **Method discipline:** `GET`/`HEAD` for discovery. The only `POST` is the MCP
  JSON-RPC handshake, and only after discovery already produced an endpoint, never
  with credentials.
- **Absolute prohibitions, enforced by runtime guards:** never `tools/call`; never
  an `Authorization` header; never follow a redirect off the target apex; never
  probe a path outside the versioned candidate list.
- **Opt-out** honoured within 24h via `data/optouts.txt`, read at crawl start.

**Interlock:** `assertCrawlerIdentity()` throws if `OPT_OUT_EMAIL` in
`politeness.ts` is ever left as a placeholder, so no User-Agent — and therefore
no request — can be built without a real contact address. It is currently set to
`census@radixia.ai` and is live. Never replace it with a placeholder to make a
test pass. (Marco's own address is `marco@radixia.ai` — that is the git author
identity, not the crawler contact.)

---

## Stack

- TypeScript strict + ESM, pnpm workspaces, Node ≥22
- Cloudflare Workers; D1 (results), R2 (raw artifacts + releases), KV (scan cache
  + rate limiting); Queues for crawl fan-out; Cron Triggers
- Server-rendered HTML from the Worker with the Cache API and
  `stale-while-revalidate`. **No SPA framework.** Charts are server-generated
  inline SVG — no chart library.
- Vitest; Biome for lint **and** format; Wrangler
- `packages/core` has **zero Cloudflare dependencies** and does no I/O: the same
  code runs in the CLI, the Worker and a local Node pilot script. Probes take
  their fetch implementation as an argument.

### Hosting — already decided

Served at **`https://www.radixia.ai/census/*`** by a separate Worker bound to a
route on the existing zone. `mcpcensus.dev` 301s there and is the public-facing
name on stickers and badges.

- `radixia.ai` is a **fully static** site built from a headless CMS. **Never touch
  that build pipeline.**
- The Worker **must emit its own complete security headers** — the main site's
  build-time CSP hashes can never cover Worker-rendered HTML. Asserted by
  `apps/worker/src/security.test.ts`.
- `www` is canonical. The base URL lives in **one constant**
  (`packages/core/src/config/site.ts`); never concatenate a URL anywhere else.
- Per-domain permalinks are SSR from D1, never pre-rendered into the static build.
- Zone plan is **free** and stays free. **Workers Paid is active** since
  2026-08-05, which is what unlocks D1, Queues and Cron.
- **The Workers route is live**: `www.radixia.ai/census/*` serves the census.
  Every other path on the zone is untouched and the static build was never
  modified. Verified by smoke test at the time it was enabled.

---

## Spec knowledge is stale — re-verify, never recall

**Read [docs/SPEC-NOTES.md](docs/SPEC-NOTES.md) before touching any probe.**

The MCP specification `2026-07-28` postdates the model's training data, and
discovery is actively contested. Verified findings that contradict intuition:

- **The `initialize`/`initialized` handshake was removed** (SEP-2575). Servers
  **MUST** implement `server/discover` instead. There are two eras — *modern*
  (`2026-07-28`+, per-request `_meta`) and *legacy* (`2025-11-25` and earlier).
- **`Mcp-Method` and `MCP-Protocol-Version` headers are REQUIRED** (SEP-2243),
  validated against the body; a mismatch returns `400` / `-32020 HeaderMismatch`.
- **A modern MCP endpoint answers `GET`/`HEAD` with `405`**, so `HEAD /mcp`
  cannot detect one. We treat the `405` as the positive signal — see
  `docs/DECISIONS/0002`.
- **No server-card discovery mechanism has been standardised.** SEP-2127 is an
  open Draft; SEP-1649 was folded into it; SEP-1960 was never adopted. The design
  moved to an endpoint-relative `<mcp-url>/server-card` plus a Linux Foundation
  **AI Catalog** at `/.well-known/ai-catalog.json`.
- **RFC 9728 is MUST — but only for servers that implement authorization, and
  authorization is itself OPTIONAL.** A public unauthenticated server correctly
  publishes no Protected Resource Metadata, so a `D4` failure is *inconclusive*,
  never a finding of non-compliance. A `401` carrying
  `WWW-Authenticate: ... resource_metadata=...` is a *positive detection*.
- `/.well-known/mcp/server-card.json` is widely asserted online but **appears in
  no primary document**. We probe it to measure cargo-culting, and never cite the
  blogs that claim it.

Re-verify before each census run and update SPEC-NOTES with URLs and access dates.

---

## Rules for working in this repo

- **No check may be added, removed or changed without a corresponding
  `METHODOLOGY.md` revision** and a bump to `METHODOLOGY_VERSION`. Check IDs ship
  in the public dataset and must survive methodology revisions.
- Adding a discovery candidate is a methodology change: bump `CANDIDATES_VERSION`
  and `METHODOLOGY_VERSION` together.
- **Probe logic must be fixture-tested** using recorded real responses. A bug there
  silently corrupts the published dataset — the one failure mode we cannot recover
  from. Everything else can be lightly tested.
- Reproducibility is the value proposition: frozen input lists with provenance and
  download date, versioned methodology, deterministic scoring.
- Small commits, Conventional Commits, real messages. No "wip", no "fixes".
- No premature abstraction. Two occurrences is not a pattern.
- Short ADRs in `docs/DECISIONS/` for real forks in the road only. Log decisions,
  not actions.
- Ask one sharp question rather than guessing and building the wrong thing. Say so
  directly if something here is wrong.

---

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Scaffold, licences, SPEC-NOTES, crawler ethics | **done** 2026-08-04 |
| 1 | Core probes D1–D6, Q1, F1, F2 + pilot | **done** 2026-08-05 |
| 2 | CLI `npx mcpcensus check` | **done**; not yet published to npm |
| 3 | Cloudflare infra — D1, R2, KV, Queues, cron | **done** 2026-08-05 |
| 4 | Full census over Universe R + D | in progress |
| 5 | Shadow MCP classification | **partial** — see below |
| 6 | Public site, live at www.radixia.ai/census/ | **done** 2026-08-05 |
| 7 | Data release, Parquet, Zenodo | tooling done, no release cut |
| 8 | Conference mode | not started |

Work strictly in order. Stop at each phase boundary, show Marco, wait for
approval, and commit with a real message.

## Known blockers

1. **npm publish of `mcpcensus`** — needs Marco's npm auth. The CLI works; it is
   not on the registry, so `npx mcpcensus` fails for anyone else.
2. **Shadow MCP is not acceptance-ready** — ~85% precision on name matching, no
   brand-level dedup across ccTLDs. `shadow_candidate` is deliberately named and
   the count must not be quoted. See `docs/SHADOW-2026-08-05.md`.
3. **Seven `inferred` domains in Universe D** need hand-checking before any
   output names those companies.
4. **Zenodo deposition** — metadata is generated; depositing needs an account.
5. **Tranco licensing** — Tranco aggregates Cloudflare Radar under **CC BY-NC
   4.0** (non-commercial); we intend CC-BY-4.0 output from a commercial
   consultancy. Resolve **before** Phase 4 freezes an input list; re-freezing
   later destroys reproducibility.
6. ~~`draft-morrison` TXT format~~ — verified 2026-08-05, implemented in D2.
7. **Smithery API key** — needed for Phase 5; auth required, rate limits unknown.

## Facts worth not re-deriving

- Cloudflare account `RADIXA`, id `e62abad0c118b8a409575354eec284d6`, zone
  `radixia.ai` (proxied, free plan).
- Existing Workers on the account: `radixia-blog-mcp`, `stealthhumanizer` — **do
  not touch either**. `mcp.radixia.ai` is attached as a Workers Custom Domain, so
  it cannot collide with a route on `/census/*`.
- Zone inspected 2026-08-04: no Transform Rules, all Managed Transforms off, no
  Workers Routes, apex→www already handled by a Redirect Rule (which fires before
  Workers).
- npm package and binary: `mcpcensus`, unscoped, invoked `npx mcpcensus check`.
  The brief's `<<<NPM_SCOPE>>>` placeholder is superseded by this.
- Homebrew's Node ships without corepack; pnpm was installed via `npm i -g pnpm`.
