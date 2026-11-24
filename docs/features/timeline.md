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

## The Timeline window (`apps/studio/src/apps/TimelineApp.tsx`, `src/timeline/`)

One window per timeline (Files: New, Timeline; a double-click on one). The U4 layout: the **stage** with the transport under it; the **Cut** below (the strip); at the left **Files**, **In use** and **Chapters**; at the right the chosen **Clip**. Panels move, size, collapse and stack as everywhere (`Dock`).

- **The stage** plays what is under the playhead: a picture through its frame in Outline, Mask, Crop or Full (the window's choice); a progression's pictures at its timing with its default frame and overlay, a smooth zoom moving; a placeholder or a missing file as a card. The caption names the chapter and the clip (and the picture of a progression). Transport: to the start, previous and next clip, play and pause (on the clock; at the end it stops and goes back to the start), the time.
- **The strip**: a ruler (click or drag to move the playhead; the knob scrubs), a lane of chapters (each from its marker to the next), the clips, each as wide as it lasts. Zoom with the slider or Ctrl + wheel; **Fit** shows the whole cut. A shot with a progression is **Spread** (a cell per picture; a click on a cell goes to that picture) or **Collapsed** (its first picture); its length is the progression's in both, and it has no edge to pull. Others: pull the right edge to change the time, drag to reorder.
- **Choosing**: a click chooses a clip and puts the playhead at its start; Shift adds a range, Ctrl one more. With several chosen, the Clip panel sets one hold time for all, ± 0.5 s, moves them together (Alt + arrows) or removes them.
- **Files**: the project's shots, photos, canvases and collections, with a search and a type filter; a collection opens to its photos (never a clip itself), a canvas with frames opens to its frames. Drag a row into the strip (a line shows where it lands; over a **placeholder** it fills it, keeping its time and chapter), double-click it, or press its plus to add it after the chosen clips. A new clip holds the timeline's value, else the account's ("New clips … s": "This timeline has its own value"; the account's value is the `clipHoldMs` preference, 2 s to start with).
- **In use**: the files this cut uses, with how often, and the placeholders; a click goes to the next clip that uses it.
- **Chapters**: each with its start and length; a click goes there. "Chapter" (C) starts one at the chosen clip, or ends it; its title and colour are set in the Clip panel.
- **The Clip panel**: the picture, the file's name (a placeholder's title is typed here), the hold time with ± 0.5 s (D focuses it), where it starts; a shot with a progression says it plays its progression. **Open in …** (or a double-click on the clip) opens the file's app in a window of its own; **Make a canvas from it** (a photo) makes a canvas on the photo next to it and points the clip at it; **Fill it** (a placeholder); **Remove**. Then where else the file is used, and its properties.
- **Missing files**: the clip keeps its place, shown dashed; the Clip panel offers to restore the file.
- **Undo and redo** (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y; the buttons in the Cut's row): up to 100 steps, changes close together are one.
- **Keys**: Space, ← →, Home, End, Alt+← →, - and +, D, P (a placeholder after the chosen clip), C, Delete, Ctrl+A ([shortcuts](../shortcuts.md)).
- **The edit lock**: the window takes it when it opens; others see the timeline read-only with who edits it, and Edit when it is free; **Stop editing** saves and lets it go. A watching window follows every change at once in a project set to realtime (the file's live room), else reads the timeline again every 5 s. Changes save 0.6 s after the last one (status bar: Saved, Changed, Saving…, Not saved).
- **The address** keeps the playhead: `#/timeline/<id>?t=12.5`.

## Editing a canvas or a shot from the cut

A double-click on a canvas or shot clip, or **Edit here** in the Clip panel, mounts the file's own window in place of the stage: the canvas editor, or the Shot window (progression and content as tabs below, its own arrangement). A bar names the file, says where else it is used, offers **Edit a copy instead** when it is used elsewhere (the clip then points at a copy, which is edited here; the original stays), **Open in …** (its app in a window of its own) and **Done**. Playback stops and the playhead stays on the clip; choosing another clip, moving the playhead or playing ends the edit. The file panels fold away meanwhile and come back after. The mounted editor owns the keys. **The lock is the file's**: editing in place takes the same lock as its own window, so a file someone edits elsewhere is read-only here too (with who has it), and the other way round. A photo clip is not edited: Make a canvas from it.

## The Master timeline window (`apps/studio/src/apps/MasterApp.tsx`)

The app **Master timeline** (also from a timeline's toolbar, which says its place in the master): the same window with timelines for clips. The stage plays them end to end (what each timeline plays, at its timing); the strip shows each as a **film strip** (as many pictures as its width holds, the first and the last always; zooming in shows more) and as a chapter; a timeline's own chapters are not shown. **Timelines** panel: those in the master in order (drag to reorder, the cross takes one out) and those outside it (**Add**), and **New timeline** (added at the end). A click chooses a timeline and puts the playhead at its start; a double-click opens it. Only membership and order are set here; changes save at once (`PUT /api/projects/:id` with `master`). The master has no edit lock: two people changing the order at the same time, the last one wins.
