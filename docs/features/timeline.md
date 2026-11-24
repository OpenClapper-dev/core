# Timeline

> **Built in step B7 ([#379](https://github.com/OpenClapper-dev/core/issues/379)).** Specification: [06 timeline](../rewrite/06-timeline.md), [U4 timeline](../rewrite/ux-4-timeline.md), [I1 interjection](../rewrite/i1-interjection.md). Replaces the first app's timelines (clips of a shot's photo or step with their own frame, layers and sketch, promotion, sequence blocks, review in the cut); that page is in the history up to v0.16.0.

A **timeline** is a rough cut, for deciding: one track of clips in order, each held for a time, played back. No audio, transitions or export. Studio only.

## The file (`packages/model/src/timeline.ts`, file type `timeline`)

`{ clips: [{ id, file, frame?, ms, title?, chapter? }], holdMs }`, edited by one person at a time (the edit lock, as a canvas).

| A clip | What plays | Length |
| --- | --- | --- |
| A photo | The photo | Its `ms` (100 ms to 1 h) |
| A canvas | Its picture (the frame marked as the picture, else the whole surface) | Its `ms` |
| One frame of a canvas (`frame`) | The canvas through that frame | Its `ms` |
| A shot without a progression | The shot's cover | Its `ms` |
| A shot with a progression | The progression, at its own timing | The progression's length |
| `file: null` | A **placeholder** with a `title` | Its `ms` |

- A clip carries nothing else: no frame, layers, view mode or notes of its own; what it shows is changed in the file (everywhere it is used).
- Each clip with a file keeps a `clip` reference (`{ clip: id }`), in order (`timelineRefs`), so "Used in", missing files and copies work as for every reference; the Worker refuses a clip of another type than photo, canvas or shot (`400`). A removed file leaves its clip, shown as missing. At most 500 clips.
- A **chapter** (`{ title, color }`) starts at its clip and runs to the next; it does not change playback.
- `holdMs`: how long a new clip holds in this timeline; null takes the account's setting (2 s to start with).
- The same file can be in a timeline any number of times; a timeline is never a clip; a collection is never a clip (its photos are added one by one).

## The master timeline (`projects.master`)

Every project has one: an ordered list of the project's timelines (`PUT /api/projects/:id` with `master`, ids; each once), played end to end. Timelines not in it stay outside it; a timeline that is gone is skipped where the master is shown.
