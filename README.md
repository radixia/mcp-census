# MCP Census

**A census of the agent-reachable web.** For a frozen, published list of domains:
could an AI agent, starting from nothing but the domain name, discover and connect
to an [MCP](https://modelcontextprotocol.io) server for that brand?

The dataset is open, the code is open, and we name domains.

> **Status: pre-release scaffold.** Nothing has been measured yet and no numbers
> have been published. The launch target is **2026-09-17**, timed to
> [AGNTCon + MCPCon Europe](https://events.linuxfoundation.org/agntcon-mcpcon-europe/)
> in Amsterdam. Follow the repo; the commit history is part of the record.

## The headline number

None yet — and we would rather say so than pre-announce one.

For context on what we expect to find: Cloudflare
[measured the 200,000 most visited domains in April 2026](https://blog.cloudflare.com/agent-readiness/)
and found MCP Server Cards on **fewer than 15 of them**. Our contribution is not
re-deriving that number at smaller scale. It is naming domains, publishing the raw
per-domain dataset, breaking out Europe and Italy, measuring *which* of the eight
competing discovery mechanisms actually respond in the wild, and joining the
census against public MCP registries to find brands whose MCP server was written
by somebody else.

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
pnpm test
pnpm build
```

Once the pilot exists, the full census run and the release-snapshot procedure will
be documented here. Frozen input lists live in `data/universe/` with provenance and
download dates; frozen output snapshots live in `data/releases/<date>/`.

## Checking a single domain

```bash
npx mcpcensus check example.com
```

The CLI lands in Phase 2. It will run the same probes as the census, from the same
`packages/core`, so a single check and a census row are always comparable.

## Layout

```
packages/core/     probes, politeness guards, scoring. Isomorphic, no I/O, no Cloudflare deps
packages/cli/      npx mcpcensus
apps/worker/       the Worker: HTTP routes, queue consumer, cron
apps/web/          templates and static assets served by the Worker
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
