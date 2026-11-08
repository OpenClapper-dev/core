-- Lights' power (issue #294), additive. powered_by: the battery fixture (a NEEWER PS099S) a light
-- without its own battery runs on, or null (a socket, or not set). One light per battery: assigning a
-- battery to a light takes it from any other.
ALTER TABLE fixtures ADD COLUMN powered_by TEXT REFERENCES fixtures(id) ON DELETE SET NULL;
