-- Desktop v2 (epic #90, issue #91): a recycle bin, the per-project Desktop folder and taskbar pins.
-- Additive: nothing is binned, every existing folder is a normal one, every desktop item sits on
-- the desktop.

-- The bin: deleted_at is when a file went to the bin (NULL = live); deleted_with is the folder whose
-- binning took it along (NULL = binned on its own), so restoring that folder brings it back too.
-- Binned rows are purged after 30 days (the Worker's daily cron) or when the bin is emptied.
ALTER TABLE shots            ADD COLUMN deleted_at TEXT;
ALTER TABLE shots            ADD COLUMN deleted_with TEXT;
ALTER TABLE timelines        ADD COLUMN deleted_at TEXT;
ALTER TABLE timelines        ADD COLUMN deleted_with TEXT;
ALTER TABLE shooting_days    ADD COLUMN deleted_at TEXT;
ALTER TABLE shooting_days    ADD COLUMN deleted_with TEXT;
ALTER TABLE views            ADD COLUMN deleted_at TEXT;
ALTER TABLE views            ADD COLUMN deleted_with TEXT;
ALTER TABLE locations        ADD COLUMN deleted_at TEXT;
ALTER TABLE locations        ADD COLUMN deleted_with TEXT;
ALTER TABLE field_definitions ADD COLUMN deleted_at TEXT;
ALTER TABLE field_definitions ADD COLUMN deleted_with TEXT;
ALTER TABLE folders          ADD COLUMN deleted_at TEXT;
ALTER TABLE folders          ADD COLUMN deleted_with TEXT;

-- A binned name no longer blocks a new one (restore renames on a clash).
DROP INDEX locations_project_name_idx;
CREATE UNIQUE INDEX locations_project_name_idx ON locations (project_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;
DROP INDEX field_definitions_project_key_idx;
CREATE UNIQUE INDEX field_definitions_project_key_idx ON field_definitions (project_id, key) WHERE deleted_at IS NULL;
DROP INDEX folders_dir_name_idx;
CREATE UNIQUE INDEX folders_dir_name_idx ON folders (project_id, ifnull(parent_id, ''), name COLLATE NOCASE) WHERE deleted_at IS NULL;

-- The Desktop folder: one per project, at the root, created by the Worker on the first GET /api/files.
ALTER TABLE folders ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'desktop'));
CREATE UNIQUE INDEX folders_desktop_idx ON folders (project_id) WHERE kind = 'desktop';

-- Taskbar pins are desktop items in another area, ordered by position.
ALTER TABLE desktop_items ADD COLUMN area TEXT NOT NULL DEFAULT 'desktop' CHECK (area IN ('desktop', 'taskbar'));
ALTER TABLE desktop_items ADD COLUMN position INTEGER;
DROP INDEX desktop_target_idx;
CREATE UNIQUE INDEX desktop_target_idx ON desktop_items (project_id, area, kind, ifnull(resource_type, ''), ifnull(resource_id, ''), ifnull(folder_id, ''), ifnull(app_id, ''));
