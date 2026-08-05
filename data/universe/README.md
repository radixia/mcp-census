# Input universes

Frozen input lists. **Nothing is measured that is not in a committed list here.**

One directory or file per universe, each accompanied by provenance metadata:

- the exact source and URL it was obtained from
- the download date, and the source's own permanent list ID or version where one
  exists (Tranco, for example, exposes a permanent ID per daily list)
- the licence the source is offered under
- the filter applied, if any, stated precisely enough to re-apply

A list, once frozen and used in a published release, is never edited. Corrections
create a new list with a new date. Re-freezing an input list after publication
would invalidate every number derived from it, which is the one thing
reproducibility cannot survive.

## Nothing is frozen yet

No universe has been committed, because the licensing question is unresolved:
Tranco aggregates Cloudflare Radar data under **CC BY-NC 4.0** (non-commercial),
while this project publishes derived data under CC-BY-4.0 from a commercial site.

Candidate mitigations, cheapest first:

1. Publish the *ranks we used* by reference — source, list ID and date — rather
   than redistributing the list itself.
2. Build the universe from a source with clean commercial terms.

See `METHODOLOGY.md` → Open questions.

## Planned universes

| Tag | Universe |
|---|---|
| A | Global top domains |
| B | Europe |
| C | Italy |
| D | AGNTCon + MCPCon Europe 2026 sponsors and speakers |

Universe D is the only one with no licensing question: it is compiled from a public
conference programme and can be frozen independently of the others.
