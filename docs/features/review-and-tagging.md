# Review and tagging

## Tags on a shot

All optional, editable at any time (`PATCH /api/shots/:id`). The vocabularies are in `packages/vocab/src/vocab.ts`.

| Tag | Values |
| --- | --- |
| Name | free text, max 120 |
| Location | a named place of the shot's project (no district); created from the tag form by typing a new name |
| Spot | a place within the location (the north gate, the roof); offered once a location is set, created the same way, cleared when the location changes |
| INT/EXT | `int`, `ext` |
| Light | any subset of `dawn`, `day`, `dusk`, `night`: every phase the shot works in. Plus the separate **Artificial** flag (lit artificially, independent of INT/EXT; an INT shot looking out of a window can still need dusk). No phase set means any time works. Display via `lightLabel()`, e.g. "Dusk / Night + Artificial". |
| Weather | `none, sunny, partly_cloudy, cloudy, rainy, stormy, foggy, snow` |
| Shot size | one of `ews, ws, mws, ms, mcu, cu, ecu` (Extreme wide … Extreme close-up; lists show the abbreviation) |
| Camera support | one of `static` (locked-off) `, handheld, steadicam, gimbal, dolly, slider, crane` (jib) `, drone, vehicle` (mount) |
| Movement | any subset of `pan, tilt, push_in, pull_out, tracking, pedestal` (boom) `, orbit, zoom`. Support and movement are separate on purpose: a Steadicam shot can pan and push in. `cameraLabel()` gives "WS · Steadicam · Pan / Push in". |
| Extra | the project's [extra fields](extra-fields.md) |

The light model feeds the [schedule](schedule.md): phases are defined by sun elevation.

## Metadata board (Studio)

