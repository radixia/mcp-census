# Universe D — AGNTCon + MCPCon Europe 2026

**Frozen 2026-08-05.** Once used in a published release this file is never
edited; corrections create a new dated list.

## Event

AGNTCon + MCPCon Europe, **17–18 September 2026**, RAI Amsterdam, Netherlands.
Run by the Linux Foundation / Agentic AI Foundation.

## Sources

| Source | URL | Retrieved |
|---|---|---|
| Sponsor list, by tier | https://events.linuxfoundation.org/agntcon-mcpcon-europe/ | 2026-08-05 |
| Programme and speaker affiliations | https://agntconmcpconeu26.sched.com/ | 2026-08-05 |

## Licensing

None of the constraints that affect the other universes apply here. This list is
compiled from a **public conference programme**, not from a ranked domain list,
so there is no CC BY-NC problem and nothing is redistributed under someone
else's terms. Universe D can therefore be published in full alongside results.

## Selection rule

1. **Every sponsor** named on the event page, at every tier. Complete as
   published on the retrieval date.
2. **Speaker organizations** named in the programme. **Incomplete by
   construction** — the programme lists 130+ speakers across 100+ sessions and
   the source page enumerated only the keynotes and a subset of session
   speakers, summarising the remainder as "60+ additional speakers from
   companies including …". Only organizations explicitly named were included.
   Independent speakers and law firms were excluded as not brands with an agent
   surface to measure.
3. Organizations were mapped to their **registrable apex domain**, because that
   is what the probe takes. Where a sponsor's product lives on a subdomain
   (`aws.amazon.com`, `cloud.google.com`) the apex is recorded and the
   organization name preserved in its own column.

## The `resolution` column

How each domain was tied to the organization. This matters: a frozen universe
with a wrong domain publishes a finding about the wrong company.

- **`confirmed`** — the domain resolves and either returned `200` or served a
  page whose title names the organization.
- **`inferred`** — the domain resolves in DNS, but the mapping is a reasonable
  inference from the organization's name that could not be positively confirmed
  at freeze time (the host blocked automated requests or returned no title).
  `omnys.com`, `authplane.com`, `aaif.io`, `deepmind.google`, `humanlayer.dev`,
  plus `amazon.com` and `google.com`, which are correct apexes but map to a
  parent company rather than the sponsoring business unit.

**Inferred rows must be confirmed by hand before this universe is used for
outreach or published as a leaderboard.** They are safe for aggregate
statistics, where a single mis-mapping does not change a percentage, and unsafe
for anything that names a company.

## Counts at freeze

- 31 sponsors (4 diamond, 3 platinum, 14 gold, 10 startup)
- 21 speaker organizations
- 52 rows, 52 unique apexes

## Overlap

Several rows also appear in other universes (`amazon.com`, `google.com`,
`microsoft.com`, `oracle.com`, `github.com`, `cisco.com`). That is intentional:
universes are tags, not partitions, and a domain may belong to several. Headline
statistics must deduplicate by apex before computing any global rate.
