# Shots, sets and locations

> **Built in step B6 ([#378](https://github.com/OpenClapper-dev/core/issues/378)).** Specification: [04 shots](../rewrite/04-shots.md), [09a places](../rewrite/09a-places.md), [I1 interjection](../rewrite/i1-interjection.md), [U3 shot](../rewrite/ux-3-shot.md). Replaces the first app's shots that owned photos, steps, layers and bakes, the review state, locations with spots and pins, and GPS on photos (review-and-tagging, composition, positions pages).

## The files (`packages/model/src/shot.ts`, `types.ts`)

| Type | What it is | References | Body |
| --- | --- | --- | --- |
| `shot` | An intent: one planned picture of the film | `content` (any files, in order), `item` (the progression's pictures, in order), `overlay` (at most one) | `{ progression: null \| { timing, frame, overlayShown } }` (version 2; a shot saved as `{}` reads as no progression) |
| `set` | The place in the story where a scene plays (Motiv) | `content` | `{}` |
| `location` | The real place where it is filmed (Drehort) | `content` | `{}` |

- **Content** is an ordered list of references to files of any type of the project. Nothing is stored per entry; one file can be in any number of lists; a removed file leaves its entry, shown as missing.
- **The progression** (shots only, at most one) is a timed order of pictures. An `item` reference points at a photo or a canvas (the Worker refuses another type with `400`; a missing one is kept) and carries `{ ms, frame?, move? }`: its own time (100 ms to 10 min), for a canvas the frame it shows, and for a smooth move the frame it moves to and whether it eases (`move: { to, ease }`). The `overlay` reference is a canvas drawn over every item.
- **Timing**: `each` (every item its own `ms`), `even` (one `total` split evenly) or `ends` (one `total`, the first and the last held twice as long); `itemTimes` computes it.
- **Default frame**: frame values (`FrameValues`: from a preset with a focal length, free-form, or an aspect ratio; the rules of a frame on a canvas). Applied, centred, to items with an angle of view and no frame of their own. A default frame from a preset keeps that lens in use: the Worker writes it into `frames` as frame `default` of the shot.
- **The cover** (thumbnail): the first item of the progression, else the first photo or canvas in the content, else a placeholder (`shotCover`).
- **Internal files**: a canvas made inside a shot (the generator's canvas, the overlay, a new canvas made there) is created with `internal_of` set to the shot: hidden from the browser and search, binned, restored and copied with the shot, and released one way with `POST /api/files/:id/release` ([files](files.md)).
- **Places in the template** of a new project: "Set" on shots (one set), "Locations" on sets (any number), "Address" (long text) and "Position" on locations. Ordinary definitions: change, hide or delete them. Projects made before B6 keep their template.
