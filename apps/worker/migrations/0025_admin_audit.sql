-- Admin audit trail (issue #224): every change an operator makes in the admin plane (accounts,
-- settings), written in the same D1 batch as the change, so neither exists without the other.
-- Workers Logs keep days; this keeps it. No foreign key: the trail outlives a deleted account.
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  operator_email TEXT NOT NULL,                -- from the Access JWT ('admin@localhost' locally)
  action TEXT NOT NULL,                        -- user.create, user.update, user.password, user.delete, settings.update
  target_user_id TEXT,
  target_email TEXT,                           -- the account's email at the time of the action
  detail TEXT NOT NULL DEFAULT '{}'            -- JSON: what changed; never a password
);

-- The board reads it newest first, page by page.
CREATE INDEX admin_audit_at ON admin_audit (at DESC, id DESC);
