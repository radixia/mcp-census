# Server Card working group — what we have, and the order to use it

Nothing in this directory has been posted. Marco decides what goes out and when.

## The clock

Both leads of the Server Card WG reach the end of their six-month terms on
**14 August 2026** — David Soria Parra (Anthropic, `@dsp-ant`) and Sam Morrow
Drums (GitHub, `@SamMorrowDrums`), per
`docs/community/working-groups/server-card.mdx` upstream. Tadas Antanavicius
(`@tadasant`) is a WG member and filed several of the issues below. The group
meets weekly, so there is likely one session left before the terms end.

Terms ending does not mean people leaving, and renewal is plausible. But a lead
closing out a term has a reason to clear blockers, and that is the window.

## Order

1. **Marco's direct contact first.** A conversation with the GitHub-side lead is
   worth more than a comment on a tracker, and it does not require the census
   site to be findable — it is still unindexed until launch.
2. **Then the issue comments**, if and when he wants them. Each one is written to
   stand alone on its own issue; there is deliberately no single post covering
   all three, because that reads as an announcement rather than a contribution.
3. **Then the fixtures**, but only shaped by whatever answer comes back. Six good
   ones with expected classifications beat thirty guesses.

## What we can offer, strongest first

| | Issue | State | Our figure | Denominator |
|---|---|---|---|---|
| **Card against runtime** | [#23](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/23) | closed, a **MUST** | 25.1% contradict; 28.2% diverge on `name` | 478 domains with both sides |
| **Link/HTML discovery** | [#43](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/43) | open, no data | ~26% of catalog-discoverable domains missed by well-known only | 178 domains |
| **Cacheability** | [#33](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/33) | closed, a **SHOULD** | 53.7% send an `ETag` | 2,029 documents |

All three from the 2026-08-07 run, methodology `0.4.0`, published in full so any
of them can be checked rather than believed.

#23 is the one to lead with. It is the only MUST, nothing we can find has
measured it, and the interesting part is not the percentage but the direction:
43 cards ahead of their server against 51 behind, which says the two are
unrelated rather than drifting, and that the requirement has no mechanism behind
it.

## House rules for anything that goes out

- **The data, then the question.** We have no architecture to propose and should
  not sound as if we do. Every draft here ends by asking something.
- **Denominators on every number.** None of these is over the whole population,
  and the easiest way to discredit the project is to let one read as if it were.
- **Never "compliant" or "non-compliant".** We observe; conformance is theirs to
  determine. `D4` in particular can never be a finding of non-compliance, because
  authorization is optional.
- **Verdicts, not values.** No table pairing a named organisation with the words
  its server contradicts. If the WG wants specific cases, privately or with the
  operator's knowledge.
- **Say what we did not do.** We did not fetch advertised URLs, we read the root
  document only, the interactive check is `HEAD`-only. The discipline is part of
  the contribution.
- **We are in our own dataset**, and every draft says so.

## Open questions for the WG, in the order we would ask them

1. Which fields on a card are normatively comparable to the handshake? Our
   reading is `version` and `protocolVersion` yes, `name` no — and 28.2% of
   comparable domains turn on that reading.
2. Is a quarter of catalog-discoverable domains enough to make `Link` and
   `<link>` worth supporting, or is the well-known fallback sufficient?
3. For the client best-practices work in [#40](https://github.com/modelcontextprotocol/experimental-ext-server-card/issues/40),
   which fixture cases are actually blocking: source precedence, cross-origin
   provenance, redirects, media type, cache revalidation, multi-card?

## After 14 August

Re-verify the charter. If the leads change, the stakeholder map changes and so
does the route in — but the data does not, and it will be a week older and more
useful for having a second point in the series.
