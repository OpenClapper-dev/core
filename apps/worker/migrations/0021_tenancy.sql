-- Issue #108 (epic #107): users, sessions and workspaces. Every project belongs to a workspace; rigs
-- too. Devices and viewfinder layouts belong to a user (a phone is a person's). Access is decided by
-- workspace_members alone; workspaces.owner_user_id is bookkeeping, nullable so organisations can
-- own workspaces later through an added owner_org_id.
-- Additive: columns are added, nothing is rebuilt. The new reference columns are nullable in SQL
-- only (ALTER TABLE cannot add a NOT NULL reference); the Worker always sets them.
-- The existing data goes to a bootstrap owner with fixed ids. Its password_hash '!' never verifies,
-- so nobody can sign in as it until a real email and password are set.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  name           TEXT,
  password_hash  TEXT NOT NULL,                 -- 'pbkdf2-sha256$<iterations>$<salt>$<hash>'; '!' = sign-in disabled
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT
);
CREATE UNIQUE INDEX users_email_idx ON users (email COLLATE NOCASE);

-- The raw token is never stored: id is its SHA-256 (hex).
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client        TEXT NOT NULL CHECK (client IN ('dashboard', 'mobile')),
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX sessions_user_idx ON sessions (user_id, expires_at);

CREATE TABLE workspaces (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  owner_user_id  TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT
);
CREATE INDEX workspaces_owner_idx ON workspaces (owner_user_id);

CREATE TABLE workspace_members (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

INSERT INTO users (id, email, name, password_hash)
  VALUES ('00000000-0000-4000-8000-000000000001', 'owner@fielder.invalid', 'Owner', '!');
INSERT INTO workspaces (id, name, owner_user_id)
  VALUES ('00000000-0000-4000-8000-000000000002', 'Personal', '00000000-0000-4000-8000-000000000001');
INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'owner');

-- ---------------------------------------------------------------- owners
ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
UPDATE projects SET workspace_id = '00000000-0000-4000-8000-000000000002';
DROP INDEX projects_name_idx;
CREATE UNIQUE INDEX projects_workspace_name_idx ON projects (workspace_id, name COLLATE NOCASE);

ALTER TABLE presets ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
UPDATE presets SET workspace_id = '00000000-0000-4000-8000-000000000002';
CREATE INDEX presets_workspace_idx ON presets (workspace_id);

ALTER TABLE devices ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE devices SET user_id = '00000000-0000-4000-8000-000000000001';

ALTER TABLE viewfinder_layouts ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE viewfinder_layouts SET user_id = '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- storage accounting
-- Bytes of the stored image, written at upload; NULL for photos uploaded before this migration.
ALTER TABLE photos ADD COLUMN size_bytes INTEGER;
