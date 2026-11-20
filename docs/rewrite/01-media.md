# 01 · Media library

Workshop [#328](https://github.com/OpenClapper-dev/core/issues/328). Status: **decided** (2026-11-13; collections and wording updated in the [interjection](i1-interjection.md), 2026-11-19).

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
| `project_id` | The project it belongs to, for good: media is hard-scoped to one project, with no move or copy between projects for now |
| `origin` | How it entered: `capture` (the phone's camera) or `import` (a file from the phone or the Studio) |
| `type` | The media type of the original. Only still images in the rebuild (JPEG, PNG, HEIC, WebP); the field leaves room for other file types later |
| `taken_at` | When the picture was taken: capture time, or EXIF time of an import, else the import time |
| `width`, `height`, `size_bytes` | Of the stored original |
| `name` | Generated when the photo is added, editable ([04](04-shots.md)) |
| `created_by`, `created_at` | Who added it and when |

Everything else is a property, a collection or a link. There is no built-in note.

## Stored images

- The **original** is kept as it arrived: the camera's full-resolution JPEG from the phone, the unmodified file for an import. It is never re-encoded and never changes.
- Two **derivatives** per photo for display: a preview (about 2048 px) and a thumbnail (about 400 px). The client that adds the photo makes them and uploads them with the original; the server stores what it gets. The Worker has no image processing today, and this keeps it that way.
- On the phone, the thumbnail and preview upload first and the original follows (on Wi-Fi only, if the user wants). A photo is usable everywhere as soon as its preview is there. "Never lose a capture" extends to the original: it stays queued until stored.

## Facts about a photo

What is known about a photo is shown as **properties** ([04](04-shots.md)), of the kind "facts of the file type": in the same list as the project's own properties, searchable, and read-only. The word "facet" from the first version of this page is retired.

| Fact | Content | Filled by |
| --- | --- | --- |
| **Capture device** | A reference to the registered device ([03](03-capture.md)) and a readout: make, model, lens used | Capture. An import carries only the readout from its EXIF |
| **Angle of view** | Horizontal and vertical, with its source ([02](02-optics.md)) | Computed once from EXIF when the photo is added |
| **Frame on screen** | The optics values, preset name and focal length that were on the camera screen, copied ([03](03-capture.md), [05](05-composition.md)) | Capture, when an optics frame was on |
| **EXIF** | The raw tags of the original, kept as they are | Capture and import |

Opinions about a photo's role (a status, a category) are properties the project defines. Position is not recorded (see Decided).

## Collections

A **collection** is a set of photos of one project that belong together. It has no opinion and imposes nothing on other files.

- A photo is in at most one collection. It can be taken out again; ungrouping a collection deletes nothing.
- A collection is made on the camera (collection mode, [03](03-capture.md)) or in the media library: group selected photos, add to an existing one.
- To have the same picture in two collections, the photo is duplicated: a new photo with its own identity. The stored image can be shared, so a duplicate costs no storage.
- Its order is by time taken, or set by hand, and matters only in the media library.
- Nothing references a collection. Dropping one into a progression or a timeline adds the photos chosen from it as separate items.
- A collection is a file, like a folder: a folder contains any files and nests, a collection contains only photos and does not nest ([07](07-organisation.md)).

## Links

Other blocks point at photos; a photo points at nothing.

| Link | Meaning | Decided in |
| --- | --- | --- |
| Shot → photo | In a shot's content list or as an item of its progression; a photo can be used by any number of shots, or none | 04 |
| Canvas → photo | As the base photo or as a placed picture | 05 |
| Clip → photo | A timeline clip shows the photo | 06 |
| Folder → photo | A photo is a file | 07 |

Removing a photo removes these links; the linking objects stay and show a missing reference (principle 2).

## What is not media

- A drawing is not a photo. It is a **canvas** ([05](05-composition.md)), and a shot can reference a canvas directly, so no rendered image has to pretend to be a photo.
- **Renders** of canvases are derived images, not library items.

## Apps

- Studio: a **Media** app (grid and list; import by drop or file picker; collections shown as one tile or spread out; properties in a side panel, editable in bulk).
- Phone: a library screen for what was taken or imported, and import from the phone's gallery.

The screens are designed in the UX workshops.

## What goes

`photos.shot_id`, `ordinal`, `preset_id`, `lens_mm`, `framing`, `device`, `root_framing_id`, `position_corrected`, `lat`, `lon`, `accuracy` and GPS readouts; `source = drawn`; capture "sequences" (several photos as one shot); the 1280 px and 2048 px caps; the 200-photo limit; New shot's "upload images" as a way to make shots.

## Handed to other workshops

- **07 (organisation):** locations and spots, positions and the map start from nothing. The owner's observation for that workshop: in film work a location is usually a place from the screenplay found during a breakdown, and each different place is its own location, not a child of another. "Spot under location" came from one setup where several script locations share one address; in general several locations may share a physical address, which is a different relation from parent and child.
- **Grouping and linking:** answered since. Photos that belong together are a collection (above); what a shot uses and in which order is the shot's content list and progression ([04](04-shots.md)); folders are workshop 07.

## Decided

2026-11-13, by the owner:

- **A photo is a standalone primitive** as described above: project, origin, type, time, size, name; properties and links instead of ownership.
- **Original resolution:** the untouched original is stored, never re-encoded. The adding client also uploads a preview (about 2048 px) and a thumbnail (about 400 px), which go first; the phone may hold the original back for Wi-Fi, and it stays queued until stored.
- **Scope:** a photo belongs to exactly one project and stays there. No move or copy between projects for now, so that projects have no dependencies on each other (clarified by the owner on 2026-11-17; the first record wrongly allowed moving and copying).
- **Media types:** still images only in the rebuild; the `type` field leaves room for other file types later.
- **No position, no place on photos.** GPS, position data and the photo → location/spot link are removed entirely for now; they were opinionated and served one past workflow. EXIF is kept raw, so positions inside it are not lost, but nothing uses them. Locations, spots and positions are re-thought in workshop 07.
- ~~**No series in the base.** Every photo is a single item; grouping is the responsibility of another layer.~~ Reopened in the [interjection](i1-interjection.md) on 2026-11-19: every photo is still a single item, and photos that belong together can be put in a **collection**, at most one per photo, made on the camera or in the media library. A collection is never referenced; its photos are.
- **Facts** about a photo in the base: capture device, angle of view, the frame on screen at capture, EXIF. They are read-only properties.
- **No built-in note** (interjection, 2026-11-19).
