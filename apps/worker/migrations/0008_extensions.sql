-- Extensions enabled per project (docs/rewrite/08-extensions.md): a JSON list of extension ids.
ALTER TABLE projects ADD COLUMN extensions TEXT NOT NULL DEFAULT '[]';
