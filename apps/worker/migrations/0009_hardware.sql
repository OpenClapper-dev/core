-- The Hardware extension's own table (docs/rewrite/08-extensions.md: an extension brings its own tables, no
-- column on a core table). A Bluetooth Mesh network the phone provisions for its lights, per account. Its keys
-- live on the phone; the server keeps only a backup the phone sealed with a passphrase.
CREATE TABLE hw_mesh_networks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  iv_index INTEGER NOT NULL DEFAULT 0,
  -- The next unicast address to hand out; the phone itself is 0x0001.
  next_unicast INTEGER NOT NULL DEFAULT 2,
  -- The device file id of the phone that sends in this network (one at a time).
  holder TEXT,
  -- Sequence numbers at or above which the holder may send; only rises.
  seq_floor INTEGER NOT NULL DEFAULT 0,
  key_backup TEXT,
  key_backup_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX hw_mesh_networks_user ON hw_mesh_networks(user_id);
