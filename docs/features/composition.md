# Composition: steps, layers, bakes

From [epic #275](https://github.com/OpenClapper-dev/core/issues/275), building on steps ([#266](https://github.com/OpenClapper-dev/core/issues/266)).
A **shot is a composition**: its **footage** (the photos, through framings) shown at a series of **steps**,
with an ordered **stack of layers** drawn over (or under) it. A single shot has one step. A sequence shows what
the shot will look like in practice: a pan in steps, a zoom in steps, a light that moves from one place to the next,
a grade that changes over the day.

## Steps (`packages/vocab/src/steps.ts`, table `shot_steps`)

- A **step** shows one of the shot's **photos**, optionally through one of that photo's saved **framings**
  (a zoom step, [framing](rig-explorer.md)). `{ id, shot_id, ordinal, photo_id, framing_id | null }`.
- **A shot without stored steps shows its photos as steps.** Phone captures never create steps; the Studio does
  (the Compose stage below). "Reset to photos" deletes them all.
- Every surface iterates `stepsOf(shot)`, never `photos`: strips, hover scrub, the "i / n" and SEQ badges,
  Step-through on the phone, and the clips a sequence contributes to a cut. Photos stay the unit for capture,
  the cover (positions, filters, map pins) and the per-photo stages Framing and Position. Thumbnails that are not
  strips (map popup, Plan rows, Files, Trash) keep the first photo.
- **The frame a step is shown with** (`stepFrame`): its framing, else the photo's root. A deleted framing clears the
  reference (`SET NULL`), a deleted photo takes its steps; a framing edit shows in every step that uses it.

## Layers (`packages/vocab/src/layers.ts`, table `layers`)

| Property | What |
| --- | --- |
| kind | **drawing** (shapes, the drawing model of [compose](compose.md)) or **adjustment** (a look: exposure, contrast, saturation, black and white, tint, vignette, softness; it changes everything below it) |
| position | the stack order. Layers with `position < 0` sit **below the footage** (they only show where there is no picture: beyond the capture, Studio only), the rest above it; higher is on top |
| range | the steps it shows on: `null` = every step, else stored step ids. Explicit ranges need stored steps: giving a layer a range stores the photos as steps first |
| space | **frame**: shapes are fractions of the rig frame a step is shown with, so a mark stays put through a zoom or a pan (and stretches with a frame of another aspect); **photo**: fractions of one photo's pixels (`photo_id`), so it shows only on that photo's steps |
| opacity, visible, locked, name, description | the usual |

A layer with `timeline_id` + `clip_id` is a **timeline clip's own** (drawn over that clip only, [timeline](timeline.md)).
`layersAt(layers, step)` is the one rule both clients and the Worker use: visible, a shot's own, in range, on the
step's photo in photo space, bottom to top. At most 50 layers per shot.

## Bakes (`step_bakes`, R2 `bakes/<shot>/<key>-<hash>.<ext>`)

The phone never draws layers. For every step that shows layers, the Studio flattens the photo and the stack into
one **bake**: the photo at its stored size, then the layers above the footage (`renderStep` in
`apps/studio/src/compose/render.ts`). Being photo-sized, the phone frames it like the photo in every view mode.
Content beyond the photo is not baked (layers below the footage, shapes outside the picture).

- **Fresh or stale**: `bakeHash(step, layers)` hashes the photo, the step's frame and every layer the step shows
  (id, version, order). A bake stored with that hash is fresh; anything else is stale. A step without layers needs
  no bake: the photo is the picture.
- **The bakery** (`compose/baker.ts`): whenever the Studio is open it bakes the stale steps of the loaded shots in
  the background, one shot at a time (a failed shot waits five minutes). So a layer edit, a framing change, a
  merge or migrated data reach the phone without anyone opening the shot. Until then strips show the photo with
  a "◌" mark (Studio) or a "Layers not baked yet" tag (phone).
- **Approved shots only** (Library › Projects › "Phone images of compositions", `projects.bake_approved_only`, carried on
  every shot payload; vocab `bakeWaits`): the bakery skips shots that are not approved. Their steps show the photo
  with "Baked once approved" on the phone (the "◌" mark's tooltip says so in the Studio). Bakes made earlier are
  kept and shown while they still match; approving a shot bakes it at the next pass. Off by default.
- Bakes of steps that no longer exist are deleted (when steps are replaced and on every bake upload).

## Building a progression

- **Steps and layers on a shot**: the Compose stage (below). A zoom sequence = n framings of one photo (one per
  lens) and n steps; a light progression = drawing layers each on one step; a grade over the day = adjustment
  layers on chosen steps.
- **Make a sequence from timeline clips** (`POST /api/shots/:id/photos`, the **merge**): adjacent clips of a cut
  become one shot's steps. Clips of one shot keep their stored steps (and the layers on them); clips of several
  shots move their photos into the first clip's shot, appended in clip order, with their framings and photo-space
  layers (on every step from then on). A source shot left without photos is **deleted for good**: its sketches and
  its frame-space layers move to the target (the layers hidden, to switch on where wanted), since a photo-less shot
  in the recycle bin could not be restored to anything. The Studio confirms this first. A clip's own re-frame is
  promoted first so the step can reference it; its own layers become the shot's, on the clip's new step.
- **Extract as own shot** (`POST /api/shots/:id/photos/:photo/extract`): one step becomes a shot of its own, as a
  **copy**: the tags, description and state (name "… · photo n"), the photo row with its own R2 object (deleting
  either shot never touches the other), its framings, and the layers that step shows (each on every step of the
  copy); the step's framing becomes the copy's root. No link back. The bakery bakes the copy.

## Studio: the Compose stage (`apps/studio/src/compose/ComposeStage.tsx`)

Shot view → stage **Compose** (`C`; route `#/shots/<id>?stage=compose`). The inspector is replaced by the
Layers panel; the step on stage is the inspector's photo when you go back.

- **Stage**: the step composed live (`compose/stack.tsx`): adjustment layers are `backdrop-filter` elements, drawing
  layers SVG in their space, in the window's frame mode. With a drawing layer selected that shows on this step (and
  is not locked) the stage is its drawing surface: the compose tools (V P L A R O T S E, colours 1–0, ⌘Z) in the
  bar, the other layers as the background.
- **Foot**: the **step strip** (`,` `.`; drag to reorder; a crop glyph marks a framing; each thumb is the step's
  bake), **+** (a copy of this step, after it), **Zoom…** (below), **Reset to photos** (confirms), then the
  **sketches** of the shot and **+ Sketch**.
- **Panel**: the **Layers** list top to bottom with the **footage row** in it (the step on stage); each layer with
  its eye, kind, a badge for its range ("this step", "n steps", "not here", "no step") and glyphs for photo space
  and lock; **+ Drawing**, **+ Adjustment** (a new layer on top, every step, frame space). The selected layer:
  name, opacity, up / down in the stack (past the footage: under the photo), lock, delete, **Anchored to** Frame ·
  Photo, **Shows on** Every step · This step · Chosen steps (chips per step), its **Look** (adjustment) or **Shape**
  section (drawing), and a Markdown description. The footage row shows the step: its photo and framing, earlier /
  later, remove, **Extract…**.
- **Saving**: everything saves on its own: steps 600 ms after the last change (the PUT replaces the whole list),
  each layer 900 ms after its last change, a sketch 1.2 s after its last stroke (with its render); leaving the
  stage or the shot sends what is pending. A shot without stored steps starts from its photos; the first change
  to the steps (or a layer range) stores them.
- **Zoom…** (`ZoomSequenceDialog.tsx`): a rig, the lenses to tick (presets inside the rig's range plus the photo's
  own and custom mm), the direction (in: wide → tight, or out), and a preview at the photo's root centre. Adds one
  saved framing per lens (an identical one is reused) and one step each; without stored steps the zoom replaces
  the implicit photo list, otherwise it is appended.
- **From timelines** (bar): re-frames, layers and sketches made in the project's timelines for this shot, with
  **Make the shot's** (a clip's layer becomes the shot's on the clip's step).

