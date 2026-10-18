-- Issue #114 (epic #107): a user's personal workspace is a kind, not "the workspace they own": the
-- shared workspaces a user creates are theirs too. Every workspace before this one was a personal one
-- (the bootstrap user's, and those scripts/user.mjs makes with a user).
ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'shared' CHECK (kind IN ('personal', 'shared'));
UPDATE workspaces SET kind = 'personal';
