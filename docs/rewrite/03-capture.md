# 03 · Capture on the phone

Workshop [#330](https://github.com/OpenClapper-dev/core/issues/330). Status: **in discussion**: the four questions are answered (2026-11-18), the rest of the proposal awaits the owner's confirmation.

The phone takes photos. Everything else on the capture screen (frames, presets, reference frames) is an optional control on top.

## As-is

| Fact | Where |
| --- | --- |
| The Shoot tab is a viewfinder for a cinema camera: the phone's preview with the frame of the chosen rig and lens on top | `docs/features/capture.md`, `apps/mobile/src/screens/Viewfinder.tsx` |
| The shutter cannot fire without a project, a rig and a camera; "Set up a rig" and "No project" are blocking cards | `capture.md` (Controls, Blocking states) |
| Camera: `react-native-vision-camera` 5.2.3, Android's logical back camera, 4:3 photo output `UHD_4_3` at quality 0.9, one zoom ratio across all lenses | `Viewfinder.tsx:83`, `capture.md` (Camera) |
| Phone lenses are fixed zoom stops inside the reported range (ultra-wide when below 1×, 1×, 2×, 3×, 5×, 10×); the library reports the range but not where the phone switches lenses | `apps/mobile/src/zoom.ts` |
| The library reports a focal length for the logical camera and for each physical lens; today this is only written to the debug log | `Viewfinder.tsx:114` |
| The live picture's field of view comes from the main lens's 35 mm equivalent times the zoom. The equivalent is learned from the EXIF of the phone's own photos (`FocalLengthIn35mmFilm`), only at 1×; at other zooms the EXIF value is logged next to the computed one and not used. Manual entry exists for phones without the tag; before the first photo the app assumes 25 mm | `apps/mobile/src/calibration.ts`, `phone.ts`, `capture.md` (Math) |
| EXIF is read in the app from the encoded JPEG, five tags only (Make, Model, Orientation, FocalLength, FocalLengthIn35mmFilm) | `apps/mobile/src/exif.ts` |
| A capture keeps a 1280 px copy and deletes the full-size file | `capture.md` (What a capture produces) |
| Every capture becomes a draft and opens the **Tag** screen (name, INT/EXT, light, location, weather, extra fields), unless Direct upload is on. **Seq** mode appends captures to one shot | `screens/Tag.tsx`, `sequence.ts` |
| Each photo gets GPS (High, Low, Off), the rig snapshot and a device readout | `capture.md`, `docs/features/positions.md` |
| Controls: Uploads, Seq, Light (torch), Shutter, Fit (zoom so the frame fills the screen), Human (reference frame 35 / 43 / 50), Rig; a lens strip; HUD chips (project, rig and lens, FOV, GPS, warnings); blackout outside the frame | `capture.md` (Controls) |
| **Viewfinder layouts**: 1–4 bars per orientation with up to 9 controls, plus a look (HUD chips, frame colour, blackout) and options (Human, phone lenses). Made in the Studio (Library › Viewfinder) with drag and drop, previewed live on the phone over a websocket (Durable Object `PreviewRoom`), picked on the phone | `docs/features/viewfinder-layouts.md`, `packages/vocab/src/viewfinder.ts` |
| A **device** record is a phone read out over that socket: model, Shoot screen size per orientation, zoom stops, the main lens's equivalent. It exists so the layout editor can preview at the phone's size; per account | `viewfinder-layouts.md` (Device specs), `apps/mobile/src/device.ts` |
| Upload queue: local first, idempotent, visible and editable while queued, 12 photos per request, network errors retry, three rejections make an entry `stuck` (never deleted), offline mode, a missing file drops only that photo | `apps/mobile/src/uploads.ts`, `capture.md` (Upload queue) |
| Gates before the tabs: sign in (or continue without, shots stay on the phone) and pick a project (a new project works offline) | `docs/features/phone-app.md` |
| The phone cannot import existing pictures | `docs/features/new-shot.md` |

## Problems and leaks

1. **No photo without a rig.** The camera is locked behind an optics opinion.
2. **Every photo is forced through tagging.** The Tag screen asks shot questions (INT/EXT, light, location) about what is, after workshop 01, only a photo.
3. **Capture decides structure.** Seq mode makes "one shot with many photos" at the moment of shooting.
4. **The picture is thrown away.** Only 1280 px survives.
5. **The live field of view rests on one assumption:** the main lens's equivalent times the zoom ratio. Whether that holds on the ultra-wide and tele lenses was never verified; the code logs the difference and ignores it.
6. **The device record serves a tool, not the photo.** It exists for the layout editor's preview, yet workshop 01 named it as a photo facet.
7. **One screen carries unrelated features:** GPS, lights, the Studio preview socket and uploads all hang on the viewfinder and on `flush()`.

## Proposal

### The base: a camera

The capture screen works with nothing set up except a project (a photo belongs to exactly one project, workshop 01). Shutter, phone lenses and torch are always available. A capture produces one photo and returns to the camera at once.

| Step | What happens |
| --- | --- |
| Shutter | The camera's full-resolution JPEG is kept as the original, untouched |
| On the phone | Preview (about 2048 px) and thumbnail (about 400 px) are made; the EXIF is read; the angle of view is computed (workshop 02) |
| Queue | The photo is queued and visible in the phone's library at once |
| Upload | Thumbnail and preview first, the original after (on Wi-Fi only, if the user wants) |

There is no Tag screen, no draft and no Seq mode: several captures are several photos. Name and note can be added in the library. Whether a capture can be aimed at a shot ("take the photo for this planned shot") is workshop 04.

### Controls on top

Everything beyond the base is a control that can be on the screen or not:

| Control | What it does | Needs |
| --- | --- | --- |
| Optics frame | Draws what an optics preset, or free-form values, see; with a focal length picker | The live picture's angle of view |
| Aspect frame | Draws a frame of an aspect ratio | Nothing |
| Fit | Zooms so the frame fills the screen | A frame |
| Blackout | Darkens outside the frame | A frame |
| Orientation | Turns the optics frame to portrait | An optics frame |
| Reference frame | A second frame for comparison (today "Human": full frame at 35 / 43 / 50 mm) | The live angle of view |
| Phone lenses | Switches between the phone's real lenses (below) | More than one real lens |
| Torch, uploads | As today | Nothing |

With an optics frame on screen, the photo gets a framing from it automatically: the preset or the free-form values, the focal length, centred. It can be renamed, changed or deleted later. Without a frame on screen there is no framing.

Fit enlarges the picture on the screen only; it never changes the photo.

### Real lenses only

The lens menu offers the phone's physical lenses and nothing else: no digital zoom, neither in the menu nor in a photo. A longer view is what a longer focal length in the optics frame is for. Every photo is therefore the full picture of one real lens, and its EXIF describes it; that is why the photo's angle of view can come from EXIF alone (workshop 02), also for photos taken in the app.

The camera library lists the physical lenses with their focal lengths. What it does not give on Android today is the zoom value at which the logical camera switches to each lens (`apps/mobile/src/zoom.ts`). Finding those points reliably is a build task, tested on real phones. A phone that cannot tell its lenses apart offers its main lens only.

### The live picture's angle of view

The optics frame needs to know what the phone sees right now, per real lens. A cascade, like the photo's in workshop 02:

1. What the camera reports for the lens in use, if it is usable (focal lengths per lens are reported; whether a sensor size or field of view comes with it, and how reliable it is across phones, is not verified).
2. Else what the phone's own photos say: the angle of view of a photo taken with that lens, remembered per lens on the device record.
3. Else a value typed in by the user.
4. Else there is no optics frame on this lens: the control says why, and the camera, aspect frames and everything else still work.

No assumed default (today's 25 mm) and no "equivalent times zoom" across different lenses.

### Camera layouts

A **camera layout** says which controls are on the screen and where, per orientation, with its look (frame colour, blackout, HUD). A control that is not in the layout is off, so a layout is also the "capture profile": a plain camera, a viewfinder with presets, and so on.

Layouts stay customisable as today: made in the Studio's layout editor, previewed live on the phone, picked on the phone. Built in and read-only: **Camera** (shutter, phone lenses, torch, uploads) and **Viewfinder** (plus optics frame, focal lengths, fit, reference frame). A layout belongs to the account, like the devices it is designed for.

### Devices

A **device** is a piece of capture hardware in a generic registry. For now the only devices are phones and tablets running the app; the shape leaves room for other cameras later (a DSLR, a 360° camera).

| Rule | Detail |
| --- | --- |
| Registered automatically | On first use the app creates the record and keeps it current: model, real lenses with their angle of view, screen size per orientation. Named after the model; can be renamed |
| One record per piece of hardware | The record is tied to a fingerprint of the hardware, not to its name or model, so two phones of the same model are two devices and a reinstall finds its record again. On Android the candidate is the system's `ANDROID_ID` (stable across reinstalls, new after a factory reset, different per signing key, so each build variant sees its own); what else can serve, and what tablets and later iOS offer, is a build task |
| Owned by the account | A device belongs to the person using it and follows them across projects |
| Photos reference it | The photo's **capture device** facet (workshop 01) references the device and keeps its own readout (make, model, lens used), so the photo reads correctly for other members and after the device is removed. An imported photo carries a readout from its EXIF and no device |

### Import on the phone

The phone's library can import pictures from the phone's gallery (workshop 01). They take the same path as a capture: original untouched, derivatives made on the phone, EXIF read, angle of view computed, queued. Whether Android's photo picker hands over the unmodified file with its EXIF is not verified.

### Upload queue

The guarantees stay, per photo instead of per shot:

- A photo is stored on the phone before anything else happens and is never deleted for a rejection.
- Uploads are idempotent; network errors retry; repeated rejections park the photo as stuck with the server's error, to retry or discard by hand.
- Thumbnail and preview go first; the original stays queued until stored, also across app restarts and offline mode.
- The phone removes its copy of an original once the server has it.
- Queued photos are visible and editable (name, note) while they wait.

### What goes

The rig as a precondition, the Tag screen and remembered tags, drafts, Seq mode, Direct upload as a setting, GPS on capture and its HUD chip, the 1280 px copy, the assumed 25 mm, phone calibration as a Setup screen (replaced by the cascade), digital zoom and the fixed zoom stops, fixtures and layouts riding on `flush()`.

## Handed to other workshops

- **04 (shots):** capturing for a shot; where the old tags live.
- **08 (extensions):** lights, live picture, camera control leave the capture screen's core.
- **09 (shells):** the phone's tabs, gates and Setup.
- **UX workshops:** the capture screen, pickers and the layout editor.
- **Build:** check on real phones what the camera reports per lens, what EXIF the app's JPEGs carry at each phone lens and under digital zoom, and what the photo picker returns.

## Still to confirm

Taken from the proposal without a question so far:

1. The base as described: only a project is needed; no Tag screen, no drafts, no Seq mode; a capture is one photo.
2. The live angle of view as a cascade per real lens, with no optics frame where nothing is known.
3. Import from the phone's gallery through the same path as a capture.
4. The upload queue's guarantees, per photo.

## Decided

2026-11-18, by the owner:

- **Camera layouts stay customisable as today:** Studio editor, live preview on the phone, generalised to the new controls.
- **A photo taken in the app gets its angle of view from EXIF only,** like every photo (workshop 02).
- **Real lenses only:** the phone offers its physical lenses and no digital zoom; if they cannot be told apart, the main lens only.
- **Framing at capture:** a photo taken with an optics frame on screen automatically gets a framing.
- **Devices are a generic registry.** Phones and tablets register themselves automatically, tied to a hardware fingerprint, one record per piece of hardware. Other kinds of cameras may follow later.
- **Devices belong to the account;** a photo references its device and keeps its own readout.
