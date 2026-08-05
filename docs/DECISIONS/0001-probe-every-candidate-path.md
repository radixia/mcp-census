# 0001 — Probe every discovery candidate rather than assume a winner

- **Date:** 2026-08-04
- **Status:** accepted

## Context

The original brief assumed one of SEP-2127, SEP-1649 or SEP-1960 had landed and
listed three `.well-known` paths to probe. Direct reads of the primary sources on
2026-08-04 showed otherwise:

- SEP-2127 is an **open Draft**; its target date of 2026-04-03 passed.
- SEP-1649 was folded into SEP-2127. SEP-1960 was never adopted.
- The design moved away from the domain root entirely: the card is now
  endpoint-relative (`<streamable-http-url>/server-card`) and domain-level
  discovery is delegated to a Linux Foundation **AI Catalog** at
  `/.well-known/ai-catalog.json`, which requires steering-committee votes from
  both A2A and MCP.
- A separate IETF individual draft proposes a fourth path,
  `/.well-known/mcp-server`, plus a DNS TXT record.
- Several third-party blogs assert `/.well-known/mcp/server-card.json` is the
  settled consensus. That string appears in no primary document.

So there is no winner to assume, and the population we measure will contain
servers built against several different snapshots of a moving proposal.

## Decision

Probe **every** candidate and record **which one responded**, with the provenance
and normativity of each candidate carried in the config. Paths live in a versioned
config file (`packages/core/src/config/candidates.ts`), never hardcoded in probe
logic.

Retain candidates we expect to fail — the superseded `/.well-known/mcp.json`,
SEP-1960's `/.well-known/mcp`, and the unattested
`/.well-known/mcp/server-card.json` — and label them `historical` and `unattested`
respectively.

## Consequences

- The distribution of *which mechanism is actually deployed* becomes a finding in
  its own right, and one nobody has published. It is directly interesting to the
  MCPCon audience.
- Measuring the unattested path quantifies how much stale-spec cargo-culting is in
  the wild. A zero there is also a result.
- Cost is bounded: eight candidates at one request per second per domain.
- Adding or removing a candidate is a methodology change — `CANDIDATES_VERSION`
  and `METHODOLOGY_VERSION` are bumped together, so a published row can always be
  traced to the exact candidate set that produced it.
- We must re-verify before each run and record the date. SEP-2127's working-group
  lead terms expire 2026-08-14, so the picture may change before launch.
