# 01 · Media library

Workshop [#328](https://github.com/OpenClapper-dev/core/issues/328). Status: **proposal, nothing decided yet**.

The first base primitive: a photo that exists on its own. Everything else in the rewrite (optics, capture, shots, composition, timeline) links to it instead of owning it.

## As-is

| Fact | Where |
| --- | --- |
| A photo is a row of `photos` and always belongs to exactly one shot (`shot_id → shots CASCADE`, `ordinal` unique per shot). There is no photo without a shot | `docs/data-model.md`, migration `0001`/`0005` |
| The first photo is the shot's cover; `shots.captured_at` is the earliest photo timestamp | `apps/worker/src/shots.ts` |
| `source` is `camera`, `upload` or `drawn`. `upload` and `drawn` photos have no rig snapshot, no position, `lens_mm` 0 | migration `0009`, `docs/features/new-shot.md` |
| One image per photo in R2 at `photos/<photoId>.<ext>`, served as it is by `GET /api/photos/:id/image`. There are no thumbnails or other sizes | `apps/worker/src/shots.ts:79`, `:327` |
| The phone captures at UHD 4:3, then keeps only a copy scaled to 1280 px on the long edge at JPEG 0.72; the full-size file is deleted | `apps/mobile/src/screens/Viewfinder.tsx:40`, `:250` |
| Studio uploads are scaled to 2048 px and re-encoded as JPEG in the browser (EXIF is lost); up to 60 images, as one shot or one shot each | `apps/studio/src/NewShot.tsx`, `docs/features/new-shot.md` |
| A drawn shot stores a rendered 1600 px PNG as its "photo", next to the vector sketch; editing the sketch does not change the photo | `docs/features/new-shot.md` |
| The phone cannot upload existing images | same |
| Per photo: timestamp, lat/lon, GPS accuracy, `position_corrected`, `preset_id`, `lens_mm`, width, height, `framing` JSON (rig snapshot), `device` JSON (phone model, EXIF focal lengths, zoom, GPS altitude/heading/fix age), `root_framing_id`, `size_bytes` | `photos` table |
| Per shot, not per photo: location, spot, name, review state, all tags, description | `shots` table |
| A capture with several photos is one shot; over 200 photos the upload is refused | `docs/known-issues.md` |
| Photos are immutable; a photo can be moved to another shot (and loses its steps) | `docs/features/composition.md` |
| Storage is accounted per workspace from `photos.size_bytes` | `docs/features/monitoring.md` |

## Problems and leaks

1. **A photo cannot be just a photo.** Taking or uploading one creates a shot, with review state and tags the user may not want.
2. **Grouping is a side effect.** "Several photos belong together" is only expressible as "they are one shot", which is why a series and a shot are the same thing today.
3. **The image is degraded at the source.** 1280 px is enough for a viewfinder reference, not for a media library; the original is thrown away on the phone, and uploads lose their EXIF, so nothing can be read from them later.
4. **One size for every use.** Grids, maps and the phone load the same file as the full view.
5. **Knowledge about a photo is fixed at capture.** Rig snapshot and device data are written once by the phone; an uploaded photo can never get them.
6. **Place lives on the wrong object for some uses.** Position is on the photo, location and spot on the shot, so a photo without a shot cannot be assigned to a place.
7. **A drawing pretends to be a photo** so that a shot has something to show.

## Proposal

### The primitive

A **photo** is a still image with the minimum needed to store and show it. It belongs to a project and to nothing else.

| Field | Meaning |
| --- | --- |
| `id` | Client-generated UUID, as today |
| `project_id` | The project it belongs to |
| `origin` | How it entered: `capture` (the phone's camera) or `import` (a file from the phone or the Studio) |
| `taken_at` | When the picture was taken: capture time, or EXIF time of an import, else the import time |
| `width`, `height`, `type`, `size_bytes` | Of the stored original |
| `name`, `note` | Optional, free text |
| `series_id`, `series_ordinal` | Optional: the series it is part of |
| `created_by`, `created_at` | Who added it and when |

Everything else is a facet or a link.

### Stored images

- The **original** is kept as it arrived: the camera's full-resolution JPEG from the phone, the unmodified file for an import (JPEG, PNG, HEIC, WebP). It is never re-encoded and never changes.
- Two **derivatives** per photo for display: a preview (about 2048 px) and a thumbnail (about 400 px). The client that adds the photo makes them and uploads them with the original; the server stores what it gets. The Worker has no image processing today, and this keeps it that way.
- On the phone, the thumbnail and preview upload first and the original follows (on Wi-Fi only, if the user wants). A photo is usable everywhere as soon as its preview is there. "Never lose a capture" extends to the original: it stays queued until stored.

### Facets

Optional groups of data on a photo. Each can be absent, filled at capture, read from EXIF on import, or added and edited by hand later, alone or in bulk.

| Facet | Content | Filled by |
| --- | --- | --- |
| **Position** | lat, lon, accuracy, altitude, heading, and how it was obtained (`gps`, `exif`, `manual`) | Capture with the position module on; EXIF of an import; a pin set by hand |
| **Capture device** | A reference to a registered device, plus the readout at that moment (model, lens used, zoom, native focal length) | Capture; matched from EXIF make and model on import; chosen by hand |
| **Optics** | What field of view the picture has (defined in [workshop 02](02-optics.md)) | Derived from the capture device where known; stated by hand |
| **EXIF** | The raw tags of the original, kept for later use | Capture and import |

A facet is data about the photo itself. Opinions about a photo's role (review state, shot size, light requirements) are not facets of a photo; where they live is [workshop 04](04-shots.md).

### Links

| Link | Meaning | Decided in |
| --- | --- | --- |
| Photo → location / spot | "Taken at" a place, set directly on the photo | 07 |
| Shot → photo(s) | A shot references photos; a photo can be referenced by any number of shots, or none | 04 |
| Framing → photo | A saved frame on a photo | 02 |
| Layer / clip → photo | Composition and timeline reference photos | 05, 06 |
| Folder → photo | A photo is a file | 07 |

Removing a photo removes these links; the linking objects stay and show a missing reference (principle 2).

### Series

A **series** is an ordered group of photos made in one capture (or grouped by hand later). It has an id, an optional name and the order. A photo is in at most one series. A series is shown as one item in the library and can be opened, reordered, split and linked to a shot as a whole. There is no size limit tied to a shot any more.

### What is not media

- A **sketch** is not a photo. It is its own file type (workshop 05), and a shot can reference a sketch directly, so no rendered image has to pretend to be a photo.
- **Bakes and renders** are derived images of other blocks, not library items.

### Apps

- Studio: a **Media** app (grid, list, map; series collapsed to one tile; import by drop or file picker; facets in a side panel; bulk editing of facets and links).
- Phone: a library screen for what was taken or imported, and import from the phone's gallery.

Mockups follow once the questions below are answered, since they change what a tile and the side panel show.

### What goes

`photos.shot_id`, `ordinal`, `preset_id`, `lens_mm`, `framing`, `device`, `root_framing_id`, `position_corrected`; `source = drawn`; the 1280 px and 2048 px caps; the 200-photo limit; New shot's "upload images" as a way to make shots.

## Open questions

1. **Original resolution**: keep the untouched original as proposed, or cap it (for storage and mobile data)?
2. **Scope**: does a photo belong to one project, or to the workspace with projects linking to it?
3. **Media types**: stills only in the rebuild, or any file (video, PDF, audio) from the start?
4. **Place**: location and spot linked directly on the photo as proposed, or only through shots?
5. **Series by hand**: may the user group existing photos into a series, or does a series only come from one capture?

## Decided

Nothing yet.
