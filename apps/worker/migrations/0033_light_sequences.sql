-- Light sequences (issue #304), per project like timelines. Additive.
-- `tracks` is the editor's JSON (tracks of a light type, their keyframes, the light each drives),
-- checked by parseSequenceTracks in packages/vocab on every save. A track's light is a fixture id of
-- the project's workspace, or null.
CREATE TABLE light_sequences (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  name         TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL,
  loop         INTEGER NOT NULL DEFAULT 0,
  tracks       TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT
);
CREATE INDEX light_sequences_project_idx ON light_sequences (project_id);
