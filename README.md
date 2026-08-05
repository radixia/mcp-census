# MCP Census

**A census of the agent-reachable web.** For a frozen, published list of domains:
could an AI agent, starting from nothing but the domain name, discover and connect
to an [MCP](https://modelcontextprotocol.io) server for that brand?

The dataset is open, the code is open, and we name domains.

> **Status: measuring.** The site is live at
> **[www.radixia.ai/census](https://www.radixia.ai/census/)** and the full census
> is running. The launch target is **2026-09-17**, timed to
> [AGNTCon + MCPCon Europe](https://events.linuxfoundation.org/agntcon-mcpcon-europe/)
> in Amsterdam. No frozen release has been cut yet.

## The headline

**Two-thirds of the organisations that provably run an MCP server publish nothing
an agent could use to find it.** Measured over a 400-domain sample of the 7,377
organisations the official MCP Registry proves run one — 66.8% had no discovery
signal at all, and only 17.3% published a server card.

The figure is *conservative*: this population both built **and registered** a
server, which makes it plausibly the most MCP-engaged population there is.

And of the cards that do exist, **90% sit on a path that is superseded or appears
in no specification document at all** — the second most-deployed path in the world
propagated through blog posts. Only 7% use the location the current proposal
actually defers to.

Cloudflare [measured 200,000 domains in April 2026](https://blog.cloudflare.com/agent-readiness/)
and found MCP Server Cards on fewer than 15. We are not re-deriving that at
smaller scale — we measure the population that matters, name domains, publish the
raw per-domain dataset, record *which* of eight competing discovery mechanisms
answered, and join the census against the public registry.

## What this is not

- **Not a security scanner.** We never call a tool, never authenticate, never
  fuzz, never test for weaknesses. Every request is a plain unauthenticated read
  of a document published on purpose. See
  [docs/CRAWLER-ETHICS.md](docs/CRAWLER-ETHICS.md).
- **Not another "is my site AI-ready" checker.** That space is well occupied by
  [agent-ready.dev](https://agent-ready.dev/), which we treat as prior art and
  cite rather than clone.
- **Not a convenience sample.** Every published study in this space so far
  measures whoever showed up. We measure a frozen population and publish it.

## Why the spec notes matter

MCP discovery is contested and moving. As of 2026-08-04, verified against primary
sources:

- The `initialize` handshake **no longer exists** — removed in revision
  `2026-07-28`, replaced by `server/discover`.
- **No server-card discovery mechanism has been standardised.** SEP-2127 is an
  open draft; the design has moved to an endpoint-relative card plus a Linux
  Foundation "AI Catalog".
- **RFC 9728 is mandatory — but only for MCP servers that implement
  authorization, and authorization is itself OPTIONAL.** A public server
  correctly publishes nothing there.
- The path most widely cited online, `/.well-known/mcp/server-card.json`, appears
  in **no primary document**.

Full findings with URLs and access dates: [docs/SPEC-NOTES.md](docs/SPEC-NOTES.md).

## Reproducing this

Reproducibility is the whole value proposition. A stranger should be able to clone
this repo and get our headline number.

```bash
pnpm install
pnpm test          # 309 tests
pnpm build
```

The population is derived from the official MCP Registry's public API, so — unlike
anything built on a ranked domain list — the frozen universe is republished in
full and you do not need a licensed input to repeat the work.

```bash
# rebuild the universe from a registry snapshot
node scripts/shadow/pull.ts --out out/registry.json
node scripts/shadow/universe-r.ts --registry out/registry.json --out universe.csv

# run the census
pnpm pilot --input universe.csv --out out/run --concurrency 64

# cut a release: CSV, JSON, JSONL, summary, Zenodo metadata, DuckDB → Parquet
node scripts/export/release.ts --jsonl out/run/results.jsonl --date YYYY-MM-DD
```

Frozen input lists live in `data/universe/` with provenance and download dates;
frozen output snapshots live in `data/releases/<date>/`.

## Checking a single domain

```bash
npx mcpcensus check example.com
```

It runs the same probes as the census, from the same `packages/core`, so a single
check and a census row are always comparable. `--json` emits the dataset's own
shape; `--all` dumps the evidence. Exit code 2 means *not assessable* — a domain
whose `robots.txt` excluded us is never reported as a zero.

Not yet published to npm, so for now: `pnpm install && pnpm build && node
packages/cli/dist/cli.js check example.com`.

## Layout

```
packages/core/     probes, politeness guards, scoring. Isomorphic, no I/O, no Cloudflare deps
packages/cli/      npx mcpcensus
apps/worker/       the Worker: routes, pages, queue consumer, cron, deltas
apps/worker/src/web/  templates, stylesheet, inline-SVG charts
data/universe/     frozen input lists, with provenance
data/releases/     frozen output snapshots, one directory per release date
docs/SPEC-NOTES.md what the spec actually says today, with URLs and access dates
docs/DECISIONS/    short ADRs for real forks in the road
scripts/           one-off analysis, dataset export, report figures
```

## Opting out

Email the address in [docs/CRAWLER-ETHICS.md](docs/CRAWLER-ETHICS.md), disallow the
`MCPCensus` user-agent in your `robots.txt`, or open a PR against
[`data/optouts.txt`](data/optouts.txt). Honoured within 24 hours, covering the
domain and all subdomains.

## Conflict of interest

This project is run by [Radixia S.r.l.](https://www.radixia.ai), a commercial AI
and cloud consultancy, and **`radixia.ai` is included in the measured population
rather than excluded from it.** We have a commercial interest in this subject
mattering. The disclosure is at the top of
[METHODOLOGY.md](METHODOLOGY.md); discount our own row accordingly.

## Licences

- Code: [Apache-2.0](LICENSE)
- Data: [CC-BY-4.0](LICENSE-DATA)
