# I1 · Interjection after workshop 06

Status: **decided** (2026-11-19). No issue of its own; part of epic [#326](https://github.com/OpenClapper-dev/core/issues/326).

After workshops 01–06 the owner brought a set of connected features that cut across them. This page records what was decided and which earlier pages changed. The pages themselves were updated, so each reads as the current state; [model.md](model.md) shows everything in one picture.

## What came up

1. Photos taken together should be loosely connected (collections).
2. A shot is not always static and needs a timed progression of pictures.
3. A progression needs a drawing and a frame across all its pictures.
4. A series of framings of one photo should be quick to make, without filling the project with files.
5. In a timeline, such a shot should show spread out or collapsed.
6. Timelines need chapter markers, and a project needs one master order of timelines.

## Conflicts with earlier decisions

| New point | Collided with | Resolution |
| --- | --- | --- |
| Collections | 01 and 03: no series, no collections | Reopened: collections exist, with strict rules (below) |
| Progression on a shot | 04: no steps; a progression is a timeline in the shot's content | Replaced: a shot can carry one progression of its own |
| The progression sets the timing | 06: every clip has its own hold time | A shot with a progression plays at the progression's timing; other clips keep their hold time |
| Spread or collapsed | 06: no blocks | Blocks return as a way of showing such a shot, not as timeline data |
| Overlay and frame across a progression | 05: one coordinate space; 04 and 06: nothing stored per entry | A bounded exception on the progression |
| A canvas per framing | 06: owned data and promotion were removed | One canvas with many frames, kept as an internal file |
| Master timeline | 06: a timeline cannot be a clip of a timeline | Stands: the hierarchy is typed |

## Decided

### Collections ([01](01-media.md), [03](03-capture.md))

- A **collection** is a set of photos of one project that belong together. It has no opinion and imposes nothing on other files.
- A photo is in at most one collection. It can be taken out again; ungrouping a collection deletes nothing.
- A collection is made on the camera (a collection mode: what is shot while it is on goes into one) or in the media library (group selected photos, add to an existing one).
- To have "the same picture" in two collections, the photo is duplicated: a new photo with its own identity. The stored image can be shared, so a duplicate costs no storage.
- Its order (by time taken, or set by hand) is only for the media library.
- Nothing references a collection. Dropping one into a progression or a timeline adds the photos chosen from it as separate items, in whatever order the progression or timeline gives them.
- Settled in [07](07-organisation.md): a collection is a file that contains only photos; a folder is a file that contains any files.

### Progression ([04](04-shots.md))

- A shot can carry one **progression**: a timed order of pictures. A picture is a photo, a canvas, or one frame of a canvas. No non-visual files, no shots, no timelines, no other progression.
- It is separate from the shot's content list and built from the timeline's components.
- Its timing is its own (per item, or one total length split across the items).
- It can have one **overlay** (a drawing over every item, no ranges) and one **default frame** (applied centred to items with an angle of view and no frame of their own; an item's own frame wins).
- A **generator** makes a framing series from one photo: one canvas with a frame per focal length, and one item per frame.
- The name is "progression"; "sequence" stays dropped, because in film it means a series of scenes.
- A progression has no relation to a flow for now.

### Internal files (general; first used by shots)

An **internal file** is an ordinary file that was created inside another file, its parent, for the parent's use.

| Rule | Detail |
| --- | --- |
| Ordinary | Same file type, same app, same edit lock, same render as any other file of its type |
| Hidden | Not in the project's file browser or search; shown inside its parent |
| Bound to the parent | Deleted with it, duplicated with it |
| Private | Only the parent references it |
| Release is one-way | "Make it a project file" clears the parent mark; the parent keeps referencing it and no data moves |

What becomes internal: what is created from inside a shot (the generator's canvas, the progression's overlay, a new canvas made there). Files dragged in from the file browser stay ordinary references. A lens used by a frame in an internal canvas counts as in use for its optics preset ([02](02-optics.md)).

### References to one frame ([05](05-composition.md))

A reference can point at one frame of a canvas, not only at the canvas. A progression item and a timeline clip can therefore show the same canvas through different frames.

### Timeline ([06](06-timeline.md))

- A shot with a progression is shown **spread** (one clip per picture) or **collapsed** (its first picture). This is a view setting; playback always runs the whole progression at its timing.
- **Chapter markers:** a title and optionally a colour at the start of a clip.
- **One master timeline per project:** a chosen, ordered list of timelines, played end to end.
- The hierarchy is typed: master timeline → timeline → shot → picture.

### Wording and small rules, to make the pages agree

- **"Facet" is retired; the word is "property".** A photo's device, angle of view and EXIF are properties of the kind "facts of the file type" ([04](04-shots.md)): shown in the same list, searchable, and read-only (typing an angle of view by hand stays deferred, [02](02-optics.md)). This is the writer's reconciliation of 01 and 04, not a separate decision of the owner.
- **No built-in note or description** on any file (owner). The fixed properties are name, type, created, updated, created by.
- **A shot's thumbnail** is the first picture of its progression, else the first photo or canvas in its content list.

## Pages changed

| Page | Change |
| --- | --- |
| [00](00-principles.md) | Principles, tiers and glossary brought in line with 01–06 and this page |
| [01](01-media.md) | Collections; properties instead of facets; no note; links and apps updated |
| [02](02-optics.md) | "Framing" wording replaced by frames in a canvas; tiers and hand-overs updated |
| [03](03-capture.md) | Collection mode; the frame at capture as a fact; stale sentences removed |
| [04](04-shots.md) | Progression, thumbnail rule, no description |
| [05](05-composition.md) | References to one frame, internal canvases, the progression's overlay |
| [06](06-timeline.md) | Hierarchy, shot clips with a progression, spread and collapsed, chapter markers, master timeline |
