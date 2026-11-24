-- Step B5 (#377): the frames of every canvas, so "is this lens of a preset in use" is one query
-- (docs/rewrite/02-optics.md), and a canvas's render and thumbnail (05-composition.md). The frames are
-- also in the canvas's body; this table is rewritten from it on every save.
CREATE TABLE frames (
  canvas_id  TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  frame_id   TEXT NOT NULL,
  preset_id  TEXT,                                 -- null for free-form and aspect frames
  focal      INTEGER,
  is_picture INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (canvas_id, frame_id)
);
CREATE INDEX frames_preset_idx ON frames (preset_id) WHERE preset_id IS NOT NULL;

-- The flattened images of a canvas, uploaded by whoever edits it; in R2 under canvases/<file id>/<part>.
CREATE TABLE renders (
  file_id  TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  part     TEXT NOT NULL CHECK (part IN ('render', 'thumbnail')),
  type     TEXT NOT NULL,
  bytes    INTEGER NOT NULL,
  at       TEXT NOT NULL,
  PRIMARY KEY (file_id, part)
);
