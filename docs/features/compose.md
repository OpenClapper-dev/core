# Compose: descriptions, overlays and sketches

From [GitHub issue #12](https://github.com/OpenClapper-dev/core/issues/12) (first half; the timeline composer is the second). A shot can carry a written description, **overlays** (a drawing plus a look over one of its photos) and **sketches** (free canvases such as a floor plan). Everything is made in the Studio; the phone shows read-only renders. Nothing here depends on the review state: unreviewed shots compose like approved ones.

## Model (`packages/vocab/src/compose.ts`, `markdown.ts`)

- **Overlay**: belongs to one **photo** (a sequence has different framing per photo). Holds a `drawing` (shapes in the raw photo's coordinate space: 0..1 across the image, values outside allowed for the black area shown when the rig saw more than the phone), a `look`, a default `presentation`, a name, a description and a position. Because the drawing lives in photo coordinates, every frame mode and every rig or lens is only a crop or a frame over it: the drawing never moves. The presentation (`mode`, the rig `frame` fractions, a `label`, and the `rig_id` / `lens_mm` it came from) is only how the overlay opens.
- A **step** of a sequence can show an overlay instead of its photo ([sequences](sequences.md)): a light progression is one step per overlay of a photo. The step opens in the frame the overlay was drawn for unless it picks a framing of its own.
- **Sketch**: belongs to the **shot**. A drawing on a blank canvas of a chosen aspect ratio (16:9, 4:3, 1:1, 3:4), a free-text `kind` (Floor plan, Lighting diagram, Blocking and Storyboard are offered first), name, description, position.
- **Shapes**: `path` (freehand, points simplified on save), `line`, `arrow`, `rect`, `ellipse` (optionally filled), `text` and `stencil`: 67 stroke glyphs in 24 × 24 (`STENCILS` / `STENCIL_GROUPS` in vocab, paths in `apps/studio/src/compose/stencils.ts`): the four hand-drawn diagram glyphs (camera top view, light, actor, flag) and, since issue #46, a curated set vendored from Lucide (lucide-static 1.53.0, ISC; each icon's elements joined into one stroke path) in groups Camera & sound, Light, People & animals, Vehicles, Set & props, Nature & weather, Marks. No icon dependency at runtime. Any shape can carry a **mask** (`mask: [{ width, points }]`, issue #46): eraser strokes that cut parts out of that shape only; moving the shape moves them, resizing or rotating does not. Stroke width is a fraction of the canvas width, text and stencil size a fraction of its height, so a drawing scales with the display and the render. Ten fixed colours (`COMPOSE_PALETTE`), drawn over photos, so they never take the theme.
- **Look** (overlays only): exposure (−3..3; brightness 4^value, so one unit is 2 EV and the slider spans ±6 EV, issue #46; the old ±1 ends render exactly as before), contrast, saturation (−1..1), black-and-white, a tint colour with opacity, vignette and softness (0..1). On the Studio it is CSS (`lookFilter()` plus a tint layer and a radial gradient); the render bakes the same into the pixels.
- **Description** (shot, overlay, sketch): a Markdown subset: `#`/`##`/`###` headings, paragraphs, `-` and `1.` lists, `**bold**`, `*italic*`, `` `code` ``, `[links](https://…)`. `parseMarkdown()` gives a block tree both clients render; nothing is stored as HTML, and only `http(s)` links are recognised.
- Validation (`validateDrawing`, `validatePresentation`) is strict: these are interactive edits. Limits: 3000 shapes, 4000 points a path, 200 characters a text, 1 MB of drawing JSON, 20 000 characters a description, 6 MB a render (JPEG, PNG or WebP, recognised by its bytes, #224).

## Renders

On every save the Studio flattens the item in the browser (`apps/studio/src/compose/render.ts`) and uploads it with the JSON (one multipart `PUT`):
- an overlay render is the **raw photo at its stored size** with the look and the drawing, as JPEG. Being photo-sized, the phone frames it with the same geometry as the photo (mask, frame, fit, raw).
- a sketch render is the canvas on white, 1600 px wide, as PNG.

Renders live in R2 under `renders/overlays/<id>.<ext>` and `renders/sketches/<id>.<ext>`. `render_url` carries the save time (`?v=`), so it changes with every save and the image route can cache for a year. Deleting a shot removes its photos and renders together.

## Studio (`apps/studio/src/compose/`)

Shot view → stage **Compose** (`C`; route `#/shots/<id>?stage=compose`). The stage takes the whole body: tools and the drawing surface where the photo was, the item strip in the foot, and a panel on the right instead of the inspector.

- **Item strip** (foot): the overlays of the photo on stage, "+ Overlay", a divider, the shot's sketches, "+ Sketch". For sequences, `,` `.` and the ‹ › buttons switch the photo (overlays are per photo). Nothing is saved until **Save** (`⌘S`); the status next to it says Not saved yet · Saving… · Saved · Not saved + Retry.
- **Tools** (stage bar): Select/move `V`, Freehand `P`, Line `L`, Arrow `A`, Rectangle `R`, Ellipse `O`, Text `T`, Stencil `S`, Eraser `E`; the colour swatches (`1`–`0`), stroke width S/M/L, Fill (rectangles and ellipses), the **stencil picker** (a searchable grid by group), Undo/Redo (`⌘Z` / `⌘⇧Z`). Shift makes squares, circles and 45° lines. Colour and width apply to the next shape, or to the selected one. Text: click to place, type, Enter; double-click a text to edit it. Select: click a shape, drag to move, arrow keys nudge, `Del` removes, Esc deselects. A selected stencil shows its box with a **corner handle** (drag to resize) and a **knob** above it (drag to rotate; Shift snaps to 15°).
- **Panel**: name; for sketches the kind (combobox, custom names allowed) and the canvas aspect; move up/down among siblings, Delete (confirms) or Discard for a new item. Overlays: **Presentation** (frame mode and a **Framing**: As captured or a saved framing from the [Framing stage](rig-explorer.md), followed when it is edited; new overlays start on the root; the drawing stays put, this is only how it opens) and **Look** (sliders; double-click a slider to reset it; Reset for all). **Shape** shows the selected shape's opacity, size, rotation (stencils), text, its **Mask** (Paint away: drags erase parts of this shape only, with an S/M/L brush, Done or Esc ends it; Restore removes the mask), Duplicate and Remove. **Description** is a Markdown field (toolbar with bold, italic, heading, lists, link, code; Write · Preview).
- **Leaving** with unsaved changes (another stage, shot or photo, Back, Esc) asks: Discard · Save · Keep editing. Closing the tab asks too.
- **From timelines · n** (stage bar, when no item is open): overlays drawn inline on this photo in the project's timelines, and the timelines' sketches (issue #31). They belong to their clip and are not listed in the item strip; **Make the shot's** moves an overlay to the photo (its clip keeps showing it), **Attach here** makes a sketch this shot's. In a timeline the same tools work inline on the stage, see [timeline](timeline.md).
- The **inspector** (other stages) has a **Description** section for the shot (saved 0.7 s after the last edit, or on leaving the field) and a **Compose** section listing the overlay and sketch names with Open (`C`). The shot's delete confirmation counts them.

Every key is listed under `?`.

## Phone (`apps/mobile/src/components/ComposeParts.tsx`, `Markdown.tsx`)

Read-only, from the renders:
- **Shot details**: the shot's description (rendered Markdown) under the summary, then a strip "Overlays · photo n · Sketches" with a thumbnail, name and kind per item. Tap opens the **viewer**: the render on black; overlays take the frame modes and open in the presentation they were drawn in, sketches show as they are; the name, kind and rig label, and the description on an opaque card (toggle).
- **Step-through** Details sheet: the description and a row per overlay and sketch; tap opens the same viewer.
- **Offline**: making a day or a project offline downloads the renders too (`offline-photos/r-<id>-<version>.jpg`); a newer save replaces the old version on the next update. In offline mode a render without a local copy stays black, like photos.

Queued shots (not uploaded yet) have no description, overlays or sketches.

## Not done

- No overlays or sketches are created on the phone; no editing there.
- The timeline composer (second half of #12) is a separate PR.
- Creating a shot from a sketch or an external image is a separate issue.
