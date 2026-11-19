# 05 · Canvas (was: composition)

Workshop [#332](https://github.com/OpenClapper-dev/core/issues/332). Status: **proposal, nothing decided yet**.

One tool and one file type for everything drawn or arranged: a sketch, a floor plan, a photo with marks and a look, a photo explored through frames. The direction was set in [workshop 04](04-shots.md); this page fills it in.

## As-is

| Fact | Where |
| --- | --- |
| **Layers** belong to a shot and are drawn over its steps: drawing layers (shapes) and adjustment layers (a look). Each has a position in the stack (below zero = under the photo), a range of steps it shows on, opacity, visibility, lock | `docs/features/composition.md`, `packages/vocab/src/layers.ts` |
| A layer lives in one of two spaces: **frame** (fractions of the frame a step is shown with, so a mark follows a zoom or pan) or **photo** (fractions of one photo) | same |
| **Sketches** also belong to a shot: a drawing on a blank canvas of 16:9, 4:3, 1:1 or 3:4, with a free-text kind (floor plan, lighting diagram, blocking, storyboard) | `docs/features/compose.md` |
| Layers and sketches share one drawing model: path, line, arrow, rectangle, ellipse, text, 67 stencils, an eraser mask per shape, ten fixed colours; coordinates and stroke widths are fractions of the canvas | `packages/vocab/src/compose.ts` |
| A **look** is exposure, contrast, saturation, black and white, tint, vignette, softness; CSS filters in the Studio, the same filter on a canvas when rendered | `compose.ts` (`lookFilter`) |
| The phone never draws. For every step with layers the Studio flattens photo and layers into a **bake** in the background (the "bakery"), tracked by a hash and marked stale when a layer, step or framing changes; sketches upload a rendered PNG on save | `composition.md` (Bakes), `apps/studio/src/compose/baker.ts`, `render.ts` |
| Timeline clips can carry layers of their own, edited inline, and be promoted to the shot | `composition.md` (Timeline) |
| **Framing** is a separate stage of the shot view: one frame as a drag handle, Compare A / B, Stacked (any number of frames in colours; nothing saved), a lens strip | `docs/features/rig-explorer.md`, `apps/studio/src/RigExplorer.tsx`, `StackedFrames.tsx` |
| **View modes** (mask, frame, fit, raw) are a global setting in the Studio, a per-window setting in the shot view, three separate remembered settings on the phone, and a stored value in a timeline clip's presentation | `docs/features/review-and-tagging.md` (View modes), `timeline.md` |
| Everything is made in the Studio; about 1,800 lines in `apps/studio/src/compose/`. Nothing is drawn or edited on the phone | `compose.md` (Not done) |

## Problems and leaks

1. **Three homes for one activity.** Drawing over a photo (layers), drawing on a blank page (sketches) and exploring frames (Framing stage) are separate features with separate storage, although a user moves between them in one thought.
2. **Everything hangs on a shot.** A floor plan or a marked-up photo cannot exist without one.
3. **Two coordinate spaces and step ranges** exist to make marks follow a progression. They make every layer a small program and are the reason bakes go stale.
4. **The bakery is a background system** with hashes, stale states and failure waits, needed only because one layer can show on many steps through many frames.
5. **View modes have five homes.**
6. **Browser only.** The editor is tied to the Studio's DOM; a tablet cannot draw.

## Proposal

### The canvas file

A **canvas** (working name, open question 2) is a file of a project. It stands alone; shots, timelines and folders reference it.

| Part | Meaning |
| --- | --- |
| Surface | Either blank with an aspect ratio, or a **base photo** |
| Layers | An ordered stack: drawing layers and adjustment layers, each with name, opacity, visibility, lock |
| Objects | What a drawing layer holds: today's shapes, plus a **placed picture** (a reference to a photo of the project with position, size, rotation and crop) |
| Frame | Only with a base photo, optional: the framing the canvas is seen through |
| Render | A flattened image of the whole surface, and a thumbnail (below) |

- **Blank:** a floor plan, a storyboard panel, a lighting diagram. Photos can be placed on it as objects.
- **Base photo:** the photo is the surface. Its angle of view (workshop 02) makes optics frames possible; a photo without one still takes aspect frames.
- A blank canvas can be given a base photo later and the other way round; the drawing stays where it is.
- The surface is bounded, not endless: that keeps thumbnails, renders and coordinates (fractions of the surface) simple.

### One space, no ranges

Everything on a canvas is positioned on its surface. There is no frame space and no step range: with steps gone (workshop 04), a mark belongs to one picture. If the frame is changed later, the drawing stays on the photo.

### Frames on a canvas

Framings stay what workshop 02 made them: small saved objects on a photo, free-form or from an optics preset, also created at capture (workshop 03). The canvas tool is where they are made and explored (open question 1):

- With a base photo, the tool lists the photo's framings. Each can be shown or hidden, in its own colour; that is today's Stacked. Two side by side is today's Compare.
- A frame is moved by dragging and changed by picking a preset or values and a focal length; saving makes or updates a framing on the photo.
- One framing can be chosen as the canvas's **frame**: the picture the canvas stands for. It is a reference and follows the framing's edits.
- There is no separate Framing app: framing a photo is opening it in the canvas tool.

### View modes

**Mask**, **Outline**, **Crop** and **Full** (workshop 00) are how a viewer shows something that has a frame. They are a choice of the window or screen looking at it, never stored in a file. One shared viewer component implements them for both clients. A thumbnail of a canvas with a frame is always Crop. Whether a timeline clip stores one is workshop 06.

### Render instead of bakes

Whoever edits a canvas uploads its render with the save, as sketches do today: the whole surface flattened (base photo, layers), plus a thumbnail. Viewers that cannot draw layers (the phone, a list, a shot's thumbnail) show the render and apply the frame themselves.

Because the render is the whole surface, changing or moving the frame never makes it stale. Only editing the canvas does, and that edit uploads a new one. The bakery, bake hashes and stale states go.

### The drawing model

Carried over: the shapes, stencils, eraser masks, the fixed palette, the look. Added: the placed picture. Everything is fractions of the surface, so it scales with any display.

### Browser and tablet

The file format and all geometry are shared code without any dependency on a renderer, as `packages/vocab/src/compose.ts` is today. Which of the three ways draws it on a tablet is chosen by a technical test at the start of the build (open question 3):

| Way | What it means | Main risk |
| --- | --- | --- |
| A. The browser editor embedded in the tablet app | One editor; the app shows it in a web view, as it does the map | Stylus feel and speed inside a web view |
| B. One model, two renderers | The app draws natively from the shared model | Two editors to build and keep in step |
| C. The tablet opens the Studio in its browser | No second client for drawing | The whole Studio shell must work with touch |

The phone only views (the render).

### Saving and editing together

Saving stays automatic and per layer, as today, so two people working on different layers do not overwrite each other. Live co-editing (seeing each other's strokes as they happen) is not part of the rebuild (open question 4).

### Tier

Core: a shot's content is often a canvas, and some pictures can only be drawn (workshop 04). This moves composition from "standard app" in workshop 00's candidates to core, and removes Framing as an app of its own from workshop 02.

### What goes

Layers and sketches as children of a shot, frame space and step ranges, bakes and the bakery, clip-owned layers and their promotion (workshop 06 decides what a clip does instead), the Framing stage, the Zoom sequence dialog, the sketch's free-text kind (a property now), view modes as stored or global settings.

## Handed to other workshops

- **06 (timeline):** what a clip references (a photo, a framing, a canvas) and whether it stores a view mode.
- **07 (organisation):** the canvas as a file type; kinds such as "floor plan" as a property.
- **UX workshops:** the tool itself (tools, panels, frame handling, tablet gestures).
- **Build:** the technical test for the tablet.

## Open questions

1. **Frames:** do framings stay saved objects on a photo that the canvas tool makes, shows and references, or do frames become objects inside a canvas only?
2. **Name:** canvas, or another word?
3. **Tablet:** which way is tested first?
4. **Editing together:** is per-layer saving enough, or is live co-editing expected?

## Decided

Nothing yet.
