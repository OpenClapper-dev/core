-- Epic #275 follow-up: a project can hold its bakes (the phone's flattened step images) back until a
-- shot is approved, to save the Studio's work and storage on shots that never make it.
ALTER TABLE projects ADD COLUMN bake_approved_only INTEGER NOT NULL DEFAULT 0;
