-- Convert the release to Parquet with DuckDB. No dependency on our side, and
-- you can point DuckDB at the published URLs instead of local files.
--   duckdb < to-parquet.sql
COPY (SELECT * FROM read_csv_auto('census.csv', header=true))
  TO 'census.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

-- Reproduce the headline number:
--   SELECT round(100.0 * SUM(CASE WHEN D1<>'pass' AND D2<>'pass'
--                                  AND D3<>'pass' AND D4<>'pass'
--                             THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_unreachable
--     FROM read_csv_auto('census.csv', header=true) WHERE assessed = 1;
