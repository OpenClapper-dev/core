-- Issue #49: viewfinder layouts made on the dashboard, picked on the phone. Global (a layout belongs
-- to the phone, not to a project); the shipped default lives in code (@fielder/vocab), not here.
CREATE TABLE viewfinder_layouts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  layout      TEXT NOT NULL CHECK (json_valid(layout)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT
);
