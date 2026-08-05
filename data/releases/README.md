# Releases

Frozen output snapshots, one directory per release date (`YYYY-MM-DD`).

Each release directory contains:

- the per-domain results as CSV, Parquet and JSON
- the registry snapshot the shadow-MCP join was computed against, with the
  timestamp it was pulled (the official MCP Registry is in preview and offers no
  durability guarantee, so it may not be re-fetchable)
- the methodology version and candidate-set version in force
- a copy of, or a precise reference to, the input universes used
- Zenodo deposition metadata, so the snapshot is citable

A published release is immutable. Corrections appear in the next release, with the
change recorded in the methodology changelog.

The one exception is an opt-out received after publication: those rows are removed
from the *live site* and from subsequent releases, and the removal is noted. An
already-citable frozen snapshot is not rewritten.

## No releases yet.
