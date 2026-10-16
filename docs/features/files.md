# Files and desktop icons

The desktop's explorer (epic #72): a project's shots, timelines, shooting days, saved views, locations and extra fields as **files** in **folders**, and **shortcuts** to files, folders and apps on the desktop. Folders, placements and shortcuts are stored on the server ([data model](../data-model.md), [API](../api.md)), so they are the same in every browser. Window layouts are per browser ([desktop](desktop.md)).

## Model

- **File types**: `FILE_RESOURCE_TYPES` in `packages/vocab/src/files.ts`: shot, timeline, day, view, location, field. `FILE_TYPE_META` names each type, its icon and the app that opens it. Spots live inside their location; rigs, viewfinder layouts and devices are shared by all projects, so they are apps, not files.
- **Folders** belong to one project and nest up to 8 deep. Names are unique within a folder (case-insensitive).
- **A file sits in at most one folder**; without one it is at the top level. There is no manual order inside a folder: Files sorts by name, date or type (remembered per browser).
- **The Desktop folder**: every project has one, at the top level, named "Desktop" (made by the Worker on first use; it cannot be renamed, moved or deleted). What is in it is on the desktop, as on Windows or macOS (epic #90).
- **Deleting moves to the recycle bin**, everywhere (Gallery, shot window, Timeline, Plan, Library, Files): see below. A shot moved to another project lands at that project's top level, without a shortcut.

## Recycle bin (epic #90)

- **Every delete bins** a file or folder instead of removing it: the server marks it (`deleted_at`) and every list leaves it out, on the phone too. A toast says so with **Undo** (6 s). Nothing asks first, except a shot that is used on timelines or shooting days: binning takes it off those now, and a restore does not put it back there.
- **A folder goes with its contents**: its subfolders and the files in them. The bin shows it as one entry with a count; restoring it brings everything back.
- **Recycle bin app** (`apps/TrashApp.tsx`, route `#/trash`): what is in the bin, newest first, with where each item was, when it was deleted and how long it stays. Restore (`R`, or double-click) puts items back where they were: at the top level when their folder is gone or in the bin itself; a name taken meanwhile gets " (restored)" (a field key `_restored`). Delete permanently (`Del`) and Empty the bin ask once and remove for good, images and drawings included. Click, Ctrl-click, Shift-click and `Mod+A` select.
- **Auto-purge**: after `TRASH_RETENTION_DAYS` (30) days the Worker's daily cron removes an item for good.
- **What comes back**: the file, its folder placement and its desktop shortcuts. Not a shot's clips on timelines and places on shooting days ([known issues](../known-issues.md)). While a location is binned its shots read as without a location; restoring it gives it back to them.
- **The phone never loses a capture**: an upload continuing (or retrying) a binned shot, and any edit to it, brings it back out of the bin.
- **Where it is**: an icon on the desktop (Settings › Desktop › Recycle bin on the desktop; on by default), and always at the bottom of Files' side bar. Both are drop targets: files and folders dragged from Files go to the bin; a desktop shortcut dropped on the bin icon is only removed (never its target). The icon shows full or empty, moves like any icon (its spot is per browser, `localStorage["desktop.bin.<projectId>"]`) and its menu has Open and Empty the bin.
- Open Timeline and Plan windows follow: a cut or day binned elsewhere leaves their list (the next one opens), a restored one comes back (`data.onTrash`).

## Files app (`apps/dashboard/src/apps/FilesApp.tsx`, route `#/files/<folderId>`)

- **Left**: the folder tree under the project's name (expand with the chevrons; the open folder's path stays expanded), then **All files**: every shot, timeline, day, view, location or field, wherever it sits, with counts.
- **Toolbar**: the path (each part is a link and a drop target), New folder (`⇧N`), search (this folder; tick **Subfolders** to search below it too, then each hit shows its folder), sort, List · Grid.
- **Rows**: a thumbnail for shots, the name and facts (shot: review state, photos, location; timeline: clips and length; day: date, title, shots; view: rules; location: spots, shots, pin; field: key, type, position), the type and the date. Archived shots are greyed.
- **Open** (double-click, `Enter`): a folder opens in place; a file opens in its app: a shot in a shot window, a timeline in Timeline, a day in Plan, a view in the Gallery, a location in Locations, a field in Fields.
- **Context menu**: Open · Rename… · Move to… (a folder picker) · Move to the top level · Move to the desktop · Create shortcut on the desktop · New folder inside (folders) · Move to the recycle bin. With several rows selected: Move to…, Move to the top level, Move to the desktop, Move to the recycle bin.
  - Rename works on shots, views, locations and folders (not the Desktop folder). Timelines and days are renamed in their own window: Timeline and Plan keep their own copy, which would overwrite a change made from outside ([known issues](../known-issues.md)). Fields are renamed in Fields.
  - Every file and folder can go to the recycle bin (not the Desktop folder).
