-- Epic #275: a shot is a composition. Layers (drawing or adjustment) stack over the footage with an
-- order, a range of steps and a space (frame or photo); the Studio bakes one image per step for the
-- phone. This migration adds the tables and copies every overlay into layers. Nothing is deleted:
-- the overlays table and its renders stay until a later release drops them.

CREATE TABLE layers (
  id           TEXT PRIMARY KEY,
  shot_id      TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('drawing', 'adjustment')),
  name         TEXT NOT NULL,
  description  TEXT,
  position     INTEGER NOT NULL DEFAULT 0,             -- < 0 below the footage, >= 0 above
  visible      INTEGER NOT NULL DEFAULT 1,
  locked       INTEGER NOT NULL DEFAULT 0,
  opacity      REAL NOT NULL DEFAULT 1,
  space        TEXT NOT NULL CHECK (space IN ('frame', 'photo')),
  photo_id     TEXT REFERENCES photos(id) ON DELETE CASCADE,   -- photo space only
  range        TEXT CHECK (range IS NULL OR json_valid(range)), -- null = every step, else [step ids]
  shapes       TEXT CHECK (shapes IS NULL OR json_valid(shapes)),
  look         TEXT CHECK (look IS NULL OR json_valid(look)),
  timeline_id  TEXT REFERENCES timelines(id) ON DELETE CASCADE, -- with clip_id: a timeline clip's own
  clip_id      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT
);
CREATE INDEX layers_shot_idx ON layers (shot_id, position);
CREATE INDEX layers_clip_idx ON layers (timeline_id, clip_id);

-- One flattened image per step, made by the Studio; hash = what it was made from (vocab bakeHash).
CREATE TABLE step_bakes (
  shot_id     TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  step_key    TEXT NOT NULL,   -- the stored step's id, or the photo's id for a shot without stored steps
  hash        TEXT NOT NULL,
  render_key  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (shot_id, step_key)
);

-- A clip shows a step's composition (its layers) instead of one overlay.
ALTER TABLE timeline_clips ADD COLUMN step_id TEXT REFERENCES shot_steps(id) ON DELETE SET NULL;

-- 1. Shots without stored steps that have overlays get them: each photo in order, followed by one
--    step per overlay of that photo, so every overlay that could be shown stays a step.
CREATE TABLE _m30_steps (id TEXT PRIMARY KEY, shot_id TEXT, ordinal INTEGER, photo_id TEXT, framing_id TEXT, overlay_id TEXT);
INSERT INTO _m30_steps (id, shot_id, ordinal, photo_id, framing_id, overlay_id)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), ph.shot_id, ph.ordinal * 1000, ph.id, NULL, NULL
  FROM photos ph
  WHERE ph.shot_id IN (SELECT p2.shot_id FROM overlays o JOIN photos p2 ON p2.id = o.photo_id WHERE o.timeline_id IS NULL)
    AND ph.shot_id NOT IN (SELECT shot_id FROM shot_steps);
INSERT INTO _m30_steps (id, shot_id, ordinal, photo_id, framing_id, overlay_id)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), ph.shot_id,
    ph.ordinal * 1000 + 1 + (SELECT count(*) FROM overlays o2 WHERE o2.photo_id = o.photo_id AND o2.timeline_id IS NULL AND (o2.position < o.position OR (o2.position = o.position AND o2.id < o.id))),
    ph.id,
    (SELECT f.id FROM framings f WHERE f.id = json_extract(o.presentation, '$.framing_id') AND f.photo_id = ph.id),
    o.id
  FROM overlays o JOIN photos ph ON ph.id = o.photo_id
  WHERE o.timeline_id IS NULL AND ph.shot_id NOT IN (SELECT shot_id FROM shot_steps);
INSERT INTO shot_steps (id, shot_id, ordinal, photo_id, framing_id, overlay_id) SELECT id, shot_id, ordinal, photo_id, framing_id, overlay_id FROM _m30_steps;
DROP TABLE _m30_steps;

