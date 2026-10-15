-- Issue #44: projects are a hard scope. Locations, extra-field definitions and saved views belong to
-- one project. Shared rows are copied into every project that uses them (the first keeps its id),
-- rows nobody uses go to the project with the most shots. Nothing is deleted.
-- Columns are added, not rebuilt: dropping `locations` would fire ON DELETE SET NULL on shots.
-- project_id is nullable in SQL only (ALTER TABLE cannot add a NOT NULL reference); the Worker always sets it.

CREATE TABLE _target AS
  SELECT p.id FROM projects p ORDER BY (SELECT count(*) FROM shots s WHERE s.project_id = p.id) DESC, p.created_at LIMIT 1;

-- ---------------------------------------------------------------- locations
ALTER TABLE locations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
DROP INDEX locations_name_idx;

-- One row per (location, project using it); rank 1 (the project with most of its shots) keeps the id.
CREATE TABLE _loc_map AS
  SELECT location_id AS old, project_id,
    CASE WHEN rn = 1 THEN location_id ELSE
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    END AS new
  FROM (
    SELECT location_id, project_id, row_number() OVER (PARTITION BY location_id ORDER BY count(*) DESC, project_id) AS rn
    FROM shots WHERE location_id IS NOT NULL GROUP BY location_id, project_id
  );

INSERT INTO locations (id, name, lat, lon, created_at, updated_at, project_id)
  SELECT m.new, l.name, l.lat, l.lon, l.created_at, l.updated_at, m.project_id
  FROM _loc_map m JOIN locations l ON l.id = m.old WHERE m.new != m.old;
UPDATE locations SET project_id = (SELECT m.project_id FROM _loc_map m WHERE m.old = locations.id AND m.new = locations.id)
  WHERE project_id IS NULL;
UPDATE shots SET location_id = (SELECT m.new FROM _loc_map m WHERE m.old = shots.location_id AND m.project_id = shots.project_id)
  WHERE location_id IS NOT NULL;
UPDATE locations SET project_id = (SELECT id FROM _target) WHERE project_id IS NULL;

CREATE UNIQUE INDEX locations_project_name_idx ON locations (project_id, name COLLATE NOCASE);

-- ---------------------------------------------------------------- extra-field definitions
ALTER TABLE field_definitions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE field_definitions ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
DROP INDEX field_definitions_key_idx;

CREATE TABLE _field_map AS
  SELECT field_id AS old, project_id, position,
    CASE WHEN rn = 1 THEN field_id ELSE
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
    END AS new
  FROM (SELECT field_id, project_id, position, row_number() OVER (PARTITION BY field_id ORDER BY project_id) AS rn FROM project_fields);

INSERT INTO field_definitions (id, key, definition, created_at, updated_at, project_id, position)
  SELECT m.new, f.key, f.definition, f.created_at, f.updated_at, m.project_id, m.position
  FROM _field_map m JOIN field_definitions f ON f.id = m.old WHERE m.new != m.old;
UPDATE field_definitions SET
    project_id = (SELECT m.project_id FROM _field_map m WHERE m.old = field_definitions.id AND m.new = field_definitions.id),
    position = coalesce((SELECT m.position FROM _field_map m WHERE m.old = field_definitions.id AND m.new = field_definitions.id), 0)
  WHERE project_id IS NULL;
UPDATE field_definitions SET project_id = (SELECT id FROM _target),
    position = 1000 + rowid
  WHERE project_id IS NULL;

CREATE UNIQUE INDEX field_definitions_project_key_idx ON field_definitions (project_id, key);
-- Folded into field_definitions.project_id + position above.
DROP TABLE project_fields;

-- ---------------------------------------------------------------- saved views
ALTER TABLE views ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
UPDATE views SET project_id = (SELECT id FROM _target);

DROP TABLE _loc_map;
DROP TABLE _field_map;
DROP TABLE _target;
