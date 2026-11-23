# U3 · Shot, set, location

UX workshop [#359](https://github.com/OpenClapper-dev/core/issues/359) ([plan](ux-plan.md)). Status: **in progress** (round 2, 2026-11-23).

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

## Round 2 (2026-11-23)

From the owner's reaction to round 1.

| Change | What to try |
| --- | --- |
| **Panels can be put elsewhere** | Properties, Progression and Content each carry a grip at the left of their head. Drag it onto a half of another panel (the left, right, top or bottom half lights up) to sit beside, above or below it, or onto an empty edge of the window (left, right, below the stage). The arrangement of round 1 stays the default; "Panels back to their places" is in the toolbar's menu. Examples: Content onto the lower half of Properties; Content onto the right half of Progression; Properties to the left edge |
| **Content as a list** | The two buttons in the Content head switch between cards and rows. Rows are reordered by dragging, too |
| **Two ways to open** | On the stage, in the panel of a picture and in a tile's menu: "Edit here" mounts the canvas tool in this window; "Open" opens the file's app in a window of its own (a message in the prototype) |
| **Free-form values** | The default frame takes a preset, typed values (format, focal length, multiplier, squeeze, delivery) or an aspect ratio. The generator takes a preset or "Free-form values…" |
| **The generator makes zooms only** | Pan and tilt are gone: from one photo they cannot be right, because the perspective changes |
| **Zoom in steps** | Primes: the ticked lenses. A zoom preset or free values: "Common stops", "Every … mm" (any step, for example 1 mm from 18 to 35) or a typed list; From and To also give the direction |
| **Smooth zoom** | "Smooth": from one focal length to another over a time, optionally eased. It makes two frames and one moving picture, not a picture per millimetre. The preview has a slider to look through the move; in the progression the picture carries "smooth", plays by itself, and its panel has the same slider and the Ease switch |

Found while testing: playback counted ticks and ran slow; it runs on the clock now.

## Decided so far

2026-11-23, by the owner:

- **The default layout** of round 1 stands: stage, properties at the right, progression and content below. Panels can be rearranged by dragging, as a personal preference.
- **The content list has two views:** cards and rows.
- **Editing in place** takes the stage and the side panel, as built. Beside it there is opening the file in a window of its own; both are offered.
- **The side panel's second tab** for the chosen picture stays.
- **A set's locations are all alike.** No "chosen" mark; a project can model that with a property.
- **Free-form values** are allowed wherever a preset is: the default frame and the generator.
- **The generator makes zooms only,** in steps or smooth. No pan or tilt.
- **A progression item can be a smooth move** between two frames of one canvas over a time.
- **The model stays:** the progression belongs to the shot, and what is made inside a shot is an internal file. Moving the progression onto the canvas was considered and dropped, because a progression across several photos needs the shot.

## Changes to specification pages

To be applied to [04](04-shots.md) when the workshop is decided:

- The generator makes a zoom, in steps or smooth; the sentence on pans and tilts from the generator goes (frames at different positions can still be made by hand in the canvas).
- A progression item is a picture held for a time, or a smooth move from one frame of a canvas to another over a time.
- The default frame may be free-form values.

## Not prototyped

Creating a canvas from a photo in the content ("Draw or frame"), duplicating a shot, moving a frame from the shot window without opening the canvas, dragging the border between two panels of one place, panels as tabs of one place, keyboard handling of the lists, typing coordinates, the windows on a phone or tablet ([U5](ux-plan.md)).

## Into the design system

Nothing yet. Candidates: the pointer-based reordering with its ghost (now written twice, in U2's layer list and here), panels that can be put elsewhere (the timeline of U4 will want the same), and a popover wider than 280 px.
