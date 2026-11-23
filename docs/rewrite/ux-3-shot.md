# U3 · Shot, set, location

UX workshop [#359](https://github.com/OpenClapper-dev/core/issues/359) ([plan](ux-plan.md)). Status: **in progress** (round 1, 2026-11-23).

The three windows that open a shot, a set and a location. Specified in [04](04-shots.md), [09a](09a-places.md), [I1](i1-interjection.md) and [06](06-timeline.md) (hosting another app in place).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u3>. Code: `apps/specimen/src/ux/u3/`. Fake data (the project of U1), no server; a reload resets every change. The bar at the very top is not part of the design: it stands for opening a file from the browser and offers six of them.

| File in the top bar | What it shows |
| --- | --- |
| Shot 02 | A progression made by the generator: one internal canvas seen through five frames, with an overlay, timed as one length |
| Shot 01 | A progression of three photos (one view, changing light) with a default frame and a time per picture; a content entry whose file is in the bin |
| Shot 05 | Content only, no progression |
| Shot 09 | A shot with a name only |
| Harbour quay | A set |
| Fischmarkt quay | A location |

Frames are drawn with the real math of [02](02-optics.md) against each photo's own angle of view.

## Round 1: what is in it

One build for all three windows.

| Part | What to try |
| --- | --- |
| **Layout** | A stage with the chosen picture; the file's properties in a panel at the right (drag its edge, or fold it with the button in the toolbar); below the stage the progression (shots only) and the content list. The lower part can be dragged higher or folded away |
| **Properties** | Every field type with its control: text, single choice, multiple choice (a menu with ticks), a reference as chips. The name is edited at the top of the panel |
| **References open files** | The chip of a shot's set opens the set; a set's location chips open the locations; a set lists the shots that play there, a location the sets filmed there. In the product each opens a window of its own |
| **Position** | On a location: the Position button opens a small map; click to place the pin, click again to move it |
| **Content list** | Tiles in order; drag to reorder (own ghost, no browser drag and drop); "Add files" opens a picker over the project; the menu on a tile opens, edits, adds to the progression or removes |
| **Picking files** | Search and a type filter; a collection opens and its photos are ticked one by one or all at once: the collection itself is never referenced |
| **A missing file** | Shot 01, third tile: the file is in the bin. The entry stays in its place and offers to restore the file or to remove the entry |
| **Progression** | A small timeline: each picture is as wide as it holds. Click to show one on the stage, drag to reorder, pull the right edge to change its time, the cross removes it. Play runs it on the stage with a playhead |
| **Timing** | "Each picture its own time", or one length split evenly, or one length with the first and last held twice as long |
| **Default frame** | A preset with a focal length, or an aspect ratio. It is applied, centred, to pictures that have an angle of view and no frame of their own (Shot 01). The caption on the stage says through which frame a picture is seen |
| **Overlay** | "Add an overlay" makes an internal canvas drawn over every picture; a switch shows and hides it; the pencil edits it. The drawing in the prototype is a stand-in |
| **Generator** | "Generate…": a photo, an optics preset, and a movement. Zoom: one frame per focal length (the preset's primes, or steps across its zoom). Pan and tilt: one focal length at several positions between two edges. The preview shows every frame on the photo and the resulting pictures. The result is one internal canvas and one picture per frame; it replaces the progression or is added to its end |
| **One frame of a canvas** | In the picker for the progression a canvas with frames can be added as a whole or through one frame. In the side panel of a progression picture, "Shows" switches between the whole canvas and its frames |
| **View modes** | Outline, Mask, Crop, Full in the toolbar, for the stage only. Thumbnails are always Crop |
| **The entry's own panel** | The side panel has a second tab named after the chosen picture: its place in the progression, its frame, its own properties and facts. This is the other app's inspector mounted in the window. A frame's focal length can be changed there while the stage follows |
| **Editing in place** | "Edit here" (or a double-click) on a canvas mounts the canvas tool of [U2](ux-2-canvas.md) where the stage and side panel were. A bar above it says which file is being edited, whether it is internal or also used elsewhere, and offers "Edit a copy instead". The lists below fold away and can be pulled up to switch to another canvas |
| **Internal files** | A canvas made inside a shot ("New canvas", the generator, the overlay) carries a lock mark and is listed in the shot's panel under "Internal files" with what it is used for. "Make it a project file" releases it, one way, after a confirmation |
| **Thumbnail** | The first picture of the progression (a star marks it), else the first picture of the content. The panel's header shows it and says which rule applied |
| **Empty shot** | Shot 09: the stage offers to add files or to draw a canvas |
| **Deleting** | "Move to the recycle bin" in the toolbar's menu names the internal files that go with the shot |

Limits of the prototype: the mounted canvas tool always opens U2's sample canvas, whichever file is edited; the overlay's drawing is fixed; frames that see more than the photo are not marked on the stage.

## Open questions for the owner

1. **Where the lists sit.** Progression and content are strips below the stage, like a timeline. The alternative is a column at the left.
2. **Editing in place takes the whole window.** The canvas tool needs room, so stage and side panel give way and the lists fold. The alternative keeps the shot's panel visible and gives the tool only the stage.
3. **The second tab of the side panel** shows the chosen picture's panel. The alternative is one long panel, or switching automatically when a picture is clicked.
4. **A set's locations** are all alike. [09a](09a-places.md) speaks of "a candidate, or the chosen one": whether one location of a set can be marked as chosen is not decided.
5. **Free-form values** as a default frame and in the generator are left out so far; both take a preset or an aspect ratio.

## Not prototyped

Creating a canvas from a photo in the content ("Draw or frame"), duplicating a shot, moving a frame from the shot window without opening the canvas, keyboard handling of the lists, typing coordinates, the windows on a phone or tablet ([U5](ux-plan.md)).

## Into the design system

Nothing yet. Candidates: the pointer-based reordering with its ghost (now written twice, in U2's layer list and here), and a popover wider than 280 px.