- **Selection**: click, Ctrl/Cmd-click toggles, Shift-click extends, `Mod+A` takes everything listed. Move to…, Move to the top level, Move to the desktop, the recycle bin and dragging act on the whole selection.
- **Drag and drop**: rows onto a folder (in the list, the tree or the path) move them there; a folder can't go into itself. Rows dragged onto the desktop **move into the Desktop folder** (their icons land around the drop point); onto the recycle bin, they are deleted. The menu's "Create shortcut on the desktop" makes a shortcut instead and leaves the file where it is.
- Keys (`files` scope): `/` search, `j`/`k` or arrows move, `Enter` open, `Backspace` or `Alt ↑` up a folder, `F2` rename, `Delete` to the bin, `⇧N` new folder ([shortcuts](../shortcuts.md)).
- Files reads nothing of its own: it joins `/api/files` (loaded with the project) with the collections already loaded; timelines and days come from the same cached fetch as the inspector, refreshed when the Files window gets focus.

## Desktop icons (`apps/dashboard/src/wm/Desktop.tsx`)

- Icons dragged onto the taskbar are pinned there (they stay on the desktop too); see [desktop](desktop.md#taskbar-launcher-desktop).

- **Two kinds of icon**, both `desktop_items` rows (the position lives there, on the server):
  - **Real items**: the files and folders of the Desktop folder. No arrow; renaming renames the file itself, deleting moves it to the recycle bin. Moving one out of the Desktop folder (in Files, or by dropping it onto a folder icon) removes its icon; putting one in (dropping files from Files, Move to the desktop, New folder on the desktop) gives it one. Something put into the Desktop folder elsewhere (another browser, a restore) gets its icon on the next free cell.
  - **Shortcuts**: apps, and files or folders that live elsewhere. A small arrow marks a shortcut to a file or folder; renaming sets the shortcut's label (empty = the item's name again); removing it leaves the target alone. One shortcut per target: adding it again flashes the existing icon. A shortcut whose target is gone is not shown.
- **Grid**: every icon has a whole cell; nothing ever lands on another icon. Any placement (a drop, a move, a new shortcut, Arrange) takes the free cell nearest to where it was asked for (`nearestFreeCell` in `fileTree.ts`, tested); a full screen continues in new columns.
- **Selection**: click selects, Ctrl/Cmd-click toggles, Shift-click adds; drag on the empty desktop draws a rubber band that selects what it touches (Ctrl keeps the earlier selection). `Mod+A` all, `Esc` none, arrow keys go to the nearest icon in that direction.
- **Drag** moves the selection (or the pressed icon): each lands on the free cell nearest to its own drop spot. Onto a **folder icon**: the files and folders move into that folder (a shortcut's target moves, the shortcut goes; apps stay, with a note). Onto the **recycle bin**: real items are binned, shortcuts removed.
- **Open**: double-click or `Enter` (a folder opens Files there). **F2** renames the selected icon, **Delete** bins the selected real items and removes the selected shortcuts.
- **Right-click an icon**: Open · Rename… (real) or Rename shortcut… · Show in Files (real) · Move to the recycle bin (real) or Remove the shortcut. With several selected: Open all · bin or remove them.
- **Right-click the desktop**: New folder (a real folder in the Desktop folder, where you clicked) · New shortcut… (search apps, folders and files) · Arrange icons (apps, then folders, then files, by name, in columns) · Open the Desktop folder · Settings · theme.
- A project's first visit in a browser, with an empty desktop, adds Gallery, Timeline, Plan, Metadata and Files (`localStorage["desktop.seeded.<projectId>"]` so removing them all does not bring them back in this browser).

