# 0005 — D1 holds state, R2 holds evidence

- **Date:** 2026-08-05
- **Status:** accepted

## Context

The first schema put each check's evidence JSON in D1. Measuring the real output
of three runs rather than estimating:

| | |
|---|---|
| Evidence per domain per run | **~4.3 KB** (8 KB pretty-printed) |
| Of which `F2` alone | **2,035 bytes**, nearly half |
| A full Universe R run (7,377 domains) | ~32 MB |
| Daily cadence | **~11.6 GB/year** |
| D1 maximum database size | **10 GB** |

A year of daily full-fidelity crawling does not fit, and Universe R grows as the
registry does. `F2` is the worst offender: twenty crawler tokens serialised per
domain per day, `not_mentioned` for roughly three quarters of them.

Meanwhile the pages that matter — leaderboard, per-domain permalink, adoption
chart — read only status, score and history. Evidence is opened on one page view
in a thousand.

## Decision

**One database, D1, and it holds only the small data.**

| Store | Contents | Growth |
|---|---|---|
| **D1** | domains, runs, scans, per-check *status*, candidate hits, aggregates, changes, opt-outs | ~850 MB/year |
| **R2** | full evidence per scan, the registry snapshot, raw artifacts, Parquet releases | ~3 GB/year, ≈ $0.05/mo |
| **KV** | on-demand scan cache, rate limiting | negligible |
| **git** | frozen universes, methodology, release manifests | trivial |

No second database and no external service. `scans.evidence_key` points at the
R2 object; `check_results` keeps a short closed-vocabulary `detail` where the
status alone is not informative enough, and never a blob.

### R2 keys are apex-first

`evidence/<apex>/<run_id>.json`, **not** `runs/<run_id>/<apex>.json`.

This is driven by the ethics commitment rather than by performance. We promise
to honour opt-outs within 24 hours, and "delete everything we hold about this
domain" has to be a prefix delete. Run-first keys would make it a scan across
every run ever performed, and that gets worse every day the project runs.

### Cadence is tiered

Nothing changes daily on a domain that has been `Absent` for six months.

- **Daily:** watchlist — anything that has ever shown a signal, all of Universe
  D, and anything with a recent change. ~1,500 domains.
- **Weekly:** the full Universe R.

Roughly 4× less data than uniform daily, and more honest: we should not imply we
re-verify 7,377 domains every night when there is no reason to.

## Consequences

- D1 stays small enough that its size never becomes a project risk.
- The detail view costs one R2 GET, on a page that is already dynamic.
- Published releases are Parquet in R2, served directly. Anyone can point DuckDB
  at the URL and re-derive the headline number without us running a query
  service — and, because Universe R is registry-derived, without needing a
  licensed input. That is the "a stranger can reproduce this" criterion met by
  object storage instead of infrastructure.
- Recomputing a score from stored evidence still works: the evidence is intact
  in R2, and scoring is a pure function of it.
- `F2` evidence should store only non-default entries. Most domains mention no
  AI crawler at all, and the default-heavy array is roughly half the payload.
- Trade-off accepted: no SQL over evidence fields. If that is ever needed it is
  a DuckDB query over the Parquet release, not a reason to put blobs back into
  D1.
