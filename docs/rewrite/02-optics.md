# 02 · Optics and frames

Workshop [#329](https://github.com/OpenClapper-dev/core/issues/329). Status: **decided** (2026-11-17; frames moved into the canvas by [05](05-composition.md), wording updated in the [interjection](i1-interjection.md), 2026-11-19).

What field of view a picture has, and what part of a photo a camera would see. Optics is a set of generic factors; an optics preset is a saved, fixed set of them.

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

## The model

### Optics

**Optics** is a set of generic factors: what a camera with a given lens sees. No equipment, no rigs, no vignetting.

| Factor | Meaning |
| --- | --- |
| Format | Sensor area, width × height in mm: picked from the generic format list or typed in |
| Multiplier | Focal reducer or teleconverter factor; 1 = none |
| Squeeze | Anamorphic squeeze; 1 = spherical. Widens the horizontal view only (front anamorphics); rear adapters are out of scope. Picks: 1.25, 1.33, 1.5, 1.6, 1.8, 2, plus free entry |
| Focal length | Whole mm |
| Orientation | Landscape or portrait |
| Delivery aspect | Optional: an aspect ratio cropped centred inside the camera's view (2.39:1 out of a 16:9 or desqueezed picture) |

`fov-math` derives the angle of view from these, as today.

### The photo's angle of view

A photo row carries its **angle of view** (horizontal and vertical, in degrees) and the source it came from. It is computed once when the photo is added, the same way for every photo, taken in the app or imported:

1. EXIF `FocalLengthIn35mmFilm` with the picture's aspect ratio and orientation.
2. Else EXIF `FocalLength` with the sensor size from `FocalPlaneXResolution` / `FocalPlaneYResolution` / `FocalPlaneResolutionUnit` and the pixel dimensions.
3. Else the photo has no angle of view.

The raw EXIF is kept (workshop 01), so the angle can be recomputed if the rule changes. No device registry is involved. What the phone reports about its camera serves the live viewfinder only (workshop 03).

Later, as further sources on the same columns: typing in the inputs of 1 or 2, or the angle itself.

Known limit: a photo cropped in another program keeps its EXIF, so its angle of view is wrong without warning.

### Frames

A **frame** is a rectangle on a photo (size and centre in fractions of the photo, as today). Two kinds:

- **Optics frame**: what given optics see, against the photo's angle of view (`overlayRect`). Needs a photo with an angle of view; can exceed the photo. With a delivery aspect, the picture is the inner rectangle of that aspect.
- **Aspect frame**: a free rectangle of a chosen aspect ratio, on any photo.

A frame is saved as an object inside a canvas that has the photo as its base ([05](05-composition.md)). There is no "framing" as a separate saved object on a photo. An optics frame is one of:

| Kind | Where its values come from |
| --- | --- |
| **Free-form** | It owns all its values. Any combination can be explored; nothing else can change it |
| **Preset** | Format, multiplier, squeeze and delivery aspect come from an optics preset; the focal length is one the preset offers. Position and orientation are the frame's own |

"Create preset from this frame" turns a free-form exploration into a preset.

A photo has no default frame. A canvas marks which of its frames is the picture it stands for; a reference can also point at one particular frame of a canvas ([05](05-composition.md)).

### Optics preset

An **optics preset** is a named, complete description of a camera with its lenses. It belongs to one project.

| Part | Content | After creation |
| --- | --- | --- |
| Name | Free text | Editable |
| Format, multiplier, squeeze, delivery aspect | As above | Fixed |
| Lenses (mandatory) | A set of primes (one or more focal lengths), or one zoom (from–to, whole mm) | Additive only |

- **Additive only:** a prime can always be added; a zoom range can always be widened. A prime can be removed, and a zoom narrowed, only as far as no frame uses the focal lengths that would go; a prime in use is shown greyed with the note that it is used.
- **In use** means used by a frame in any canvas of the project, internal canvases included ([I1](i1-interjection.md)), or by a progression's default frame ([04](04-shots.md)). The frame recorded at capture is a copy and does not count.
- **Deleting:** a preset no frame uses can be deleted. One in use can only be archived: it leaves the pickers and its frames keep working.
- **Duplicate** is the way to a changed preset (another format, another zoom). Moving frames from one preset to another is a later feature.
- Because nothing that shapes the picture can change, a frame never changes behind the user's back, and a phone that was offline still shows the preset's current values.

### Pickers

| Where | Focal lengths offered |
| --- | --- |
| Free-form | The built-in prime list as stops, plus any whole mm typed in |
| Preset with primes | That set |
| Preset with a zoom | From–to in whole mm |

Built-in prime list (cine and photo series merged), also the tick list when defining a preset's primes, where own values can be added:

`12 14 16 18 20 21 24 25 27 28 32 35 40 50 65 75 85 90 100 135`

Zooms have no defaults.

### Generic formats

No camera bodies. Dimensions are from memory and must be checked against the standards before they are built in.

| Group | Format | Width × height (mm) |
| --- | --- | --- |
| Small sensors | 1/2.3" | 6.17 × 4.55 |
| | 1/1.7" | 7.6 × 5.7 |
| | 1" | 13.2 × 8.8 |
| Small film | Super 8 | 5.79 × 4.01 |
| | 16 mm | 10.26 × 7.49 |
| | Super 16 | 12.52 × 7.41 |
| Mid-size | Micro Four Thirds | 17.3 × 13.0 |
| | APS-C (Canon) | 22.3 × 14.9 |
| | APS-C (Sony, Nikon, Fuji) | 23.5 × 15.6 |
| 35 mm cine | Academy 35 | 21.95 × 16.0 |
| | Super 35, 3-perf | 24.89 × 14.0 |
| | Super 35, 4-perf | 24.89 × 18.66 |
| Full frame | Full frame (135) | 36 × 24 |
| | VistaVision, 8-perf | 37.72 × 24.92 |
| Medium and large | Medium format 44 × 33 | 43.8 × 32.9 |
| | Medium format 645 digital | 53.4 × 40.0 |
| | 65 mm, 5-perf | 52.63 × 23.01 |
| | IMAX, 15-perf | 70.41 × 52.63 |

### Creating a preset: preview on example photos

The create flow shows what the preset sees on real pictures. The app ships a small set of example photos with a known angle of view:

- several scenes (for example an interior, a street, a landscape, a person at a known distance);
- per scene two or three photos from one tripod position at different focal lengths on full frame, so every focal length can be shown as a correct crop without enlarging too far.

The photos must be ones the project may ship; the plan is that the owner shoots them (shot list to follow). A project's own photos with an angle of view can be used in the same preview.

### Package boundaries

- `fov-math`: optics → angle of view, EXIF values → angle of view, frame fractions. No colours, no presets, no photos.
- `vocab`: frame and preset shapes, the additive-edit rules, the format and prime lists.
- Overlay colours move to the design system (`--over-*`); view modes are workshop 05.

### Tiers

- Core: the photo's angle of view and the optics math.
- Standard app: Optics presets. Frames are made in the canvas tool, which is core ([05](05-composition.md)).

## What goes

Rigs (`presets` as body + lens range + vignetting), the camera body catalogue, vignetting, `photos.framing` (rig snapshot), `photos.root_framing_id`, `phoneViewFromFrame` and `reframe` as the way to a photo's field of view, `framings` as saved objects on a photo, `OVERLAY_DEFAULTS` in `fov-math`, the rig as a precondition for capture and framing. Equipment and inventory may return later as their own block that builds presets.

## Handed to other workshops

Answered since: the live picture's angle of view and the frame at capture ([03](03-capture.md)); how frames are saved and referenced ([05](05-composition.md)).

- **UX workshops:** the frame picker, the preset create flow with its preview, the "in use" states.
- **Build:** verifying the format dimensions.

## Decided

2026-11-13 and 2026-11-17, by the owner:

- **Both kinds of frames:** optics frames where a photo has an angle of view, aspect frames on every photo. An optics frame can carry a delivery aspect, cropped centred inside the camera's view.
- **Optics is generic factors only:** format, multiplier, squeeze, focal length, orientation. No rigs, no equipment or inventory, no vignetting for now.
- **The photo's angle of view** is computed once when the photo is added and stored on the photo row with its source: first from the EXIF 35 mm equivalent, else from EXIF focal length and sensor size, else none. Same path for photos taken in the app and imports; no device registry. Raw EXIF stays.
- **Typing in the inputs or the angle by hand** is deferred; it is a further source on the same columns.
- **Frames are free-form or made from a preset.** A free-form frame owns its values. There is no default frame on a photo.
- **Optics preset** (the name): format, multiplier, squeeze, delivery aspect, and mandatory lenses (a set of primes, or one zoom). Scoped to one project, no sharing between projects.
- **Presets change additively only:** the name is always editable; format, multiplier, squeeze and delivery aspect are fixed; lenses can be added, and removed only where no frame uses them. A preset in use is archived, not deleted; duplicating gives a changed one.
- **Built-in prime list** of 20 focal lengths, own values can be added; no defaults for zooms; focal lengths are whole mm.
- **Formats:** a generic list from small sensors to IMAX, no camera bodies.
- **Preset creation previews on example photos** shipped with the app.
- **Tiers:** angle of view and math are core; Optics presets are a standard app.

Changed by [05](05-composition.md) on 2026-11-19: frames live inside a canvas only. The first record of this page had "framings" as saved objects on a photo and a Framing app; both are gone, and the text above is updated. Free-form and preset frames, the optics preset and its additive rule stand.
