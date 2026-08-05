-- Monthly growth of the official MCP Registry.
--
-- Derived from a registry snapshot rather than measured by our crawler, and kept
-- in its own table so that provenance stays obvious: this is somebody else's
-- count of servers, not our count of reachable domains. The two must never be
-- conflated in a chart or in copy.
--
-- One row per calendar month. `partial` marks a month that had not finished when
-- the snapshot was taken — without it the current month always looks like a
-- collapse, which is the single easiest way to publish an accidental lie about a
-- trend.

CREATE TABLE IF NOT EXISTS registry_growth (
  month        TEXT PRIMARY KEY,          -- 'YYYY-MM'
  added        INTEGER NOT NULL,          -- first published in this month
  cumulative   INTEGER NOT NULL,          -- total registered by end of month
  partial      INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1)),
  -- Which snapshot produced this row, so a chart can cite its own source date.
  snapshot_date TEXT NOT NULL
);
