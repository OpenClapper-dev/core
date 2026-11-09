-- A device put to sleep (issue #318): the phone proxy leaves it alone (no connection attempts) until
-- it is woken. Additive.
ALTER TABLE fixtures ADD COLUMN asleep INTEGER NOT NULL DEFAULT 0;
