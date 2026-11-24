-- The master timeline of a project (docs/rewrite/06-timeline.md, step B7 #379): an ordered JSON list of the
-- project's timelines, played end to end. Timelines not in it stay outside it.
ALTER TABLE projects ADD COLUMN master TEXT NOT NULL DEFAULT '[]';
