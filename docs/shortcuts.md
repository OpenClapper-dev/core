# Keyboard shortcuts (dashboard)

Generated from `apps/dashboard/src/shortcuts.ts` (issue #32); `shortcuts.test.ts` fails when this file drifts. Regenerate with `node apps/dashboard/src/shortcuts.docs.ts > docs/shortcuts.md`.
The same list is in the app: `?`, and Settings › Shortcuts. Single keys never fire while you type in a field; plain letters wait while a G jump is pending.

## Everywhere

| Keys | What |
| --- | --- |
| ⌘K | Go to… (command palette) |
| ? | All shortcuts |
| G S | Open the Gallery (shots) |
| G T | Open Timeline |
| G P | Open Plan |
| G D | Open Metadata |
| G F | Open Files |
| G L | Open Projects (the library) |
| G M | Shots on the map |
| Esc | Close or back out one level |

## Windows (always live, like Everywhere)

| Keys | What |
| --- | --- |
| ⌘` / ⌘Alt PageDown | Next window |
| ⌘Alt PageUp | Previous window |
| ⌘Alt W | Close the window |
| ⌘Alt ↓ | Minimize the window |
| ⌘Alt ↑ | Maximize or restore the window |
| ⌘Alt ← | Snap the window to the left half |
| ⌘Alt → | Snap the window to the right half |
| ⌘Alt D | Show the desktop (again: bring the windows back) |

## Shots

| Keys | What |
| --- | --- |
| / | Focus the search |
| F | Filter panel |
| M | Cycle the frame mode |
| ⇧N | New shot (upload or draw) |
| Esc | Leave the search field |

## Shots · grid

| Keys | What |
| --- | --- |
| ← ↑ → ↓ | Move in the grid |
| ↵ | Open the shot |

## Shots · list

| Keys | What |
| --- | --- |
| J / ↓ | Next row |
| K / ↑ | Previous row |
| X | Select the row |
| ⇧X | Select a range |
| ↵ | Open the shot |
| B | Bulk edit the selected shots |
| ⇧M | Move the selected shots to a project |
| Del | Move the selected shots to the recycle bin |
| Esc | Close bulk edit · clear the selection |

## Shots · map

| Keys | What |
| --- | --- |
| ↑ / ↓ | Move in the list |
| ↵ | Open the shot |

## Shot view

| Keys | What |
| --- | --- |
| ← | Previous shot |
| → | Next shot |
| , | Previous photo of a sequence |
| . | Next photo of a sequence |
| A | Approve |
| E | Archive (archived: back to review) |
| R | Framing stage |
| C | Compose stage |
| M | Cycle the frame mode |
| Esc | Back to where the shot was opened |

## Shot view · Framing

| Keys | What |
| --- | --- |
| Drag | Move the frame |
| ← | Shorter lens |
| → | Longer lens |
| ⇧ arrows | Nudge the frame by 1 % |
| ⌘S | Save the framing |
| Esc | Back to the photo |

## Shot view · Compose

| Keys | What |
| --- | --- |
| , | Previous photo of a sequence |
| . | Next photo of a sequence |

## Drawing (Compose, and overlays or sketches on the timeline stage)

| Keys | What |
| --- | --- |
| V | Select / move |
| P | Freehand |
| L | Line |
| A | Arrow |
| R | Rectangle |
| O | Ellipse |
| T | Text |
| S | Stencil |
| E | Eraser |
| 1 – 0 | Colour |
| ⌘Z | Undo |
| ⌘⇧Z / ⌘Y | Redo |
| Del / ⌫ | Remove the selected shape |
| ← ↑ → ↓ | Nudge the selected shape |
| ⌘S | Save now (inline drawings also save on their own) |
| Esc | Stop editing text · deselect · leave |

## Re-framing a clip on the timeline stage

| Keys | What |
| --- | --- |
| Drag | Move the frame on the stage |
| ← | Shorter lens |
| → | Longer lens |
| ⇧ arrows | Nudge the frame by 1 % |
| Esc | Done |

## Timeline

| Keys | What |
| --- | --- |
| ← | Previous clip |
| → | Next clip |
| Home | First clip |
| End | Last clip |
| Space | Play / pause |
| Alt ← | Move the clip earlier |
| Alt → | Move the clip later |
| Drag | Shots into the strip · reorder clips · scrub along the ruler |
| N | Shot browser ⇄ clip panel |
| P | Placeholder clip |
| R | Re-frame the clip on the stage |
| C | Draw the clip's overlay (or sketch it) |
| ↵ | Open the clip's shot |
| ⇧N | New timeline |
| Right-click | Actions on shots, clips and timelines |

## Timeline · shot browser

| Keys | What |
| --- | --- |
| A | Approve the selected shot |
| E | Archive the selected shot (archived: back to review) |

## Timeline · clip panel

| Keys | What |
| --- | --- |
| A | Approve the clip's shot |
| E | Archive the clip's shot (archived: back to review) |
| D | Focus the hold time |
| Del | Remove the clip |

## Plan

| Keys | What |
| --- | --- |
| ↓ | Next planned shot |
| ↑ | Previous planned shot |
| Alt ↓ | Move later in the day |
| Alt ↑ | Move earlier in the day |
| T | Planned time |
| Del | Remove from the day |
| N | Add shots |
| Esc | Close the Add shots panel |
| ⇧N | New shooting day |
| ↵ | Open the shot |

## Metadata

| Keys | What |
| --- | --- |
| Drag | Set the value |
| Drag back | Clear the value |
| Double-click | Open the shot |

## Library · Rigs

| Keys | What |
| --- | --- |
| J / ↓ | Next rig |
| K / ↑ | Previous rig |
| ↵ | Edit the rig |

## Rig editor

| Keys | What |
| --- | --- |
| ⌘S | Save the rig |
| Esc | Close the editor |

## Library · Locations

| Keys | What |
| --- | --- |
| / | Filter the locations |
| J / ↓ | Next location |
| K / ↑ | Previous location |
| F2 | Rename |
| P | Set the position |
| ↵ | Show its shots |
| Del | Move to the recycle bin |

## Library · Fields

| Keys | What |
| --- | --- |
| ⌘S | Save the field |
| Tab | Indent in the JSON editor |
| Esc | Leave the editor |

## Shot view · Position

| Keys | What |
| --- | --- |
| Drag | Move the pin |
| ↵ | Save the position |
| Esc | Cancel |

## New shot · drawing

| Keys | What |
| --- | --- |
| ⌘Z | Undo the last shape |
| Del | Remove the selected shape |

## Combobox

| Keys | What |
| --- | --- |
| ↑ / ↓ | Move |
| ↵ / Tab | Take the highlighted entry |
| Esc | Cancel |

## Files

| Keys | What |
| --- | --- |
| / | Focus the search |
| J / ↓ | Next item |
| K / ↑ | Previous item |
| ↵ | Open the item (a folder: go into it) |
| ⌫ / Alt ↑ | Up to the parent folder |
| F2 | Rename |
| Del | Move to the recycle bin |
| ⇧N | New folder here |
| ⌘A | Select everything listed (Ctrl-click toggles, Shift-click extends) |
| Drag | Onto a folder: move there · onto the desktop: into the Desktop folder · onto the recycle bin: delete |
| Right-click | Open, rename, move, move to the desktop, shortcut on the desktop, recycle bin |

## Desktop icons

| Keys | What |
| --- | --- |
| ↵ | Open the focused icon (or double-click it) |
| Drag | Move the selected icons, each to a free cell · files dragged from Files move into the Desktop folder |
| Right-click | On an icon: open, rename, remove · on the desktop: new folder, new shortcut, arrange |
| ⌘A | Select every icon |
| Esc | Clear the selection |
| F2 | Rename the selected icon (a real file or folder itself, else the shortcut) |
| Del | Selected files to the recycle bin, selected shortcuts off the desktop |
| ← | Select the icon to the left |
| → | Select the icon to the right |
| ↑ | Select the icon above |
| ↓ | Select the icon below |
| Click / Drag | Ctrl-click toggles, Shift-click adds; drag on the empty desktop to select with a rubber band |
| Drag | Icons onto a folder icon: move them into that folder (apps stay) |
| Drag | An icon or a file from Files onto the recycle bin: remove the shortcut, or bin the file |

## Recycle bin

| Keys | What |
| --- | --- |
| / | Focus the search |
| ⌘A | Select everything listed |
| R | Restore the selected items (or double-click one) |
| Del | Delete the selected items permanently |

