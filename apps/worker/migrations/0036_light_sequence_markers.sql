-- Markers on a light sequence (#323): named points and ranges, across the sequence or on a track.
-- The editor's JSON, checked by parseSequenceMarkers (packages/vocab). Additive.
ALTER TABLE light_sequences ADD COLUMN markers TEXT NOT NULL DEFAULT '[]';
