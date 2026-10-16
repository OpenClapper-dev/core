-- Epic #72: the dashboard becomes a desktop. Folders hold the project's "files" (shots, timelines,
-- days, views, locations, fields), and the desktop holds shortcuts. Fully additive, no backfill:
-- a resource without a folder_items row sits at the root, and every desktop starts empty.

CREATE TABLE folders (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- NULL = at the root. Nesting is capped at depth 8 by the Worker (it also rejects cycles).
  parent_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT
);
-- Names are unique within one directory, case-insensitively (a clash answers 409 + existing_id).
CREATE UNIQUE INDEX folders_dir_name_idx ON folders (project_id, ifnull(parent_id, ''), name COLLATE NOCASE);

-- Which folder a resource sits in: at most one (the primary key); no row = the root. No foreign key
-- on the resource (several tables, stale rows tolerated); the delete routes sweep them.
CREATE TABLE folder_items (
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  folder_id     TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (resource_type, resource_id)
);
CREATE INDEX folder_items_folder_idx ON folder_items (folder_id);

-- Shortcuts on a project's desktop: to a resource, a folder or an app, at a position.
CREATE TABLE desktop_items (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('resource', 'folder', 'app')),
  resource_type TEXT,
  resource_id   TEXT,
  folder_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  app_id        TEXT,
  label         TEXT,
  x             REAL NOT NULL DEFAULT 0,
  y             REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT,
  CHECK ((kind = 'resource') = (resource_type IS NOT NULL AND resource_id IS NOT NULL)),
  CHECK ((kind = 'folder') = (folder_id IS NOT NULL)),
  CHECK ((kind = 'app') = (app_id IS NOT NULL))
);
-- One shortcut per target on a desktop (a duplicate answers 409 + existing_id).
CREATE UNIQUE INDEX desktop_target_idx ON desktop_items (project_id, kind, ifnull(resource_type, ''), ifnull(resource_id, ''), ifnull(folder_id, ''), ifnull(app_id, ''));
