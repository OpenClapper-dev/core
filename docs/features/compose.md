# Compose: descriptions, drawings and sketches

From [GitHub issue #12](https://github.com/OpenClapper-dev/core/issues/12). A shot carries a written description,
**sketches** (free canvases such as a floor plan) and, since [epic #275](https://github.com/OpenClapper-dev/core/issues/275),
**layers** over its photos ([composition](composition.md): drawings and looks on steps, baked for the phone). This page
covers the drawing model the layers and sketches share, the sketches, and the descriptions. Everything is made in the
Studio; the phone shows read-only renders. Nothing here depends on the review state.

## Drawing model (`packages/vocab/src/compose.ts`, `markdown.ts`)

- **Shapes**: `path` (freehand, points simplified on save), `line`, `arrow`, `rect`, `ellipse` (optionally filled),
  `text` and `stencil`: 67 stroke glyphs in 24 × 24 (`STENCILS` / `STENCIL_GROUPS` in vocab, paths in
  `apps/studio/src/compose/stencils.ts`): the four hand-drawn diagram glyphs (camera top view, light, actor, flag)
  and, since issue #46, a curated set vendored from Lucide (lucide-static 1.53.0, ISC; each icon's elements joined
  into one stroke path) in groups Camera & sound, Light, People & animals, Vehicles, Set & props, Nature & weather,
  Marks. No icon dependency at runtime. Any shape can carry a **mask** (`mask: [{ width, points }]`, issue #46):
  eraser strokes that cut parts out of that shape only; moving the shape moves them, resizing or rotating does not.
  Coordinates are fractions of the canvas (a sketch's box, a photo, or a rig frame for a layer in frame space).
  Stroke width is a fraction of the canvas width, text and stencil size a fraction of its height, so a drawing
  scales with the display and the render. Ten fixed colours (`COMPOSE_PALETTE`), drawn over photos, so they never
  take the theme.
- **Look** (adjustment layers): exposure (−3..3; brightness 4^value, so one unit is 2 EV and the slider spans
  ±6 EV), contrast, saturation (−1..1), black-and-white, a tint colour with opacity, vignette and softness (0..1).
  On the Studio it is CSS (`lookFilter()`), in a bake the same filter on a canvas.
- **Description** (shot, layer, sketch): a Markdown subset: `#`/`##`/`###` headings, paragraphs, `-` and `1.` lists,
  `**bold**`, `*italic*`, `` `code` ``, `[links](https://…)`. `parseMarkdown()` gives a block tree both clients
  render; nothing is stored as HTML, and only `http(s)` links are recognised.
- Validation (`validateDrawing`, `validateLook`) is strict: these are interactive edits. Limits: 3000 shapes, 4000
  points a path, 200 characters a text, 1 MB of drawing JSON, 20 000 characters a description, 6 MB a render (JPEG,
  PNG or WebP, recognised by its bytes, #224).

## Sketches

- A **sketch** belongs to the **shot**: a drawing on a blank canvas of a chosen aspect ratio (16:9, 4:3, 1:1, 3:4),
  a free-text `kind` (Floor plan, Lighting diagram, Blocking and Storyboard are offered first), name, description,
  position.
- **Studio**: in the shot view's Compose stage ([composition](composition.md)), the sketches sit at the end of the
  foot with **+ Sketch**; opening one puts its canvas on the stage and its settings in the panel (name, kind,
  canvas, shape, description, Delete). It saves on its own 1.2 s after the last stroke, with a render: the canvas
  on white, 1600 px wide, PNG (`renderSketch` in `apps/studio/src/compose/render.ts`), under
  `renders/sketches/<id>.<ext>`; `render_url` carries the save time (`?v=`), so the image route can cache for a
  year.
- A placeholder clip in a timeline can carry a sketch of its own (a sketch clip, [timeline](timeline.md));
  **Attach to shot** makes it a shot's.
- **Phone** (`apps/mobile/src/components/ComposeParts.tsx`, `Markdown.tsx`): Shot details shows the shot's
  description (rendered Markdown) under the summary, then a **Sketches** strip; tap opens the viewer (the render on
  white, the name and kind, the description on an opaque card). The Step-through Details sheet has the description
  and a row per sketch. Offline days and projects download the renders; in offline mode a render without a local
  copy stays black. Queued shots have no description or sketches.

The inspector (other stages) has a **Description** section for the shot (saved 0.7 s after the last edit, or on
leaving the field) and a **Compose** section listing the layer and sketch names with Open (`C`).

## Not done

- Nothing is drawn or edited on the phone.
- Creating a shot from a sketch or an external image is [new shot](new-shot.md).
