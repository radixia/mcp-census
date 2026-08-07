# Draft comment — experimental-ext-server-card#33

**Status: not posted.** See [`outreach.md`](outreach.md).

**Target:** [#33 — Discovery: recommend ETag + conditional requests
(If-None-Match/304) as a SHOULD](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/33)
(closed COMPLETED 2026-07-24).

**Why:** it is two weeks old, so this is a baseline rather than a verdict — which
is the useful thing to have when a recommendation has just landed.

---

## A baseline for the caching SHOULD

Same run: 7,422 domains from the MCP Registry, 2026-08-07, methodology `0.4.0`.

**Denominator: 2,029 discovery documents** we successfully retrieved and parsed
across those domains. We already receive these headers, so recording their shape
costs no request. We keep the shape and never the value: an `ETag` is the
publisher's opaque identifier and has no business in our dataset.

| `ETag` | count | share |
|---|---:|---:|
| present | 1,090 | 53.7% |
| absent | 939 | 46.3% |

| `Cache-Control` | count | share |
|---|---:|---:|
| present, fresh (`max-age`, no revalidation directive) | 963 | 47.5% |
| present, revalidatable (`no-cache` / `must-revalidate`) | 447 | 22.0% |
| absent | 487 | 24.0% |
| `private` or `no-store` | 132 | 6.5% |

By candidate path, `ETag` present:

| path | with `ETag` |
|---|---|
| `/.well-known/ai-catalog.json` | 63.8% |
| `/.well-known/mcp.json` | 56.6% |
| `/.well-known/mcp/server-card.json` | 53.6% |
| `/.well-known/mcp` | 29.0% |

Content type is `application/*json` for 2,022 of the 2,029; seven are something
else, which we mention only because the media-type divergence in #16 makes the
tail worth watching rather than rounding away.

## What we read into it, cautiously

Just over half send a validator, and about a fifth send something a client can
revalidate against rather than merely re-fetch. The recommendation is two weeks
old, so this is where the ecosystem was when it landed, not a compliance rate.
The spread by path is a hint that this tracks the hosting rather than the
publisher's intent — a static file behind a CDN gets an `ETag` whether anyone
meant it or not.

We will re-measure. If the recommendation moves the number, that is worth
knowing; if it does not, that is worth knowing sooner.

**Question:** is the shape above the right thing to track, or would the WG rather
see conditional requests actually exercised — that is, whether a `304` comes back
for an `If-None-Match`? We do not currently send one. It would be a second
request per document against sites that did not ask us to test their caching, so
we would want a reason before adding it.
