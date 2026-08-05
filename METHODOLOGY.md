# Methodology

**Version `0.2.0-draft` · last revised 2026-08-05**

This document is the single most important artifact in the project. It is
versioned, and every published row carries the methodology version that produced
it. No check may be added, removed, or have its semantics changed without a
revision here and a bump to `METHODOLOGY_VERSION`.

> **Status: draft.** No scores have been published. The scoring formula below is
> published *before* any score, deliberately, so that it can be argued with before
> it is used. The population and headline framing are still under review — see
> [Open questions](#open-questions).

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
| A | Global top domains | not yet frozen — see [Open questions](#open-questions) |
| B | Europe | not yet frozen |
| C | Italy | not yet frozen |
| D | AGNTCon + MCPCon Europe 2026 sponsors and speakers | not yet frozen |

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
  re-crawling.
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
| `0.2.0-draft` | 2026-08-05 | Checks `D1`–`D4`, `F1`, `F2` implemented. Scoring split the single discovery tier into "published document" (35) and "endpoint-shaped only" (20), so an unconfirmed `D3` no longer counts the same as a card. Added the explicit refuse-to-score rules. Nothing measured yet. |