Elsewhere the Photo stage composes the step live too, and strips, cards, scrub and badges count steps and show
their bakes.

## Timeline

- A sequence dropped into a cut contributes **one clip per step**; a stored step becomes the clip's `step_id` (its
  layers come along) and its framing the clip's presentation framing. "Restore all photos" matches clips to steps
  by step.
- A clip's **Shows** select picks the step of its photo it shows (or the photo with the layers on every step).
  Its **own layers** (Layers, `C`) go on top, edited inline with the same layer list and settings.
- **Sequence layers** (`Shift+C`, in a block's Sequence section): the **shot's** layers edited inline on the
  timeline stage, the same list as the Compose stage. A change shows on every clip of the shot at once. Shows on
  offers Every step, and This step when the clip shows a stored step; chosen steps are picked in the Compose stage.
- **Shift-click** range → **Make a sequence…**, and **Extract as own shot…** in the clip menu, as above. Details in
  [timeline](timeline.md).

## Phone

Read-only: the phone never draws a layer. `steps(shot)` drives Shot details, History, Step-through, the strip and
the SEQ badges; a step shows its **fresh bake** (the offline copy first), else the photo with "Layers not baked
yet" while the Studio catches up. "Step i / n" once the Studio stored steps, "Photo i / n" for a plain capture
sequence. Offline days and projects download the fresh bakes with the photos and sketch renders.

## Migration 0030 (from overlays)

Overlays (issue #12) were drawings with a look over one photo, shown one at a time. Migration 0030 copied them:
each became a drawing layer (same id, photo space) and, when its look changed the photo, an adjustment layer below
it. A shot without stored steps that had overlays got stored steps (each photo, then one step per overlay of it),
and each overlay's layers show on its step; in a shot with curated steps an overlay shows on the steps that showed
it, or on none (it waits in the list). A clip that showed an overlay points at its step, or got the layers as its
own. The old `overlays` table and its renders stay, unread, until a later release drops them.
