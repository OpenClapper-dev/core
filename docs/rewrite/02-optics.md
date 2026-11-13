# 02 · Optics and frames

Workshop [#329](https://github.com/OpenClapper-dev/core/issues/329). Status: **proposal, nothing decided yet**.

What field of view a picture has, and what part of a photo a camera would see. Optics is the base; a rig becomes an optional saved bundle on top of it.

## As-is

| Fact | Where |
| --- | --- |
| The math needs only a sensor (width × height mm), a focal length and a focal reducer factor; it returns the effective focal length, crop factor, full-frame equivalent and horizontal, vertical and diagonal FOV | `packages/fov-math/src/fov.ts` (`computeFraming`) |
| A frame on a photo is the ratio of `tan(fov/2)` of the rig and of the phone, per axis; fractions > 1 mean the rig sees more than the photo | `overlayRect` |
| The phone's own FOV is estimated from its 35 mm-equivalent focal length and the preview aspect | `phoneViewFromEquivalent` |
| A stored photo does not keep its own FOV. It is recovered backwards from the rig snapshot and the as-captured frame fractions (`phoneViewFromFrame`); re-framing with another rig goes through that (`reframe`) | `fov.ts`, `docs/features/rig-explorer.md` (Math) |
| A **rig** (`presets` table) is: name, camera body and recording format (`camera_id`, `format_id`, or a custom sensor), sensor width × height, speedbooster factor, lens range min–max, vignetting per focal length | `docs/data-model.md`, `apps/worker/src/presets.ts` |
| Built-in camera formats: Blackmagic Pocket 4K and 6K (per recording mode, windowed modes crop), generic full frame, Super 35, APS-C (Sony/Fuji/Nikon, Canon), MFT, 1"; plus fixed lists of lens focal lengths and reducer factors | `packages/fov-math/src/cameras.ts`, `presets.ts` |
| Rig orientation (landscape/portrait) is a capture setting that swaps axes | `framing.rig_orientation`, `fovOnPhoto` |
| Every phone photo carries a **rig snapshot** (`photos.framing` JSON: rig name, ids, sensor, reducer, lens, orientation, derived FOV, the frame, the phone's equivalent focal length) | `docs/data-model.md` |
| **Framings** (`framings` table) are saved frames per photo: name, `rig_id` (or null = as shot), lens, frame size + centre. Size always comes from a rig + lens: there is no free crop. One framing can be the photo's **root**, which every view shows | `packages/vocab/src/framing.ts`, `docs/features/rig-explorer.md` |
| Steps reference framings; timeline clips reference a framing plus a copy of its frame; inline re-frames live only in a clip until promoted | `docs/features/composition.md`, `timeline.md` |
| **Vignetting** belongs to the rig and is read live from the current preset, while FOV is read from the snapshot | `packages/vocab/src/vignetting.ts`, `apps/studio/src/vignette.ts` |
| Uploaded and drawn images have no rig and cannot be framed at all | `docs/features/rig-explorer.md` |
| The phone cannot take a photo without a rig | `apps/mobile/src/screens/Viewfinder.tsx:240` |
| Rigs are used across ~20 Studio files (Library › Rigs, Framing stage, Compare, Stacked, Inspector, Timeline, Zoom sequence) and ~15 phone files (rig and lens sheets, forced rig, preset sync) | grep `presets`, `rig` |
| `fov-math` also holds overlay colours (`OVERLAY_DEFAULTS`) | `presets.ts` |

## Problems and leaks

1. **Optics is only reachable through a rig.** Saying "this photo was taken at 24 mm on full frame" or "show me 35 mm on Super 35 here" requires creating a rig first.
2. **A photo does not know its own field of view.** It is reconstructed from a rig snapshot, so a photo without one (upload, import, an old phone photo) can never be framed.
3. **Snapshot and live data are mixed.** FOV comes from the snapshot, vignetting from the live rig; editing a rig changes some things on old photos and not others.
4. **No frame without optics.** A plain aspect-ratio crop (2.39:1 on a reference photo) is impossible.
5. **The root framing is a global opinion.** One framing decides how a photo looks everywhere, although different shots or clips may want different frames of the same photo.
6. **Display concerns in the math package** (overlay colours), and the rig carries capture behaviour (the phone refuses to shoot without one).

## Proposal

### Optics (base)

**Optics** is a plain value: what a camera with a given lens sees.

| Field | Meaning |
| --- | --- |
| Format | Sensor area width × height in mm, from the built-in catalogue (body + recording format) or entered by hand |
| Focal length | mm |
| Reducer | Focal reducer factor; 1 = none |
| Squeeze | Anamorphic squeeze factor; 1 = spherical (open question 5) |
| Orientation | Landscape or portrait |

From it `fov-math` derives the field of view (horizontal, vertical, diagonal), the full-frame equivalent and the crop factor, as today. Optics needs no saved object: it can be typed in anywhere a value is asked for.

### The photo's optics facet

The **optics facet** of a photo (workshop 01) states the field of view of the image itself: horizontal and vertical angle of view, plus where it came from (`device` from the capture device and zoom, `exif` from an import's focal length and 35 mm equivalent or make/model, `manual`). It is stored directly, never reconstructed from a rig. A photo with this facet can be framed with any optics; a photo without it can only get an aspect frame (below).

### Frames

A **frame** is a rectangle on a photo: a size and a centre, in fractions of the photo, as today (`Frame` in `packages/vocab/src/framing.ts`). Its size comes from one of two sources:

- **Optics frame**: the size follows from target optics against the photo's optics facet (the existing `overlayRect`). Can exceed the photo (the camera sees more than the photo has).
- **Aspect frame**: a free rectangle of a chosen aspect ratio (2.39:1, 1.85:1, 16:9, 4:3, 1:1, custom), any size up to the photo. Works on every photo (open question 2).

A **framing** is a saved, named frame on a photo. It stores its frame and, for an optics frame, the optics values it was made with, so it stays correct whatever happens to a rig later (open question 4).

### Who chooses the frame

The photo shows itself whole. A user of a photo (a shot, a step, a layer, a timeline clip) references the framing it wants, or none. There is no root framing on the photo (open question 6).

### Rig (optional layer)

A **rig** is a saved bundle for people who shoot with known kit: a name, a format, a reducer, a lens set (focal lengths or a zoom range), and vignetting per focal length. It is a **template** that fills optics in one pick, and the place where lens character (vignetting) lives. Nothing requires a rig: the phone shoots without one (workshop 03), and every optics field can be typed in by hand. Whether a framing or the viewfinder follows later edits of the rig is open question 4.

### Package boundaries

- `fov-math`: optics → FOV, frame fractions, reframing. No colours, no rigs, no photos.
- `vocab`: frame and framing shapes, validation, the camera catalogue's shape.
- Overlay colours move to the design system (`--over-*`), view modes to workshop 05.

### Apps and tiers (proposal)

- **Optics** calculator and the optics facet editor: core (they are how a photo gets a field of view).
- **Framing** (saving frames on photos, compare, stacked frames): standard app.
- **Rigs** (library of rigs, vignetting): standard app.

### What goes

`photos.framing` snapshot, `photos.root_framing_id`, `phoneViewFromFrame` as the way to get a photo's FOV, `framings.rig_id` as the only size source, `OVERLAY_DEFAULTS` in `fov-math`, the rig as a precondition for capture and framing.

## Open questions

1. **Optics facet**: store the photo's angle of view as proposed, or the capturing camera's format + focal length (and compute the angle)?
2. **Aspect frames**: allow free aspect-ratio frames next to optics frames, or keep frames optics-only?
3. **Rigs**: keep rigs as optional templates with lens sets and vignetting, or drop them and keep only the format catalogue plus typed-in values?
4. **Snapshot or live**: does a framing keep the optics values it was made with, or follow later edits of its rig?
5. **Anamorphic**: include a squeeze factor in the base optics now?
6. **Root framing**: no default frame on the photo (users pick their framing), or keep one default per photo?

## Decided

Nothing yet.
