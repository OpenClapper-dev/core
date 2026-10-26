# Sequences: steps, progressions, merge and extract

From [GitHub issue #266](https://github.com/OpenClapper-dev/core/issues/266). A **sequence** is a shot with
more than one picture, and its job is to show what the shot will look like in practice: a pan in steps, a
zoom in steps, a light that moves from one position to the next. Until #266 a sequence step was always a
captured photo, so only pans existed; a zoom was a row of framings and a light progression a row of overlays,
both only visible in a Timeline cut. Now a shot carries **steps**.

## Model (`packages/vocab/src/steps.ts`, table `shot_steps`)

- A **step** shows one of the shot's **photos**, optionally through one of that photo's saved **framings** (a
  zoom step, [framing](rig-explorer.md)) and optionally as one of its shot **overlays** (a light step, [compose](compose.md)).
  `{ id, shot_id, ordinal, photo_id, framing_id | null, overlay_id | null }`.
- **A shot without stored steps shows its photos as steps.** Phone captures never create steps; the Studio's
  Sequence stage does. "Reset to photos" deletes them all.
- Every surface iterates `stepsOf(shot)`, never `photos`: the photo strip, hover scrub, the "i / n" and SEQ
  badges, Step-through on the phone, and the clips a sequence contributes to a cut. Photos stay the unit for
  capture, the cover (positions, filters, map pins), and the per-photo stages Framing, Compose and Position.
  Thumbnails that are not strips (map popup, Plan rows, Files, Trash) keep the first photo.
- **The frame a step is shown with** (`stepFrame`): its framing, else the frame its overlay was drawn for (the
  overlay's presentation framing, or the copy kept when that framing was deleted), else the photo's root.
  **Its image**: the overlay's render when it has one, else the photo. The viewing surface's frame mode applies.
- **Deletes**: a deleted framing or overlay clears the reference (`SET NULL`) and the step falls through the
  order above; a deleted photo takes its steps. A framing edit shows in every step that uses it.
- `stepKey()` tells steps apart by picture (a photo may repeat in a progression), e.g. for a cut's "Restore all photos".

API ([api](../api.md)): every shot embeds `steps` (raw rows); `PUT /api/shots/:id/steps` replaces the list,
strictly (interactive edits): a photo of the shot, a framing of that photo, a shot overlay of that photo (a
timeline clip's own overlay is never a step).

## Building a progression

Three ways, two of them moving pictures between shots:

- **Steps on a shot**: the Sequence stage (Studio, below). A zoom sequence = n framings of one photo (one per
  lens) and n steps; a light progression = n steps on one photo, each showing another overlay.
- **Make a sequence from timeline clips** (`POST /api/shots/:id/photos`, the **merge**): adjacent clips of a cut
  become one shot's steps. Clips of one shot only need steps; clips of several shots move their photos into the
  first clip's shot, appended in clip order, with their framings and overlays. A source shot left without photos is
  **deleted for good** (its sketches move to the target, its day places and shortcuts go): a photo-less shot in the
  recycle bin could not be restored to anything, so the bin would promise an undo it cannot keep. The Studio
  confirms this first. Timeline clips of the moved photos leave their sequence blocks (a block holds one shot's photos).
- **Extract as own shot** (`POST /api/shots/:id/photos/:photo/extract`): one photo (or step) of a sequence
  becomes a shot of its own, as a **copy**: the tags, description and state are copied (name "… · photo n"), the
  photo row gets its own R2 object (one object per photo stays the rule, so deleting either shot never touches the
  other), its framings and overlays are copied with their renders, and the step's framing becomes the copy's
  root. No link back: from then on it is an ordinary shot, and the sequence is unchanged. Costs one image of storage.

## Studio, Timeline, phone

Built in the follow-up PRs of #266 (Sequence stage with "Zoom sequence…" and "From overlays", Shift-click
range + "Make a sequence…" in the Timeline, step-aware strips on the phone). Until then stored steps are
only reachable through the API.
