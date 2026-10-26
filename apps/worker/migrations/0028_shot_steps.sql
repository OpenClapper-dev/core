-- Issue #266: a sequence as a progression. A step shows one of the shot's photos, optionally
-- through a saved framing (a zoom step) and optionally as one of its overlays (a light step).
-- A shot without rows shows its photos as steps; captures never write rows. Deleting a framing
-- or overlay only clears the reference (the step falls back to the root frame / the photo).
CREATE TABLE shot_steps (
  id          TEXT PRIMARY KEY,
  shot_id     TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  photo_id    TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  framing_id  TEXT REFERENCES framings(id) ON DELETE SET NULL,
  overlay_id  TEXT REFERENCES overlays(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (shot_id, ordinal)
);
CREATE INDEX shot_steps_photo_idx ON shot_steps (photo_id);
