# Universe R — first measurement, 2026-08-05

The headline result. **Not a release**: this is a 400-domain sample of the
7,377-organization universe, run to establish whether the population answers the
question before committing to the full crawl. It does.

- **Population:** organizations that *provably* run an MCP server — registry-
  verified namespace or an endpoint hosted on their own apex. See
  `data/universe/R-registry-2026-08-05.provenance.md`.
- **Sample:** every 18th row of the 7,377 organizations, ordered by server count
  — 400 domains. Systematic, not random; see Limitations.
- **Methodology:** `0.2.0-draft`, candidate set `2026-08-04`
- **Run:** 400 domains, 42 minutes, concurrency 16, zero guard violations

## Coverage

| | n | % |
|---|---|---|
| Assessed | 400 | 100.0% |
| Blocked by `robots.txt` | 0 | 0.0% |
| Unreachable | 0 | 0.0% |

Perfect coverage. These domains run MCP servers; they are not hostile to
machines.

## The headline

> **Two-thirds of the organizations that run an MCP server publish nothing an
> agent could use to find it.**

| | n | % |
|---|---|---|
| **No discovery signal at all** (`D1`, `D3`, `D4` all fail) | **267** | **66.8%** |
| Any discovery signal | 133 | 33.3% |
| Publishes a server card (`D1`) | 69 | 17.3% |

Per check:

| Check | n | % |
|---|---|---|
| `D1` server card | 69 | 17.3% |
| `D2` DNS TXT | 0 | 0.0% |
| `D3` conventional endpoint | 66 | 16.5% |
| `D4` RFC 9728 | 62 | 15.5% |
| `F1` text fallbacks | 177 | 44.3% |
| `F2` declared crawler posture | 87 | 21.8% |

Bands: 181 Absent, 102 Text-only, 117 Discoverable.

This is the number the project exists to produce, and it is **conservative**.
Universe R contains only organizations that both built *and registered* a
server — plausibly the most MCP-engaged population that exists. If two-thirds of
*them* are unreachable from their own front door, the figure for everyone else
is worse.

## Compared with the open web

The same probe, same day, three populations:

| | Universe R (400) | AGNTCon cohort (52) | Open web (501) |
|---|---|---|---|
| `D1` server card | **17.3%** | 11.5% | 1.0% |
| `D4` RFC 9728 | 15.5% | 7.7% | 0.8% |
| `F1` text fallbacks | 44.3% | 51.9% | 8.6% |
| Discoverable | 29.3% | 15.4% | 1.4% |

The open-web rate is a rounding error and duplicates work Cloudflare published
in April across 200,000 domains. The interesting variance is entirely inside the
MCP-engaged population.

## Which mechanism answered

86 card responses across 69 domains — enough to state a distribution rather than
list anecdotes:

| Path | Provenance | Hits | Share |
|---|---|---|---|
| `/.well-known/mcp.json` | **superseded** — original SEP-1649/2127 shape, never accepted | 44 | 51% |
| `/.well-known/mcp/server-card.json` | **unattested** — appears in no primary document | 33 | 38% |
| `/.well-known/ai-catalog.json` | **current SEP-2127 direction** | 6 | 7% |
| `/.well-known/mcp` | historical, SEP-1960 | 3 | 3% |
| `/.well-known/mcp-server` | draft-serra | 0 | 0% |
| `_mcp.<apex>` TXT | draft-serra / draft-morrison | 0 | 0% |

**90% of deployed server cards sit on a path that is either superseded or exists
in no specification document at all.** The single most-deployed path,
`/.well-known/mcp.json`, was superseded in-flight. The second, at 38%, was never
in any primary document — it propagated through blog posts.

Only 7% are where the specification is actually heading.

The earlier pilot found zero adopters of `ai-catalog.json` across the open web
and concluded "nobody implements the current direction". With a population that
actually runs servers, the finding is sharper and more useful: **adoption of the
current direction exists, and it is 7%.**

## Limitations specific to this run

- **Systematic, not random sampling.** Every 18th row of a list ordered by
  server count. That spreads the sample across the whole distribution rather
  than concentrating it, but it is not a simple random sample and confidence
  intervals should not be computed as if it were. The full universe run
  replaces it.
- **`D5` is not implemented**, so nothing can be *confirmed* — every
  "Discoverable" here means "published something findable", not "an agent
  connected to it". Nothing in this run can exceed 65 points.
- Registry-only population: an organization running an unregistered server is
  invisible. See the universe provenance note.
- All the general limitations in `METHODOLOGY.md` apply.
