-- MCP Census — D1 schema, v1
--
-- Designed for a *time series* from the first row, not a single snapshot.
-- Retrofitting history onto a schema that assumed one scan per domain is the
-- kind of migration that eats a launch week, and the adoption curve is the
-- thing that makes this a recurring asset rather than a one-off report.
--
-- Two rules shape everything below:
--
--  1. Nothing is overwritten. A run is append-only; the "current" state is a
--     view over the newest run, never a mutated row.
--  2. A change is not a change until it repeats. See `status_changes`.

-- ---------------------------------------------------------------------------
-- Population
-- ---------------------------------------------------------------------------

CREATE TABLE domains (
  apex          TEXT PRIMARY KEY,
  universe      TEXT NOT NULL,           -- 'A' global | 'B' europe | 'C' italy | 'D' agntcon
  rank          INTEGER,                 -- rank within its source list, if any
  country       TEXT,
  sector        TEXT,
  -- Self-submitted domains never enter headline statistics. Keeping them in the
  -- same table with a flag is what stops a convenience sample leaking into a
  -- census — the exact flaw this project criticises in prior work.
  source        TEXT NOT NULL DEFAULT 'universe'
                CHECK (source IN ('universe', 'self_submitted')),
  first_seen    TEXT NOT NULL,
  opted_out_at  TEXT
);

CREATE INDEX idx_domains_universe ON domains (universe, source);

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------

-- One row per crawl. Every result is keyed to a run, which is what makes the
-- series queryable and what lets a partial run be excluded from a delta.
CREATE TABLE runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at            TEXT NOT NULL,
  finished_at           TEXT,
  methodology_version   TEXT NOT NULL,
  candidates_version    TEXT NOT NULL,
  universe_filter       TEXT,            -- NULL = everything
  domains_planned       INTEGER NOT NULL DEFAULT 0,
  domains_completed     INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'complete', 'aborted')),
  -- A run that did not finish must never be used as the baseline for a delta:
  -- every unvisited domain would look like it had just disappeared.
  usable_for_delta      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_runs_status ON runs (status, started_at);

-- ---------------------------------------------------------------------------
-- Per-domain results
-- ---------------------------------------------------------------------------

CREATE TABLE scans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       INTEGER NOT NULL REFERENCES runs (id),
  apex         TEXT NOT NULL REFERENCES domains (apex),
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER,
  -- Full evidence for every check in this scan lives in R2 under
  --   evidence/<apex>/<run_id>.json
  -- Measured at ~4.3 KB per domain per run; at 7,377 domains that is ~32 MB a
  -- run, which crosses D1's 10 GB ceiling inside a year of daily crawling. D1
  -- keeps what the site reads on every page; R2 keeps what it reads on one.
  --
  -- The key is apex-first deliberately. We promise to honour opt-outs, and
  -- "delete everything about this domain" must be a prefix delete, not a scan
  -- across every run we have ever done.
  evidence_key TEXT,
  -- Mirrors ScoreResult: assessed rows carry a score, unassessed ones carry the
  -- reason. A blocked domain is NOT a zero, and the schema must not let it
  -- become one by leaving score NULL-able-but-defaulted.
  assessed     INTEGER NOT NULL DEFAULT 0,
  score        INTEGER,
  band         TEXT,
  unassessed_reason TEXT
               CHECK (unassessed_reason IN ('skipped_by_robots', 'opted_out', 'unreachable')),
  CHECK ((assessed = 1 AND score IS NOT NULL AND band IS NOT NULL)
      OR (assessed = 0 AND unassessed_reason IS NOT NULL)),
  UNIQUE (run_id, apex)
);

CREATE INDEX idx_scans_apex_run ON scans (apex, run_id DESC);
CREATE INDEX idx_scans_run ON scans (run_id);

-- Status only. No evidence blob.
--
-- Evidence was ~4.3 KB per domain per run, half of it F2 listing twenty crawler
-- tokens that are `not_mentioned` for most domains. Keeping it here would put
-- ~11.6 GB a year into a 10 GB database to serve a detail view that one page in
-- a thousand opens. It lives in R2; `scans.evidence_key` points at it.
--
-- What remains is ~40 bytes a row, ~645 MB a year at daily cadence, and it is
-- everything the leaderboard, the per-domain page and the adoption chart read.
CREATE TABLE check_results (
  scan_id    INTEGER NOT NULL REFERENCES scans (id),
  check_id   TEXT NOT NULL,              -- D1..D6, Q1, F1, F2, S1
  status     TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'skip', 'error')),
  -- A short, closed-vocabulary reason where one adds meaning the status cannot
  -- carry — 'skipped_by_robots', 'html_catch_all', 'malformed'. Never a blob.
  detail     TEXT,
  latency_ms INTEGER,
  PRIMARY KEY (scan_id, check_id)
);

-- Which discovery mechanism answered. Normalised out of D1's evidence blob so
-- the adoption-by-path curve — the finding the pilot turned up — is a cheap
-- GROUP BY instead of a JSON scan over every row in the series.
CREATE TABLE candidate_hits (
  scan_id      INTEGER NOT NULL REFERENCES scans (id),
  candidate_id TEXT NOT NULL,            -- 'mcp-json', 'ai-catalog', ...
  host         TEXT NOT NULL,
  path         TEXT NOT NULL,
  PRIMARY KEY (scan_id, candidate_id, host)
);

