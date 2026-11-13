# 01 · Media library

Workshop [#328](https://github.com/OpenClapper-dev/core/issues/328). Status: **decided** (2026-11-13).

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
2. **Grouping is a side effect.** "Several photos belong together" is only expressible as "they are one shot".
3. **The image is degraded at the source.** 1280 px is enough for a viewfinder reference, not for a media library; the original is thrown away on the phone, and uploads lose their EXIF, so nothing can be read from them later.
4. **One size for every use.** Grids and the phone load the same file as the full view.
5. **Knowledge about a photo is fixed at capture.** Rig snapshot and device data are written once by the phone; an uploaded photo can never get them.
6. **Position is built in.** GPS on every photo comes from one past workflow (scouting by map); almost no photo needs it, yet it shapes capture, the data model and the UI.
7. **A drawing pretends to be a photo** so that a shot has something to show.

## The primitive

A **photo** is a still image with the minimum needed to store and show it. It belongs to exactly one project and to nothing else.

| Field | Meaning |
| --- | --- |
| `id` | Client-generated UUID, as today |
| `project_id` | The project it belongs to. A photo can be moved or copied to another project |
| `origin` | How it entered: `capture` (the phone's camera) or `import` (a file from the phone or the Studio) |
| `type` | The media type of the original. Only still images in the rebuild (JPEG, PNG, HEIC, WebP); the field leaves room for other file types later |
| `taken_at` | When the picture was taken: capture time, or EXIF time of an import, else the import time |
| `width`, `height`, `size_bytes` | Of the stored original |
| `name`, `note` | Optional, free text |
| `created_by`, `created_at` | Who added it and when |

Everything else is a facet or a link.

## Stored images

- The **original** is kept as it arrived: the camera's full-resolution JPEG from the phone, the unmodified file for an import. It is never re-encoded and never changes.
- Two **derivatives** per photo for display: a preview (about 2048 px) and a thumbnail (about 400 px). The client that adds the photo makes them and uploads them with the original; the server stores what it gets. The Worker has no image processing today, and this keeps it that way.
- On the phone, the thumbnail and preview upload first and the original follows (on Wi-Fi only, if the user wants). A photo is usable everywhere as soon as its preview is there. "Never lose a capture" extends to the original: it stays queued until stored.

## Facets

Optional groups of data about the photo itself. Each can be absent, filled at capture, read from EXIF on import, or added and edited by hand later, alone or in bulk.

| Facet | Content | Filled by |
| --- | --- | --- |
| **Capture device** | A reference to a registered device, plus the readout at that moment (model, lens used, zoom, native focal length) | Capture; matched from EXIF make and model on import; chosen by hand |
| **Optics** | What field of view the picture has (defined in [workshop 02](02-optics.md)) | Derived from the capture device where known; stated by hand |
| **EXIF** | The raw tags of the original, kept as they are for later use | Capture and import |

Opinions about a photo's role (review state, shot size, light requirements) are not facets; where they live is [workshop 04](04-shots.md). Position is not a facet (see Decided).

## Links

Other blocks point at photos; a photo points at nothing.

| Link | Meaning | Decided in |
| --- | --- | --- |
| Shot → photo(s) | A shot references photos; a photo can be referenced by any number of shots, or none | 04 |
| Framing → photo | A saved frame on a photo | 02 |
| Layer / clip → photo | Composition and timeline reference photos | 05, 06 |
| Folder → photo | A photo is a file | 07 |

Removing a photo removes these links; the linking objects stay and show a missing reference (principle 2).

## What is not media

- A **sketch** is not a photo. It is its own file type (workshop 05), and a shot can reference a sketch directly, so no rendered image has to pretend to be a photo.
- **Bakes and renders** are derived images of other blocks, not library items.

## Apps

- Studio: a **Media** app (grid and list; import by drop or file picker; facets in a side panel; bulk editing of facets).
- Phone: a library screen for what was taken or imported, and import from the phone's gallery.

Mockups follow with workshop 03 (capture) and 07 (the filesystem), where the tile, the side panel and the phone library meet their neighbours.

## What goes

`photos.shot_id`, `ordinal`, `preset_id`, `lens_mm`, `framing`, `device`, `root_framing_id`, `position_corrected`, `lat`, `lon`, `accuracy` and GPS readouts; `source = drawn`; capture "sequences" (several photos as one shot); the 1280 px and 2048 px caps; the 200-photo limit; New shot's "upload images" as a way to make shots.

## Handed to other workshops

- **07 (organisation):** locations and spots, positions and the map start from nothing. The owner's observation for that workshop: in film work a location is usually a place from the screenplay found during a breakdown, and each different place is its own location, not a child of another. "Spot under location" came from one setup where several script locations share one address; in general several locations may share a physical address, which is a different relation from parent and child.
- **Grouping and linking** of photos (progressions, sets, "these belong together") is the responsibility of a layer above the base, not of the photo. Workshops 04 (shots) and 07 (folders) say where it lives.

## Decided

2026-11-13, by the owner:

- **A photo is a standalone primitive** as described above: project, origin, type, time, size, optional name and note; facets and links instead of ownership.
- **Original resolution:** the untouched original is stored, never re-encoded. The adding client also uploads a preview (about 2048 px) and a thumbnail (about 400 px), which go first; the phone may hold the original back for Wi-Fi, and it stays queued until stored.
- **Scope:** a photo belongs to exactly one project; it can be moved or copied to another.
- **Media types:** still images only in the rebuild; the `type` field leaves room for other file types later.
- **No position, no place on photos.** GPS, position facets and the photo → location/spot link are removed entirely for now; they were opinionated and served one past workflow. EXIF is kept raw, so positions inside it are not lost, but nothing uses them. Locations, spots and positions are re-thought in workshop 07.
- **No series in the base.** Every photo is a single item; a multi-photo capture produces several photos. Grouping, progression and linking are a generic responsibility of another layer. This reopens workshop 00, where "Series" was named; it is removed from the glossary there.
- **Facets** in the base: capture device, optics, EXIF.
