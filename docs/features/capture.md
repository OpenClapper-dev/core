# Capture (phone viewfinder)

The Shoot tab (`apps/mobile/src/screens/Viewfinder.tsx`) is a viewfinder for a cinema camera: the phone camera preview with the frame of the chosen rig + lens drawn on top.

## Camera (react-native-vision-camera, issue #26)

- The back camera is Android's logical camera (`useCameraDevice("back")`), so one zoom ratio reaches every lens: below 1× is the ultra-wide, the phone switches to its tele by itself. The `<Camera>` gets a 4:3 photo output (`UHD_4_3`), `resizeMode="contain"` in the 4:3 preview box, `orientationSource="interface"` (photos follow the UI orientation, like the frame), the zoom and the torch.
- **Phone lenses** (`zoom.ts`, `ZoomStrip` in `LensStrip.tsx`): stops inside the camera's zoom range: its minimum when below 1× (e.g. 0.5×), 1×, then 2× 3× 5× 10× up to its maximum. vision-camera reports the range (from the controller once the camera runs; remembered as `zoomRange.v1` for Setup) but not the lens switch points on Android. Which stops the strip offers is the layout's **Phone lenses** option (issue #68): All · Pick · Fixed (one, no buttons); List or Carousel per placement. The strip shows only with two or more stops. The choice is remembered (`zoom.v1`); a stop no longer offered falls back to the nearest.
- **FOV with a zoom**: the phone's 35 mm equivalent is the main lens's times the zoom. Auto calibration from EXIF runs only at 1× (other zooms are other lenses or a crop); captures at other zooms log the EXIF next to the computed value.
- The app runs only in a development build or an APK from here on (vision-camera is not in Expo Go; [development](../development.md)).
- Every step is in the [debug log](debug-log.md): the device (`camera device`: type, virtual, physical lenses, zoom range), `camera started` (the controller's range and stops), `phone lens`, `photo taken` (size, orientation, EXIF), `capture resized`, `capture at zoom`, `camera error`.

## Rigs and lenses

- **Rigs** (presets) are a camera body + recording format + speedbooster, or a custom sensor. Bodies and formats are in `packages/fov-math/src/cameras.ts`: BMPCC 4K/6K, generic FF, S35, APS-C, MFT, 1".
  - Optionally a lens range, e.g. an 18–35 zoom.
  - Optionally **lens vignetting** (issue #266, edited in the Studio's Library › Rigs): per focal length, where the dark corners start and are fully dark (fractions of the frame's half-diagonal) and how dark they get. The dark fading corners of a wide lens are its image circle ending before the format diagonal, so the shape is a circle around the centre and only those numbers are asked; between focal lengths the values interpolate, below the widest one they hold, above the longest there is none (aperture is ignored: a rough indication). The viewfinder draws it inside the frame (`components/Vignette.tsx`, an SVG radial gradient: `react-native-svg`) and every stored photo shows it over its frame; it is never baked into a photo.
  - Shoot → Rig opens the **Rig sheet** (`components/RigSheet.tsx`): tap a rig to shoot with it. "Edit <rig>" and "New rig" open the **Rig editor** (`screens/Rigs.tsx`). The editor has:
    - body + format as rows that open option sheets, or a custom sensor
    - speedbooster (none, ×0.71, ×0.64, ×0.58, other)
    - an optional lens range
    - a live facts line (crop, FF-equivalent)
  - Setup → Rigs & lenses lists every rig with the same editor. The Studio has Library › Rigs.
  - Rigs live on the server. `src/rigs.ts` holds them and the one in use for every screen, saves locally first, and pushes. `presetSync.ts` pushes offline edits and pulls the list.
- **Lens**: the **lens strip** (`LensStrip.tsx`) is a scrollable row of `LENS_PRESETS_MM` (12–135 mm) inside the rig's range (`lens.ts`).
  - Tap a value to use it. The selected one is an accent pill with "mm"; tapping it opens the **Lens sheet**, which takes any focal length (auto-focused number field plus the range presets; "Use 32 mm").
  - A value outside the rig's range is allowed there and shows struck through on the strip.
- **Math** (`packages/fov-math/src/fov.ts`, `apps/mobile/src/framing.ts`):
  - Effective focal length = lens × speedbooster; the crop factor is by diagonal against 36×24; the FOV is computed per axis.
  - The phone's own FOV comes from its 35 mm-equivalent focal length (issue #26). **From the photos** (default): each capture reads the EXIF `FocalLengthIn35mmFilm` (`calibration.ts`); when it differs from the stored value, that capture is framed with the EXIF value and Setup takes it over (with the phone model). **Manual** keeps a typed value for phones without the tag. Before the first photo the default is 25 mm (`phone.ts`).
  - The frame size is the ratio of tan(fov/2) values.
  - When the rig sees more than the phone, the live image is shrunk, the area around it is hatched (`components/Hatch.tsx`, the same pattern the stored photos use) and the frame drawn dashed.

## Controls

The bars and their controls come from the chosen [viewfinder layout](viewfinder-layouts.md); the **default** is described here. It puts the phone lenses (0.5× 1× 3×…) at the end of the lens strip's bar.

**One control row**, icons only (the accessible name carries the label): **Uploads · Seq · Light · Shutter · Fit · Human · Rig**, left to right, under the lens strip. Each side control is a whole-cell target with a 46 × 56 visual; the shutter is 76 dp.

In landscape the row becomes an 80 dp column next to the tab bar, read top to bottom as Rig · Human · Fit · Shutter · Light · Seq · Uploads. The lens strip becomes an 80 dp column on the other side, after the 32 dp cutout clearance. All chrome is opaque; a control that is on is filled with the accent colour.

| Control | What |
| --- | --- |
| Uploads | Queue count as a badge (red when a shot is stuck). Tap retries everything, stuck shots included, and says what happened; **hold** (500 ms) opens the Uploads screen. |
| Seq | Sequence mode on/off. Disabled while a capture runs. The count is on the shutter disc and the SEQ badge. |
| Light | Flashlight on/off (`torchMode`). Manual, not a flash; not remembered across launches. |
| Shutter | Capture. Red ring and disc with the photo count while a sequence runs. Dashed when it can't fire (no project, rig or camera). |
| Fit | Digital zoom so the rig frame fills the screen |
| Human | Cyan reference frame for roughly what a person sees, labelled "HUMAN 43". The layout says (issue #68): **cycle** (off → 35 → 43 → 50 → off) or **toggle** (off ↔ the chosen value). |
| Rig | The Rig sheet |

**HUD**: solid chips over the image, top left (centred between the columns in landscape). Each is switched on its own in the layout's look (issue #68; Setup → Viewfinder or the Studio editor):
- **Project**: tap opens the Project sheet.
- **Rig and lens**.
- **FOV**: FF-equivalent and angle of view, with the fit zoom, plus the human-view relation.
- **GPS**: the mode and accuracy ("GPS ±5 m", "GPS low ±40 m", "GPS off"); see [positions](positions.md).
- **Warnings**, shown independently of the others:
  - red "No project" (tap to pick)
  - amber: no GPS fix, or worse than ±20 m in high precision (never in GPS off), rig wider than the phone, **"Vignetting at n mm"** when the rig darkens the corners at the chosen lens, not signed in (tap to sign in), no server in this build

There is no theme button on the HUD any more; the theme is Setup → Theme.

**Blocking states** get an opaque card over the image with the one action that fixes them: "Set up a rig" → Rig editor, "No project" → Project sheet.

The layout's look holds the frame colour and width and the blackout and its tint (the neutral 62 % black is the default); Setup → Capture / Phone calibration hold rig orientation, orientation lock and the phone's focal length ([phone app](phone-app.md)). Fit and Human on/off are button states on the phone, not settings.

## What a capture produces

`capturePhoto` and the position (per the GPS mode, [positions](positions.md)) run in parallel. The encoded JPEG's EXIF is read in JS (`exif.ts`: Make, Model, Orientation, focal lengths; vision-camera does not expose it), the bytes go to a cache file, and the photo is resized (upright, the manipulator applies the EXIF rotation) to 1280 px JPEG (the full-size temp file is deleted) and gets `PhotoMetadata`: id, ordinal, timestamp (the capture time), lat/lon, accuracy, lens, preset id, size, the `framing` snapshot and `device` (incl. `gps_mode` and `gps_from_first_photo`; [data model](../data-model.md)). Without any fix the photo is kept without a position ("No GPS fix · saved without position"); a capture is never refused for GPS.

It then becomes a **draft** (`CaptureDraft = { shotId, photos: DraftPhoto[] }`), with its photos moved into `draft-photos/` (`sequence.ts`, `keepPhoto`):
- **Normal:** the **Tag** screen (`screens/Tag.tsx`) opens full screen, without the tab bar:
  - the photo (fit mode) with the capture facts in the header
  - the tag editor: name (not auto-focused), INT/EXT and light in place, then location, weather and the project's extra fields as rows that open sheets
  - **Discard | Upload** pinned at the thumb (a right-hand column in landscape; for sequences "Discard 7 | Upload 7 photos")
  - Remembered tags: location, INT/EXT, light, weather and extra fields come from the last upload (`lastTags.v1`; extra fields only in the same project) and carry a **LAST** tag until changed. The name never does, so a repeat shot is one tap on Upload.
  - Upload queues and returns to Shoot with "Queued · <name>". Discard and Android back ask first (a confirm sheet); nothing is dropped silently.
- **Direct upload** (Setup → Capture): no Tag screen; the shot is queued untagged ("Queued untagged · tag it later in History"). If queuing fails, Tag opens instead.
- **Sequence mode:** every capture while Seq is on is appended to one shot (`addToSequence`). A red "SEQ · n" badge with a dot sits on the preview. Turning Seq off turns the set into one draft: Tag (with a photo strip), or the queue with direct upload.

A capture never creates **steps**: a sequence uploaded from the phone shows its photos as steps until the Studio stores steps and layers ([composition](composition.md)).

Drafts and running sequences are stored in the kv-store (`captureDraft.v1`, `sequence.v1`), so an app kill loses nothing: Tag or the sequence comes back on the next launch (Tag once the sign-in and project gates are through). A capture that finishes after Seq was switched off becomes a single shot, never part of the ended sequence.

## Upload queue (`apps/mobile/src/uploads.ts`)

- `enqueue` copies the photos to `pending-photos/` and stores the entry (`pendingUploads.v2`). It then deletes the draft files.
- **Queued shots are visible right away**: in Shots (filter **Queued**, and in All with a "Queued" tag on the card) and in History, with their local photos. They can be tagged, approved, archived, positioned or discarded before they upload; the change rewrites the queue entry (`localShots.ts`), and the decision travels with the upload (`state` in the metadata). Once the first part was sent (`sent`), a later change sets `editedAfterSend` and the upload ends with a PATCH (the server keeps the tags of an existing shot). That PATCH can't make a shot stuck: when rejected it retries without the extra fields, then leaves the tags as uploaded (logged).
- After the upload the server's copy replaces the queued one in the lists at once (`onUploaded`), so nothing blinks out, and the shot is recorded for the **Uploaded · last 7 days** list (`uploadHistory.v1`).
- **Offline mode** (Setup → Offline): `flush()` does nothing and the API makes no request until it is switched off; switching it off flushes and reloads.
- `flush()`: syncs projects, field definitions and locations, then uploads oldest first, then sends edits kept on the phone (`flushEdits`, see [offline](day-mode-offline.md)). Big sequences go 12 photos per request (the server appends to the same shot, up to 200 photos a shot; beyond that the upload is rejected and parked as stuck, #224). The shutter never waits for it.
- **Network or auth errors** stop the round; it is retried at the next capture, sign-in, app start or manual retry.
- **Rejections (4xx)** increase `attempts`. After 3 the entry is `stuck`: skipped automatically, listed on the Uploads screen with the error, and retried or discarded by hand. Files are never deleted for a rejection.
- **A missing photo file** means the remaining photos are uploaded and the missing ones dropped.
- `usePendingCount()` (storage.ts), `onFlushed()` and `onFlushProgress()` (the shot and photo being sent) let screens react; `useSync()` (`sync.ts`) turns them into the header's sync state.
