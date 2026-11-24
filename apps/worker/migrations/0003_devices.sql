-- Devices (rewrite step B3, #375; docs/rewrite/03-capture.md). A device is a file of the type "device"
-- in its owner's account home; this row ties it to the hardware it stands for, so the same phone
-- finds its record again after a reinstall and two phones of one model are two devices. On Android
-- the fingerprint is the system's ANDROID_ID (per signing key, new after a factory reset).
CREATE TABLE devices (
  file_id      TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint  TEXT NOT NULL,
  seen_at      TEXT NOT NULL,
  UNIQUE (user_id, fingerprint)
);
