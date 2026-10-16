# Timeline

Second half of [GitHub issue #12](https://github.com/bubulux/fielder/issues/12). A **timeline** is a rough cut of a project out of its scouted photos: clips in order, each with a hold time ("Vorstopp"), played back to see which shots carry a sequence. Dashboard only; the phone does not read timelines. The shot browser beside the cut makes it the place to review too (issue #31; issue #48 merged the former Review page into it).

## Model

A project has any number of named timelines. A **clip** holds:
- one **photo** (of a shot in the project); a sequence contributes one clip per photo, grouped as a **sequence block** (below)
- optionally one **overlay** of that photo ([compose](compose.md)): the clip then shows the overlay's render instead of the photo
- a **presentation** (frame mode plus the rig frame, the same shape as an overlay's), so the same photo can appear raw, framed or fitted, with any rig and lens
- `duration_ms` (100 ms .. 1 h), entered in seconds with one decimal
- notes

The timeline can **lock a presentation mode** (`lock_mode`): every clip then shows in that mode, in the preview, strip and clip panel, and the clip's own presentation controls are inert (its stored presentation is kept and returns on unlock).

### Sequence blocks (issue #37)

A sequence added to a cut (dragged in, "Add to timeline", the Add shots panel, or dropped onto a placeholder) is **one block**: its clips stay together in photo order. In the strip a solid band (SEQ · n · name · length) spans the block and its clips are capped in the same colour; each clip shows "2 / 4". The block moves as a whole (drag the band or any of its clips, `Alt+←/→`, Move earlier/later), and nothing can be dropped inside it (the drop moves to its nearer edge). Each photo stays its own clip for framing, overlay, notes and inline editing.

- **Length**: **Per photo** (each photo its own hold time, the block is the sum) or **Total**: one length split across the photos, **Even** or **Edges** (the first and last photo get *w* shares, the rest one; the edge weight 1–3×, default 1.5×, is per block). Shares are in 100 ms steps, the remainder goes to the last photo, every photo keeps at least 100 ms. Switching to Total starts from the block's current length. In Total the photos' hold-time fields are read-only.
- **Remove** on a block's clip drops just that photo (the split recomputes); **Restore all photos** brings removed ones back in order. Settings → Timeline → "Removing a sequence's photo" can make Remove take the whole sequence.
- **Duplicate** on a block's clip duplicates the block. **Ungroup** turns it into loose clips that keep their hold times.
- A sequence **dropped onto a placeholder** fills it as a block in Total mode at the placeholder's hold time (the first clip keeps the placeholder's notes and sketch).
- Clips added before blocks existed stay loose.

A **placeholder** clip (issue #31) has no photo: it reserves time for a shot that does not exist yet, carrying a title ("Wanted shot"), the hold time and notes. It renders as a dashed block in the strip and the preview, plays like any clip, and is filled by dropping a shot onto it (the hold time is kept). A placeholder with a sketch is a **sketch clip**: "Sketch it" draws the wanted shot right on the stage.

### Timeline-scoped edits (issue #31)

Changes made to a clip in the timeline belong to the timeline, like in a video editor; the shot is only touched when an edit is **promoted**:
- **Re-frame**: the clip's own presentation gets the frame (rig + lens give the size, the drag gives the centre; no saved framing on the photo). The clip panel marks it "This clip's own re-frame".
- **Overlay**: drawn inline, it belongs to the clip (`overlays.timeline_id` + `clip_id`). Editing a *shot* overlay inline edits a copy for the clip; the shot keeps its own. "Show as" lists the clip's own overlays and the shot's.
- **Sketch**: a sketch clip's sketch belongs to the clip. When a shot fills a sketch clip the clip keeps the sketch; its panel then offers **Attach to shot** (the sketch becomes that shot's).
- Promotion of re-frames and overlays is in the shot view (Framing / Compose → **From timelines**, see [framing](rig-explorer.md) and [compose](compose.md)). Shots never show clip-owned overlays or sketches, and the phone never sees them.
- **Duplicate** (a clip or a whole timeline) copies the clip's own overlay and sketch, so the copies never share a drawing. Removing a clip deletes them.

The same photo can be in a timeline several times. Deleting a shot removes its clips everywhere (the shot's delete dialog says "Used in n timelines"); deleting an overlay keeps the clip, which then shows the photo as is. A shot moved to another project leaves that project's timelines, like it leaves its shooting days.

## Using it (`apps/dashboard/src/Timeline.tsx`, route `#/timeline/<id>`)

On the desktop Timeline is one window (`apps/TimelineApp.tsx`) for all of the project's cuts; the cut is picked in its rail, and a deep link, the inspector's "open in timeline" or ⌘K switch that window to the cut (and the position). It is a single window on purpose: the page keeps its own copy of every timeline, so a second window could overwrite the first one's autosave ([known issues](../known-issues.md)). Closing it while the last save failed asks first. The stage height follows the window, and the stage grip stops at the window's bottom.

- **Left**: the project's timelines with length and clip count; **New** (`⇧N`) makes "Cut n"; right-click for Rename, Duplicate (copies the clips' own drawings too), Delete. The rail **collapses** to a strip of numbered buttons (remembered).
- **Head**: name, total length, the **Presentation lock** ("Per clip" or one mode for all), **Review**: "Approve all · n" while shots in the cut are unreviewed (approves those), else "Back to review · n" for the approved ones (archived shots are left alone; one bulk request, Undo in the toast), save status, menu (Rename…, Delete timeline…). Changes **autosave** 600 ms after the last edit and at once when leaving the page; the server's answer replaces the clip list, so clips of deleted photos disappear on the next save.
- **Preview**: the selected clip, large, in its presentation (the overlay's render when one is chosen; a sketch clip's sketch on white). The stage keeps **one height** for every clip (`--tl-stage-h`): shots, sketches and placeholders letterbox into it, so the layout never jumps. The grip under the stage **resizes** it (remembered per browser in `localStorage["timelineStageH"]`; double-click goes back to the default, which fills the window). Transport: first · previous · **Play/Pause** (`Space`) · next · last, the playhead clock over the total, "clip n of m · 3.0 s", **Placeholder** (`P`) and **Shots** (`N`: the browser ⇄ the clip panel).
  Playback steps through the clips at their hold times (100 ms ticks) and stops at the end; Play at the end starts over.
- **Strip**: one block per clip, its width proportional to the hold time (44 px a second by default; zoomed out a clip keeps at least 20–64 px), with a thumbnail (a photo clip's carries its shot's state marker), the shot's title (and photo number for sequences; a layers icon marks an overlay) and the hold time. Placeholders are dashed. A ruler labels the time (the spacing adapts to the zoom); **dragging along the ruler scrubs** (the preview follows; playback, if running, continues from there).
  - **Zoom**: Ctrl/⌘ + scroll over the strip zooms around the pointer; the bar above has −, a slider (double-click: default), +, and **Fit** (the whole cut in the width). Remembered in `localStorage["timelineZoom"]`.
  - **Playhead**: one red line across ruler and clips with a **knob above the strip**; drag the knob to scrub.
  - **Height**: the grip under the strip sets the thumbnail height (double-click resets; `localStorage["timelineStripH"]`). Click selects, double-click opens the shot view with the timeline's shots as its list, right-click opens the clip menu (Re-frame, Overlay or Sketch it, Approve / Archive / Back to review for the clip's shot, Open shot, Duplicate, Remove). **Drag a clip** to reorder (an accent line marks the drop position); shots drop in from the browser.
