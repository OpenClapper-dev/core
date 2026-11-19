# 06 · Timeline

Workshop [#333](https://github.com/OpenClapper-dev/core/issues/333). Status: **decided** (2026-11-19).

A rough cut out of pictures: clips in order, each held for a time, played back to see what carries a sequence. With shots, canvases and photos now separate files, a clip becomes a plain reference.

## As-is

| Fact | Where |
| --- | --- |
| A timeline belongs to a project and holds clips in order; each clip has a hold time (100 ms to 1 h) and notes. Playback steps through them. There is no export, no audio, no transitions: it is for deciding, not for delivery | `docs/features/timeline.md` |
| A clip holds one photo of a shot, optionally one of that shot's stored steps, a **presentation** (view mode plus a frame), and can have **layers and a sketch of its own** | `timeline.md` (Model), `docs/data-model.md` (`timeline_clips`) |
| Edits made in the timeline (a re-frame, layers, a sketch) belong to the clip until they are **promoted** to the shot from the shot view | `timeline.md` (Timeline-scoped edits), `apps/worker/src/promote.ts` |
| A timeline can lock one view mode for all clips | `timelines.lock_mode` |
| A **sequence block** keeps a multi-photo shot's clips together, moves as one and can split one total length across its clips, evenly or weighted to the edges | `timeline.md` (Sequence blocks), `timelines.groups` |
| A **placeholder** clip has no photo: a title, a hold time and notes for a shot that does not exist yet; with a sketch it is a sketch clip | `timeline.md` |
| A range of clips can be turned into one shot's steps, merging shots and deleting emptied ones; a clip can be extracted as a shot of its own | `timeline.md` (Range), `docs/features/composition.md` |
| The timeline is also where shots are reviewed: a shot browser beside the cut with approve and archive | `timeline.md` (Shot browser), `docs/features/review-and-tagging.md` |
| One window for all cuts, because a second window would overwrite the first one's autosave; saving replaces the whole timeline | `timeline.md` (Using it), `docs/known-issues.md` |
| Studio only; the phone does not read timelines. About 1,650 lines | `apps/studio/src/Timeline*.tsx` |

## Problems and leaks

1. **A clip is a small copy of several features.** It carries its own frame, layers and sketch, with a promotion path back to the shot. That is the composition feature again, inside the timeline.
2. **It depends on shot ownership.** A clip is a photo of a shot, a block is "the clips of one shot", and merge and extract rewrite shots from inside a cut.
3. **Review lives here** only because the old review page was merged in.
4. **View mode is stored three times:** per clip, as a timeline lock, and as the browser's global setting.
5. **Saving can overwrite:** the whole timeline is replaced on save, which forced the single-window rule.

## Proposal

### The timeline

A **timeline** is a file of a project: a name, properties (workshop 04) and an ordered list of clips. It stays a tool for deciding: hold times and playback, no audio, transitions or export.

### The clip

A clip is a reference and a time, nothing more:

| Part | Meaning |
| --- | --- |
| Reference | A file with a picture, or nothing |
| Hold time | 100 ms to 1 h |
| Title | Only on a clip without a file |

What a clip can reference:

| Reference | What plays |
| --- | --- |
| A photo | The photo |
| A canvas | Its picture: the frame marked as the picture, else the whole surface ([05](05-composition.md)) |
| A shot | The shot's thumbnail, its first visual entry ([04](04-shots.md)); the clip follows when the shot's content changes |
| Nothing | A **placeholder**: a place in the cut where something is missing, with a title and a hold time, filled later by dropping a file onto it |

- The same file can be in a timeline any number of times.
- A removed file leaves the clip in place, showing a missing reference (principle 2).
- A timeline cannot be a clip of a timeline.
- Clips have no notes.

### No clip-owned edits

A clip has no frame, no layers, no sketch and no view mode of its own. Responsibility lies with the file and the app that manages it. To change what a clip shows, the file is changed (everywhere it is used), or duplicated first and the clip pointed at the copy. "Make a canvas from this photo" turns a photo clip into a canvas clip in one step. Promotion disappears, because nothing belongs to a clip.

View modes are a choice of the window ([05](05-composition.md)); the timeline's "lock" becomes simply the window's mode.

### Editing a file without leaving the timeline

Not owning the picture must not mean leaving the cut for every change. The timeline **hosts** the file's app in place. This is a general mechanism of the Studio, not a timeline feature; the shot window can use it the same way.

A file type's app offers up to three parts that a host can mount:

| Part | What it is | Mounted where |
| --- | --- | --- |
| Viewer | Shows the file | The host's stage, thumbnails, lists |
| Editor | Works directly on the picture: drawing, dragging a frame | The host's stage |
| Inspector | Settings that do not need the picture as the working surface: a frame's values, a look, properties | The host's side panel |

Which parts are used depends on the task and the app. Changing a frame's focal length or a look needs only the inspector while the stage keeps previewing; drawing needs the editor on the stage. Whether a given app is better served by an inspector, by its editor on the stage, or both, is a choice per app, made in the UX workshops.

Rules that hold whichever way is chosen:

- **The edit is to the file,** not to the clip. The host says where else the file is used and offers to duplicate it first.
- **The file's app saves,** as it does on its own (automatically, with its render). The timeline saves only its own list.
- **The edit lock applies:** a file someone else is editing is read-only in the timeline too.
- **Playback and editing do not mix.** Starting an edit pauses and pins the playhead to the clip; moving the playhead away ends the edit, which saves first. Until the new render is stored, the strip shows the live picture.
- **The editor owns the keys** while it is active.
- A photo cannot be edited: editing a photo clip makes a canvas from it.

### Two file panels

As in any editor, the timeline has two panels beside the cut:

- **The project's files:** the same file browser as everywhere in the Studio (workshop 07), to drag files into the cut.
- **In this timeline:** the files the cut uses, with how often.

### Blocks

None for now. Several clips are moved by selecting them, and each clip has its own hold time. Blocks existed to keep one shot's steps together; steps are gone. A generic block can return later.

### What the timeline no longer does

- **Reviewing.** There is no review state ([04](04-shots.md)).
- **Restructuring shots.** "Make a sequence" and "Extract as own shot" go; a shot's content is edited on the shot.

### Editing

One editor at a time, as for a canvas ([05](05-composition.md)): a timeline open for editing is read-only for others. That removes the overwrite problem and the single-window rule.

### Tier and clients

A standard app, as in workshop 00. Made in the Studio; whether the phone or tablet can play one back is workshop 09.

### What goes

`timeline_clips.photo_id`, `step_id` and `presentation`, clip-owned layers and sketches with promotion, `lock_mode`, sequence blocks and their length split, merge and extract, the review controls and the shot browser's state filters, sketch clips (a canvas clip now), clip notes.

## Handed to other workshops

- **07 (organisation):** the timeline as a file type.
- **09 (shells):** the hosting mechanism (viewer, editor, inspector per app) as part of what an app is; playback on the phone or tablet.
- **UX workshops:** the strip, the preview, the two file panels, and per app whether editing in the timeline goes through the inspector, the stage, or both.

## Decided

2026-11-19, by the owner:

- **A timeline is a file:** an ordered overview of files with a picture, for deciding, with hold times and playback.
- **A clip references any file with a picture** (photo, canvas, shot), or nothing.
- **A clip carries nothing of its own** beyond its reference and hold time: no frame, layers, sketch, view mode or notes. Responsibility lies with the file and its app.
- **Placeholders stay:** a clip without a file, with a title and a hold time.
- **No blocks for now.**
- **Files are edited from within the timeline** by hosting their app in place, through an inspector panel, the stage, or both, depending on the app. The mechanism is general and is detailed in workshop 09 and the UX workshops.
- **Two file panels:** the project's files, and the files in this timeline.

Taken from the proposal with the above: no reviewing and no restructuring of shots in the timeline; one editor at a time; a standard app.
