-- Lights (epic #206, issue #208): the fixtures a workspace controls from the phone, and the
-- Bluetooth Mesh networks the phone provisions for mesh fixtures (Aputure). Additive.
--
-- No key material here: a mesh network's NetKey, AppKey and device keys stay in the phone's secure
-- store. A network row only carries what another phone or the Studio may know about it.

CREATE TABLE mesh_networks (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  name          TEXT NOT NULL,
  iv_index      INTEGER NOT NULL DEFAULT 0,
  -- The next free unicast address the provisioner hands out.
  next_unicast  INTEGER NOT NULL DEFAULT 2,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT
);
CREATE INDEX mesh_networks_workspace_idx ON mesh_networks (workspace_id);

CREATE TABLE fixtures (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
  label            TEXT NOT NULL,
  -- FIXTURE_KINDS in packages/vocab/src/lighting.ts.
  kind_id          TEXT NOT NULL,
  -- The Bluetooth address as Android reports it ("AA:BB:CC:DD:EE:FF").
  address          TEXT NOT NULL,
  -- Mesh fixtures once provisioned; NULL for GATT fixtures and unprovisioned mesh ones.
  mesh_network_id  TEXT REFERENCES mesh_networks(id) ON DELETE SET NULL,
  mesh_unicast     INTEGER,
  mesh_elements    INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT
);
CREATE INDEX fixtures_workspace_idx ON fixtures (workspace_id);
CREATE UNIQUE INDEX fixtures_unicast_idx ON fixtures (mesh_network_id, mesh_unicast) WHERE mesh_network_id IS NOT NULL;
