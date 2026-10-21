-- Issue #224 (finding 2): a device row per user. The id is the phone's own, and it travels in
-- photos.device, so with `id` alone as the key any signed-in user could take a workspace mate's
-- row over. Now the key is (user_id, id): every account that saves the same phone gets its own row.
--
-- SQLite cannot change a primary key in place, so both tables are rebuilt and every row copied:
-- devices keyed (user_id, id), and viewfinder_layouts, whose device_id now points at a device of the
-- layout's own user (a composite foreign key; it was a reference to devices(id), which is no longer
-- unique). The layouts are rebuilt first and the old devices table dropped only once nothing
-- references it: dropping it while the old layouts still did would run their ON DELETE SET NULL.
-- Every row keeps its owner. user_id has always been set (migration 0021 gave every older row to
-- the bootstrap user); the coalesce only guards a row that somehow has none.
PRAGMA defer_foreign_keys = true;

CREATE TABLE devices_new (
  user_id     TEXT NOT NULL REFERENCES users(id),
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  specs       TEXT NOT NULL CHECK (json_valid(specs)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT,
  PRIMARY KEY (user_id, id)
);
INSERT INTO devices_new (user_id, id, name, specs, created_at, updated_at)
  SELECT coalesce(user_id, '00000000-0000-4000-8000-000000000001'), id, name, specs, created_at, updated_at FROM devices;

-- No ON DELETE action: SET NULL on a composite key would also clear user_id. The Worker clears a
-- layout's device_id in the same batch as deleting the device (devices.ts).
CREATE TABLE viewfinder_layouts_new (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  layout      TEXT NOT NULL CHECK (json_valid(layout)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT,
  device_id   TEXT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  FOREIGN KEY (user_id, device_id) REFERENCES devices_new (user_id, id)
);
-- A device_id that is not one of the layout owner's devices (none should exist: a takeover cleared
-- the other users' references) is dropped, as deleting the device would have done.
INSERT INTO viewfinder_layouts_new (id, name, layout, created_at, updated_at, device_id, user_id)
  SELECT l.id, l.name, l.layout, l.created_at, l.updated_at,
         CASE WHEN EXISTS (SELECT 1 FROM devices_new d WHERE d.user_id = coalesce(l.user_id, '00000000-0000-4000-8000-000000000001') AND d.id = l.device_id)
              THEN l.device_id END,
         coalesce(l.user_id, '00000000-0000-4000-8000-000000000001')
  FROM viewfinder_layouts l;

DROP TABLE viewfinder_layouts;
DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;
ALTER TABLE viewfinder_layouts_new RENAME TO viewfinder_layouts;

CREATE INDEX viewfinder_layouts_user_device_idx ON viewfinder_layouts (user_id, device_id);
