-- A project's description and picture (#426, second round). The picture lives in R2 at projects/<id>/picture;
-- picture_type is its content type (null: no picture), picture_at when it was set (a cache key for clients).
ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN picture_type TEXT;
ALTER TABLE projects ADD COLUMN picture_at TEXT;
