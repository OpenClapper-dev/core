-- Mesh key recovery (issue #303), additive.
--
-- key_backup: a network's keys, encrypted on the phone with a key derived from the owner's recovery
-- passphrase (AES-GCM; scrypt). An opaque blob: the server cannot read it.
-- holder: the app install (its device id) that controls the network now. One phone at a time: both
-- would send from the same mesh address, and the lights drop one of them as replays.
-- seq_floor: how far that phone has counted its mesh sequence numbers, so a restored phone starts above.
ALTER TABLE mesh_networks ADD COLUMN key_backup TEXT;
ALTER TABLE mesh_networks ADD COLUMN key_backup_at TEXT;
ALTER TABLE mesh_networks ADD COLUMN holder TEXT;
ALTER TABLE mesh_networks ADD COLUMN seq_floor INTEGER NOT NULL DEFAULT 0;
