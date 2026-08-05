# Scripts

One-off analysis, dataset export and report figures. Nothing here is part of the
published pipeline; anything that becomes load-bearing moves into `packages/core`
with tests.

Planned:

- `pilot/` — the Phase 1 local Node runner: census over the pilot sample, CSV out.
  Runs against `packages/core` directly, no Cloudflare dependencies, so the
  go/no-go can be reached before any infrastructure exists.
- `shadow/` — the Phase 5 pipeline: pull the official MCP Registry and Smithery,
  extract claimed brand, join against the census universe on apex domain using
  registry namespace verification as the primary signal, emit confidence scores and
  the four-way classification. See `docs/DECISIONS/0003`.
- `export/` — release snapshot generation: CSV, Parquet, JSON, Zenodo metadata.
