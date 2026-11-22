# U2 · Canvas

UX workshop [#358](https://github.com/OpenClapper-dev/core/issues/358) ([plan](ux-plan.md)). Status: **round 3 built**; decisions so far recorded below.

The one tool for drawing, placing pictures and framing. Specified in [05](05-composition.md) and [02](02-optics.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u2>. Code: `apps/specimen/src/ux/u2/`. Fake data, no server; a reload resets every change. The bar at the very top is not part of the design.

The frames are drawn with the real math of workshop 02: the base photo is 4:3 at a 24 mm equivalent (74° × 59°), and each frame is what its format, focal length, multiplier and squeeze see against that.

## Round 1: what is in it

| Part | What to try |
| --- | --- |
| A base photo with frames | The canvas opens on a photo with three frames from the preset "Pocket 6K · Sigma 18–35" at 18, 24 and 35 mm, each in its own colour: all visible at once is today's Stacked |
| Moving a frame | With the first tool (Select and move), drag a frame. It stays on the photo |
| The frame list | In the inspector: click a frame to edit it, the eye hides it, the star makes it **the picture** the canvas stands for |
| A frame from a preset | Focal length follows the preset's lenses: a slider in whole mm for a zoom, one button per focal length for primes. "+ Frame" adds one from any preset |
| A free-form frame | "+ Frame → Free-form values": format, focal length (typed, or a stop from the built-in list), multiplier, squeeze, delivery aspect; "Create a preset from this frame" |
| An aspect frame | "+ Frame → Aspect ratio only": an aspect and a size, no optics |
| Anamorphic and delivery | Add a frame from "Super 35 4-perf · 2× anamorphic": the outer frame is what the camera sees desqueezed, the dashed inner frame is the 2.39:1 delivery |
| A frame wider than the photo | Add a frame from "Full frame primes" (24 mm): it sees more than the photo, so the photo is drawn smaller, the frame dashed, the area beyond hatched |
| What a frame sees | Under each frame's settings: its angle of view and the full-frame equivalent; the status bar says how much of the photo's width it covers |
| View modes | Outline, Mask, Crop, Full in the toolbar. Mask and Crop use the picture (the starred frame, and its delivery aspect when it has one) |
| Drawing | Pen, line, arrow, rectangle, ellipse in the tool rail; ink colours appear in the toolbar; "Undo the last shape" in Layers |
| A look | Exposure, contrast and saturation under Layers; the Look checkbox switches it off |
| Blank canvas | Surface → Blank: paper to draw on, no frames |
| The edit lock | "Someone else is editing" in the top bar: the banner and a read-only tool |

## Round 2 (2026-11-22)

From the owner's reaction to round 1. The prototype was rebuilt around one idea: the canvas works like a drawing program.

| Change | What to try |
| --- | --- |
| **Objects in one stack** | Everything drawn or placed is an object: pen stroke, line, arrow, rectangle, ellipse, text, stencil, placed photo. There is no "drawing layer" and no "look layer" any more |
| **Layers = the order of objects** | The Layers tab lists the objects, front at the top. Drag a row to reorder, or use the arrows; the eye hides, the lock protects. The surface (the base photo, or paper) is the fixed bottom row |
| **Groups** | Shift-click two rows (or objects), then Group (Ctrl+G). A group moves as one and opens in the list; Ungroup (Ctrl+Shift+G) dissolves it |
| **Select, move, resize** | With Move (V): click an object, drag it, pull a corner handle. Delete removes it, Ctrl+D duplicates it |
| **Properties belong to the object** | Stroke colour and width, fill for rectangles and ellipses, opacity; a text's words; a stencil's symbol. Colours use the chooser from U1 (predefined colours and the picker) |
| **A look belongs to a photo** | Exposure, contrast and saturation are properties of a photo object: the base photo (select the surface row) or a placed photo |
| **Tools and their icons** | Move, Pen, Line, Arrow, Rectangle, Ellipse, Text, Stencil, Place a photo, each with its own icon and key (V P L A R O T S I). A drawing tool shows its colour and width in the toolbar |
| **Stencils** | Symbols to put on the canvas (camera, light, person, flag and more): choose one in the toolbar, click to place, then move, resize and colour it like any object |
| **Paper has a colour** | On a blank canvas, select the surface row: its colour can be set |
| **Frames stay special** | Frames are not in the stack; they have their own tab. Selecting a frame or an object switches the inspector to its tab |
| **Link centres** | A switch in the Frames tab, on by default: the frames share one centre and move together, held on the photo by the largest of them. Off, each frame is moved on its own |
| **Crop** | The view is fitted to the picture's frame and nothing outside it shows; a delivery aspect leaves its bars inside |
| **The edit lock is an overlay** | "Someone else is editing": the whole tool is dimmed and cannot be used, with a card that says who is editing and offers to check again or to open a copy |
| **Dropdowns work everywhere** | They were cut off or painted over inside the inspector. Selects, comboboxes, menus and popovers now float above everything (a change in the design system) |
| **Room in the inspector** | Two tabs (Layers, Frames) instead of one long list; more space between rows; a colour is one dot that opens the chooser |

Found while testing with a real mouse: frames swallowed clicks meant for objects inside them. Only a frame's edge and its label take the pointer now.

## Round 3 (2026-11-22)

| Change | What to try |
| --- | --- |
| Mask always shows the picture's frame | In Mask the camera's frame of the picture is drawn whether or not it is selected, so the bars of a delivery aspect have an edge |
| "The picture" is marked clearly | The star is gone. In the list the frame carries a filled **Picture** pill and an accent bar; on the canvas its label carries a **PICTURE** badge and the frame has a heavier edge with corner marks. A crop icon on the other frames makes one of them the picture |
| Text is edited in place | Double-click a text (or select it and press Enter): type on the canvas; Enter finishes, Escape gives up. A text placed with the Text tool starts in this state |
| Rotation | Just outside each corner of a selection the pointer becomes a rotate arrow: drag to turn the object, Shift for steps of 15°. The inspector shows the angle. Resizing a turned object keeps the opposite corner in place |
| Lines and arrows have end points | A selected line or arrow shows a node on each end instead of a box. Drag a node: that end moves, the other stays. Drag the line itself to move it whole |
| Kinds of pen | Pen, Marker (broad, flat ends), Highlighter (very broad, see-through), Brush (thin at both ends), Dashed. Chosen in the toolbar while the Pen is active; a stroke's kind can be changed afterwards in the inspector. Strokes are drawn with rounded corners |
| A wider inspector | It can be dragged from 280 to 820 px (the layout's default limit rose from 400 to 640) |
| Objects win over frames | A frame is grabbed by its label, or by its edge where no object lies. An object on or inside a frame is always the one that is clicked, and the handles of a selection sit above the frames |

The last row came out of testing with a real mouse: the end node of the arrow and the text both lay on a frame's edge and could not be grabbed.

## Not built yet

Compare (two frames side by side), the preset create flow with its preview on example photos, editing a pen stroke's points, snapping and alignment guides, rotating and resizing a group, undo and redo, zooming and panning the view, the tablet.

## Questions for the owner

1. Is the picture now marked clearly enough?
2. Do the pens feel right, and is one missing?
3. Which stencils are missing? Film-specific ones (dolly, tripod, flag on a stand, light with barn doors) would have to be drawn.
4. Next: Compare, the preset create flow, or zoom and pan with snapping?

## Into the design system

| Part | What |
| --- | --- |
| `Floating` | New: a surface that floats next to a control, rendered at the themed root so no panel, row or animated section can cut it off or paint over it; follows its anchor, opens upward when there is no room, closes on a press outside |
| `Select`, `Combobox`, `DropdownMenu`, `Popover` | Their lists and surfaces use `Floating` |
| `EditorLayout`, `ViewerLayout` | The inspector's limits can be set; it can be dragged up to 640 px by default (was 400) |
| Icons | New glyphs for the drawing tools: cursor, pencil, line, arrow, square, circle, text, stencil, group. The Tabler ones were written out from the published set and are to be checked against the package |

## Changes to specification pages

To be applied to [05](05-composition.md) when this workshop is decided:

- A canvas holds **objects in one stack**, with groups. "Drawing layers" and "adjustment layers" are dropped; layering is the order of objects.
- A **look** (exposure, contrast, saturation and the rest) is a property of a photo object, the base photo or a placed one, not a layer over everything.
- A blank surface has a colour.
- Frames are not part of the stack.

## Decided

2026-11-22, by the owner, after round 1:

- **Frames** as a list that can be compared, hidden and given one "picture" are right.
- **Frames can be moved together:** their centres can be linked.
- **The canvas is a drawing program:** objects, a stack that is reordered by dragging, groups; no layer kinds. A look belongs to a photo.
- **Stencils** are part of the drawing tools.
- **The edit lock is an overlay** over a disabled tool, not a banner.
- **Crop** shows only the picture, fitted to the view.
- **No angle of view for a blank canvas.**

2026-11-22, by the owner, after round 2:

- **The object stack, groups and controls** are right as built.
- **Crop** as built: fitted to the picture's frame, bars for a delivery aspect inside.
- **Mask** always shows the picture's frame.
- **Text is edited in place;** objects can be rotated; lines and arrows are changed by their end points; there are several kinds of pen.
- **The picture needs a stronger mark** than a star.
