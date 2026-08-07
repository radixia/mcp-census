# MCP Census — release 2026-08-07

**Immutable.** Corrections appear in the next release rather than rewriting this
one; a citable snapshot that changes is not a snapshot. The one exception is an
opt-out received after publication, which is removed from later releases and
from the live site, and noted.

| | |
|---|---|
| Domains | 7422 |
| Assessed | 7421 |
| Not assessable | 1 |
| Methodology | `0.4.0` |
| Candidate set | `2026-08-07` |

## Headline

**60.3%** of assessed organisations publish no discovery
signal an agent could use — 4474 of 7421. 20.4%
publish a server card; 22.3% answer a handshake.

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
