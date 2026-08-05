# Universe R — organizations that provably run an MCP server

**Frozen 2026-08-05.** The headline population. Once used in a published release
this file is never edited; corrections create a new dated list.

## Source

| | |
|---|---|
| Source | Official MCP Registry, `https://registry.modelcontextprotocol.io/v0.1/servers` |
| Pulled | 2026-08-05 |
| Entries in snapshot | 65,787 |
| Built by | `scripts/shadow/universe-r.ts` |

## Licensing

**Clean.** Derived entirely from the registry's own public, unauthenticated API,
which exists precisely so that aggregators can consume it. No ranked domain
list, no CC BY-NC term, nothing redistributed under a third party's conditions.
Unlike any Tranco-derived universe, this list can be republished in full
alongside results — which is what makes the census reproducible by a stranger
without them having to source a licensed input.

## Selection rule

An apex enters Universe R when the registry contains at least one non-deleted
server carrying evidence **only that domain's owner could produce**:

1. **`verified_namespace`** — a reverse-DNS namespace resolving to the apex.
   Registry names are reverse-DNS and the registry verifies ownership by DNS or
   HTTP challenge before allowing a publish, so `com.stripe/*` is provably
   controlled by `stripe.com`.
2. **`endpoint_on_apex`** — a declared remote endpoint hosted on the apex. Only
   the domain owner can serve from `mcp.stripe.com`.

Excluded:

- **`io.github.*` namespaces as a source of apexes.** They verify a GitHub
  *account*, reverse to `<user>.github.io`, and are never the brand. Their
  *endpoints* still count, which is how a first-party server published under a
  company's GitHub org — `io.github.zoom/*` serving from `mcp.zoom.us` — is
  correctly included.
- **Public suffixes.** Resolved with a public suffix list, so
  `foo.workers.dev` is its own registrable domain and does not make Cloudflare
  look like the operator of everything hosted on it.
- **RFC 2606 reserved names** and hostnames containing template placeholders
  (`{env}.azurewebsites.net`).

## Composition

| | n |
|---|---|
| Apexes with an MCP server | 7,447 |
| — organizations (publish their own) | **7,377** |
| — platforms (host other people's) | 70 |

Organizations by evidence:

| Evidence | n |
|---|---|
| Verified namespace only | 631 |
| Endpoint on apex only | 3,086 |
| Both | 3,660 |

### Platforms

A domain hosting **three or more** servers whose namespaces belong to somebody
else is acting as hosting infrastructure rather than publishing its own server.
The largest: `pipeworx.io` (1,311 servers), `smithery.ai` (217), `ansvar.eu`
(118), `klymax402.com` (100), `mcp.ai` (99), `caseyjhand.com` (75),
`apify.actor` (69), `mcpize.run` (55).

They are tagged in the `kind` column rather than deleted, because "how
discoverable are MCP hosting platforms" is a legitimate question — just a
different one. Including them in the organization denominator would let a few
thousand deployments on shared infrastructure drive the headline rate.

The threshold of three is a judgement call and is recorded here so it can be
argued with. A domain hosting one or two foreign-namespace servers is more
likely a company hosting a partner's integration than a platform.

## Known limitations

- **Registry-only.** An organization running an MCP server that it never
  registered is invisible to this universe. Universe R therefore measures
  *"organizations that both run and registered a server"*, and the discoverability
  rate computed over it should be read as applying to that population — very
  plausibly the most MCP-engaged population there is, which makes any low
  discoverability figure a conservative one.
- **The registry is in preview** with no durability guarantee and may reset. The
  snapshot is what makes this reproducible; re-pulling later will not reproduce
  it exactly.
- **Personal domains are included.** `caseyjhand.com` is an individual, not a
  brand. They genuinely run servers, so they are in; segmenting brands from
  individuals would need a judgement the data does not support.
