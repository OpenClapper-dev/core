-- How watchers of a canvas see it change while someone edits it (#377 follow-up): `realtime` through a
-- Durable Object per canvas (every change as it happens), or `gradual` (the watchers read the file every
-- few seconds; only D1). A project setting, because Durable Objects cost; the default is realtime.
ALTER TABLE projects ADD COLUMN canvas_live TEXT NOT NULL DEFAULT 'realtime' CHECK (canvas_live IN ('realtime', 'gradual'));
