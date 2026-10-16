-- Issue #68: device specs read out from a phone (screen sizes per orientation, lens stops, the main
-- lens's 35 mm equivalent), so the layout editor previews on the real device. The id is the phone's
-- own (client-generated), so the phone keeps its record up to date. A layout names the device it is
-- designed for; deleting the device leaves the layout without one.
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  specs       TEXT NOT NULL CHECK (json_valid(specs)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT
);

ALTER TABLE viewfinder_layouts ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
