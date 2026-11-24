-- Photos (rewrite step B2, #374; docs/rewrite/01-media.md). A photo is a file of the type "photo";
-- this row holds what the server searches and counts: when it was taken, its size, its angle of
-- view, and which images are stored for it. The raw EXIF and the device readout are in the file's body.
--
-- Stored images are immutable and can be shared: a duplicate of a photo is a new file with the same
-- object_id, so it costs no storage. The three objects of one object_id live in R2 under
-- photos/<object_id>/original.<ext>, preview.<ext> and thumbnail.<ext>; a size column that is NULL
-- means that image has not arrived yet. They are removed when the last photo with the object_id is purged.
CREATE TABLE photos (
  file_id         TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  object_id       TEXT NOT NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('capture', 'import')),
  media_type      TEXT NOT NULL,                 -- of the original: image/jpeg, image/png, image/webp, image/heic
  taken_at        TEXT NOT NULL,                 -- capture time, the EXIF time of an import, else the import time (ISO 8601 UTC)
  width           INTEGER NOT NULL,              -- of the original, as it is shown (upright)
  height          INTEGER NOT NULL,
  original_bytes  INTEGER,
  preview_bytes   INTEGER,
  preview_type    TEXT,
  thumbnail_bytes INTEGER,
  thumbnail_type  TEXT,
  aov_horizontal  REAL,                          -- degrees; NULL when the EXIF gives none
  aov_vertical    REAL,
  aov_source      TEXT,                          -- exif-35mm | exif-sensor
  device_id       TEXT,                          -- the registered device that took it (from step B3)
  frame           TEXT CHECK (frame IS NULL OR json_valid(frame))  -- the optics frame on the camera screen at capture (from step B8)
);
CREATE INDEX photos_object_idx ON photos (object_id);
CREATE INDEX photos_taken_idx ON photos (taken_at);
