#!/usr/bin/env bash
# Hit the live site on the paths that matter, immediately after a deploy.
#
# Written after a 30-second KV TTL — below the platform's 60-second floor —
# shipped past 145 green tests and made /census/check return 1101 for every
# domain not already in the census. It was live for 62 minutes, because the
# deploy happened and then an hour of documentation happened before anyone
# looked at the page. The unit suite could not have caught it: the fake KV in
# the tests accepted a TTL the real one refuses.
#
# So this asks the running Worker, not a model of it. Thirty seconds, and it
# runs as part of `pnpm deploy` rather than when someone remembers.
#
#   ./scripts/smoke.sh [base-url]

set -uo pipefail
BASE="${1:-https://www.radixia.ai/census}"
ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
FAILED=0

check() {
  local label="$1" url="$2" expect="$3" needle="${4:-}"
  local body status
  body="$(curl -sS --max-time 25 -w '\n%{http_code}' "$url" 2>/dev/null)" || {
    printf '  FAIL  %-34s request failed\n' "$label"; FAILED=1; return
  }
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"

  if [ "$status" != "$expect" ]; then
    printf '  FAIL  %-34s http %s, wanted %s\n' "$label" "$status" "$expect"
    FAILED=1; return
  fi
  if [ -n "$needle" ] && ! printf '%s' "$body" | grep -qF "$needle"; then
    printf '  FAIL  %-34s missing %q\n' "$label" "$needle"
    FAILED=1; return
  fi
  printf '  ok    %-34s http %s\n' "$label" "$status"
}

echo "smoke: $BASE"

check "landing"        "$BASE/"                       200 "Why this is hard"
check "methodology"    "$BASE/methodology"            200 "Where the check identifiers"
check "results"        "$BASE/results"                200 "Results"
check "crawler"        "$BASE/crawler"                200
check "data"           "$BASE/data"                   200

# The two that actually execute something. A known domain reads the database; an
# unknown one runs the probe, writes KV and is where every regression has been.
check "domain page"    "$BASE/d/cloudflare.com"       200 "How far an agent gets"

# The check endpoint is rate limited by client IP, so a run from a machine that
# has been exercising it will legitimately see 429. Say so rather than cry wolf:
# a smoke test that fails for its own reasons is a smoke test people stop reading.
KNOWN="$(curl -sS --max-time 25 -o /tmp/smoke-known.html -w '%{http_code}' "$BASE/check?domain=github.com")"
case "$KNOWN" in
  200) grep -qF "Can an agent find you" /tmp/smoke-known.html \
         && echo "  ok    check, known                       http 200" \
         || { echo "  FAIL  check, known                       wrong page"; FAILED=1; } ;;
  429) echo "  skip  check, known                     rate limited from here" ;;
  *)   echo "  FAIL  check, known                     http $KNOWN"; FAILED=1 ;;
esac

# example.com is IANA's reserved name for exactly this. Tolerates 429, because
# a smoke test that trips its own rate limit should say so rather than fail.
UNKNOWN="$(curl -sS --max-time 25 -o /dev/null -w '%{http_code}' "$BASE/check?domain=example.com")"
case "$UNKNOWN" in
  200) echo "  ok    check, unknown (live probe)       http 200" ;;
  429) echo "  skip  check, unknown                    rate limited from here" ;;
  *)   echo "  FAIL  check, unknown                    http $UNKNOWN"; FAILED=1 ;;
esac

check "404 is a 404"   "$BASE/no-such-page"           404

# The one that would have caught twelve days of shipping nothing. The Worker
# bundles @mcp-census/core from dist/, and `typecheck --noEmit` does not build
# it, so a deploy after a source change can quietly ship the previous build. On
# 2026-09-01 production was still serving methodology 0.4.0 while the source had
# said 0.5.0 since 2026-08-19 — the per-domain budget among the code that never
# went live. Compare what is running against what is in the tree.
SRC_VERSION="$(grep -o 'METHODOLOGY_VERSION = "[^"]*"' "$ROOT_DIR/packages/core/src/version.ts" | cut -d'"' -f2)"
LIVE_VERSION="$(curl -sS --max-time 20 "$BASE/health" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("methodologyVersion",""))' 2>/dev/null)"
if [ -z "$SRC_VERSION" ] || [ -z "$LIVE_VERSION" ]; then
  # A check that passes because it could not read something is not a check. The
  # first version of this reported "ok" against a wrong path.
  printf '  FAIL  %-34s could not read source (%s) or live (%s) version\n' \
    "deployed version" "${SRC_VERSION:-none}" "${LIVE_VERSION:-none}"
  FAILED=1
elif [ "$SRC_VERSION" != "$LIVE_VERSION" ]; then
  printf '  FAIL  %-34s live %s, source %s — stale bundle\n' "deployed version" "$LIVE_VERSION" "$SRC_VERSION"
  FAILED=1
else
  printf '  ok    %-34s %s\n' "deployed version" "$LIVE_VERSION"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "smoke: FAILED — roll back or fix before walking away"
  exit 1
fi
echo "smoke: all good"
