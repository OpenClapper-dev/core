# Keyboard shortcuts (Studio)

Generated from `apps/studio/src/shortcuts.ts`; `shortcuts.test.ts` fails when this file drifts. Regenerate with `node apps/studio/src/shortcuts.docs.ts > docs/shortcuts.md`.
The same list is in the app: `?`, and Settings › Shortcuts. Single keys never fire while you type in a field; plain letters wait while a G jump is pending.

## Everywhere

| Keys | What |
| --- | --- |
| ⌘K | Search files, apps and windows |
| ? | All shortcuts |
| G F | Open Files |
| G M | Open Photos (Files) |
| G P | Open the project's settings |
| G , | Open Settings |
| Esc | Close or back out one level |

## Windows (always live, like Everywhere)

| Keys | What |
| --- | --- |
| ⌘` / ⌘Alt PageDown | Next window |
| ⌘Alt PageUp | Previous window |
| ⌘Alt W | Close the window |
| ⌘Alt ↓ | Minimise the window |
| ⌘Alt ↑ | Maximise or restore the window |
| ⌘Alt ← | Snap the window to the left half |
| ⌘Alt → | Snap the window to the right half |
| ⌘Alt D | Show the desktop (again: bring the windows back) |
| ⌘Alt V | Task view: every desktop and its windows |
| ⌘Alt ⇧→ | Next desktop |
| ⌘Alt ⇧← | Previous desktop |
| ⌘Alt N | New desktop (and go there) |
| ⌘Alt 1–9 | Go to desktop 1–9 |
| ⌘Alt⇧ 1–9 | Move the window to desktop 1–9 |

## Files

| Keys | What |
| --- | --- |
| / | Focus the search |
| J / ↓ | Next file |
| K / ↑ | Previous file |
| ↵ | Open the file (a folder: go into it) |
| ⌫ / Alt ↑ | Up to the folder above (in Media: back from a collection) |
| F2 | Rename |
| Del | Move to the recycle bin |
| ⇧N | New folder here |
| ⌘A | Tick everything listed (Ctrl-click ticks one, Shift-click a range) |
| Esc | Clear the ticks |
| Drag | Onto a folder, a collection, the tree or the path: move there · onto the desktop: into the Desktop folder · onto the recycle bin: delete · onto the taskbar: pin · image files from the computer: import |
| Right-click | Open, rename, duplicate, collections (group, add to, take out, ungroup), move, shortcut on the desktop, pin, recycle bin |

## Desktop icons

| Keys | What |
| --- | --- |
| ↵ | Open the selected icon (or double-click it) |
| ⌘A | Select every icon |
| Esc | Clear the selection |
| F2 | Rename the selected icon |
| Del | Selected icons to the recycle bin |
| ← | Select the icon to the left |
| → | Select the icon to the right |
| ↑ | Select the icon above |
| ↓ | Select the icon below |
| Click / Drag | Ctrl-click toggles, Shift-click adds; drag on the empty desktop to select with a rubber band |
| Drag | Move the selected icons, each to a free cell · onto a folder icon: into that folder · onto the recycle bin: delete |
| Right-click | On an icon: open, rename, show in Files, recycle bin · on the desktop: new folder, new shortcut, arrange |

## Recycle bin

| Keys | What |
| --- | --- |
| / | Focus the search |
| ⌘A | Select everything listed |
| R | Restore the selected entries (or double-click one) |
| Del | Delete the selected entries for good |

## Photo

| Keys | What |
| --- | --- |
| ← | Previous photo |
| → | Next photo |

## Timeline

| Keys | What |
| --- | --- |
| Space | Play or pause |
| ← | Previous clip |
| → | Next clip |
| Home | First clip |
| End | Last clip |
| Alt ← | Move the chosen clips earlier |
| Alt → | Move the chosen clips later |
| - | Hold the chosen clips 0.5 s shorter |
| + | Hold the chosen clips 0.5 s longer |
| D | Type the chosen clip's hold time |
| P | A placeholder after the chosen clip |
| C | A chapter starts at the chosen clip (or no more) |
| Delete | Remove the chosen clips |
| ⌘A | Choose every clip |
| ⌘Z | Undo |
| Mod+Shift+Z | Redo |
| ⇧Click | Choose several clips: Shift adds a range, Ctrl one more |

## Shot · progression

| Keys | What |
| --- | --- |
| Space | Play or pause the progression |
| ← | Playhead 0.1 s back |
| → | Playhead 0.1 s on |
| Shift+← | Playhead 1 s back |
| Shift+→ | Playhead 1 s on |
| Home | Playhead to the start |
| End | Playhead to the end |
| Delete | Delete the chosen items |
| ⌘X | Cut the chosen items |
| ⌘C | Copy the chosen items |
| ⌘V | Paste after the chosen items, or at the playhead |
| ⌘D | Duplicate the chosen items |
| ⌘A | Choose every item |
| ⌘Z | Undo |
| Mod+Shift+Z | Redo |
| Esc | Clear the choice, or back to the playhead |
| ⇧Click / Drag | Shift adds a range, Ctrl one more; drag over the track for a box, drag items to move them |
| ⌘Wheel | Zoom the track |

## Flows (extension)

| Keys | What |
| --- | --- |
| Space | Play from the playhead; again: stop and go back to where play started |
| K | Stop where it is |
| V | Select mode: clicks select, never add; on the stage, Move |
| I | Insert mode: a click on a lane adds a keyframe |
| M | A marker at the playhead |
| Shift+M | A range marker: in, then out |
| Delete | Delete the selected keyframes and markers, or what is chosen on the stage |
| ⌘Z | Undo (tracks and stage together) |
| Mod+Shift+Z | Redo |
| P | Stage: pen |
| L | Stage: line |
| A | Stage: arrow |
| R | Stage: rectangle |
| O | Stage: ellipse |
| T | Stage: text |
| S | Stage: stencil |
| E | Stage: eraser |
| ⌘A | Select every keyframe and marker |
| Esc | Clear the selection |
| Alt Click | Add a keyframe in Select mode too |
| ⇧Click / Drag | Shift-click adds to the selection; drag over the lanes for a box |

