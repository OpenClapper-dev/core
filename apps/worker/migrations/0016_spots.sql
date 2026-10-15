-- Issue #44, part 2: a Spot is a named place within a location (the north gate, the roof), with an
-- optional pin. A shot has at most one, and it must be a spot of the shot's location.
CREATE TABLE spots (
  id           TEXT PRIMARY KEY,
  location_id  TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  lat          REAL,
  lon          REAL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT
);
CREATE UNIQUE INDEX spots_location_name_idx ON spots (location_id, name COLLATE NOCASE);

ALTER TABLE shots ADD COLUMN spot_id TEXT REFERENCES spots(id) ON DELETE SET NULL;
