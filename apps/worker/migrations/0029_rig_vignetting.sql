-- Issue #266: lens vignetting per rig. The lens's image circle can be smaller than the format
-- diagonal at some focal lengths (wide end), so the corners darken. A rig stores points
-- [{ mm, start, end, opacity }]: where the falloff begins and is complete (fractions of the frame's
-- half-diagonal) and how dark the corner gets, interpolated between points (packages/vocab vignetting.ts).
ALTER TABLE presets ADD COLUMN vignetting TEXT CHECK (vignetting IS NULL OR json_valid(vignetting));
