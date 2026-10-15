# Dashboard overview

Designed in Claude Design (2026-09-28): four sections plus a shot view, a sidebar instead of header tabs, keyboard first. The design exports are in the gitignored `references/dashboard/`.

## Shell (`apps/dashboard/src/App.tsx`, `Sidebar.tsx`, `router.ts`)

- **Sidebar**, 232 px, or a 56 px rail. Collapse and expand it with the button next to the brand (rail: at the bottom) or Ctrl B / ⌘B; the choice is remembered in `localStorage["sidebar"]`. Without a choice it is a rail below 1100 px. The scope menu opens as a fixed popup, so the rail does not clip it. It holds:
  - the **project switcher** (the projects, "Manage projects…"); the choice is remembered in `localStorage["project"]`. Every page works inside that one project
  - the sections: Shots (count), Timeline (unreviewed count), Metadata, Plan, Library (with Projects · Fields · Rigs · Locations · Viewfinder under it; [viewfinder layouts](viewfinder-layouts.md))
  - **saved views**, with a dot while a view has unsaved edits, and "+" for a new view
  - footer: "Go to…" (⌘K), the theme button (Auto → Sun → Set), **Settings** and reload
- **Hash routes**, so deep links survive a reload: `#/shots`, `#/shots?view=<id>`, `#/shots/<shotId>?stage=rigs|compose|position`, `#/metadata/<field>`, `#/plan/<dayId>`, `#/timeline/<timelineId>` (same `t` / `tool`), `#/settings`, `#/library/projects|fields|rigs|locations/<id>`.
- **Cut position** (issue #35): the Timeline keeps the playhead (`t`, seconds) and the inline tool open on the clip under it (`tool` = `reframe` · `overlay` · `sketch`) in the URL. They are written with `history.replaceState` 300 ms after the playhead or tool settles (so not during playback; no history entries, no re-render) and restored when the page opens; back from a shot view returns to the same spot.
- **Key hint bar** at the bottom: the shortcuts of the current screen; `?` opens all of them.
- **First run** (no project chosen, or it was deleted): a full-window project picker with "New project" (`ProjectGate` in `Projects.tsx`).
- **Installable (PWA)**: `public/manifest.webmanifest` (standalone, start `/`), icons in `public/icons/`, linked from `index.html` with `crossorigin="use-credentials"` so the manifest request carries the Access cookie. No service worker (nothing is cached offline; Chrome and Edge install without one). The `theme-color` meta follows the Sun/Set surface (`theme.ts`). Icons: `favicon.svg` (pixel-snapped for 16 px), `icon-192/512.png`, `icon-maskable-512.png`.
- **Dialogs** only for confirmations, name prompts, the command palette and the shortcut sheet (`confirmDialog`, `promptDialog`, `toast` in `ui/`). There are no `window.confirm`/`alert` calls any more.

## Sections

| Section | Files | What |
| --- | --- | --- |
| Shots | `ShotsPage.tsx`, `shotsQuery.ts`, `FilterBuilder.tsx`, `MapView.tsx`, `ShotCard.tsx` | Gallery, Views and Map merged: one filter model, three layouts (Grid · List · Map, remembered). See below. |
| Shot view | `ShotView.tsx`, `Inspector.tsx`, `RigExplorer.tsx`, `PositionEditor.tsx`, `compose/` | Replaces the dialog. See [review and tagging](review-and-tagging.md) and [compose](compose.md). |
| Metadata | `MetadataPage.tsx` | Sort shots into one field's values by drag and drop (issue #42). See [review and tagging](review-and-tagging.md#metadata-board-dashboard). |
| Plan | `Plan.tsx` | [Shooting days](schedule.md) |
| Timeline | `Timeline.tsx` | [Timelines](timeline.md): rough cuts with hold times and playback |
| Settings | `SettingsPage.tsx`, `settings.ts` | Preferences saved on change, per browser (`localStorage["settings"]`; theme and frame mode keep their own keys): theme, default frame mode, the review state of shots made with New shot (Approved by default), and Timeline → the playhead while a clip is edited inline (pinned, or moving away ends the edit) and what Remove takes on a sequence block's clip (the photo, or the whole sequence). Sidebar footer cog, or ⌘K → Settings. |
| Library › Projects | `Projects.tsx` | [Projects](projects.md): list with counts, detail with name, notes and ordered extra fields |
| Library › Fields | `Fields.tsx` | [Extra fields](extra-fields.md): list, JSON editor, live preview |
| Library › Rigs | `Rigs.tsx` | Rig table (body, format, sensor, speedbooster, lens range, shots) and an editor panel |
| Library › Locations | `Locations.tsx` | Filterable table, inline rename (F2), the pin (Set position `P`, a map dialog with the location's shots, see [positions](positions.md)), counts that open Shots filtered to the location, show on map, delete |

## Shots

- **Toolbar**:
  - title: "Shots", "All shots · all projects", or the saved view's name with an **Edited** marker and Save · Save as new… · Revert; the view menu has Rename… and Delete view…
  - **New shot** (`⇧N`): upload images or draw a sketch ([new shot](new-shot.md))
  - search (`/`) over name, location, rig and project
  - **Filter** (`F`) opens the rule-builder side panel (nested all/any groups over state, project, name, location, INT/EXT, light, artificial, weather, shot size, camera support, movement, has position, rig, lens, FF-equivalent, photos in shot, date and the extra fields; the model is `packages/vocab/src/filter.ts`)
  - the layout switch and the frame-mode switch (mask/frame/fit/raw, `M` cycles; global, `localStorage["maskMode"]`)
- **Sub-toolbar**: the state switch (All · Unreviewed · Approved · Archived) with counts **inside the current filter**, the active top-level rules as removable pills, the result count and the sort (newest, oldest, name).
- **Saved views** store the rule filter plus the state switch (as a leading "state is …" rule, `encodeView`/`decodeView` in `shotsQuery.ts`). Leaving a view with unsaved edits asks first. "Save view…" appears as soon as a filter has rules.
- **Grid**: cards with the framed cover, SEQ badge (top left; moving the mouse across a sequence card **scrubs** its photos, see [review](review-and-tagging.md)), state marker (top right), title, "place · INT/EXT · light", and the project tag in "All projects". Arrow keys move, Enter opens.
- **List**: a table with checkboxes (click, Shift-click for a range, `X`/`⇧X`; a range starts at the last toggled row, else the focused one, and takes that row's state, so it can also deselect), `J`/`K` to move, Enter to open; a selection bar offers "Select all", Clear (Esc), "Move to project…" (`⇧M`), "Edit…" (`E`) and "Delete n shots…" (with confirmation). Bulk edits go through `PATCH /api/shots` in one transaction and offer Undo in the toast (`BulkEdit.tsx`).
  - **Move to project…**: a dialog with the project picker (type a new name and pick "Create “…”" to make the project on the spot), where the shots are now, how many are already in the target, and a warning when shots leave shooting days of their project.
  - **Edit…**: a 500 px side panel "Edit n shots" with every field of the inspector: project (a new one can be created inline), name, review state, location (search or create), INT/EXT, light phases, artificial light, weather, shot size, camera support, movement, and the extra fields that every target project uses (the others are counted as hidden). Nothing changes until touched; a field where the shots differ says "Mixed · n values", and "Clear all" empties a field for every shot. An edited field gets an accent bar, a bold label, "Edited", a reset button and an "n of m change" button that opens the before/after dialog: each selected shot with its current value struck through and the value after apply (shots that already have the value are folded away, "Show unchanged shots" lists them). "Review" in the panel foot shows that dialog for all edited fields; "Apply to n shots" sends only the edited fields, for only the shots that change. The panel stays open on the selection afterwards, showing the new values.
  - While the panel is open, a row click selects instead of opening, so the selection can be adjusted with the diffs updating live. Esc (or the close button) closes it and asks before discarding edits.
  - Patch semantics: Light phases and Artificial are separate fields. An extra field is set per key; a group merges child by child (editing "Parking" keeps each shot's "Power"), and a changed parent drops dependent selects that no longer fit (`patchExtra` in `packages/vocab`).
- **Map**: the result list on the left and one state pin per shot (shots captured without GPS stay in the list as "No position · not on the map"); selecting a row focuses its pin and opens the popup (framed thumbnail, state, "Open details"). "Fit all" fits the pins. "Show on map" from a shot switches to this layout with the pin focused and the filter kept (cleared when the shot is outside it).
- States: skeleton cards while loading, "No shots in <project> yet" (switch scope), "No shots match" (edit or clear the filter), a load-error banner with Retry.

## Keyboard

Every shortcut is declared once in the registry `src/shortcuts.ts` (issue #32): scope, action, keys, label and the hint-bar text. Pages bind handlers by action (`useKeys(bind("timeline", { next, play, … }))` in `keys.ts`), so no page writes a key string. The `?` sheet, **Settings › Shortcuts** (`#/settings/shortcuts`, read-only, no rebinding yet), the hint bar and [docs/shortcuts.md](../shortcuts.md) are rendered from it.

- Single keys never fire while typing in a field. Plain letters step aside for 1.2 s after `G`, so `G T` on Plan or `G P` on the Timeline or Locations jumps instead of acting on the page (they used to collide).
- Each scope lists the scopes live with it (`SCOPES[id].with`); `pnpm -C apps/dashboard test` fails when a key does two things there, and when docs/shortcuts.md drifts. The drawing and re-frame editors on the timeline stage and the rig editor are modal: the page's keys pause while they are open.
- The audit's changes: Shots list bulk edit is `B` (`E` archives everywhere else); on the Timeline `A`/`E` act on the clip's shot while the clip panel shows, on the browser's selection while the browser does (separate scopes, so `D` and Del only work with the clip panel open, as before).

## Shared pieces

- `ui/`: the component library; pages build from it instead of writing `f-*` markup ([design](../design.md#dashboard-component-library)).
- `Framed.tsx`: a photo with its frame (optional frame override), also used in the map popup; `FramedThumb` is the map list's thumbnail.
- `format.ts`: `cover`, labels, frame geometry, `filterable(shot)`. `api.ts`: types and calls; a `401` reloads the page (Access login).
- Styles: design-system tokens and component classes in `ui/design/*.css` (the rework's additions, such as sidebar, toolbar, panels, tables, stage, plan grid, palette and JSON editor, are in `ui/design/dashboard.css`), the library's own additions in `ui/design/components.css`, page layouts in `styles.css`. See [design](../design.md).
