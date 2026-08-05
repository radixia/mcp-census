# 0003 — Shadow MCP attribution uses registry namespace verification, not fuzzy brand matching

- **Date:** 2026-08-04
- **Status:** accepted

## Context

The brief's Shadow MCP pipeline proposed extracting the brand a registry server
purports to serve from its name, description, homepage, endpoint hostname and
source repo owner, then joining against the census universe on apex domain with
fuzzy brand matching as a secondary signal.

Fuzzy brand matching is the weakest possible foundation for the strongest claim we
intend to make. The headline asserts that a *third party* — not the brand — wrote
a server for that brand. If the match is wrong, we have publicly misattributed
authorship of software to a named company.

The official MCP Registry turns out to solve this directly. Server names are
reverse-DNS (`io.github.user/server`, `com.example/server`) and the registry
**verifies namespace ownership** through GitHub, DNS or HTTP challenge before
allowing a publish under that namespace.

## Decision

Attribution is driven by the registry's own namespace verification:

- `com.example/*` is **provably** controlled by whoever proved ownership of
  `example.com` → first-party.
- `io.github.someuser/example-mcp` is **provably not** controlled by
  `example.com` → third-party.

Fuzzy brand matching is demoted to a secondary signal used only to *find*
candidate pairings, never to decide the classification. Every match carries a
confidence score, and low-confidence matches are excluded from the headline
number.

The four-way classification remains: `official` (registry entry **and** own server
card) / `orphan` (own card, not in registry) / `shadow` (third-party registry
entry, no own card) / `absent`.

## Consequences

- The central claim rests on a verification the registry performed, not on string
  similarity we computed. That is defensible on Hacker News, which is the real
  test.
- Registry `status` is honoured: `deleted` indicates a moderation action
  (spam/malware/illegal), so those entries are excluded from headline counts and
  reported separately.
- The registry is explicitly in **preview** with no durability guarantee and may
  reset data. We snapshot what we pull, with a timestamp, into
  `data/releases/<date>/`, and never rely on being able to re-fetch it.
- Smithery requires `bearerAuth` and documents no rate limits, so it is a
  dependency risk. Its entries are treated as lower-confidence than the official
  registry's, since we cannot verify their namespace provenance the same way.
- Servers published under a personal GitHub namespace *by an employee of the
  brand* will classify as `shadow` when they are arguably official. This must be
  named in Limitations, and is a reason the copy says "you don't know about it"
  rather than "you didn't write it".
