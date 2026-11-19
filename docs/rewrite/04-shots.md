# 04 · Shots and planning

Workshop [#331](https://github.com/OpenClapper-dev/core/issues/331). Status: **proposal, nothing decided yet**.

What a shot is once photos stand on their own: a planned picture that references media instead of owning it.

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

## Proposal

### The shot

A **shot** is a planned picture in a film. It belongs to one project and exists on its own: with a name only, with a description, with pictures, in any order of arrival.

| Field | Meaning |
| --- | --- |
| `id`, `project_id` | As everywhere |
| `name`, `description` | Optional; description is Markdown as today |
| Steps | An ordered list, possibly empty (below) |
| `created_by`, `created_at` | Who made it and when |

A shot owns nothing but its steps. Photos, framings and sketches are referenced.

### Steps are the shot's content

There is one list. A **step** is one stage of the shot and shows one thing:

| A step shows | Reference |
| --- | --- |
| A photo | The photo |
| A photo through a framing | The photo and one of its framings (workshop 02) |
| A sketch | The sketch (its file type is workshop 05) |

- A shot with no steps is a plan without a picture. One step is a single picture; several are a progression (a pan, a zoom, light changing).
- The same photo can be a step in any number of shots, and several times in one.
- Only photos, framings and sketches of the same project can be referenced.
- A removed photo, framing or sketch leaves the step in place, showing a missing reference (principle 2). A removed framing falls back to the whole photo.
- The cover of a shot is its first step.
- Steps have stable ids, so layers (workshop 05) and clips (workshop 06) can point at them.

Move, merge and extract disappear as special operations: they are adding and removing steps.

### Properties of a shot

Proposed split of today's tags (open question 2):

| Today's tag | Proposal |
| --- | --- |
| Name, description | Stay on the shot |
| Shot size, camera support, movement | Stay on the shot as an optional **camera** facet: they describe the planned picture |
| INT/EXT, light phases, Artificial, weather | Leave the base: they described shooting conditions for the deleted day schedule |
| Location, spot | Workshop 07 |
| Extra fields | Parked (workshop 00) |

### Review

No review state in the base (open question 3). A photo is in the library when it is taken; a shot is what the user made. Approval between people is business logic for later. Getting things out of the way is the bin's job (workshop 07). With it go the phone's History tab as a review queue and "phone images only once approved".

### Capturing for a shot

On the phone, the camera can optionally be aimed at a shot: while a target shot is chosen, every photo taken is also appended to it as a step (open question 4). The photo is a normal photo either way; the step is a link made for the user, which they could also make by hand (principle 4). This is what Seq mode was used for, without a grouping concept in the base.

### Shot lists

No shot-list object. A list of shots is a folder or a filter (workshop 07); a cut is a timeline (workshop 06).

### Tier and apps

Shots are core. Studio: a Shots app (list and grid, new shot from nothing, from photos picked in Media, or from a sketch) and the shot window (steps, properties). Phone: workshop 09.

### What goes

`photos.shot_id` and everything that follows from ownership (cover and `captured_at` from the first photo, move, merge, extract, the 200-photo limit), "photos as steps" fallback, the review state with its screens and `bake_approved_only`, New shot's upload path (that is importing media now), the rendered PNG of a drawn shot.

## Handed to other workshops

- **05 (composition):** layers over steps, sketches as a file type, what the phone shows for a step with layers.
- **06 (timeline):** clips referencing steps.
- **07 (organisation):** locations on shots, folders and filters as shot lists, the bin, the Metadata board.
- **09 (shells):** the phone's shot screens.

## Open questions

1. **Content:** are steps the shot's only content (photos referenced through steps), or does a shot keep a separate set of photos next to its steps?
2. **Properties:** which of today's tags stay on a shot?
3. **Review:** no review state in the base, or keep one?
4. **Capturing for a shot:** an optional target shot on the phone's camera now, or later?

## Decided

Nothing yet.
