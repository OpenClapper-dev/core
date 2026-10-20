-- Cloudflare analytics overlay (epic #67, issue #217): the admin Worker's daily cron keeps yesterday's
-- account-wide numbers (R2 bytes per bucket and in total, Worker requests, D1 rows) so the history
-- outlives the GraphQL API's 31-day window. Key/value: a new metric needs no migration.
CREATE TABLE cf_usage_daily (
  day TEXT NOT NULL,                          -- 'YYYY-MM-DD' (UTC)
  metric TEXT NOT NULL,                       -- 'r2.bytes.total', 'r2.bytes.<bucket>', 'r2.objects.total', 'worker.requests', ...
  value REAL NOT NULL,
  taken_at TEXT NOT NULL,
  PRIMARY KEY (day, metric)
);