**Metadata** (`MetadataPage.tsx`, route `#/metadata/<field>`, issue #42; its own app on the desktop) sets one single-value field on many shots by drag and drop, kanban style.

- **Head**: the **field** (Location, INT/EXT, Weather, Shot size, Camera support, Review state; multi-value fields and extra fields are not offered), the state filter and search (remembered per browser in `localStorage["metadataBoard"]`), and "n without … · m shots".
- **Left** (a resizable panel): the shots **without a value**, as cards (hover scrub on sequences); the list empties as you sort. For the review state it holds the unreviewed shots.
- **Right**: one **column per value** with its shots and a count. Location columns are the locations the project's shots use, plus columns added with **Add a location** (pick or create; remembered per project in `localStorage["metadataColumns.<projectId>"]`, closable while empty). The vocabularies give the other fields' columns; the review state has Approved and Archived.
- **Layout** (head, remembered with the filters): the values as **columns** (side by side) or **rows** (stacked, the cards running sideways and sized by the row height), each in **S · M · L** (columns 200 / 260 / 340 px wide, rows 190 / 260 / 360 px high; the board scrolls) or **Fit**: every lane shares the board, so it never scrolls (a short row shows the covers only).
- **Drag** a card onto a column to set the value, onto another column to change it, back to the left list to clear it (review state: back to review). Each drop saves at once (`PATCH /api/shots/:id`) with Undo in the toast. Double-click opens the shot view.

## Shot view (Studio)

The shot view (`ShotView.tsx`) is the **Shot** app on the desktop (`apps/ShotApp.tsx`): one window per shot, so two shots can sit side by side (opening a shot that is already open focuses its window). It keeps the list it was opened from (the Gallery's result, the map, Plan, Timeline or ⌘K); ←/→ move this window on to the next shot, and from a deep link without a list they walk the project's shots, newest first.

- **Toolbar**: back (Esc) closes the window and focuses the one it was opened from, "7 of 212" with the list's description (state · view or project · sort), and ←/→; the **stage switch** Photo · Framing (`R`) · Compose (`C`) · Position, and the frame-mode switch (hidden in Compose, where the overlay's own presentation applies). The frame mode starts from the global mode; a change sticks for ←/→ until the window closes (`frameMode.ts` holds the global one). `M` cycles it.
- **Stage**:
  - **Photo**: the photo as large as fits, with prev/next buttons beside it and nothing drawn over the picture (rig and lens are in the inspector). The foot has the photo strip for sequences (`,` `.`) and the actions Download crop (cropped in the browser), Original, Show on map, and Delete (confirm dialog, offering Archive instead).
  - **Framing**: re-frame the photo, saved framings, the root frame ([framing](rig-explorer.md)).
  - **Compose**: overlays and sketches ([compose](compose.md)); the inspector is replaced by the compose panel.
  - **Position**: the [position correction](positions.md) map.
- **Inspector** (`Inspector.tsx`, 380 px, scrolls on its own):
  - the name, state marker and a summary line
  - the decision buttons: unreviewed → Approve (`A`) · Archive (`E`); approved → Back to review · Archive; archived → Back to review · Approve. A toast confirms, with **Undo**.
  - **Tags**, edited in place and **saved per change**, with a status (Saving… · Saved · Not saved + Retry):
    - Project: a combobox; "Create “…”" makes a new project and moves the shot there (an existing name is taken, not duplicated). When moving the shot would take it off shooting days, a warning names how many, and Move confirms.
    - Name: saved on Enter or leaving the field; Esc reverts.
    - Location: a combobox, "Create “…”" makes a new one.
    - Spot: a combobox of the location's spots ("Create “…”" too); "Pick a location first" without one.
    - INT/EXT: INT · EXT · –.
    - Light: chips plus Artificial.
    - Weather: a combobox.
    - Shot size and Support: comboboxes; Movement: chips (any number).
    - Extra fields: saved 0.7 s after the last change.
  - **Description**: a Markdown field ([compose](compose.md)), saved 0.7 s after the last edit or on leaving it.
  - **Compose**: the names of the shot's overlays and sketches, with Open (`C`).
  - **Position** of the photo on stage, with "Correct", and the switch "Use the location's position" ([positions](positions.md)). A photo captured without GPS says "No position · captured without GPS" and offers "Set position" (the same map stage, starting at another photo of the shot or Berlin).
  - **Shot**: captured, photos, uploaded, the **shooting days** it is planned on (link to Plan) and the **timelines** it is cut into (link to Timeline).
  - **Camera** of the photo on stage: rig, the frame shown (root framing or As captured, and how many framings), body, format, sensor, lens + FF-equivalent ("· vignetting" when the rig darkens the corners at it, [framing](rig-explorer.md#vignetting-issue-266)), FOV, time, GPS accuracy, fix age and altitude, phone.
  - **Raw metadata**: collapsed, with Copy.
## Reviewing

Reviewing is finding the shots that carry a sequence. On the Studio it happens in the [Timeline](timeline.md) (issue #48 merged the former Review page into it): the cut on stage, the shot browser beside it, decisions on browser cards, clips and the whole cut. The Gallery's state switch counts the unreviewed shots.

## History on the phone

The **History** tab (`screens/History.tsx`, was Review until issue #48) steps through the project's shots one at a time (queued ones included, newest first; the header button switches to oldest first and starts at the top of that order, remembered in `reviewOrder.v1`), photo first, with the decisions at the thumb. **All shots · To review** (remembered in `historyFilter.v1`) narrows it to the unreviewed queue; the tab badge counts the unreviewed shots either way:
- The photo spans the width (up to 262 dp), with the SEQ badge and "Photo i / n" for sequences and the photo strip under it. **Swipe** on the photo = next/prev shot; the strip moves between photos. **Double-tap** opens the photo full screen (mode switch on an opaque card; swipe = photos).
- The frame-view switch (remembered in `reviewMode.v1`).
- The summary:
  - the name (or the rig when untagged), the state and location
  - the tags line and the extra fields
  - rig · lens · capture time
  - **Edit** (pencil) opens the edit sheet: the same tag editor as after a capture, Save pinned; a failure keeps the sheet open with the error.
  - **⋯** opens Shot details, Show on map, Correct position and Delete (a confirm with **Archive** as the safe alternative).
- **Pinned**: Prev · "n of m" (with the order under it) · Next, then the two states the shot is not in (unreviewed → Archive | Approve; approved → Back to review | Archive; archived → Back to review | Approve). A decision shows "Approved · Undo" (4 s) and moves on to the next shot; in To review the decided shot leaves and the next takes its position.
- States: skeleton while loading; "No shots yet", or in To review "Nothing to review" with the project's totals and **Show all shots**; a load error with Try again (pull to refresh too). Offline: the banner; decisions and edits still work and are kept on the phone until they can be sent ([offline](day-mode-offline.md)).
- Landscape: the photo fills the left with the mode switch floating on it; a 292 dp side panel holds the strip, the filter, the summary and the decisions at the bottom.

**Shot details** (Shots → a shot, or ⋯ → Shot details; `screens/ShotDetails.tsx`) is a full screen:
- the photo (swipe = the neighbours in the list it was opened from), strip and frame view
- the summary, the **description** (when set) and the **overlays · sketches** strip ([compose](compose.md)), **Tags** with Edit, **Position** per photo (coordinates, ±accuracy or "corrected") with Show on map and Correct, **Camera** per photo, and **Raw metadata** (expands)
- ⋯ holds Delete (Discard for a queued shot; deleting an uploaded shot needs a connection)
- Pinned: the two states that aren't the current one (unreviewed → Archive | Approve; approved → Back to review | Archive; archived → Back to review | Approve)

## Buttons ([design](../design.md))

- Action buttons are rounded rectangles and carry an icon.
- Tabs, segmented switches and chips are pills; the selected one is filled, bold and checked.
- Approve is green. Archive and Back to review are neutral grey with a border. Secondary actions are outlined. Delete is a red outline (solid red only inside a confirmation).
- Mobile `Button` kinds: `primary | approve | archive | secondary | ghost | danger | dangerSolid` (solid red only inside a confirm sheet).

## Tag editing UI

- **Studio**: the inspector (above). The combobox (`ui/Combobox.tsx`):
  - Type to filter; matches at the start rank first. The typed text is marked in yellow in each match (also in ⌘K).
  - The list takes the width of its options; when that would spill past the right edge of its panel, it opens from the input's right edge.
  - ↑/↓ move, Enter or Tab take the highlighted entry (Tab also moves on), Esc cancels.
  - "Create “…”" makes a new location.
  - The same combobox is used for the project box, rig and format pickers, and the filter builder's single values.
- **Phone** (`components/TagEditor.tsx`, one editor for Tag, the History edit sheet and the Shot-details edit):
  - Name, INT/EXT (segmented) and light (chips + Artificial) are edited in place.
  - A **Camera** section: Shot size and Camera support are rows that open a sheet (support carries LAST: it usually stays for a while; size and movement are not remembered), Movement is chips (any number).
  - Location, weather and every extra field are 64 dp rows (`FieldRow`) showing the value, the LAST tag (kept from the last capture) and a chevron; a tap opens a focused sheet:
    - **Location**: search auto-focused; "Create “…”" first when the name is new; with an empty query the last used first, then by shots there.
    - **Spot** (indented under Location, once one is set): the same sheet for the location's spots. LAST carries over when the remembered location does.
    - **Weather**: a 2-column grid.
    - **Extra fields**: `OptionSheet` (chips up to 12 options, a search list above, checkboxes + "Done (n)" when several are allowed); numbers and text in their own sheet; booleans as a switch row.
  - Groups expand in place (20 dp indent per level); a filled group starts collapsed showing its summary.
  - A dependent select that a parent change cleared shows "Pick again" until chosen.

## View modes (how the rig frame is drawn on a photo)

`mask` (neutral dark mask outside the frame), `frame` (border only), `fit` (crop to exactly the frame), `raw`.

- **Fit** always shows exactly the rig frame. Where the rig saw more than the phone (fraction > 1) the rest stays black, like the live view (`frameLayout` in `apps/studio/src/format.ts`, `FramedImage.tsx` on the phone).
- **Studio**: the Shots toolbar switch sets the global mode (`localStorage["maskMode"]`) for the grid, list, map, Plan and the Timeline browser's thumbnails. The shot view has its own switch (above).
- **Phone**: History, Shots (shared by grid and map) and step-through remember their own mode (`reviewMode.v1`, `shotsMode.v1`, `stepMode.v1`); Shot details starts from the Shots mode.
