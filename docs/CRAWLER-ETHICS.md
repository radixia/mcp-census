# Crawler ethics

This page explains exactly what the MCP Census crawler does, why, and how to be
excluded from it. The URL of this page is in every request we send, so if you found
us in an access log you are in the right place.

**Contact for opt-out or anything else:** `census@radixia.ai`

Run by [Radixia S.r.l.](https://www.radixia.ai), Milan/Pavia, Italy.

---

## What we are doing

We are taking a census of the agent-reachable web: for a frozen, published list of
domains, we record whether an AI agent could discover and connect to a
[Model Context Protocol](https://modelcontextprotocol.io) server for that brand.

The dataset is published openly under CC-BY-4.0 and the code under Apache-2.0, so
anyone can check our work or re-run it themselves.

## What we are not doing

**This is not a security scanner.** We do not look for vulnerabilities, and a
finding from us is never a report that something is broken or exposed.
Specifically, we never:

- call an MCP tool (`tools/call`), ever, under any circumstances
- send an `Authorization` header, a cookie, or any other credential
- attempt authentication, or try to obtain a token
- fuzz, brute-force, or enumerate anything
- probe any path that is not on our published candidate list
- use any HTTP method other than `GET`, `HEAD`, and one narrowly-scoped `POST`
- follow a redirect that leaves the domain we were asked to look at

Every single request we make is a plain, unauthenticated read of a document you
published on purpose, at a location a standard or a public proposal told you to
publish it.

## Exactly what we request

For each domain, at most:

1. `/robots.txt` — first, always, and it governs everything after it.
2. A short list of `.well-known` paths and conventional endpoints, drawn from the
   MCP specification and from public discovery proposals. The full versioned list
   lives in
   [`packages/core/src/config/candidates.ts`](https://github.com/radixia/mcp-census/blob/main/packages/core/src/config/candidates.ts)
   with the provenance of each entry.
3. A DNS `TXT` lookup at `_mcp.<your-domain>`, per a public IETF Internet-Draft.
4. Plain-text agent fallbacks: `/llms.txt`, `/llms-full.txt`, `/AGENTS.md`.
5. **Added 2026-08-07:** one `GET` of your home page, `/`, to read the `Link`
   header and any `<link rel="ai-catalog">` in the `<head>`. The AI Catalog
   specification puts those ahead of the well-known path, so without this we were
   measuring only its optional fallback and calling the result adoption.

   What we do with it is bounded on purpose. We stop reading at `</head>`. We
   record that an advertisement exists and whether its target is this domain, a
   subdomain or somebody else — never the URL itself, because you choose that
   string and we will not republish it. **We do not fetch it.** Following an
   advertised URL would put a fetcher of third-party-controlled addresses inside
   an unattended crawler, and that is a request-forgery surface we have no reason
   to build. `/` was already on the candidate list; what is new is asking for it
   on the apex, and reading the body.
6. **Only if steps 2–3 already found an MCP endpoint:** one unauthenticated
   JSON-RPC `POST` to that endpoint — `server/discover` (or `initialize` for
   servers on an older protocol revision), and if that succeeds, `tools/list`.
   Both are read-only. `tools/list` returns the tool descriptions you chose to
   publish; we record their shape, not their contents' effects.

That is the whole surface. There is no step 6.

## How politely

| | |
|---|---|
| Rate | **1 request per second, maximum**, per domain |
| Concurrency | At most **64 domains** probed at once, crawl-wide. This bounds how many *different* sites we visit in parallel — your site never sees more than the 1 req/s above, no matter what the crawl is doing elsewhere |
| Timeouts | 5s connect, 10s total |
| Retries | Exponential backoff on `429` and `5xx`, then we give up after 2 |
| Redirects | One hop, and only if it stays on your domain |
| `robots.txt` | Respected for **every** path, including `.well-known` |
| User-Agent | Always identifies us and links here |

Our User-Agent is:

```
MCPCensus/<version> (+https://www.radixia.ai/census/crawler; census research; opt-out: <email>)
```

### On `robots.txt`

We respect it even where we arguably would not have to. If your `robots.txt`
disallows us, we stop, record the domain as `skipped_by_robots`, and move on. That
category is reported publicly as its own number rather than folded into our
failures, because excluding it silently would flatter our coverage statistics.

A `Crawl-delay` directive, if you set one, is honoured and overrides our own rate
limit when it is stricter.

## How to opt out

Any one of these works:

- **Email `census@radixia.ai`** from an address at the domain, or with any
  reasonable indication that you speak for it. One line is enough.
- **Disallow us in `robots.txt`:**

  ```
  User-agent: MCPCensus
  Disallow: /
  ```

- **Open an issue or a pull request** against
  [`data/optouts.txt`](https://github.com/radixia/mcp-census/blob/main/data/optouts.txt)
  in the public repository.

**We honour opt-outs within 24 hours.** The denylist is a committed file the
crawler reads at start-up, so an opted-out domain costs zero requests on the next
run, not one. Opting out covers the domain and all its subdomains.

If you are already in a published dataset when you opt out, tell us and we will
remove your rows from the next release and from the live site. We will not
retroactively rewrite an already-citable frozen snapshot, because that would break
the reproducibility the whole project rests on — but we will note the removal.

## Corrections

If we got something wrong about your domain, the per-domain page has a rescan
action, and we would rather hear about it than not: same address, or an issue on
the repository. Being wrong in public about a named domain is the failure mode we
care most about avoiding.

## We are in our own dataset

`radixia.ai` is measured by the same probe as everyone else and is not excluded.
Radixia is an AI and cloud consultancy, so we have a commercial interest in this
subject; that conflict is disclosed at the top of our
[methodology](https://www.radixia.ai/census/methodology). Excluding ourselves
precisely where we happen to score well would read as less honest, not more.

## Current status

The crawler has **not yet made a single request to a domain we do not own.**
Nothing has been measured and no results have been published.

The opt-out address above is live and monitored. The code enforces that:
[`assertCrawlerIdentity()`](https://github.com/radixia/mcp-census/blob/main/packages/core/src/politeness.ts)
refuses to construct a User-Agent — and therefore any request at all — if this
project is ever left without a real contact address.

Last updated: 2026-08-05.
