# New shot without the camera

[Issue #27](https://github.com/bubulux/fielder/issues/27), left over from #12. Dashboard → Shots → **New shot** (`⇧N`, also in ⌘K) makes a shot that did not come from the phone (`apps/dashboard/src/NewShot.tsx`).

- **Upload images**: drop images or choose files (up to 60). They are scaled to 2048 px on the long edge and sent as JPEG; transparent PNGs get a white background. Several images become **one shot with a sequence** in the shown order (reorder with ‹, remove with ✕), or **one shot each** (names get " 2", " 3", …).
- **Draw a sketch**: the compose editor's tools on a blank canvas (16:9, 4:3, 1:1, 3:4). On create, the drawing is rendered to a 1600 px PNG that becomes the shot's photo, and the vector drawing is kept as the shot's first **sketch** ([compose](compose.md)), so it stays editable there.
- **Side panel**: name, location (search or create), review state (starts from Settings › New shot › Review state: Approved by default, since the shot is added on purpose; To review for those who review everything) and a description.
- After creating, the shot view opens on the new shot (or the first of several).

## What such a shot is

A normal shot whose photos have `source` `upload` or `drawn` instead of `camera` (`photos.source`, migration 0009). They have no rig framing, no position and `lens_mm` 0. Everywhere a rig would be named they say "Uploaded image" or "Drawn sketch" (`rigLabel` on both clients); the inspector's Camera section shows the source and size. Frame modes show the image as is; the rig explorer says it has no framing data; Compose and Timeline hide the rig and lens pickers for them. Tags, overlays, sketches, shooting days and timelines work as for any shot, and the phone shows them like other photos. A position comes from a location pin ([positions](positions.md)) or Set position.

## Not done

- Editing the sketch later does not change the shot's photo (photos are immutable); add an overlay or a new shot instead.
- No upload from the phone.
