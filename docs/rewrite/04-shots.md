# 04 · Shots and planning

Workshop [#331](https://github.com/OpenClapper-dev/core/issues/331). Status: **decided** (2026-11-19).

What a shot is once photos stand on their own: an intent with a list of referenced files.

## As-is

| Fact | Where |
| --- | --- |
| A shot owns 1..n photos and cannot exist without one; a drawn shot stores a rendered PNG as its photo | `docs/data-model.md` (`shots`, `photos`), `docs/features/new-shot.md` |
| A shot is created by a capture on the phone (one per capture, or one per sequence) or by New shot in the Studio (upload or draw) | `docs/features/capture.md`, `new-shot.md` |
| Tags on a shot, all optional: name, location, spot, INT/EXT, light phases (dawn, day, dusk, night) plus an Artificial flag, weather, shot size, camera support, movement, the project's extra fields, a Markdown description | `docs/features/review-and-tagging.md`, `packages/vocab/src/vocab.ts` |
| The light phases fed the shooting-day schedule, which is deleted in the rewrite | `docs/features/schedule.md`, [README](README.md) |
| Review state on every shot: `unreviewed` on upload, then `approved` or `archived`. The phone's History tab and the Studio's Timeline are built around deciding it; a project can hold back phone images of compositions until a shot is approved | `review-and-tagging.md` (Reviewing, History), `projects.bake_approved_only` |
| The Metadata board sets one tag on many shots by drag and drop | `review-and-tagging.md` (Metadata board) |
| **Steps** (`shot_steps`): a step shows one of the shot's own photos, optionally through one of that photo's framings. A shot without stored steps shows its photos as steps; only the Studio stores steps. Layers range over steps; timeline clips can reference a step | `docs/features/composition.md`, `packages/vocab/src/steps.ts` |
| So a shot has two lists that mostly say the same: its photos (ownership, capture order) and its steps (what is shown) | same |
| Photos can be moved between shots, shots merged and a photo extracted into a shot of its own | `composition.md` |
| The first photo is the cover; `captured_at` is the earliest photo's time | `apps/worker/src/shots.ts` |
| There is no shot list as an object: order comes from sorting the gallery, saved filters, or a timeline | `docs/features/files.md`, `timeline.md` |

## Problems and leaks

1. **A shot is a container for photos,** so planning a shot before any picture exists is impossible, and one photo cannot serve two shots.
2. **Two lists per shot.** Photos and steps overlap, with a fallback rule between them that every screen has to know.
3. **Review is built in.** Every shot carries an approval state from the moment of upload, and two screens exist to work through it. Workshop 00 names an approval process as business logic, not base.
4. **A fixed film vocabulary sits on the base object,** and part of it (light phases, weather) only existed to feed the deleted day schedule.
5. **Restructuring is needed because of ownership:** move, merge and extract exist only because photos belong to shots.

## The model

### The shot

A **shot** is what a filmmaker wants to achieve: one planned picture in a film. It is a file of its project and exists on its own, with a name only or with any amount of content.

| Part | Meaning |
| --- | --- |
| System properties | Name, created, updated, created by (see Properties) |
| Properties | Whatever the project attaches to shots: scene, shot size, a status |
| Content | An ordered list of references to files |

### Content

The content of a shot is a generic, ordered list. An entry is "a file of type X with id Y" and its place in the list, nothing else.

- **Any file type can be content.** Now: a photo, a framing (a photo through a saved frame, workshop 02), a canvas (below). Later: a flow, a document, a PDF. No kind ranks above another: a photograph and a drawing are two ways to the same end.
- **The shot does not know the kinds.** Each file type says for itself whether it is visual, how its thumbnail looks and which app opens it. A new file type, also one from an extension, becomes shot content without the shot changing (principle 6).
- **Nothing is stored per entry.** Whatever is done to a picture (drawing on it, adjusting it) is a file of its own that the shot references.
- **One file can be in any number of shots.** Only files of the same project can be referenced.
- **The thumbnail** of a shot is the first visual entry in its list; reordering changes it. A shot without visual content shows a placeholder.
- A removed file leaves its entry in place, showing a missing reference (principle 2).

There are no steps. A progression is several entries, or a timeline (workshop 06) where it needs timing.

### The canvas (direction for workshop 05)

Drawing, placing photos, framing and floor plans are one tool on one file type, a **canvas** (working name):

- It holds drawings, placed pictures (references to photos, movable and resizable), text and adjustments. It can start blank.
- An optional **base photo** ties the canvas to that photo; because the photo has an angle of view, optics frames work on it. An optional framing makes the frame the visible picture, with what is drawn sitting inside it.
- Today's framing exploration (several frames, A/B, stacked, moving a frame) is this tool working on a base photo. What that means for the separate Framing app of workshop 02 is decided in 05.
- A sketch, a composition and a floor plan are the same kind of file.
- It must work in the browser and on a tablet from one document model. Three ways are on the table, to be chosen in workshop 05 after a technical test: one model with two native renderers; the browser editor embedded in the tablet app (as the map is today); or the tablet using the Studio in its browser.

### Properties

Properties are the metadata of a file, apart from its content. The mechanism is generic for every file type, not a feature of shots.

- **One catalogue per project.** A property is defined once (name, field type, options) and attached to any number of file types. Search and filters on a property cover every type it is attached to.
- **Three kinds, shown in one list:**

| Kind | Examples | Editable | Can be hidden |
| --- | --- | --- | --- |
| System | Name, type, created, updated, created by | Name only | No |
| Facts of the file type | A photo's size, time taken, angle of view, device | No | Yes |
| Project-defined | Scene, shot size, status | Yes | Yes |

- **Defaults are a template.** A new project starts with a default set per file type (for shots: a typical shot list, such as scene, shot number, shot size, angle, movement, support, lens, INT/EXT, day or night; the list is fixed in workshop 07). Every project-defined property can be hidden and shown again without losing its values, edited or deleted. There are no hard-coded fields beyond the system ones.
- **Field types:** text, long text, number, yes/no, single and multiple choice with colours, date. References to people or files may follow.
- **AI import** of property definitions (a prompt that returns them as JSON) carries over from today's extra fields.

This replaces the fixed tags, and it un-parks the extra fields that workshop 00 set aside.

### Names

Every file gets a real name when it is created, from a naming pattern per file type.

- Default patterns such as "Photo 0142" or "Shot 12", with a counter per project and file type.
- A project can change a pattern with tokens: type, counter, date, time, and facts of the file type (for a photo: device, focal length). Tokens only, no programmable functions.
- Names can be edited and need not be unique; a file is identified by its id.

### Review

There is no review state in the base. A team that wants one models it as a property (a choice field with colours). With it go the phone's History tab as a review queue and "phone images only once approved".

### Capturing for a shot

Not now. The camera makes photos; shots are assembled in the Studio. Aiming the camera at a shot can be added on top later.

### Shot lists

No shot-list object. A list of shots is a folder or a filter (workshop 07); a cut is a timeline (workshop 06).

### Tier

Shots and properties are core.

## What goes

`photos.shot_id` and everything that follows from ownership (cover and `captured_at` from the first photo, move, merge, extract, the 200-photo limit), steps (`shot_steps`) and "photos as steps", the fixed tag vocabulary on shots (INT/EXT, light phases, Artificial, weather, shot size, support, movement), the review state with its screens and `bake_approved_only`, New shot's upload path (that is importing media now), the rendered PNG of a drawn shot.

## Handed to other workshops

- **05 (composition):** the canvas file and its tool, its name, layers and adjustments, the Framing app, browser and tablet from one model, what the phone shows.
- **06 (timeline):** what a clip references now that there are no steps.
- **07 (organisation):** the property catalogue in detail (definition, default templates, search, filters, bulk editing as on today's Metadata board), naming patterns, locations as properties or files, shot versus folder (a folder is where a file lives; a shot points at files and adds intent and order), the bin.
- **09 (shells):** the phone's shot screens.

## Decided

2026-11-19, by the owner:

- **A shot is an intent with content:** a file with properties and an ordered, generic list of references to files of any type. The shot stores nothing per entry; the first visual entry is its thumbnail; one file can be in many shots.
- **No steps.**
- **Drawing on or adjusting a picture is a file of its own,** referenced by the shot. Sketch, composition and floor plan are one file type, a canvas with an optional base photo and framing, made in one tool that works in the browser and on a tablet (details in workshop 05).
- **Properties are generic for all files:** one catalogue per project, each property defined once and attached to file types; system properties (name, created, updated) are fixed; defaults are a template that can be hidden, changed or deleted; AI import stays.
- **Names** are generated at creation from a per-type pattern with tokens, editable and not unique.
- **No review state** in the base; it can be modelled as a property.
- **Capturing for a shot** on the phone is deferred; the Studio is where shots are assembled.
- **No shot-list object.**

Changed by [05](05-composition.md) on 2026-11-19: a framing is not a file type any more. A shot references a photo or a canvas; "a photo through a frame" is a canvas with that photo as its base and one frame.
