-- Storage monitoring in the admin plane (epic #67, issue #214).
-- storage_daily: one snapshot a day, written by the app Worker's cron (storage-stats.ts). Per
-- workspace from photos.size_bytes; workspace_id '' is the bound bucket's total from an R2 listing,
-- which also covers renders and orphans. No foreign key: the history outlives a deleted workspace.
CREATE TABLE storage_daily (
  day TEXT NOT NULL,                          -- 'YYYY-MM-DD' (UTC)
  workspace_id TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL,
  objects INTEGER NOT NULL,                   -- photos per workspace; objects for the bucket row
  unsized INTEGER NOT NULL DEFAULT 0,         -- photos without a recorded size (before migration 0021)
  PRIMARY KEY (day, workspace_id)
);

-- The admin plane's own settings (the operator's storage marks first); value is JSON.
CREATE TABLE admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT
);