-- 2. Every overlay becomes a drawing layer (same id, photo space) and, when its look changes the
--    photo, an adjustment layer just below it. A shot overlay shows on the steps that showed it
--    (none: an empty range, it waits in the layer list); a clip's own overlay stays the clip's.
INSERT INTO layers (id, shot_id, kind, name, description, position, visible, locked, opacity, space, photo_id, range, shapes, look, timeline_id, clip_id, created_at, updated_at)
  SELECT o.id, ph.shot_id, 'drawing', o.name, o.description, o.position * 2 + 1, 1, 0, 1, 'photo', o.photo_id,
    CASE WHEN o.timeline_id IS NULL THEN (SELECT json_group_array(st.id) FROM shot_steps st WHERE st.overlay_id = o.id) END,
    coalesce(json_extract(o.drawing, '$.shapes'), '[]'), NULL, o.timeline_id, o.clip_id, o.created_at, coalesce(o.updated_at, o.created_at)
  FROM overlays o JOIN photos ph ON ph.id = o.photo_id;
CREATE TABLE _m30_adj (overlay_id TEXT PRIMARY KEY, id TEXT);
INSERT INTO _m30_adj (overlay_id, id)
  SELECT o.id, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) FROM overlays o
  WHERE json_extract(o.drawing, '$.look') IS NOT NULL AND NOT (coalesce(json_extract(o.drawing, '$.look.exposure'), 0) = 0 AND coalesce(json_extract(o.drawing, '$.look.contrast'), 0) = 0 AND coalesce(json_extract(o.drawing, '$.look.saturation'), 0) = 0 AND coalesce(json_extract(o.drawing, '$.look.bw'), 0) = 0 AND json_extract(o.drawing, '$.look.tint') IS NULL AND coalesce(json_extract(o.drawing, '$.look.vignette'), 0) = 0 AND coalesce(json_extract(o.drawing, '$.look.blur'), 0) = 0);
INSERT INTO layers (id, shot_id, kind, name, description, position, visible, locked, opacity, space, photo_id, range, shapes, look, timeline_id, clip_id, created_at, updated_at)
  SELECT a.id, ph.shot_id, 'adjustment', substr(o.name || ' · look', 1, 80), NULL, o.position * 2, 1, 0, 1, 'photo', o.photo_id,
    CASE WHEN o.timeline_id IS NULL THEN (SELECT json_group_array(st.id) FROM shot_steps st WHERE st.overlay_id = o.id) END,
    NULL, json_extract(o.drawing, '$.look'), o.timeline_id, o.clip_id, o.created_at, coalesce(o.updated_at, o.created_at)
  FROM _m30_adj a JOIN overlays o ON o.id = a.overlay_id JOIN photos ph ON ph.id = o.photo_id;

-- 3. A clip that showed a shot overlay points at the step that shows it. Where no step does (a shot
--    whose curated steps left that overlay out), the overlay's layers become the clip's own copies,
--    so the clip still looks the same.
UPDATE timeline_clips SET step_id = (
  SELECT st.id FROM shot_steps st WHERE st.overlay_id = timeline_clips.overlay_id AND st.photo_id = timeline_clips.photo_id ORDER BY st.ordinal LIMIT 1)
WHERE overlay_id IN (SELECT id FROM overlays WHERE timeline_id IS NULL);
INSERT INTO layers (id, shot_id, kind, name, description, position, visible, locked, opacity, space, photo_id, range, shapes, look, timeline_id, clip_id, created_at, updated_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), l.shot_id, l.kind, l.name, l.description, l.position, 1, 0, 1, 'photo', l.photo_id, NULL, l.shapes, l.look, c.timeline_id, c.id, l.created_at, l.updated_at
  FROM timeline_clips c
  JOIN overlays o ON o.id = c.overlay_id AND o.timeline_id IS NULL
  JOIN layers l ON l.timeline_id IS NULL AND (l.id = o.id OR l.id = (SELECT a.id FROM _m30_adj a WHERE a.overlay_id = o.id))
  WHERE c.step_id IS NULL;
DROP TABLE _m30_adj;
