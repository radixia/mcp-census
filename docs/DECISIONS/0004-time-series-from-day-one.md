# 0004 — The census is a time series, and changes are debounced

- **Date:** 2026-08-05
- **Status:** accepted

## Context

The original plan was a one-shot census: crawl, publish, done. Two things
changed that.

First, feasibility. After fixing the retry behaviour the pilot ran 501 domains
in 39 minutes, and the politeness model caps us at 64 concurrent apexes — which
puts a 10k census at roughly 3.4 hours. A daily run is comfortably affordable on
existing hardware, so the marginal cost of a series over a snapshot is close to
zero.

Second, value. A one-shot census is citable once. A series answers the question
our own pilot finding immediately provokes: *every deployed server card is on a
superseded or unattested path and nobody implements the current spec direction —
is that changing?* Cloudflare publishes weekly aggregates of a single boolean;
nobody publishes which mechanism, in what format, over time. The day the first
domain adopts `/.well-known/ai-catalog.json`, a daily run catches it.

The blocker is noise. During the pilot `otomoto.pl` answered `200` to the
crawler and `403` to a manual check an hour later — ordinary bot-mitigation
flapping. At a ~1% base rate, that kind of flapping generates more apparent
changes than real adoption does. A raw delta feed would be mostly false.

## Decision

**Model the census as a time series from the first schema migration**, rather
than adding history later:

- `runs` is the spine; every scan and check result is keyed to a run.
- Nothing is updated in place. "Current" is a view over the newest complete run.
- A run that did not finish is flagged `usable_for_delta = 0`, because every
  unvisited domain in it would otherwise look like it had just disappeared.
- `candidate_hits` is normalised out of D1's evidence JSON so the
  adoption-by-mechanism curve is a `GROUP BY`, not a scan over every blob in the
  series.
- `run_aggregates` is precomputed per run so the public chart never aggregates
  the whole history at request time.

**And debounce every published change.** A status change lands in
`pending_changes` when first observed and is promoted to `status_changes` only
once it persists across two consecutive complete runs. Only `status_changes`
is ever shown.

## Consequences

- The public "recent changes" feed is trustworthy by construction. A flap
  costs one row in a staging table nobody reads.
- Confirmation lags reality by one run — about a day. That is the right trade:
  a feed that cries wolf is worse than a feed that is a day late, and the
  methodology can state the lag plainly.
- Changes are categorised. `discovery` events are rare and newsworthy;
  `posture` events (F2, 24.6% base rate with real churn) are frequent and are
  what keeps the feed from looking like a dead space between discovery events.
- Self-submitted domains from `/census/check` share the `domains` table behind a
  `source` flag and are excluded from every headline denominator. Letting
  on-demand checks into the statistics would make the census a convenience
  sample, which is precisely the flaw the project criticises in prior work.
- We are not building realtime transport. At 0–2 discovery events per day across
  10k domains, a live ticker would be an empty room; a server-rendered "recent
  changes" list with a short cache is indistinguishable from realtime at this
  event rate and needs no client framework. A genuinely live view is Phase 8
  conference mode, where a hallway screen justifies it.
- This makes fixing our own row more urgent, not less: a daily tracker
  re-measures and republishes `radixia.ai` every day.
