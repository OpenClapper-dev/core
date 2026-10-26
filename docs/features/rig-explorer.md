# Framing (re-framing and the rig explorer)

Studio shot view → stage **Framing** (`R`; `apps/studio/src/RigExplorer.tsx`; was "Rigs", [issue #29](https://github.com/OpenClapper-dev/core/issues/29)). The phone usually captures more than the rig frame, so a photo can be **re-framed**: another rig and lens (the size) at another place on the photo (the position). The inspector stays visible.

## Framings

- **As captured** is the frame the phone recorded (`photos.framing.frame`, centred). It always exists and is never changed.
- **Saved framings** (`framings` table, per photo): a name, a rig (or "as shot") + lens, and the frame with its centre (`x`, `y`, fractions of the photo).
- One framing per photo can be the **root** (`photos.root_framing_id`; null = as captured). Every view shows the root: grid, list, map popups, shot view, Timeline, Plan, Download crop, and on the phone Shots, History, Shot details, Day and step-through. Deleting the root falls back to as captured.
- Size comes only from a rig + lens, so a framing is always something the camera can shoot; there is no free crop. The centre is clamped so the frame stays on the photo; on an axis where the rig sees more than the phone (fraction ≥ 1) it cannot move at all.

## Using it

- **Bar**: Framing · Compare A / B · Stacked; the framing picker (As captured, the saved ones, "· root" marks the root); rig and lens pickers; "Edited" / "Not saved" when the frame differs from what is selected.
- **Stage**: the photo in Mask (or Frame) mode with the frame as a **drag handle**. Fit and Raw are not used here because they cannot show where the frame sits. `⇧` + arrows nudge by 1 %, `←/→` step the lens (the centre is kept, clamped to the new size).
- **Actions**: **Save as new…** (asks for a name), **Update** (`⌘S`) for a saved framing, **Set as root** (saves first when needed; "Root frame" when it already is), delete (confirms; overlays and clips keep their copy). For sequences, **All n photos** saves the same rig, lens and centre on every photo, each with its own size from its own capture.
- **Foot**: the facts (FF-equivalent, horizontal and vertical FOV, "sees more than this photo", "vignetting" when the rig darkens the corners at that lens, issue #266), a hint, and the **lens strip** with the frame at the current centre for every lens of the rig (a lens with vignetting is labelled in amber and its thumb shows the falloff).
- **Compare A / B**: two rigs side by side as before; A uses the current centre.
- **Stacked** (issue #47, `StackedFrames.tsx`): one photo with any number of rig + lens frames on it, each in its own colour (the fixed compose palette, so it reads on any photo; click a swatch for the next colour). **+ Frame** adds one (it starts as a copy of the last), × removes it. **Rig names** labels each frame with its rig and lens, at a chosen corner, inside or outside the frame. Frames share the Framing view's centre (clamped per frame); a frame wider than the photo shrinks the photo and draws dashed. Nothing is saved.
- Uploaded and drawn images ([new shot](new-shot.md)) have no rig: the stage says there is nothing to re-frame.

## Who uses a framing

- `frameOf()` on both clients returns the root (`rootFrame()` in `packages/vocab/src/framing.ts`); `frameLayout()` (Studio) and `FramedImage` (phone) place an off-centre frame and crop Fit around it.
- Overlay presentations and timeline clips pick a framing (As captured or a saved one) in a **Framing** select. They store `framing_id` and follow its edits, plus a copy of the frame that is used when the framing is deleted (`referencedFrame()`). New overlays and clips start on the root. Presentations from before #29 (a rig + lens without a framing) show as "Kept: …" until another framing is picked.
- **Timeline clips re-framed inline** (issue #31) keep their frame in the clip only (no framing on the photo). The Framing stage bar shows **From timelines · n** for the photo on stage: each such re-frame with its timeline and clip, and **Make the shot's** (asks for a name) turns it into a saved framing of the photo; the clip then references it. A re-frame identical to an existing framing (same rig, lens and frame) links that one instead of saving a twin.

## Vignetting (issue #266)

A rig can say how its lens darkens the corners per focal length (Library › Rigs › Vignetting, [capture](capture.md); `packages/vocab/src/vignetting.ts`, `apps/studio/src/vignette.ts`). Every `Framed` box draws the rig's vignette at the lens of the frame it shows, over the frame rect (the root framing's rig and lens, a saved framing's, a presentation's rig + lens, or the capture's), in Mask, Frame and Fit, never in Raw; the Framing stage shows it for the chosen rig + lens, Compare A / B per pane, the Timeline per clip. The shot view's toolbar shows an amber **Vignetting · n mm** chip on the Photo stage and the inspector's Lens line says "· vignetting", so nobody has to spot the corners.

## Math (`packages/fov-math/src/fov.ts`, tested)

A photo only stores what the phone saw. The phone's field of view for that photo is recovered from the rig FOV it was framed with and the **as-captured** frame fractions (`phoneViewFromFrame`, the inverse of `overlayRect`), whatever the root is. Any rig + lens is then sized on it with `reframe(source, sourceFrame, target)`. Portrait rigs swap axes (`fovOnPhoto`). The source rig comes from the photo's `framing` snapshot (`sourceRigOf` in `apps/studio/src/format.ts`), so it works even if the preset was deleted. A combination wider than the phone's view gives fractions > 1: the frame is drawn beyond the photo (dashed), it cannot move, and the facts line says "sees more than this photo".
