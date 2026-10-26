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

## Studio: the Sequence stage (`apps/studio/src/SequenceStage.tsx`)

Shot view → stage **Sequence** (`S`; route `#/shots/<id>?stage=sequence`). The inspector stays and follows the
selected step's photo.

- **Bar**: "Step i of n", then for the selected step the **Photo** (one of the shot's), the **Framing** (the
  root frame, or a saved framing of that photo; with an overlay the default is the frame the overlay was drawn
  for), the **Overlay** (Photo as is, or one of the photo's overlays), Move earlier / later (`Alt+←/→`), Remove
  (`Del`), **Extract as own shot…**, the save status, Back (`Esc`).
- **Stage**: the step large, in the window's frame mode.
- **Foot**: the **step strip** (`,` `.` select; drag a thumb to reorder, an accent line marks the drop; a crop
  or layers glyph marks a framing or an overlay), then **+ Step** (a copy of the selected step, after it),
  **From overlays · n** (one step per overlay of the selected photo, after it: a light progression),
  **Zoom sequence…** and **Reset to photos** (confirms; deletes every step).
- **Saving**: the list is a draft that **autosaves 600 ms after the last change and when leaving** the stage
  (`Mod+S` saves now), like a cut: the PUT replaces the whole list, so a retry is idempotent. A shot without
  stored steps starts from its photos ("Not stored yet"); the first change stores them.
- **Zoom sequence…** (`ZoomSequenceDialog.tsx`): a rig (As shot or a preset, default the photo's), the lenses to
  tick (the presets inside the rig's range plus the photo's own and any custom mm), the direction (zoom in: wide →
  tight, or out), and a preview strip of the frames at the photo's **root centre** (move it in the Framing stage
  first). Adds one saved framing per lens (an identical existing framing is reused, named like "6K FULL · 24 mm")
  and one step each. Without stored steps the zoom **replaces** the implicit photo list; otherwise it is appended.
  Lenses wider than the photo are allowed: the step shows the hatch beyond the capture.
- **Extract** (Photo stage foot, Sequence bar): confirms, then `POST …/extract` with the step's framing (which
  becomes the copy's root) and overlay; the new shot joins the lists and a toast offers **Open** (its own window).

Everywhere else in the Studio the strips, hover scrub and SEQ badges count **steps**: the Photo stage's strip
(`,` `.`), the Gallery's and the Metadata board's cards, the Timeline browser, the map and the list's badge
(the list's "photos" column stays photos). The inspector's Shot section says "n photos · m steps".

## Timeline (`apps/studio/src/Timeline.tsx`, `TimelineParts.tsx`)

- A sequence dropped into a cut contributes **one clip per step**: the step's framing becomes the clip's
  presentation framing (`framing_id` + the frame copy), its overlay the clip's overlay. "Restore all photos"
  matches clips to steps by what they show (`photo | framing | overlay`), so a repeated photo is told apart.
  The block band and the clip labels count steps ("2 / 4" is the place in the block).
- **Shift-click** selects a range of clips (whole blocks, contiguous; an accent ring); right-click in it →
  **Make a sequence… (n clips)**. One shot: `PUT …/steps` replaces its steps. Several shots: a confirm names
  the target (the first clip's shot) and the shots whose photos move into it, then `POST …/photos` merges and
  deletes the emptied sources. Before either, a clip's own re-frame or clip-owned overlay is **promoted**
  (`promote.ts`) so the step can reference a saved framing or shot overlay. The range becomes one block
  (per-photo lengths kept); the moved photos' clips in other cuts leave their blocks (the server nulls their
  `group_id`). Placeholders and sketch clips cannot be in the range; the menu item says why.
- **Extract as own shot…** in the clip menu: the clip's photo copied out with the clip's saved framing as root.

## Phone

Built in the last PR of #266 (step-aware strips, Step-through and badges). Until then the phone shows photos.
