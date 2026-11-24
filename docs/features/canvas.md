# Canvas and optics presets

> **Built in step B5 ([#377](https://github.com/OpenClapper-dev/core/issues/377)).** Specification: [02 optics](../rewrite/02-optics.md), [05 canvas](../rewrite/05-composition.md), [U2 canvas](../rewrite/ux-2-canvas.md). Replaces the first app's rigs, framings, layers, sketches, bakes and the Framing stage (rig-explorer, compose, composition pages).

## Optics (`packages/fov-math/src/optics.ts`)

Optics are generic factors: format (mm), multiplier (reducer or teleconverter), squeeze (front anamorphic), focal length (whole mm), orientation, and an optional delivery aspect cropped centred inside. `opticsView` gives the angle of view and the full-frame equivalent (same diagonal view); `opticsFrame` the frame on a photo as fractions of its width and height (the ratio of half-angle tangents against the photo's stored angle of view; above 1 the optics see more than the photo) with the delivery's inner rectangle; `aspectFrame` an aspect frame of a size. The generic formats were checked against the published camera apertures (two values of the specification's table were corrected: Super 35 3-perf is 24.89 × 13.87 mm, VistaVision 37.72 × 25.17 mm). Built-in primes: 12 14 16 18 20 21 24 25 27 28 32 35 40 50 65 75 85 90 100 135.

## Optics presets (`packages/model/src/canvas.ts`, file type `preset`)

A named camera with its lenses, a file of the project: `{ format, formatName, multiplier, squeeze, delivery, lenses: primes | zoom from–to, archived }`. **Additive only** (`presetChangeError`, checked by the Worker on every save): the name always changes; format, multiplier, squeeze and delivery never (duplicate for others); primes can be added and a zoom widened, a prime removed or a zoom narrowed only where no frame uses those focal lengths. "In use" counts every frame of every canvas of the project, binned and internal ones too (the `frames` table). A preset in use cannot go to the bin (`409`); it is archived instead (out of the pickers, its frames keep working).

## The canvas (`packages/model/src/canvas.ts`, file type `canvas`)

A body `{ surface, objects, frames, picture, linkCentres, comments }`:

| Part | What |
| --- | --- |
| `surface` | `{ kind: "blank", aspect, color }`, or `{ kind: "photo", look? }` with the photo as the canvas's one `base` reference |
| `objects` | One stack, last on top: pen (with its kind: pen, marker, highlighter, brush, dashed), line, arrow, rectangle, ellipse, text, stencil (a glyph), placed picture (a photo of the project, with a look; one `placed` reference each), group. Box, points (flat pairs, to keep bodies small), rotation, stroke, fill, width, opacity, visible, locked, the group it is in. All in fractions of the surface |
| `frames` | Only with a base photo: from a preset (preset and focal length), free-form (format, multiplier, squeeze, focal length, delivery) or an aspect (aspect and size); centre, orientation, name, colour, visible |
| `picture` | The frame the canvas stands for, or null (the whole surface) |
| `comments` | On a point or a region, numbered, with replies, resolved or open. Not part of the picture |

The Worker checks it (`canvasError`) on every save, keeps its frames in the `frames` table, and points a copy's placed pictures at photos copied along (`remap`).

## The edit lock (`apps/worker/src/canvas.ts`)

One editor at a time for every lockable type (the canvas so far). An editing window takes the lock with its own token (`POST /api/files/:id/lock`, `{ holder }`), renews it while open (it holds 60 s) and lets go when it closes (`DELETE`). While someone holds it, a save or a render upload from anyone else, a second window of the same person included, answers `423`. A lock that ran out is free, so a crashed tablet blocks nothing for long. Every file answer carries `lock` (`{ by, until }` or null).

## Renders

Whoever edits a canvas uploads its render (the whole surface flattened) and a thumbnail with the save (`PUT /api/canvases/:id/render | thumbnail`, PNG, JPEG or WebP, at most 12 MB and 600 KB; R2 `canvases/<id>/<part>`). Viewers that cannot draw a canvas show the render and apply a frame themselves. A copy of a canvas copies its renders; purging removes them.

## In the Studio: the Optics presets app (`apps/studio/src/apps/PresetsApp.tsx`, `PresetFlow.tsx`)

A standard app (`#/presets`). The list shows each preset's format and lenses and how many of its focal lengths frames use; archived ones on request. A preset's page: the name (editable), what it is (fixed, with a lock), its lenses with angle of view and full-frame equivalent per focal length (primes: remove one that no frame uses, add any whole mm; a zoom: widen it, narrow it only down to the focal lengths frames use), Duplicate (opens the create flow with its values, for a changed camera), Archive or take out of the archive, Delete (only when no frame uses it). Which focal lengths are in use is read from the project's canvases in the Studio; the Worker checks the same with its frames table.

**The create flow**: name; format from the generic list or an own width and height; multiplier; squeeze (spherical or anamorphic factors); delivery aspect; lenses as primes (ticked from the built-in list, own focal lengths added) or one zoom. Beside it the preview: an example with the frame at one focal length, drawn with the optics math, "On the photo" (dimmed outside, hatched where the preset sees more than the example) or "What it sees" (fitted to the frame), the angle of view and full-frame equivalent, and a strip with one small picture per focal length (four across a zoom, with a slider). **Examples**: a drawn test chart that stands for a photo at 14 mm on full frame (104° × 81°, with the full-frame focal lengths marked), and the project's own photos that have an angle of view. The example photos of the shot list ([optics-example-photos](../rewrite/optics-example-photos.md)) take the chart's place once they exist.

## In the Studio: the Canvas app (`apps/studio/src/apps/CanvasApp.tsx`, `canvas/`)

One window per canvas (`#/canvas/<id>`), opened from Files (double-click), made with **New, Canvas** in Files (blank, 16:9) or **Make a canvas** on a photo (the Files menu, the Photo app; the canvas sits where the photo is, or next to its collection).

- **The editor** (`canvas/CanvasEditor.tsx`, U2's tool on the real model): tools Move (V), Pen (P; pen, marker, highlighter, brush, dashed), Line (L), Arrow (A), Rectangle (R), Ellipse (O), Text (T, edited in place), Stencil (S), Place a photo (I, a photo of the project), Comment (C). Objects in one stack: select, Shift-select, move, resize from a corner, rotate just outside a corner (Shift: 15°), end points of lines, Alt-drag copies, Ctrl+D duplicates, Delete, Group (Ctrl+G) and Ungroup (Ctrl+Shift+G), the layer list reordered by dragging, hide and lock. Properties of the selection (stroke, fill, width, opacity, rotation, pen, stencil, photo and its look). The surface: a base photo (with its look, and a photo to choose) or paper (shape and colour); a blank canvas gets a photo underneath from the surface's row. Frames (only with a base photo): from a preset with its focal lengths (buttons for primes, a slider for a zoom), free-form (format, focal length with the prime stops, multiplier, squeeze, delivery; "Create a preset from it"), or an aspect ratio; orientation, colour, name, the picture, Link centres, what it sees. A photo without an angle of view takes aspect frames only. View modes Outline, Mask, Crop, Full (the window's choice, never stored), Compare (two frames side by side), zoom and pan (Ctrl + wheel, wheel, Space-drag, 0 fits), snapping with a switch (Ctrl suspends it), comments (point or region, replies, resolve, move, redraw the region, list with resolved too).
- **Saving**: automatic, 0.7 s after the last change, with the body and its references (base and placed); then the render (2048 px on the long side) and the thumbnail (400 px) are drawn in the browser (`canvas/render.ts`, the editor's geometry on a 2D canvas) and uploaded. The status bar says Changed, Saving…, Saved or Not saved. Pen strokes keep a point every few pixels and coordinates are rounded to four decimals, so a body stays small.
- **Undo and redo** (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y): the window's own history of bodies, a drag being one step, up to 100.
- **The lock**: the window takes it when it opens (its own token, so a second window of the same person is someone else), renews it every 20 s and lets it go when it closes. Someone else's lock shows the tool read-only under a card with who has it, Check again, and Open a copy to edit.
- Thumbnails of canvases show in Files once a canvas was saved. A canvas with a picture has its thumbnail cropped to the picture (Crop); the render is always the whole surface.

## On the phone and the tablet

- **Media** lists the project's canvases as tiles of their thumbnails (with a brush), in All photos and in their folders. A canvas's page shows its render with the view modes of a canvas that has a picture (Crop, Mask, Outline, Full; the screen's choice), computed with the same frame math as the Studio (`fov-math`, `frameOptics` in the model), and Edit.
- **Canvas** is a tab (Setup, Tabs on this device; best on a tablet): the canvases as tiles, a new one (needs a connection), and the **editor in a web view**: the Studio's embed page (`#/embed/canvas/<id>`), signed in through `GET /api/web` ([api](../api.md)). It holds the lock and saves like the Studio. Touch: two fingers zoom and pan; once a stylus was used, a finger pans and never draws; pen strokes take every point the pen reports. Research and what is to be tested: [tablet canvas](../rewrite/tablet-canvas.md).
