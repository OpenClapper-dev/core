-- Step B4 (#376): the running number of each naming pattern, per project and file type
-- (docs/rewrite/04-shots.md, "Names"). Raised in the same statement that reads it, so two files made
-- at once never get the same number.
CREATE TABLE name_counters (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  next       INTEGER NOT NULL,
  PRIMARY KEY (project_id, type)
);
