# Methodology

**Version `0.2.0` · last revised 2026-08-05**

This document is the single most important artifact in the project. It is
versioned, and every published row carries the methodology version that produced
it. No check may be added, removed, or have its semantics changed without a
revision here and a bump to `METHODOLOGY_VERSION`.

> **Status: in use.** The scoring formula was published *before* any score, so
> that it could be argued with before it was used; that window is now closed and
> the [2026-08-05 release](https://www.radixia.ai/census/data) cites this version.
> A release that calls itself immutable cannot cite a draft.
>
> The limitations below are written from measurement rather than expectation — the
> first full-population census has run. Open questions that remain open are still
> listed as such, and answering one is a revision, not an edit.

---

## Conflict of interest — read this first

**This census is run by [Radixia S.r.l.](https://www.radixia.ai), a commercial AI
and cloud consulting firm, and `radixia.ai` is included in the measured
population.**

Radixia sells services related to the thing being measured. It also already
implements most of the agent-facing surface this census scores: an MCP server card,
`llms.txt`, Markdown content negotiation, structured data, a public read-only MCP
server at `mcp.radixia.ai`, WebMCP, and `security.txt`. It will therefore score
well, and we have an obvious interest in the subject appearing important.

We chose to include our own domain rather than exclude it. Prior work in this space
tends to exclude the authors' own properties; excluding ourselves precisely where we
happen to pass would read as less honest, not more. Readers should discount our
own row accordingly, and everything needed to verify it — the raw dataset, the
probe code, the frozen input lists — is public.

---

## What this measures

For each domain in a frozen population: **could an AI agent, starting from nothing
but the domain name, discover and connect to an MCP server for that brand?**

It is a census — a defined, reproducible population, measured per domain, reported
as a small number of defended statistics. It is not a general-purpose site audit,
and it is emphatically **not** a security assessment. See
[docs/CRAWLER-ETHICS.md](docs/CRAWLER-ETHICS.md) for what we do and do not touch.

## The population

Frozen input lists live in `data/universe/`, each committed with its provenance and
download date. Nothing is measured that is not in a committed list.

| Tag | Universe | Status |
|---|---|---|
| **R** | **Organizations that provably run an MCP server** — the headline population | **frozen 2026-08-05**, 7,377 organizations |
| D | AGNTCon + MCPCon Europe 2026 sponsors and speakers | **frozen 2026-08-05**, 52 domains |
| A | Global top domains | context only — see [Open questions](#open-questions) |
| B | Europe | not frozen |
| C | Italy | not frozen |

### Universe R is the headline population

Measuring the web's top domains asks "how many big brands have an MCP server?".
The answer is approximately none — about 1% in our pilot — and Cloudflare
already published that across 200,000 domains in April 2026. Repeating it at
smaller scale produces a weaker version of somebody else's result.

Universe R asks a question nobody has answered: **of the organizations that
demonstrably run an MCP server, how many can an agent actually find?** It is
built from the MCP Registry's own public API, from two forms of evidence only a
domain owner can produce — a registry-verified reverse-DNS namespace, or a
remote endpoint hosted on the apex itself.

Three consequences, all deliberate:

- **The base rate stops being the limiting factor.** These domains are known to
  have servers, so discoverability becomes measurable at n≈7,000 instead of
  resting on a handful of hits.
- **No third-party licensing.** Universe R derives from the registry's public
  API, not from a ranked domain list, so — unlike anything Tranco-derived — the
  frozen universe can be republished in full alongside the results.
- **No overlap with prior work.** Cloudflare measures the whole web with a
  single boolean; this measures the population that matters, per mechanism.

**Platforms are separated from organizations.** A domain hosting three or more
servers whose namespaces belong to somebody else is acting as hosting
infrastructure, not publishing its own server: `pipeworx.io` (1,311),
`smithery.ai` (217), `apify.actor`. 70 such platforms are tagged and excluded
from the organization count, because a few thousand deployments on shared
infrastructure would otherwise drive the headline rate.

## Protocol context

Measurement is against the MCP specification revision `2026-07-28`, published
2026-07-28 and verified against primary sources on 2026-08-04. Full findings,
with URLs and access dates, are in [docs/SPEC-NOTES.md](docs/SPEC-NOTES.md).

Two facts shape every check below:

1. **There are two protocol eras.** The `initialize` handshake was removed in
   `2026-07-28` (SEP-2575) and replaced by `server/discover`. Servers on
   `2025-11-25` and earlier still expect `initialize`. We probe for both and
   report the split.
2. **No server-card discovery mechanism has been standardised.** We probe every
   published candidate and record which one responded. See
   [ADR 0001](docs/DECISIONS/0001-probe-every-candidate-path.md).

## The checks

Each check is a pure function returning `{ id, status: 'pass'|'fail'|'skip'|'error', evidence, latencyMs }`.
Check IDs are stable and appear as columns in the published dataset; they survive
methodology revisions.

### Where these identifiers come from

`D1`, `F1`, `Q1` are **ours**. No specification assigns them and nobody outside this
project uses them. They exist because the identifiers ship as columns in the
published dataset and must survive revisions of this document, so they are
deliberately dull and deliberately stable.

Authority, where there is any, belongs to the thing measured and never to the
label — see the "Normative basis" column, which ranges from a MUST in RFC 9728 to
nothing at all. Citing "a `D4` failure" as though it were a standard designation
would be citing us.

- **`D`, discovery.** `D1` to `D6`, in dependency order: find a document, find an
  endpoint, connect, list what is there. Each depends on the one before, which is
  why a later check so often reports `skip`.
- **`Q`, quality** of the tool surface once an agent is connected. One check today.
- **`F`, fallbacks and posture.** The two things that help an agent which never
  speaks MCP: text it can read, and whether a crawler is welcome.

The letters were never expanded in the brief that introduced the scheme; the
groupings above are what the checks and the scoring already do, written down here
on 2026-08-06 rather than left to be inferred.

`S1` was specified in the original brief for shadow servers and is absent from
this list, because it turned out not to be a check: it measures the registry
against a domain rather than measuring the domain, so it lives in a separate
pipeline. The gap in the sequence is deliberate.

### What a negative result means

A check reports `pass`, `fail`, `skip` or `error`. `fail` is the one that can be
misread, so from `0.3.0` every failed candidate check also records **why**, from
a closed vocabulary, derived from responses already received:

| Outcome | Meaning | What a reader may conclude |
|---|---|---|
| `absent_at_every_candidate` | Every candidate answered `404` or `410`. | The document is not at any path we publish. Still not proof of absence — see limitation 12. |
| `inconclusive_blocked` | At least one candidate answered `401`, `402`, `403`, `407`, `429`, `451` or `5xx`, or failed at the transport. | **Nothing about the domain.** We were refused or the server broke. |
| `invalid_document` | Something was served at a candidate and did not parse. | A publisher intended something. It is not readable by a conforming client. |
| `mixed_negative` | Negative, but not uniformly, and nothing was blocked. | Read the per-candidate evidence. |

Until `0.3.0` the code recorded every non-2xx as `not_found`. That was a
measurement error and not a wording one: a `403` and a `404` license opposite
conclusions, and collapsing them let "we were refused" be published as "they have
nothing". Re-reading the frozen `0.2.0-draft` evidence for run 3 under the new
taxonomy moves 328 of 5,283 D1 failures out of absence and into inconclusive, of
which 145 sit in the `Absent` band. A further 630 served something that did not
parse.

Those bands are **not** restated. Scoring reads only the four statuses and never
these labels, so no score changes; the reclassification is published as evidence
alongside the run it describes, and the historical release stands as issued.

`402` is treated as a refusal because it is common in this population: hosting
that has been suspended answers every path with it, and counting that as absence
attributes a billing dispute to the brand.

| ID | Name | Method | Normative basis |
|---|---|---|---|
| `D1` | MCP server card | `GET` each candidate path; record which responded and whether it parses | none — all candidates are drafts or historical |
| `D2` | DNS discovery | `TXT` lookup at `_mcp.<apex>` | individual IETF draft, no standing |
| `D3` | Conventional endpoint | `GET`/`HEAD` conventional paths and subdomains; **`405` is the positive signal** | Streamable HTTP transport |
| `D4` | OAuth protected resource | `GET` root and path-inserted forms; parse `WWW-Authenticate` on `401` | RFC 9728 — MUST, but only for servers that implement authorization |
| `D5` | Handshake | unauthenticated JSON-RPC `server/discover`, falling back to `initialize`. Runs only if D1–D4 produced an endpoint | spec |
| `D6` | Tool listing | JSON-RPC `tools/list`, read-only. Runs only if D5 succeeded | spec |
| `Q1` | Tool surface shape | tool count, description presence and length distribution, parameter description coverage | — |
| `F1` | Text fallbacks | `llms.txt`, `llms-full.txt`, `AGENTS.md` | community convention |
| `F2` | AI crawler posture | parse `robots.txt`; per-agent allow/deny for major AI crawlers | robots.txt |
| `D7` | Root-document catalog advertisement | `GET /`; read the `Link` header and `<link rel>` in the `<head>`. Records the relation of the target, never the URL, and never fetches it. **Measured, not scored.** | AI Catalog discovery procedure; the well-known path it falls back to is optional |
| `S1` | Shadow MCP | join against registry data; see [ADR 0003](docs/DECISIONS/0003-namespace-verification-over-fuzzy-matching.md) | — |

Notes that matter for interpretation:

- **`D4` has a MUST behind it, but a conditional one.** RFC 9728 is mandatory for
  MCP servers that implement authorization — and *authorization itself is
  **OPTIONAL*** under the specification. A public, unauthenticated server
  correctly publishes no Protected Resource Metadata.

  So a `D4` **pass** is the highest-confidence discovery evidence we collect: the
  document is unambiguous when present. A `D4` **failure is inconclusive**, not a
  finding of non-compliance — it cannot yet distinguish "needs no authorization"
  from "needs it and fails to advertise it". Separating those requires `D5`: a
  server answering an unauthenticated handshake is public; one returning `401`
  is protected and must have the metadata. We report D4 failures as inconclusive
  until then.
- A `401` carrying `WWW-Authenticate: ... resource_metadata=...` is a positive
  detection, not a failure.
- **`D3` alone is weak evidence.** A `405` at `/mcp` is consistent with a modern
  MCP endpoint but also with any other POST-only endpoint. It is used to *locate*
  an endpoint for D5, never as a confirmed MCP server on its own. See
  [ADR 0002](docs/DECISIONS/0002-d3-detects-405.md).
- **`D5` and `D6` are the only requests that are not `GET`/`HEAD`**, and they run
  only against an endpoint that discovery already found, never with credentials.
- A domain disallowing us in `robots.txt` is recorded as `skipped_by_robots` and
  reported as its own category, never folded into failures.

## Scoring

**In one sentence: a domain earns 70 of 100 points for being connectable at all,
and the remaining 30 for the quality of what an agent finds once connected.**

| Component | Points | Awarded when |
|---|---|---|
| Confirmed connection | 70 | `D5` succeeded — a real MCP server answered |
| Published discovery document | 35 | `D1`, `D2` or `D4` passed, but `D5` did not confirm |
| Endpoint-shaped only | 20 | `D3` passed and no discovery document was found |
| Tool surface quality | 15 | `D6`/`Q1`: tools listed, described, parameters documented |
| Text fallbacks | 10 | `F1` |
| Declared crawler posture | 5 | `F2`: an explicit per-agent policy either way |

The discovery tiers are exclusive — a domain earns the highest one it reaches,
never a sum of them.

Discovery is weighted far above everything else because that is the census
question. A domain an agent cannot find has no partial credit worth arguing about,
and the lower tiers exist only to distinguish "published something" from
"published nothing".

`D3` is deliberately worth less than a published document. A `405` is consistent
with any POST-only endpoint, so on its own it is a hint rather than a finding.
See [ADR 0002](docs/DECISIONS/0002-d3-detects-405.md).

Scoring is deterministic: the same evidence always produces the same score, and
any published score can be recomputed from the released dataset without
re-crawling.

### When we refuse to score

A domain gets **no score at all** — not a zero — when we were not permitted or
not able to look:

- **`skipped_by_robots`**: `robots.txt` excluded us from every HTTP discovery
  check. `D2` (DNS) is not gated by `robots.txt`, so a blocked domain still
  produces a clean DNS negative; that alone does not make it assessed, because
  publishing "Absent" on the strength of a DNS lookup would be a finding about
  our own crawl dressed up as a finding about their site.
- **`unreachable`**: every HTTP discovery check failed at the transport.

A positive finding anywhere overrides both: if we found something, we know
something worth publishing.

Unassessed domains are reported as their own category and are excluded from
percentage denominators.

| Band | Score |
|---|---|
| Absent | 0 |
| Text-only | 1–30 |
| Discoverable | 31–69 |
| Connectable | 70–89 |
| Agent-ready | 90–100 |

## Reproducibility

A third party must be able to re-run this and get comparable numbers:

- Input lists are frozen, committed, and carry provenance and download date.
- The methodology version and candidate-set version are recorded on every row.
- Scoring is deterministic and depends on nothing but the recorded evidence.
- Raw response artifacts are retained so a score can be recomputed without
  re-crawling. **Exception, run 3.** The first full census was driven by the local
  runner and imported with `scripts/pilot/import.ts`, which wrote the database
  rows but not the per-domain R2 objects, although it set the `evidence_key`
  column as though it had. The evidence itself was never lost: it is published
  whole as `evidence/bundles/run-3.jsonl.gz`, one JSON object per domain, and the
  per-domain keys for that run are being backfilled from it. Runs 4 onward go
  through the Worker and are unaffected.
- Releases are frozen snapshots under `data/releases/<date>/`.

Code is Apache-2.0. Data is CC-BY-4.0.

## Limitations

The things that weaken our own findings. This section is not a formality.

1. **The base rate may be so low that per-domain statistics are close to
   meaningless.** Cloudflare measured 200,000 domains in April 2026 and found MCP
   Server Cards on fewer than 15. If our numbers agree, most of our per-country
   and per-sector breakdowns will be zeros, and differences between them will be
   noise rather than signal. We will report the zeros rather than dressing them up.
2. **A negative is not proof of absence.** A brand may run an MCP server that is
   discoverable only through a client marketplace, a registry entry, a private
   agreement, or documentation. We measure *autonomous discoverability from the
   domain name*, which is narrower than "has an MCP server".
3. **We measure the front door only.** Geo-routing, bot mitigation, WAF rules and
   CDN behaviour mean our view from one vantage point may differ from a real
   agent's. A `403` may be about us, not about the domain's readiness.
4. **`robots.txt` exclusions bias the sample**, and in a direction we cannot
   correct for: domains with sophisticated crawler policies are plausibly also the
   ones with sophisticated agent policies.
5. **`D3`'s `405` signal has false positives** — any POST-only endpoint at a
   conventional path looks the same.
6. **`.well-known` candidates are probed on the apex only.** When `D3` locates an
   endpoint on `mcp.<apex>`, we probe the endpoint-relative card and the RFC 9728
   document on that host, but not the full `.well-known` candidate set. A server
   card published only at `https://mcp.<apex>/.well-known/mcp.json` is therefore
   missed. This affects only domains that already pass `D3`, so it biases the
   *mechanism distribution* rather than the headline hit rate. To be fixed before
   the full census.
7. **A `D4` failure is inconclusive, and we cannot yet resolve it.** Until `D5`
   lands we cannot tell a server that needs no authorization (correctly
   publishing nothing) from one that needs it and fails to advertise it. `D4`
   failures must not be reported as non-compliance, and the `D4` pass rate is a
   floor on compliance, not a measure of it.
8. **A `200` catch-all can hide a real negative.** Some hosts answer every
   unmatched path with `200` and a human-readable page. We reject those (they are
   neither JSON nor a valid metadata document), but a domain configured this way
   cannot be distinguished from one that has genuinely published nothing, and it
   is invisible to any scanner that only checks status codes.
9. **Discovery candidates are a moving target.** We probe eight; a mechanism
   invented after our freeze date will read as absent. SEP-2127 could land between
   our run and our publication.
10. **Shadow MCP misclassifies servers written by employees under personal
   namespaces** as third-party. This is why the claim is "you don't know about it",
   not "you didn't write it".
11. **Registry coverage is partial and unstable.** The official registry is in
   preview with no durability guarantee; Smithery entries cannot be
   namespace-verified the same way; Glama and PulseMCP are not yet assessed.
12. **The authors have a commercial interest** in this subject mattering. See the
   conflict-of-interest note above.
13. **Input-list licensing is unresolved.** See below.

16. **Two "no discovery signal" numbers exist, and they differ by 16 rows.** The
    landing page counts domains where none of `D1`–`D4` passed (4,495 of 7,421 in
    the 2026-08-05 release). The band distribution counts `Absent` plus
    `Text-only`, which is a score threshold (4,511). The gap is domains whose only
    discovery signal is `D3`'s `405` — worth 20 points, not the 35 a published
    document earns — that then score at or under 30 because they also lack
    `F2`. Both are correct for their own question, both round to 61%, and neither
    is a correction of the other. Stated here because a reader who spots two
    numbers for one idea is right to ask.
17. **The 2026-08-05 release was produced by the local runner, not the Worker
    queue.** The probe code is identical — the same `packages/core`, so the rows
    are the same rows — but the crawl was driven from a laptop because a
    7,400-domain backfill is resumable and watchable that way, and the queue path
    is not. The nightly cron and queue are the production path and are what
    produce every subsequent run. We say so rather than implying the first dataset
    came off the edge.
18. **The registry growth chart is not our measurement.** Cumulative entries in
    the official MCP Registry, keyed on each entry's own `publishedAt`, from a
    snapshot taken on the release date. It answers how fast the ecosystem is
    growing, which is a different question from how much of it an agent can reach,
    and the two are never combined into one series. The current month is always
    incomplete and is flagged as such: a snapshot on the 5th puts five days beside
    thirty, which renders as a collapse if left unmarked.

19. **The headline is computed from a full-population run only, never a nightly
    one.** The watchlist that runs on the six non-Sunday nights is, by
    construction, every domain that has ever shown a discovery signal, so almost
    all of it has one. On 2026-08-06 the first nightly run flipped the live
    headline from "61% publish nothing, 4,495 of 7,421" to "2%, 64 of 2,928"
    while the sentence around it stayed the same: nothing had improved, the page
    had silently changed population. The query now refuses any run that is not
    over the whole universe. Recorded because the failure was invisible in the
    direction that mattered — a number that gets worse is questioned, one that
    gets better is celebrated.

20. **Our AI Catalog count measures one optional location, not adoption.** We
    probe `/.well-known/ai-catalog.json`. The AI Catalog specification does not
    require it: a catalog is identified by its media type rather than its path,
    it says a document may be served from any URL, and it calls use of the
    well-known URI optional. Its full discovery procedure consults an HTTP `Link`
    header and an HTML `<link>` element *before* falling back to the well-known
    path, and we probe neither, because both mean fetching and parsing a page we
    were not asked to fetch. The extension repository tracks the same gap as
    [issue #43](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/43),
    open since 2026-07-20. So our figure is a floor for one optional path, and
    the right phrasing is "answered at the well-known path", never "has adopted
    the AI Catalog". The same caution applies to every candidate we probe, but it
    bites hardest here because this is the mechanism with a future.

## Open questions

These are unresolved as of 2026-08-05 and are recorded here rather than hidden:

- **Which universes to freeze.** Cloudflare already measures MCP discovery across
  the 200,000 most visited domains weekly and publishes the aggregates. Re-running
  a global top-domain universe would largely duplicate that, so the populations we
  freeze should be the ones nobody covers — Europe, Italy, and the conference
  cohort — plus whatever is needed as a comparable baseline. Not yet settled, and
  it must be before any list is frozen.
- **Input-list licensing.** Tranco aggregates Cloudflare Radar data under **CC
  BY-NC 4.0** (non-commercial), while we intend to publish derived data under
  CC-BY-4.0 from a commercial site. This must be resolved before any universe is
  frozen, because re-freezing later destroys reproducibility.
- **`draft-morrison-mcp-dns-discovery` record format** is unverified, so `D2`
  currently covers only the `draft-serra` format.
- **Whether to name domains** in the public leaderboard. Current plan: yes, with a
  correction route and a rescan action on every per-domain page.

## Changelog

| Version | Date | Change |
|---|---|---|
| `0.1.0-draft` | 2026-08-04 | Initial draft. Checks defined, scoring published, nothing measured. |
| `0.1.0-draft` | 2026-08-05 | Editorial only, no change to checks or scoring. Open questions reworded to scope rather than framing. |
| `0.2.0` | 2026-08-05 | Checks `D1`–`D4`, `F1`, `F2` implemented. Scoring split the single discovery tier into "published document" (35) and "endpoint-shaped only" (20), so an unconfirmed `D3` no longer counts the same as a card. Added the explicit refuse-to-score rules. Finalised the same day the first full census over Universe R ran (7,422 domains, 7,421 assessed) and the limitations were rewritten from what it found: the two "no discovery signal" definitions, the local-runner provenance of the first release, and the registry growth series being the registry's count rather than ours. |
| `0.3.0` | 2026-08-07 | Candidate checks now classify *why* a probe was negative instead of recording every non-2xx as `not_found`, and failed `D1`/`D4` rows carry the roll-up as `detail`. No check was added, no request changed, and no score moved: scoring reads statuses only. Recorded the run-3 evidence gap under Reproducibility. Prompted by an external review of the published documentation. |
| `0.3.0` | 2026-08-07 | Editorial, same day: limitation 20 records that the AI Catalog figure measures one optional path. Verified against the AI Catalog specification and the extension repository's open issue #43. |
| `0.4.0` | 2026-08-07 | Added `D7`, which reads the catalog link relations the AI Catalog specification consults *before* the well-known path. It is measured and deliberately **not scored**: an advertisement is not a document, and we chose not to open it. Costs one `GET` of `/` per domain; `/` was already on the candidate list, the change is asking for it on the apex and reading the head. `D2` now publishes only `v=mcp*` TXT records and a count of the rest — the first census shipped 122 domains' unrelated site-verification tokens in a CC-BY dataset, which was collection we could not justify. Candidate set `2026-08-07`. |
