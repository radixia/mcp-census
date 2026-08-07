#!/usr/bin/env bash
# Upload one run's expanded evidence to R2 under evidence/<apex>/<run>.json.
#
# The other half of evidence/expand.ts. Separate because this one talks to a paid
# API several thousand times and should be restartable: it skips a key that is
# already there, so an interrupted run is resumed by running it again.
#
#   ./scripts/evidence/upload.sh 6 [parallelism] [--resume]
#
# `--resume` checks R2 before each put and skips what is already there. It
# doubles the number of wrangler invocations, so it is off by default: on a
# first pass every check is a guaranteed miss, and paying for it would turn
# twenty minutes into forty.
#
# About twenty minutes for 7,422 objects at the default parallelism. Each call
# spawns wrangler, which is the slow part; a bulk API would need R2 access keys
# from the dashboard, which is Marco's to create.

set -uo pipefail
RUN="${1:?usage: upload.sh <run-id> [parallelism]}"
PAR="${2:-16}"
RESUME="${3:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/scripts/out/evidence-$RUN"
# pnpm workspaces hoist per package, so wrangler lives with the worker.
WRANGLER="$ROOT/apps/worker/node_modules/.bin/wrangler"
BUCKET="mcp-census-artifacts"

[ -d "$DIR" ] || { echo "no $DIR — run evidence/expand.ts first"; exit 1; }
[ -x "$WRANGLER" ] || { echo "no wrangler at $WRANGLER"; exit 1; }

TOTAL="$(find "$DIR" -type f | wc -l | tr -d ' ')"
echo "run $RUN: $TOTAL objects, parallelism $PAR"

FAILED="$(mktemp)"
DONE="$(mktemp)"
export RUN DIR WRANGLER BUCKET FAILED DONE TOTAL RESUME

upload_one() {
  apex="$1"
  key="evidence/$apex/$RUN.json"
  if [ "$RESUME" = "--resume" ] &&
     "$WRANGLER" r2 object get "$BUCKET/$key" --remote --file /dev/null >/dev/null 2>&1; then
    return 0
  fi
  if ! "$WRANGLER" r2 object put "$BUCKET/$key" \
        --file "$DIR/$apex" --content-type application/json --remote >/dev/null 2>&1; then
    echo "$apex" >> "$FAILED"
  fi

  # Progress, because the alternative is sampling a handful of keys and guessing
  # — which once had a working upload killed twelve minutes in.
  echo x >> "$DONE"
  n="$(wc -l < "$DONE" | tr -d " ")"
  case "$n" in
    *00) printf "  %s/%s\n" "$n" "$TOTAL" ;;
  esac
}
export -f upload_one

find "$DIR" -type f -exec basename {} \; \
  | xargs -P "$PAR" -I{} bash -c 'upload_one "$@"' _ {}

COUNT="$(wc -l < "$FAILED" | tr -d ' ')"
if [ "$COUNT" != "0" ]; then
  echo "FAILED: $COUNT objects. Re-run to retry only those:"
  head -5 "$FAILED"
  rm -f "$DONE"
  exit 1
fi
rm -f "$FAILED" "$DONE"
echo "run $RUN: all $TOTAL uploaded"
