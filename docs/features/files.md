# Files and desktop icons

The desktop's explorer (epic #72): a project's shots, timelines, shooting days, saved views, locations and extra fields as **files** in **folders**, and **shortcuts** to files, folders and apps on the desktop. Folders, placements and shortcuts are stored on the server ([data model](../data-model.md), [API](../api.md)), so they are the same in every browser. Window layouts are per browser ([desktop](desktop.md)).

## Model

- **File types**: `FILE_RESOURCE_TYPES` in `packages/vocab/src/files.ts`: shot, timeline, day, view, location, field. `FILE_TYPE_META` names each type, its icon and the app that opens it. Spots live inside their location; rigs, viewfinder layouts and devices are shared by all projects, so they are apps, not files.
- **Folders** belong to one project and nest up to 8 deep. Names are unique within a folder (case-insensitive).
- **A file sits in at most one folder**; without one it is at the top level. There is no manual order inside a folder: Files sorts by name, date or type (remembered per browser).
- **Deleting a folder** never deletes files: its subfolders and files move up to its parent (or the top level), and its desktop shortcut goes.
- **Deleting a file** anywhere (Gallery, Library, Files) also removes its placement and shortcuts. A shot moved to another project lands at that project's top level, without a shortcut.

## Files app (`apps/dashboard/src/apps/FilesApp.tsx`, route `#/files/<folderId>`)

- **Left**: the folder tree under the project's name (expand with the chevrons; the open folder's path stays expanded), then **All files**: every shot, timeline, day, view, location or field, wherever it sits, with counts.
- **Toolbar**: the path (each part is a link and a drop target), New folder (`⇧N`), search (this folder; tick **Subfolders** to search below it too, then each hit shows its folder), sort, List · Grid.
- **Rows**: a thumbnail for shots, the name and facts (shot: review state, photos, location; timeline: clips and length; day: date, title, shots; view: rules; location: spots, shots, pin; field: key, type, position), the type and the date. Archived shots are greyed.
- **Open** (double-click, `Enter`): a folder opens in place; a file opens in its app: a shot in a shot window, a timeline in Timeline, a day in Plan, a view in the Gallery, a location in Locations, a field in Fields.
- **Context menu**: Open · Rename… · Move to… (a folder picker) · Move to the top level · Add to the desktop · New folder inside (folders) · Delete….
  - Rename works on shots, views, locations and folders. Timelines and days are renamed and deleted in their own window: Timeline and Plan keep their own copy, which would overwrite a change made from outside ([known issues](../known-issues.md)). Fields are renamed in Fields.
  - Delete says what happens per type: a shot offers Archive instead; a location's shots stay, without a location; a field's stored values stay; a folder's contents move up.
- **Drag and drop**: rows onto a folder (in the list, the tree or the path) move them there; a folder can't go into itself. Rows dragged onto the desktop become shortcuts.
- Keys (`files` scope): `/` search, `j`/`k` or arrows move, `Enter` open, `Backspace` or `Alt ↑` up a folder, `F2` rename, `Delete`, `⇧N` new folder ([shortcuts](../shortcuts.md)).
- Files reads nothing of its own: it joins `/api/files` (loaded with the project) with the collections already loaded; timelines and days come from the same cached fetch as the inspector, refreshed when the Files window gets focus.

## Desktop icons (`apps/dashboard/src/wm/Desktop.tsx`)

- Each shortcut shows its label, or the item's live name; a shot shows its photo, others their type's or app's icon; a small arrow marks a shortcut to a file or folder. A shortcut whose target is gone is not shown.
- **Double-click** or `Enter` opens it (a folder opens Files at that folder). **Drag** moves it (snapped to a half-cell grid, saved on the server). **Right-click**: Open · Rename shortcut… (empty = the item's name again) · Remove from the desktop.
- **Right-click the desktop**: New folder (a top-level folder, with its shortcut where you clicked) · New shortcut… (search apps, folders and files) · Arrange icons (apps, then folders, then files, by name, in columns) · Settings · theme.
- One shortcut per target: adding it again flashes the existing icon.
- A project's first visit in a browser, with an empty desktop, adds Gallery, Timeline, Plan, Metadata and Files (`localStorage["desktop.seeded.<projectId>"]` so removing them all does not bring them back in this browser).