CREATE INDEX idx_candidate_hits_candidate ON candidate_hits (candidate_id);

-- ---------------------------------------------------------------------------
-- Deltas — the debounce
-- ---------------------------------------------------------------------------

-- A status change is recorded only once it has PERSISTED ACROSS TWO CONSECUTIVE
-- COMPLETE RUNS.
--
-- This is not fussiness. At a ~1% base rate, WAF and bot-mitigation flapping
-- produces more apparent changes than real adoption does: during the pilot,
-- otomoto.pl answered 200 to the crawler and 403 to a manual check an hour
-- later. Publishing raw deltas would make the tracker mostly noise, and a
-- public feed that cries wolf is worse than no feed.
--
-- `pending_changes` is the staging area; nothing here is ever shown.
CREATE TABLE pending_changes (
  apex          TEXT NOT NULL REFERENCES domains (apex),
  check_id      TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  first_seen_run INTEGER NOT NULL REFERENCES runs (id),
  PRIMARY KEY (apex, check_id)
);

-- Confirmed, publishable changes. This is what the feed and the chart read.
CREATE TABLE status_changes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  apex          TEXT NOT NULL REFERENCES domains (apex),
  check_id      TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  first_seen_run INTEGER NOT NULL REFERENCES runs (id),
  confirmed_run  INTEGER NOT NULL REFERENCES runs (id),
  confirmed_at   TEXT NOT NULL,
  -- Discovery changes are rare and newsworthy; F2 posture changes are frequent
  -- and are what keeps the feed alive between them.
  category      TEXT NOT NULL CHECK (category IN ('discovery', 'posture', 'fallback'))
);

CREATE INDEX idx_status_changes_recent ON status_changes (confirmed_at DESC);
CREATE INDEX idx_status_changes_apex ON status_changes (apex, confirmed_at DESC);

-- ---------------------------------------------------------------------------
-- Daily aggregates — what the adoption chart reads
-- ---------------------------------------------------------------------------

-- Precomputed per run so the public chart never aggregates across the full
-- series at request time. Cheap to rebuild, and it keeps /census/ fast.
CREATE TABLE run_aggregates (
  run_id        INTEGER NOT NULL REFERENCES runs (id),
  universe      TEXT NOT NULL,
  metric        TEXT NOT NULL,           -- 'D1_pass', 'candidate:mcp-json', 'band:Discoverable', ...
  value         INTEGER NOT NULL,
  denominator   INTEGER NOT NULL,        -- assessed domains, never the whole universe
  PRIMARY KEY (run_id, universe, metric)
);

-- ---------------------------------------------------------------------------
-- Registry side (Phase 5)
-- ---------------------------------------------------------------------------

-- Only the fields the join needs. The full 86 MB registry snapshot is an
-- immutable artifact and belongs in R2 at registry/<pulled_at>.json, not here.
CREATE TABLE registry_servers (
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  namespace     TEXT NOT NULL,
  namespace_domain TEXT,                 -- reverse-DNS resolved, NULL for io.github.*
  is_github_namespace INTEGER NOT NULL DEFAULT 0,
  title         TEXT,
  website_host  TEXT,
  endpoints     TEXT,                    -- JSON array of hosts, short
  status        TEXT,
  pulled_at     TEXT NOT NULL,
  PRIMARY KEY (name, version)
);

CREATE INDEX idx_registry_namespace_domain ON registry_servers (namespace_domain);

CREATE TABLE shadow_matches (
  apex          TEXT NOT NULL REFERENCES domains (apex),
  server_name   TEXT NOT NULL,
  claim         TEXT NOT NULL,           -- verified_namespace | endpoint_on_apex | brand_in_server_name | ...
  confidence    REAL NOT NULL,
  first_party   INTEGER NOT NULL,
  -- Low-confidence matches are never published without a human saying so.
  -- See docs/SHADOW-2026-08-05.md: name matching alone is ~85% precise, which
  -- is not good enough for a table that asserts who wrote someone's software.
  reviewed      INTEGER NOT NULL DEFAULT 0,
  review_verdict TEXT CHECK (review_verdict IN ('confirmed', 'rejected')),
  pulled_at     TEXT NOT NULL,
  PRIMARY KEY (apex, server_name, claim)
);

CREATE TABLE brand_classifications (
  apex          TEXT PRIMARY KEY REFERENCES domains (apex),
  classification TEXT NOT NULL
                CHECK (classification IN ('official', 'registered_undiscoverable',
                                          'orphan', 'shadow_candidate', 'absent')),
  first_party_count INTEGER NOT NULL DEFAULT 0,
  third_party_count INTEGER NOT NULL DEFAULT 0,
  computed_at   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Opt-outs
-- ---------------------------------------------------------------------------

-- Mirrors data/optouts.txt, which stays the source of truth so an opt-out is
-- reviewable in git history rather than only in a database somebody has to be
-- trusted to have updated.
CREATE TABLE optouts (
  apex        TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  honoured_at  TEXT,
  note        TEXT
);
