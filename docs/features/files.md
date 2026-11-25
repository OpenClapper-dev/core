# Files, the recycle bin and desktop icons

> **Mid-rewrite (epic [#371](https://github.com/OpenClapper-dev/core/issues/371)).** This page describes the rebuilt Studio (step B1, [#373](https://github.com/OpenClapper-dev/core/issues/373)). Media, Shots, Sets and Locations are further entries of the same browser and come with their file types; so do the board and map views, saved filters and bulk editing of properties.

Everything a user makes is a file ([07 · organisation](../rewrite/07-organisation.md)): one row on the server with a type, a name, a place in a tree and a body ([data model](../data-model.md), [API](../api.md#files-filests)). Designed in [U1](../rewrite/ux-1-files.md).

## Model

- **Two roots:** a project, and the signed-in person's **account home** (files that follow them into every project). Nothing moves between the two, or between projects.
- **Containers:** a folder holds any files and nests up to 8 deep; a collection holds only photos and does not nest ([media](media.md)). A file sits in one container or at the top level. Names are free text and need not be unique.
- **Fixed folders** of a project, made with it: **Desktop** (what is in it shows as icons on the desktop) and **Settings** (one settings page per tab: General, Properties, Naming patterns, Extensions, Customizations; the property definitions and naming patterns are kept there too but not listed, their pages show them). A person's home has a **Settings** folder too (Appearance, Account, Shortcuts), made when the home is first listed. They cannot be renamed, moved, copied or deleted, and show as first-class folders with their own glyphs (desktop, settings) in the system's grey rather than a folder's blue (#426), so they never pass for your own folders.
- **Shortcuts** are files of their own: one opens an app, or points at a file elsewhere. A shortcut whose target is in the bin or gone is not shown on the desktop and says so in Files; it works again once the target is restored.
- **Settings pages are files** (#426): one file of the type `settings` per page (its body names the page), in its root's Settings folder. Opening one opens Settings at that page; so do a property definition and a naming pattern. They are made and kept by the server: never renamed, moved, copied or deleted. What a page sets lives where it always did (the project, the account, the preferences). The personal pages are drawn in one colour, the project's in another, each with its page's glyph.
- **Preferences** are a data file of the type `preferences` in the account home ([desktop](desktop.md#preferences-prefsts-themets)); Files and the search do not list it (the Appearance page is how it is reached).
- **Types** come from `@openclapper/model`; `fileKinds.ts` gives each its icon and colour, and the app registry says which app opens it (`opens`).

## The store (`files.ts`, `fileOps.tsx`)

`files.ts` holds one copy of each root's files and bin for every window, so a change in one place shows in all. A change goes to the server first and the root is read again. `fileOps.tsx` holds what a person does with files (open, new folder, rename, move with the model's placement rules checked first, copy, shortcut, bin with Undo, the folder picker); the views call it and keep no rules of their own.

## Files app (`apps/FilesApp.tsx`, route `#/files[/<folderId>]`, `#/files/home[/<folderId>]`, `#/files/bin`)

- **Panels** (the design system's `Dock`: move, resize, collapse, stack as tabs; "Panels back to their places" in the ⋯ menu):
  - **Folders:** the project's folder tree, the account home's tree, and the recycle bin with its count. The open folder's path stays expanded.
  - **Properties:** nothing chosen: the folder and its count. One file: its icon, its name (editable in place), its type, Open, what it holds or opens, where it is, created, created by, changed, and **Used in** (the files that point at it). Several ticked: Move to… and To the recycle bin.
- **Toolbar:** the path (each part a link and a drop target), search over names in the whole root (marked "whole project"), the Types filter once there is more than one type, List · Grid, New (folder).
- **Live** (#426): every root on screen keeps a socket to its room (`/api/live/root`); any write that changed its files, from any client (a photo uploaded from a phone, a change in another browser), makes it read the root again, once for a burst. No reload and no Reload button needed.
- **Selecting is an OS file manager's** (#426): a click selects a file (the panel shows it), Ctrl-click adds or removes one, Shift-click selects the range from the file last clicked; a drag on the empty part of the list or grid draws a rectangle and selects what it touches (Ctrl keeps the selection), and a click there clears it. No checkboxes or tick circles; hover is a light background, selected a stronger one (`useMarquee` and `clickSelect` in the design system). The status bar counts the selection, with Clear. New files are made from the New menu and the context menu of the empty space, never from a button per type.
- **List:** name with its icon (a fixed folder's own glyph, arrow for a shortcut), type, "In" while searching, created; sortable by name, type and created, containers first. **Grid:** cards with the type icon and a line of facts. Sort and view are remembered per browser.
- **Columns** (#426): every column a kind of list can show, the properties included; **Columns** in the toolbar (list view) shows or hides them (hidden, not deleted; *As they were* resets), and a header's right edge is dragged to size it. Kept with the account per kind of list (folders, home, Photos, Shots, Sets, Locations), the same in every window and browser. Search keeps covering every property: a row that matched in a hidden column says which property and value.
- **Open** (double-click, `Enter`): a folder opens in place, or in a window of its own with "Open in a new window"; every folder shows in at most one window (opening one that is open brings that window up), each with its own taskbar button, as in an OS file manager (#426). Folders opened from elsewhere (the desktop, a pin, a shortcut) open in their own window; any other file in the app registered for its type; a shortcut opens what it points at.
- **Context menu:** Open · Show what it points at (shortcut) · Rename… · Duplicate · New folder inside · Move to… (a folder picker) · Move to the top level · Move to the desktop · Create shortcut on the desktop · Pin to taskbar · Move to the recycle bin. With several ticked: the move entries and the bin. On the empty area: New folder, Select everything listed.
- **Drag and drop:** rows and cards onto a folder (in the list, the grid, the tree or the path) move there; onto the desktop they move into the Desktop folder; onto the recycle bin they are deleted; onto the taskbar they are pinned. What cannot be (a folder into itself, more than 8 levels, a fixed folder) is said in a toast, by the same rules the server applies.
- **Keys** (`files` scope): `/` search, `j`/`k` or arrows, `Enter` open, `Backspace` or `Alt ↑` up a folder, `F2` rename, `Delete` to the bin, `⇧N` new folder, `⌘A` select all, `Esc` clear ([shortcuts](../shortcuts.md)).

## Recycle bin (`apps/BinView.tsx`, `apps/BinApp.tsx`, route `#/bin`)

- **Every delete bins** and says so in a toast with **Undo**. A folder goes with its contents, a file with its internal files; the bin shows one entry with how many went along.
- **The list:** newest first, with the type, where the entry was, when it was deleted and how many days it stays. Search by name.
- **Restore** (`R`, double-click, the button) puts entries back where they were, with everything that went along, and back everywhere they were used; when the folder is gone or still binned they come back at the top level, and the toast says so.
- **Delete permanently** (`Del`) and **Empty the bin** ask once.
- **Where it is:** the Recycle bin app (launcher, ⌘K), Files' side bar, and an icon on the desktop (Settings › Appearance; on by default). The icon is a drop target, shows its count, and its menu has Open, Empty the bin and "Take the bin off the desktop".
- After 30 days the Worker's daily cron purges an entry.

## Desktop icons (`wm/DesktopIcons.tsx`, `wm/grid.ts`)

- The icons are the files of the project's **Desktop folder**: real files and folders, and shortcuts (marked with an arrow) to apps and to files elsewhere, plus the recycle bin.
- **Places are a preference of the account,** per project (`prefs.ts`): each icon has a whole cell of a grid; nothing lands on another icon. A new icon takes the free cell nearest to where it was asked for (`nearestFreeCell`, tested); an icon whose saved cell is off the screen comes back to the nearest one on it.
- **Select:** click, Ctrl-click toggles, Shift-click adds; drag on the empty desktop draws a rubber band. Hover gives an icon a soft background, a selected icon a stronger one (as on Windows' desktop); no outline. `⌘A` all, `Esc` none, arrow keys go to the nearest icon in that direction (while the desktop has the focus).
- **Drag** moves the selection, each icon to the free cell nearest its own drop spot. Onto a **folder icon:** into that folder. Onto the **recycle bin:** deleted. Onto the **taskbar:** pinned. Files dragged in from the Files app move into the Desktop folder and land around the drop point.
- **Open:** double-click or `Enter`. **F2** renames, **Delete** bins.
- **Right-click an icon:** Open · Rename… · Show in Files (or what a shortcut points at) · Move to the recycle bin; with several selected: Open all, bin.
- **Right-click the desktop:** New folder (a real folder in the Desktop folder, where you clicked) · New shortcut… (search apps, folders and files) · Arrange icons (apps, then folders, then files, by name, in columns) · Open the Desktop folder, then the shell's entries.

## Changed from the first app

- A shortcut is a file: removing one moves it to the recycle bin like anything else, instead of only taking the icon away.
- Names need not be unique, so nothing is renamed "(restored)".
- A new project's desktop starts empty; the first app seeded shortcuts per browser. The taskbar starts with Files, Media and Project pinned.

Properties, search over values, filters as files, the board view, bulk edit and the Shots entry of the browser: [properties](properties.md).
