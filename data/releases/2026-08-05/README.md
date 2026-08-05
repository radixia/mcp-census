# MCP Census — release 2026-08-05

**Immutable.** Corrections appear in the next release rather than rewriting this
one; a citable snapshot that changes is not a snapshot. The one exception is an
opt-out received after publication, which is removed from later releases and
from the live site, and noted.

| | |
|---|---|
| Domains | 7422 |
| Assessed | 7421 |
| Not assessable | 1 |
| Methodology | `0.2.0-draft` |
| Candidate set | `2026-08-04` |

## Headline

**60.6%** of assessed organisations publish no discovery
signal an agent could use — 4495 of 7421. 20.3%
publish a server card; 21.9% answer a handshake.

Unassessed domains are excluded from every denominator. A domain that excluded our
crawler is reported as its own category, never as a zero.

## Files

| File | What |
|---|---|
| `census.csv` | one row per domain, one column per check |
| `census.json` | the same rows with full evidence |
| `census.jsonl` | the same, one object per line |
| `summary.json` | the statistics above, recomputed from these rows |
| `universe.csv` | the frozen population, with its provenance |
| `to-parquet.sql` | DuckDB script for Parquet, plus the headline query |
| `zenodo.json` | deposition metadata |

## Reproducing the headline

```sql
SELECT round(100.0 * SUM(CASE WHEN D1<>'pass' AND D2<>'pass'
                               AND D3<>'pass' AND D4<>'pass'
                          THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_unreachable
  FROM read_csv_auto('census.csv', header=true)
 WHERE assessed = 1;
```

The population is derived from the official MCP Registry's public API, so nothing
here depends on a licensed input and the universe can be republished in full.

Code Apache-2.0. Data CC-BY-4.0.

## Which file to take

`census.jsonl.gz` is canonical for the per-domain rows: one JSON object per line,
full evidence, 1.6 MB compressed against 33.5 MB plain. `census.csv` is the same
rows flattened for a spreadsheet, without the evidence blobs.

The uncompressed `census.jsonl` and the monolithic `census.json` are not
distributed. They contain nothing the gzipped JSONL does not, and shipping 86 MB
of duplicate data would only make this release expensive to fetch. Gunzip if you
want them:

```
gunzip -k census.jsonl.gz
```

## Methodology version

This release cites methodology **0.2.0**. The per-domain rows carry
`0.2.0-draft`, which was the value of `METHODOLOGY_VERSION` at crawl time; the
document was finalised the same day and that change was one of status, not of
semantics — no check was added, removed, or redefined.

The rows were not rewritten to match. Editing measured data to agree with a later
document is how a dataset stops being evidence.

## Provenance

The crawl was driven by the local runner (`scripts/pilot/run.ts`), not by the
Worker queue, because a 7,400-domain backfill is resumable and watchable that way.
The probe code is identical — the same `packages/core` — so the rows are the same
rows the queue would have produced. Every subsequent run comes from the nightly
cron.
