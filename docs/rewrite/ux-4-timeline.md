# U4 · Timeline

UX workshop [#360](https://github.com/OpenClapper-dev/core/issues/360) ([plan](ux-plan.md)). Status: **in progress** (round 1, 2026-11-23).

The window that opens a timeline, and the master timeline. Specified in [06](06-timeline.md) and [I1](i1-interjection.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u4>. Code: `apps/specimen/src/ux/u4/`. Fake data (the project of U1 and U3), no server; a reload resets every change except the arrangement of the panels. The bar at the very top is not part of the design: it stands for opening a file and offers three timelines and the master.

## Round 1: what is in it

| Part | What to try |
| --- | --- |
| **Layout** | The stage with the transport under it; below, the strip of the cut; at the left Files, In use and Chapters as tabs; at the right the chosen clip. All of them are panels of the design system's `Dock` ([U3](ux-3-shot.md)): move, size, collapse and stack them as anywhere |
| **The strip** | A ruler, a lane of chapters and the clips. A clip is as wide as it lasts; the slider at the right of the strip's controls zooms. Click a clip to choose it and put the playhead at its start; click or drag in the ruler to move the playhead anywhere |
| **Kinds of clips** | In "Scene 12, first pass": two shots with a progression, a placeholder, one frame of a canvas, a photo, a shot without a progression, a canvas, and a clip whose file is in the bin |
| **Hold time** | Pull the right edge of a clip, or type it in the Clip panel. A shot with a progression has no edge to pull: it plays its progression, and the panel says so |
| **Reordering** | Drag a clip along the strip (own ghost) |
| **Spread and collapsed** | The switch in the strip's controls: a shot with a progression as one cell per picture, or as one clip showing its first picture. The length is the same in both. Spread, a click on a cell puts the playhead on that picture |
| **Playback** | Space or the play button; arrow keys or the buttons step from clip to clip. Progressions play at their own timing, with their overlay and default frame; a smooth zoom moves |
| **View modes** | Outline, Mask, Crop, Full beside the transport: a choice of this window, not stored in a clip |
| **Files** | The project's shots, photos and canvases, with a search and a type filter. Drag a row into the strip (a line shows where it lands), double-click it, or press its plus to add it after the chosen clip. A collection opens to its photos; a canvas with frames opens to its frames |
| **In use** | The files this cut uses, with how often; a click goes to the first clip that uses the file |
| **Placeholders** | "Placeholder" in the strip's controls adds one after the chosen clip; its title is typed in the Clip panel. The stage shows it as a card |
| **A missing file** | The last clip of Scene 12: the clip keeps its place; the Clip panel offers to restore the file |
| **Chapters** | "Chapter" in the strip's controls, or the switch in the Clip panel: a chapter starts at the chosen clip. Title and colour are set in the panel. The lane above the clips shows each chapter from its marker to the next; the Chapters panel lists them with start and length |
| **The clip's panel** | The file as a chip, hold time, start, the chapter, where else the file is used, and the file's own properties (a shot's scene and shot size, a canvas's kind) |
| **Editing in place** | Double-click a canvas clip, or "Edit here" in its panel: the canvas tool of [U2](ux-2-canvas.md) takes the stage, with a bar saying which file is edited, where else it is used, and "Edit a copy instead". Playback stops; choosing another clip or moving the playhead ends the edit |
| **A photo clip** | "Make a canvas from it" (a message in the prototype) |
| **The master timeline** | The last entry of the top bar. The same window: the strip holds one block per timeline, the stage plays them end to end, each timeline is a chapter. At the left the timelines in the master (drag to reorder, the cross takes one out) and those outside it (Add). A double-click opens a timeline |

Limits of the prototype: the mounted canvas tool always opens U2's sample canvas; shots and their progressions are fixed (they are edited in U3's prototype, which does not share its changes with this one); a shot clip only says that it opens the shot's window.

## Open questions for the owner

1. **Editing a shot from the cut.** A canvas is edited on the stage. A shot clip opens the shot's window. Should the shot window also be mounted in place (its properties in the Clip panel are already there), or is the own window right for shots?
2. **One track.** The cut is one row of clips. Nothing in the specification asks for more; confirm that a second track is not wanted.
3. **Dragging files in** adds a clip of 2 s. Should the default hold time be a setting of the timeline or of the account?
4. **The master's strip** shows each timeline's pictures (spread) or its first picture (collapsed), with the same switch as for progressions. Enough, or should the master show the timelines' own chapters too?
5. **Replacing a clip's file** (pointing a clip or a placeholder at another file while keeping its place and time) is not built; today a file is dragged in and the old clip removed. Wanted as a drop onto a clip?

## Not prototyped

The edit lock of a timeline (someone else has it open), duplicating a file from a clip, making a canvas from a photo clip, undo and redo, selecting several clips, playback on a phone or tablet ([U5](ux-plan.md)).

## Into the design system

Nothing new yet. The strip is page code of the prototype; `TrackLayout` of the design system (lanes with coloured items) does not fit a cut of pictures and would be replaced by it.
