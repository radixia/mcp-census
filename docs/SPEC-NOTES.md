# SPEC-NOTES

What the MCP specification and its surrounding discovery proposals **actually say
today**, established by direct reads of primary sources — not from model recall.

- **Research date: 2026-08-04.** Every URL below was fetched on this date.
- **Methodology version this supports:** `0.1.0-draft` (pre-Phase-0)
- **Re-verify before each census run.** Discovery is an actively contested design
  space; several of the documents below changed in the last 30 days.

> **Status: nothing has been measured.** As of 2026-08-05 the repository contains
> the Phase 0 scaffold and this research record. No domain has been probed, no
> census has been run, and no results have been published.

> **Standing warning for future sessions.** The assistant's training data predates
> the `2026-07-28` revision. Several things the model "knows" about MCP are wrong
> as of this file's research date — in particular the `initialize` handshake, which
> no longer exists in the current revision. Do not implement a probe from recall.
> Re-read the primary source and update this file.

---

## 1. Specification status

| Fact | Value | Source |
|---|---|---|
| Current revision | `2026-07-28` | [spec index](https://modelcontextprotocol.io/specification/2026-07-28) |
| Release-candidate lock | 2026-05-21 | [RC blog post](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) |
| Final publication | 2026-07-28 | ibid. |
| Previous revision | `2025-11-25` | [spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) |
| Authoritative schema | `schema/2026-07-28/schema.ts` | [repo](https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts) |

The revision is **final**, published ~7 days before this research date, after a
ten-week SDK validation window that began at the RC lock. Real-world server
deployment of `2026-07-28` should therefore be assumed to be *early and sparse*;
the population we measure will be overwhelmingly `2025-11-25` and earlier. The
census must treat protocol era as a measured variable, not an assumption.

---

## 2. The finding that invalidates the brief's D5/D6

**The `initialize` / `initialized` handshake has been removed from the protocol**
([SEP-2575](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)).
So has the `Mcp-Session-Id` header and the protocol-level session (SEP-2567).

The spec now defines two eras, and names them
([Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)):

- **Modern** — `2026-07-28` and later. No handshake. Every request carries
  protocol version, client identity and client capabilities in `_meta`.
- **Legacy** — `2025-11-25` and earlier. Establishes a session via `initialize`.

Verbatim from the versioning page:

> There is no negotiation handshake. Every request carries its protocol
> version, and the server accepts or rejects each request independently.

### `server/discover` replaces the handshake

Servers **MUST** implement `server/discover`
([Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)).
Clients **MAY** call it before anything else. Exact request shape:

```json
{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "ExampleClient", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Response is a `DiscoverResult`: `supportedVersions`, `capabilities`,
`instructions`, `ttlMs`, `cacheScope`, and `serverInfo` under
`_meta["io.modelcontextprotocol/serverInfo"]`.

**Note for scoring:** the spec explicitly says `serverInfo` is self-reported and
unverified — *"Clients **SHOULD NOT** rely on it for security decisions."* We may
report it as evidence; we must not treat it as identity.

### Consequence for the census

A single `initialize` probe now produces a **false negative on every modern
server** and a false negative on nothing else. D5 must become an era-detecting
probe that tries modern first and falls back, and the era split becomes a
published finding. See §7.

---

## 3. Required HTTP headers — a probe that omits these gets a 400

[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
(SEP-2243) mirrors body fields into headers and makes them mandatory.

| Header | Source field | Required for |
|---|---|---|
| `MCP-Protocol-Version` | `_meta` protocol version | Every POST |
| `Mcp-Method` | `method` | All requests |
| `Mcp-Name` | `params.name` or `params.uri` | `tools/call`, `resources/read`, `prompts/get` |

> These headers are **REQUIRED** for compliance.

Servers **MUST** reject a request missing a required standard header, or whose
header disagrees with the body, with `400 Bad Request` and JSON-RPC error
`-32020` (`HeaderMismatch`). The `MCP-Protocol-Version` header value **MUST**
equal the `_meta` value.

Other transport facts that matter to a prober:

- Client **MUST** send `Accept` listing **both** `application/json` **and**
  `text/event-stream`. A response may legitimately be either.
- Endpoint is **POST-only**. `GET` / `DELETE` on a modern MCP endpoint
  **SHOULD** return `405 Method Not Allowed`. **This breaks the brief's D3**,
  which specifies `HEAD /mcp` — see §7.
- Unknown method → `404` + JSON-RPC `-32601`. So a `404` is *not* proof of
  absence; the body must be parsed.
- Unsupported version → `400` + `UnsupportedProtocolVersionError` (`-32022`)
  carrying a `supported` array. **A 400 is frequently a positive detection**,
  and the `supported` array is exactly the era data we want.
- Servers **MUST** validate `Origin` and **MUST** return `403` if present and
  invalid. Our prober should omit `Origin` rather than forge one.
- Example endpoint given by the spec is `https://example.com/mcp`, but the path
  is explicitly implementation-chosen. There is **no normative default path**.

---

## 4. Server-card discovery: nothing has landed

The brief asks which of SEP-2127 / SEP-1649 / SEP-1960 landed. **Answer: none.**
As of 2026-08-04 there is **no standardized MCP server-card discovery mechanism.**

| Proposal | Type | State on 2026-08-04 | Source |
|---|---|---|---|
| SEP-2127 "MCP Server Cards" | PR, Extensions Track | **open**, `Draft`, created 2026-01-21, last updated 2026-08-03, target date **Apr 3 2026 (missed)** | [PR #2127](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127) |
| SEP-1649 | Issue | folded into #2127 | [Issue #1649](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649) |
| SEP-1960 `.well-known/mcp` | Issue | open, not adopted | [Issue #1960](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1960) |

The [Server Card Working Group charter](https://modelcontextprotocol.io/community/working-groups/server-card)
lists SEP-2127 as its single active work item, status `Draft`, and both WG lead
terms expire **2026-08-14** — ten days after this research date. The reference
implementation ("Tier-1 SDKs, end April") has not shipped.

### The design moved, and it moved away from `.well-known/mcp*`

This is the substantive correction. The brief's candidate list
(`/.well-known/mcp.json`, `/.well-known/mcp/server-card.json`,
`/.well-known/mcp`) reflects the *January* shape of the proposal. The current
SEP-2127 text and the
[experimental extension repo](https://github.com/modelcontextprotocol/experimental-ext-server-card)
specify something different:

- The card lives at **`<streamable-http-url>/server-card`** — *relative to the
  MCP endpoint*, not at the domain root. Cards "can be hosted at any unreserved
  URI"; this path is only the "recommended location".
- **Domain-level** discovery is delegated to a separate, cross-ecosystem effort:
  an **AI Catalog** at **`/.well-known/ai-catalog.json`**
  ([ai-catalog.io](https://ai-catalog.io/),
  [Agent-Card/ai-card](https://github.com/Agent-Card/ai-card)), a Linux
  Foundation working repo spanning MCP, A2A and others, requiring steering
  committee votes from **both** A2A and MCP to adopt.

The experimental repo carries an unambiguous status warning:

> **Status:** Experimental. This work is for prototyping and feedback only, and
> is not an accepted or official MCP extension.

Card fields observed: `$schema` (required), `name`, `version`, `description`,
and optional `title`, `icons`, `repository`, `websiteUrl`, remote transport
endpoints, `_meta`.

Maintainer design intent, quoted from the PR discussion
([@dsp-ant](https://github.com/dsp-ant)):

> The Server card should care about exposing HTTP and only that. We should aim
> for minimal information not maximal information.

**Secondary-source contamination — recorded deliberately.** Several third-party
blog posts and search summaries assert that `/.well-known/mcp/server-card.json`
is the settled "SEP-1649 / SEP-2127 consensus" path. This string **does not
appear** in the SEP-2127 patch. The only `.well-known` path in that patch is
`/.well-known/ai-catalog.json`. Do not cite the secondary sources; they are
circulating a path that no primary document specifies. This is itself worth a
line in the report.

### Candidate path inventory (the versioned config the brief asks for)

No mechanism has won, so the probe tries all of them and records which
responded. Provenance is tracked per candidate so we can report the
distribution honestly.

| # | Path | Provenance | Normative? |
|---|---|---|---|
| 1 | `/.well-known/oauth-protected-resource` | RFC 9728, via MCP auth spec | **Yes — MUST** |
| 2 | `/.well-known/oauth-protected-resource{/mcp-endpoint-path}` | RFC 9728 path-insertion form | **Yes — MUST** |
| 3 | `<mcp-endpoint>/server-card` | SEP-2127 / experimental ext | No — draft |
| 4 | `/.well-known/ai-catalog.json` | AI Catalog (LF) / SEP-2127 | No — draft |
| 5 | `/.well-known/mcp-server` | draft-serra-mcp-discovery-uri-04 | No — individual I-D |
| 6 | `/.well-known/mcp.json` | SEP-1649/2127 original (superseded) | No — historical |
| 7 | `/.well-known/mcp` | SEP-1960 | No — draft |
| 8 | `/.well-known/mcp/server-card.json` | secondary sources only | **No — unattested** |

Candidates 6–8 are retained precisely because measuring how much *stale-spec
cargo-culting* is deployed in the wild is a legitimate finding.

---

## 5. Authorization — normative, but conditionally

From [Authorization Server Discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery):

> MCP servers **MUST** implement the OAuth 2.0 Protected Resource Metadata
> ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)) specification to
> indicate the locations of authorization servers.

**Read in isolation this is misleading, and we initially misread it.** The
[Authorization index](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
scopes the entire section:

> Authorization is **OPTIONAL** for MCP implementations. When supported:
> [...]

and defines the role as *"A **protected** MCP server acts as an OAuth 2.1
resource server"*. The RFC 9728 MUST therefore binds only servers that
implement authorization — which is itself optional.

**Consequence for D4, and it is significant.** A public, unauthenticated MCP
server correctly publishes *no* Protected Resource Metadata. A `D4` failure is
therefore **not** evidence of non-compliance on its own; it is ambiguous
between:

- the server requires no authorization — legitimate, and probably the common
  case for read-only public servers, or
- the server requires authorization but does not advertise it — genuinely
  non-compliant.

Distinguishing them needs the handshake: a server that answers an
unauthenticated `server/discover` is public; one that returns `401` is
protected and *must* have the metadata. Until `D5` lands, D4 must be reported
as a positive signal when it passes and as **inconclusive** when it fails —
never as a failure to comply.

A `D4` *pass* remains the highest-confidence discovery evidence we can collect,
because the document is unambiguous when present. It is the interpretation of
absence that has to be careful.

A server **MUST** implement one of:

1. `WWW-Authenticate` header carrying `resource_metadata` on a `401`; or
2. a well-known URI, in this precedence order:
   - path-insertion form — endpoint `https://example.com/public/mcp` →
     `https://example.com/.well-known/oauth-protected-resource/public/mcp`
   - root form — `https://example.com/.well-known/oauth-protected-resource`

The metadata document **MUST** contain `authorization_servers` with at least one
entry.

**A `401` carrying `WWW-Authenticate: ... resource_metadata=...` is a positive
detection of a compliant MCP server.** Our probe must read `401` responses as
signal, never as failure. This is a read of a response header, not an
authentication attempt — it stays inside our ethics envelope.

### SEP-2351, the ".well-known discovery suffix" clarification

MCP **does not define an application-specific well-known suffix** for
authorization. It reuses RFC 8414's `oauth-authorization-server`. Clients
**MUST** try, for issuers with a path component:

1. `https://auth.example.com/.well-known/oauth-authorization-server/tenant1`
2. `https://auth.example.com/.well-known/openid-configuration/tenant1`
3. `https://auth.example.com/tenant1/.well-known/openid-configuration`

and without a path component, forms 1 and 2 at the root. Retrieved metadata
**MUST** be rejected if its `issuer` differs from the issuer used to build the
URL. We follow the same validation rule when recording evidence, so that a
mismatched document is scored as misconfiguration rather than as a pass.

Also relevant, all `2026-07-28`: SEP-2468 (`iss` validation, RFC 9207),
SEP-2352 (credentials bound to AS issuer), SEP-837 (OIDC `application_type`),
SEP-2207 (refresh tokens), SEP-2350 (scope accumulation on step-up).

---

## 6. DNS-based discovery — two competing individual drafts

The brief names one draft. There are **two**, and neither has working-group
standing.

### draft-serra-mcp-discovery-uri-04

[datatracker](https://datatracker.ietf.org/doc/draft-serra-mcp-discovery-uri/) ·
version **04**, dated **2026-03-25**, expires **2026-09-25** — i.e. eight days
after our launch date. Author: Marco Serra. Status: *Active Internet-Draft
(individual)*.

> This I-D is **not endorsed by the IETF** and has **no formal standing** in the
> IETF standards process.

Defines the `mcp://` URI scheme plus two-mode discovery. Exact TXT syntax:

```
_mcp.{domain} IN TXT "v=mcp1; src={url}[; auth={type}]"
_mcp.{domain} IN TXT "v=mcp1; registry={url}"
```

Well-known path: `/.well-known/mcp-server`. Clients **SHOULD** prefer the
well-known URI over DNS TXT; operators **SHOULD** enable DNSSEC. Requests IANA
registration of both the `mcp` URI scheme and the `mcp-server` suffix.

### draft-morrison-mcp-dns-discovery-01

[datatracker](https://datatracker.ietf.org/doc/draft-morrison-mcp-dns-discovery/01/)
· "Discovery of Model Context Protocol Servers via DNS TXT Records".
Individual Internet-Draft, Informational, published April 2026, expiring
October 2026. Verified against the source on **2026-08-05**.

Same underscore label, `_mcp.{domain}`, and the same `v=mcp1` version tag as
draft-serra. Exact syntax:

```
"v=mcp1; url=https://mcp.example.com; proto=streamable-http; pk=ed25519:<base64url>;
 epoch=<digit>; cap=<tokens>; attest=<tokens>; scope=<tokens>; priority=<digit>;
 ttl=<digits>; ext=https://..."
```

Required: `v` and `url`. Everything else optional. The draft declares itself
work-in-progress and unsuitable for citation.

**The two drafts collide on the label and diverge on the key.** Both claim
`_mcp.{domain}` with `v=mcp1`; serra names the endpoint `src=`, morrison names
it `url=`. One DNS lookup therefore covers both, and *which key a record uses
identifies which draft the operator implemented*. D2 records that as
`dialect: serra | morrison | both | unknown` — a free finding, and a concrete
illustration of the fragmentation the census exists to measure.

Note also that morrison's optional `pk=ed25519:<base64url>` can contain `=`
padding, so a record parser must split on the *first* `=` per field only.

Both drafts being unadopted and near expiry means D2's expected hit rate is
near zero. Keep the check — a zero on a named mechanism is a reportable result —
but do not build headline statistics on it.

---

## 7. Required corrections to the brief's check table

| Check | Brief says | Reality | Action |
|---|---|---|---|
| `D1` | GET candidate `.well-known` paths | Paths are wrong/stale; real target is endpoint-relative + AI Catalog | Rewrite candidate list per §4 |
| `D2` | TXT per "the IETF draft" | Two competing drafts | Probe both; verify morrison first |
| `D3` | `HEAD /mcp` | Modern endpoints **SHOULD** return `405` to HEAD/GET | Cannot use HEAD. See below |
| `D4` | GET `/.well-known/oauth-protected-resource` | Only **MUST**-level signal in the whole spec | Promote; add path-insertion form + `WWW-Authenticate` |
| `D5` | JSON-RPC `initialize` | **Method removed from the protocol** | Replace with era-detecting `server/discover` + legacy fallback |
| `D6` | `tools/list` | Still exists, but requires `Mcp-Method` header and dual-Accept | Keep; fix headers |

**D3 needs a decision from you.** `HEAD /mcp` cannot detect a modern server:
the spec tells servers to answer `405`. Detecting one requires a POST. But the
brief's §6 permits POST *only after discovery has already succeeded* — and D3
*is* discovery. Options, my recommendation first:

1. **Recommended.** Redefine D3 as a *negative-evidence* check: `GET`/`HEAD` the
   conventional paths and treat `405 Method Not Allowed` as the positive signal.
   It is exactly what the spec prescribes, it needs no POST, and it stays inside
   the ethics envelope untouched. A `405` at `/mcp` is strong evidence of a
   modern MCP endpoint.
2. Permit a single unauthenticated `server/discover` POST to at most three
   conventional paths per apex. Better recall, but it widens the POST envelope to
   undiscovered endpoints and needs an explicit ethics-doc amendment.
3. Drop conventional-path probing; rely on D1/D2/D4 only. Cleanest ethically,
   worst recall.

Option 1 is a genuinely novel detection trick and I'd rather publish it than
widen the crawl envelope.

---

## 8. Registry APIs (for the Shadow MCP pipeline, §8 of the brief)

### Official MCP Registry

Base URL **`https://registry.modelcontextprotocol.io`**
([docs](https://modelcontextprotocol.io/registry/registry-aggregators)).
Unauthenticated, read-only.

- `GET /v0.1/servers` — list all; cursor pagination via `limit` + `cursor`,
  `nextCursor` in `metadata`
- `GET /v0.1/servers/{serverName}/versions`
- `GET /v0.1/servers/{serverName}/versions/{version}` (`latest` supported)
- `GET /v0.1/servers?updated_since=<RFC3339>` — incremental sync
- Path params **must** be URL-encoded (`io.modelcontextprotocol%2Feverything`)
- Expected scrape cadence: **once per hour**. No uptime or durability guarantee.
- **Status: preview.** "Breaking changes or data resets may occur."

`server.json` fields useful for brand attribution: `name` (reverse-DNS, e.g.
`io.github.user/server` or `com.example/server`), `title`, `description`,
`version`, `packages[]`, `remotes[]`, `_meta`, `status`.

**Namespace authentication is a gift to the Shadow MCP classification.** The
registry verifies namespace ownership via GitHub, DNS or HTTP challenge. So
`com.example/*` is *provably* controlled by `example.com`, whereas
`io.github.someuser/example-mcp` is provably **not**. That gives us a
first-party/third-party split grounded in the registry's own cryptographic-ish
verification rather than fuzzy brand matching — far more defensible than the
brief's fuzzy-match plan. Fuzzy matching drops to a secondary signal.

Also honour `status`: `deleted` means moderation action (spam/malware/illegal).
Exclude from headline counts, report separately.

### Smithery

`@smithery/registry` npm SDK; `servers.list()` with a search query.
**Requires `bearerAuth`** — unlike the official registry. Rate limits not
documented publicly. **Unverified; needs an API key before Phase 5.** Flag as a
dependency risk.

### Not yet investigated

Glama, PulseMCP. PulseMCP is named as an official registry backer, so its data
may be redundant with the official registry.

---

## 9. Prior art — and the competitive problem

### Cloudflare "Agent Readiness score" — published 2026-04-17

[blog.cloudflare.com/agent-readiness](https://blog.cloudflare.com/agent-readiness/) ·
[Radar changelog](https://developers.cloudflare.com/changelog/post/2026-04-17-radar-ai-insights-updates/)

This was not in the brief and it materially affects the plan.

- Per-site checker at **isitagentready.com**, plus URL Scanner integration
- A **public Cloudflare Radar dataset**, updated **weekly on Mondays**,
  filterable by domain category, with a documented **Agent Readiness API**
- Population: **the 200,000 most visited domains**, category-filtered

Their published numbers:

| Signal | Adoption |
|---|---|
| `robots.txt` present | 78% |
| AI usage preferences declared | 4% |
| Markdown content negotiation | 3.9% |
| **MCP Server Cards / API Catalogs** | **fewer than 15 sites in 200,000** |

Their check set covers discoverability (`robots.txt`, sitemaps, `Link` headers),
content (Markdown for agents), bot access control (Content Signals, AI bot
rules, Web Bot Auth), and capabilities (Agent Skills, API Catalog, OAuth
discovery, **MCP Server Cards**, WebMCP).

**Relationship to this census.** This is the largest published measurement of MCP
discovery adoption to date and it should be cited as such, not competed with. Any
census of top global domains overlaps a population Cloudflare already covers at
20× the scale, weekly, for free.

What their dataset does *not* provide, and what this project therefore contributes:

- **Per-domain results.** Cloudflare reports aggregates — "The tool does not
  publish individual domain names in a leaderboard format." We name domains.
- **A raw open dataset.** They expose statistics through an API; we publish the
  underlying per-domain rows under CC-BY-4.0, with the probe code that produced
  them.
- **A registry-side join.** Nobody is matching public MCP registry entries back to
  the brands they claim to serve.
- **European and Italian breakouts.**
- **Which discovery mechanism responded.** Their check reports MCP Server Cards as
  a single signal; we record which of the eight candidate mechanisms answered, and
  the modern/legacy protocol-era split.

### agent-ready.dev

[agent-ready.dev](https://agent-ready.dev/) · treated as prior art per the brief,
to be cited respectfully, not cloned. 69 checks, CLI, browser extensions, its own
MCP server (`agent-ready-mcp`, a stdio wrapper over a hosted endpoint), plus
research pages. Scores against the Vercel Agent Readability Spec and
llmstxt.org. Covers three surfaces: discovery files, structural signals, and
protocol manifests (MCP Server Cards, A2A Agent Cards, `agents.json`,
`agent-permissions.json`).

### Others noted

Factory.ai "Agent Readiness" and an "AI Agent Readiness Report" skill both score
**repositories**, not domains. Different population; not competitors.

---

## 10. Input list licensing — an unresolved legal flag

[tranco-list.eu](https://tranco-list.eu/) is available; `/top-1m.csv.zip` for
the latest list, `/top-1m-id` for the permanent list ID that makes a run
citable. Also on PyPI (`tranco`) and BigQuery (`tranco.daily.daily`).

**The problem.** Tranco is an aggregate of five sources under **different**
licences, including **Cloudflare Radar under CC BY-NC 4.0** — non-commercial.
We intend to publish derived data under **CC-BY-4.0**, which permits commercial
use, from a commercial consultancy's site, feeding a lead-magnet page.

I am not a lawyer and this needs your decision before Phase 4 freezes an input
list. Cheapest mitigations: publish the *ranks we used* by reference (list ID +
date) rather than redistributing the list; or build the universe from a source
with clean commercial terms. Raising it now because it constrains which universe
we freeze, and re-freezing later invalidates reproducibility.

---

## 11. Open items for the next session

- [x] ~~Fetch `draft-morrison-mcp-dns-discovery-01`; record exact TXT format~~ — done 2026-08-05, §6
- [ ] Resolve the D3 HEAD-vs-POST decision with Marco (§7)
- [ ] Confirm Smithery API key availability and rate limits (§8)
- [ ] Investigate Glama and PulseMCP APIs; check PulseMCP redundancy (§8)
- [ ] Read the Cloudflare Agent Readiness API reference; determine exactly which
      fields are per-domain and which are aggregate (§9)
- [ ] Resolve Tranco licence question before freezing any universe (§10)
- [ ] Re-verify SEP-2127 state after 2026-08-14 (WG lead terms expire)
- [ ] Check whether `2026-07-28` conformance-test requirements (SEP-2484) produce
      a public conformance suite we could reuse as probe fixtures