- **Clip panel** (right, for the selected clip, `N` switches to the browser; a block's clip adds the **Sequence** section: length mode, total, split, edge weight, Restore all photos, Ungroup; the drawer is **resizable**, its width is remembered): the clip tools **Re-frame** (`R`) and **Overlay** (`C`), see Inline editing; thumbnail, the shot's **state** with its decisions (issue #35, Undo in the toast), **Hold time** (−0.5 s · field · +0.5 s; `D` focuses it), **Show as** (Photo as is, or one of the photo's overlays; picking an overlay adopts the presentation it was drawn in), **Presentation** (frame mode and a **Framing**: As captured or a saved framing of the photo, see [framing](rig-explorer.md); a clip follows its framing's edits and starts on the root), notes, Move earlier/later (`Alt+←/→`), Duplicate, Open shot (`↵`), Remove (`Del`). A placeholder's panel has the wanted-shot title, **Sketch it** (`C`), hold time and notes instead; a sketch clip's shows the sketch and **Edit the sketch**.
- **Inline editing** (`ClipEditing.tsx`): the clip tools put the editor **on the stage** and the settings in the drawer. Re-frame: drag the frame on the stage, rig and lens in the drawer (⇧ + arrows nudge, ←/→ lens, "Start from" a saved framing, "Back to the root frame"). Overlay and sketch: the drawing canvas on the stage, the tool bar, look and shape sections in the drawer (the compose keys apply: V P L A R O T S E, 1–0, ⌘Z). Drawings **save on their own** 1.2 s after the last change and when the edit ends (Done or Esc); "Delete overlay…" / "Back to a placeholder…" remove the clip's own drawing. While editing, the editor owns the keys (a modal scope in the [shortcut registry](../shortcuts.md)) and the playhead is **pinned** to the clip, or, with Settings → Timeline → "Leave ends the edit", selecting, stepping or scrubbing away ends the edit first. With Settings → Timeline → **Open overlays right away** (issue #51, off by default), landing on a clip that shows an overlay opens it in the inline overlay editor without `C` (not during playback; after Esc it stays closed until you move to another clip), and moving away always ends the edit.
- **Shot browser** (right, a resizable drawer; the default when no clip is selected). Shots added from it start at 3.0 s (a sequence as a block, Per photo) in the view's current frame mode with the rig the photo was shot with.
  - **Cards**: cover in the global frame mode, SEQ · n on sequences top left like the gallery, state marker top right, name, location · photos · overlays), two per row or **one per row** for bigger covers (the switch in the head), filtered by state ("To review + Approved" by default), location, **timeline** (in this timeline or not) and a search field, newest first. The layout and filters are remembered per browser (`localStorage["reviewBrowser"]`), so they survive leaving the page; a remembered location of another project shows as All locations.
  - **Hover scrub** (issue #39, like Resolve): moving the mouse across a sequence card shows the photo under the pointer (n equal zones, left = first) with a red line and "3 / 7" next to the SEQ badge; leaving shows the cover. The photos preload on the first move. Same on the Shots grid (`ScrubCover` in `ShotCard.tsx`). Dragging the card still adds the whole sequence.
  - **In this timeline** (issue #35): a badge next to the state marker (top right) marks the shots the cut on stage uses, with "×n" when it is used more than once (a sequence block counts once). A shot counts when any clip uses it: a clip of any of its photos (with or without an overlay) or a sketch clip showing one of its sketches. Clicking the badge selects the shot's first clip (a block's first) in the strip, and each further click the next use; the browser stays open. "New shot" opens the [New shot](new-shot.md) dialog. Click selects (`A` approve / `E` archive then act on it, with an Undo toast), double-click opens the shot view, the card's foot always shows the two decisions the shot is not in (Approve green, Archive / Back to review grey), right-click offers Add to timeline, Approve/Archive/Back to review, Open shot, Show on map.
  - **Drag and drop**: drag a card into the strip (an accent line marks the insert position, never inside a sequence block; a sequence comes in as a [block](timeline.md)) or **onto a placeholder** to fill it — the hold time and notes stay; a sequence fills it as a block split across that time. Dropping an unreviewed shot offers "Approve" in a toast: it earned its place. Clips reorder by drag too.
  - A shot dropped onto a sketch clip fills it; the clip keeps the sketch and offers **Attach to shot**.
- **URL**: `#/timeline/<id>?t=12.5&tool=overlay` keeps the playhead and the inline tool; reloading restores both (the tool only when it fits the clip under the playhead). On the desktop the position goes into the window's route, so the address bar shows it only while the Timeline window has focus, and a restored desktop brings it back.
- Keys: `←/→` clip, `Home`/`End`, `Space`, `Alt+←/→`, `D`, `Del`, `N` browser ⇄ clip panel, `P`, `R` re-frame, `C` overlay / sketch, `A`/`E` on the clip's shot (clip panel) or the browser's selection, `⇧N`, `↵`. `G T` goes to Timeline from anywhere.

The inspector's **Shot** section lists the timelines a shot is in (links).

## Storage

`timelines` + `timeline_clips` (`apps/worker/src/timelines.ts`), the clips' own overlays and sketches in `overlays` / `sketches` with `timeline_id` + `clip_id`, promotion in `promote.ts`. `PUT /api/timelines/:id` replaces the whole timeline; clips whose photo is not in the project are dropped silently, an overlay that does not belong to the clip's photo (or is another clip's) is nulled, and clips that leave take their own drawings along. See [api](../api.md) and [data model](../data-model.md).

The strip, preview, clip panel, playback and autosave live in `apps/dashboard/src/TimelineParts.tsx`; the page and the browser in `Timeline.tsx`.

## Not done

- No export (video or image sequence) and no transitions or audio: the timeline is for deciding, not for delivery.
