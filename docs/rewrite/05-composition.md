# 05 · Canvas (was: composition)

Workshop [#332](https://github.com/OpenClapper-dev/core/issues/332). Status: **decided** (2026-11-19; references to one frame and internal canvases added in the [interjection](i1-interjection.md); objects in one stack, comments and the look on photos from UX workshop [U2](ux-2-canvas.md), 2026-11-22).

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

A **canvas** is a file of a project. It stands alone; shots, timelines and folders reference it.

| Part | Meaning |
| --- | --- |
| Surface | Either blank with an aspect ratio, or a **base photo** |
| Surface colour | A blank surface has a colour |
| Objects | Everything drawn or placed, in **one stack**: pen strokes (several kinds of pen), lines, arrows, rectangles, ellipses, text, stencils, and **placed pictures** (a reference to a photo of the project). Each has a name, position, size, rotation, opacity, visibility and a lock. The order of the stack is the layering; there are no layer kinds |
| Groups | Objects can be grouped; a group moves and is layered as one |
| Look | Exposure, contrast, saturation and the rest are properties of a photo: the base photo or a placed one. There is no adjustment layer over everything |
| Comments | On a point or a region, with replies, open or resolved. Not objects, not part of the picture, never in a render |
| Frames | Only with a base photo, optional: any number of frames, one of which can be the picture the canvas stands for |
| Render | A flattened image of the whole surface, and a thumbnail (below) |

- **Blank:** a floor plan, a storyboard panel, a lighting diagram. Photos can be placed on it as objects.
- **Base photo:** the photo is the surface. Its angle of view (workshop 02) makes optics frames possible; a photo without one still takes aspect frames.
- A blank canvas can be given a base photo later and the other way round; the drawing stays where it is.
- The surface is bounded, not endless: that keeps thumbnails, renders and coordinates (fractions of the surface) simple.

### One space, no ranges

Everything on a canvas is positioned on its surface. There is no frame space and no step range: with steps gone (workshop 04), a mark belongs to one picture. If the frame is changed later, the drawing stays on the photo.

The one place where a drawing is laid over other pictures is a progression's overlay ([04](04-shots.md)): a canvas of its own, stretched over each item's picture. Inside any canvas there is still only one space.

### Frames on a canvas

A frame exists only inside a canvas that has a base photo. There is no framing as a separate saved object on a photo any more (this reopens workshops 02 and 03).

| Part of a frame | Meaning |
| --- | --- |
| Values | Free-form (the frame owns format, multiplier, squeeze, focal length, delivery aspect), or an optics preset plus one of its focal lengths; or an aspect ratio for an aspect frame (workshop 02) |
| Position, orientation | Where it sits on the photo |
| Name, colour | For telling several apart |

- A canvas can hold any number of frames. Showing several at once in their colours is today's Stacked; two side by side is today's Compare.
- One frame can be marked as **the picture**: what the canvas stands for in a thumbnail, a shot or a clip. Without one, the canvas stands for its whole surface.
- A frame is moved by dragging and changed by picking a preset or values and a focal length.
- An optics preset's lens counts as in use when a frame in any canvas of the project uses it (the additive rule of workshop 02 is unchanged). Frames are therefore stored where the server can find them, not buried in a drawing.
- "A photo through a frame" is a canvas with that photo as its base and one frame. There is no Framing app.
- **A reference can point at one frame of a canvas,** not only at the canvas. A shot's progression and a timeline can so show one canvas through several of its frames: a zoom, a pan or a tilt is one canvas with a frame per step ([04](04-shots.md)).
- A canvas can be an **internal file** of a shot ([I1](i1-interjection.md)): the canvas a framing series is generated into, and a progression's overlay. It is an ordinary canvas that is hidden from the file browser and lives with its shot.

**The frame from capture.** A photo taken with an optics frame on screen keeps that as a capture fact: the optics values, the preset's name and the focal length, copied, so it never blocks editing a preset. When such a photo becomes a canvas's base, the canvas starts with that frame. A user setting of the canvas tool, on by default, switches this off.

### View modes

**Mask**, **Outline**, **Crop** and **Full** (workshop 00) are how a viewer shows something that has a frame. They are a choice of the window or screen looking at it, never stored in a file. One shared viewer component implements them for both clients. A thumbnail of a canvas with a frame is always Crop. A timeline clip stores none ([06](06-timeline.md)).

### Render instead of bakes

Whoever edits a canvas uploads its render with the save, as sketches do today: the whole surface flattened (base photo, objects), plus a thumbnail. Viewers that cannot draw layers (the phone, a list, a shot's thumbnail) show the render and apply the frame themselves.

Because the render is the whole surface, changing or moving the frame never makes it stale. Only editing the canvas does, and that edit uploads a new one. The bakery, bake hashes and stale states go.

### The drawing model

Carried over: the shapes, stencils and the look. Added by [U2](ux-2-canvas.md): the placed picture, several kinds of pen, rotation, groups, any colour next to the predefined ones. Dropped there: drawing layers and adjustment layers, eraser masks on a shape. Everything is fractions of the surface, so it scales with any display.

Frames are not part of the stack. An object on or inside a frame is always the one that is taken; a frame is taken by its label or by its edge where no object lies.

### Browser and tablet

The file format and all geometry are shared code without any dependency on a renderer, as `packages/vocab/src/compose.ts` is today.

The first way to be tested is the embedded one: the tablet app shows the same editor the Studio uses, inside a web view, as it does the map today. The build starts with research into how established canvas tools (Figma, Miro and the like) get a fluid, interchangeable result on web and mobile, and into best practice for stylus feel and speed; the test then confirms or rejects the embedded way. The fallback is a native renderer on the shared model.

The phone only views (the render).

### One editor at a time

A canvas open for editing is read-only for everyone else, who see who has it. There is no merging and no live co-editing. The lock releases when the editor leaves or goes silent, so a tablet that crashed or lost its connection cannot block a file. Saving is automatic.

### Tier

Core: a shot's content is often a canvas, and some pictures can only be drawn (workshop 04). This moves composition from "standard app" in workshop 00's candidates to core, and removes Framing as an app of its own from workshop 02.

### What goes

Layers and sketches as children of a shot, frame space and step ranges, bakes and the bakery, clip-owned layers and their promotion (a clip carries nothing of its own, [06](06-timeline.md)), the Framing stage, the Zoom sequence dialog, the sketch's free-text kind (a property now), view modes as stored or global settings.

## Handed to other workshops

- **07 (organisation):** the canvas as a file type; kinds such as "floor plan" as a property.
- **UX workshops:** the tool itself (tools, panels, frame handling, tablet gestures).
- **Build:** the research and the technical test for the tablet; the edit lock.

## Decided

2026-11-19, by the owner (the direction of one file type and one tool was decided in [04](04-shots.md)):

- **The file type is called canvas.** Its surface is blank or a base photo; it holds drawing and adjustment layers and placed pictures; everything sits in one space on the surface.
- **Frames live inside a canvas only.** No framing as a saved object on a photo; a canvas holds any number of frames and one can be the picture. Workshops 02 and 03 are changed accordingly.
- **The frame from capture is a fact on the photo,** and a canvas on that photo starts with it unless the user switched that off (a setting, on by default).
- **Tablet:** the embedded editor is tested first, after research into how established tools achieve a fluid result on web and mobile.
- **One editor at a time:** others see the canvas read-only.

Taken from the proposal with the above: a render of the whole surface replaces bakes; view modes are a viewer's choice and never stored in a file; the canvas is core and there is no Framing app.

2026-11-19, in the [interjection](i1-interjection.md), by the owner:

- **A reference can point at one frame of a canvas.**
- **A canvas can be an internal file of a shot,** for a generated framing series and for a progression's overlay.

2026-11-22, in UX workshop [U2](ux-2-canvas.md), by the owner:

- **Objects in one stack, with groups,** replace drawing and adjustment layers. A look belongs to a photo.
- **Comments** on a canvas, on a point or a region. Commenting needs the edit lock like any change; only canvases have comments for now.
- **A blank canvas has no angle of view** and therefore no frames.
