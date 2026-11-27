-- A progression becomes a file of its own (#426, feedback 4): an internal file of its shot, listed in the
-- shot's content. Every shot that had a progression in its body gets one progression file with:
--   * the body: the shot's body.progression (timing, default frame, overlay switch), body version 1;
--   * the shot's "item" and "overlay" references, moved over as they are (their order and data kept);
--   * the default frame's row in `frames` (frame id 'default'), so a preset's lens stays in use;
--   * a "content" reference from the shot: first when it has items (it was the shot's cover), else last;
--   * the internal canvases of the shot that only its items or overlay used (the generator's canvases, the
--     overlay), which now live inside the progression (binned, restored and copied with it).
-- The binned state follows the shot's. Then every shot's body is {} at body version 3.
-- Ids are random version-4 UUIDs in the lower-case form the model accepts.

CREATE TABLE _progression_map (shot_id TEXT PRIMARY KEY, prog_id TEXT NOT NULL UNIQUE);

INSERT INTO _progression_map (shot_id, prog_id)
SELECT id,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
  || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
FROM files
WHERE type = 'shot' AND json_type(body, '$.progression') = 'object';

INSERT INTO files (id, project_id, home_of, type, name, container, internal_of, created_at, updated_at, created_by, deleted_at, deleted_with, body, body_version)
SELECT m.prog_id, s.project_id, s.home_of, 'progression', 'Progression 1', NULL, s.id, s.created_at, coalesce(s.updated_at, s.created_at), s.created_by,
  s.deleted_at, CASE WHEN s.deleted_at IS NULL THEN NULL ELSE coalesce(s.deleted_with, s.id) END,
  json_extract(s.body, '$.progression'), 1
FROM _progression_map m JOIN files s ON s.id = m.shot_id;

UPDATE refs SET from_file = (SELECT m.prog_id FROM _progression_map m WHERE m.shot_id = refs.from_file)
WHERE kind IN ('item', 'overlay') AND from_file IN (SELECT shot_id FROM _progression_map);

INSERT INTO refs (from_file, kind, position, to_file, data)
SELECT m.shot_id, 'content',
  CASE WHEN EXISTS (SELECT 1 FROM refs i WHERE i.from_file = m.prog_id AND i.kind = 'item')
    THEN (SELECT coalesce(min(c.position), 0) - 1 FROM refs c WHERE c.from_file = m.shot_id AND c.kind = 'content')
    ELSE (SELECT coalesce(max(c.position), -1) + 1 FROM refs c WHERE c.from_file = m.shot_id AND c.kind = 'content') END,
  m.prog_id, NULL
FROM _progression_map m;

UPDATE frames SET canvas_id = (SELECT m.prog_id FROM _progression_map m WHERE m.shot_id = frames.canvas_id)
WHERE canvas_id IN (SELECT shot_id FROM _progression_map);

UPDATE files SET internal_of = (SELECT m.prog_id FROM _progression_map m WHERE m.shot_id = files.internal_of)
WHERE internal_of IN (SELECT shot_id FROM _progression_map)
  AND id IN (SELECT r.to_file FROM refs r JOIN _progression_map m ON r.from_file = m.prog_id WHERE r.kind IN ('item', 'overlay'))
  AND id NOT IN (SELECT r.to_file FROM refs r WHERE r.from_file = files.internal_of AND r.kind = 'content');

UPDATE files SET body = '{}', body_version = 3 WHERE type = 'shot';

DROP TABLE _progression_map;
