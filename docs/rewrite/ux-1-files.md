# U1 · Files and properties

UX workshop [#357](https://github.com/OpenClapper-dev/core/issues/357) ([plan](ux-plan.md)). Status: **round 4 built**; decisions so far recorded below.

The file browser in its five entries, and how properties are shown and edited. Specified in [07](07-organisation.md), [09](09-shells.md), [09a](09a-places.md) and [04](04-shots.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u1> (also under "UX workshops" in the specimen's navigation). Code: `apps/specimen/src/ux/u1/`. It runs on a fake project ("Nachtzug": 4 sets, 4 locations, 10 shots, 17 photos in 2 collections, 5 canvases) and has no server; a reload resets every change.

The bar at the top is not part of the design: it switches between the five apps, between variants, and the theme.

## Round 1: what is in it

| Part | What to try |
| --- | --- |
| Five entries on one browser | Files, Media, Shots, Sets, Locations in the top bar. Every entry opens as a list |
| Files | The folder tree, the breadcrumb, double-click into folders and collections; the fixed Desktop and Settings folders carry a lock |
| Views | List, grid, board, map in the toolbar; a view is offered only where it can show something |
| Board | Columns by a property (the select next to the views). Drag a card to another column to set the value; select several and drag one to move all |
| Map | Locations with a position as pins; the note says how many have none. The map itself is a stand-in drawing |
| Collections | In Media's grid a collection is one stacked tile; the switch next to the views spreads them out |
| Search | Looks at names and at every property value, including the names of referenced files (search "kitchen" in Files) |
| Types | In Files, the Types menu narrows to file types; searching or filtering lists the whole project, marked as such |
| Saved filters | "Night interiors" and "Shots without a picture" in the sidebar |
| Recycle bin | In Files' sidebar, with Restore |
| Account home | Shown in Files' sidebar as "Ada's home"; not clickable yet |
| Properties panel | Select a file: picture, name (editable), the project's properties in their sections, the facts of the file type, its content, where it is used. Select several (Ctrl or Shift): the shared properties, edited together, "Mixed" where they differ |

Variants that can be switched in the top bar:

- **Properties:** a panel on the right, a strip at the bottom, or off.
- **Collection mark:** bar, dot or frame (round 2, below).
- **Board cards:** with the picture, or compact.

## Round 2 (2026-11-20)

From the owner's reaction to round 1:

| Change | What to try |
| --- | --- |
| List is the default view everywhere | Open any entry |
| Scrubbing a collection | In Media's grid, move the pointer across a stacked tile: the photo under the pointer shows, with a red line at the pointer and "4 / 5" in the corner, as on clips in an editor. Leaving the tile shows the first photo again |
| A collection has a colour | Each collection carries one of the eight categorical colours. Its stacked tile shows it, and so does the list's Collection column |
| Photos keep their collection's colour when spread out | Spread the collections: each photo of a collection carries the colour and names its collection underneath. Three ways to draw the mark are in the top bar: a **bar** under the picture, a **dot** before the name, a **frame** around the picture |

## Round 3 (2026-11-20)

| Change | What to try |
| --- | --- |
| The mark is a personal preference | "Collection mark" in the top bar stands for a setting of the account: bar (the default), dot or frame |
| The bar can sit below or to the left | With "Bar" chosen, a second switch: Bottom (the default) or Left |
| The frame | Choose "Frame": a thin coloured outline. On a stacked collection the tiles behind are drawn in the collection's colour too (round 4, the owner's idea, replacing the thicker frame tried first) |
| The mark on the board | Media → board: every photo of a collection carries its collection's mark and names the collection. The board always shows single photos, because a property is set per photo |
| Choosing a collection's colour | Select a collection (Media, grid): the panel has a Colour section with the eight colours and a "+" for a colour of one's own. The change shows at once on the tile and on its photos |

## Round 4 (2026-11-20)

| Change | What to try |
| --- | --- |
| Clicking and ticking are two things | **Click** a file once: it becomes the current file, outlined, and the panel shows it. **Tick** files to select them for acting on several: the checkbox in the list, a circle in the top left corner of a card (it appears on hover, and on every card once something is ticked). Ticked files take the selection colour; the panel then edits them together and the status bar counts them, with Clear |
| The same in every view | List, grid and board behave alike. Ctrl-click ticks, Shift-click ticks a range from the current file. Dragging a ticked card on the board moves all ticked cards |
| Panels can be dragged | The sidebar (180 to 420 px, starts at 220), the properties panel on the right (260 to 560, starts at 320) and at the bottom (160 to 480 high, starts at 240). The grip lights up under the pointer; a double-click returns to the starting size; arrow keys move it when focused |
| Own scrollbars | Thin, no track, in the theme's colours; the thumb darkens under the pointer and takes the accent while dragged |

Three of these went into the design system (`packages/design`), not only the prototype: the scrollbar design (for every scrolling area), a panel that resizes along the bottom and resets on double-click, and a table whose rows have a current row apart from the ticked ones.

## Stand-ins

- **Pictures** are generated placeholders. Real example photos are still to come ([02](02-optics.md)).
- **The icons for set and location** are existing glyphs standing in; both are to be drawn.
- **File-type colours** are a first assignment from the eight categorical colours.

## Not in round 1

The Project app (property editor, AI import, naming patterns, extensions), creating and saving a filter, the "new" flows, context menus, drag and drop between folders, the account home as a second root, keyboard handling.

## Questions for the owner

1. What next: the Project app (property editor, AI import, naming patterns, extensions), or more on the browser first?

## Decided

2026-11-20, by the owner, after round 1:

- **The five entries stay as they are:** one browser in five settings.
- **The properties panel** can sit on the right, at the bottom, or be off; those three are enough.
- **List is the default view** of every entry.
- **A collection is a stacked tile that can be scrubbed** by moving the pointer across it.
- **A collection has a colour,** and its photos show it when collections are spread out.

2026-11-20, by the owner, after round 2:

- **How the mark is drawn is a personal preference** of the account ([09](09-shells.md)): a bar (the default), a dot or a frame. The bar sits below the picture (the default) or to its left.
- **The mark shows wherever photos of a collection appear singly,** also on the board.
- **Scrubbing** a stacked collection stays as built.
- **The frame mark is thin;** on a stacked collection the tiles behind it take the collection's colour.
- **Click and tick are separate.** One click makes a file the current one; ticking selects, in the same way in the list, the grid and the board. A card shows a circle in its top left corner for it.
- **Panels are resizable** by dragging, within a minimum and a maximum.
- **Scrollbars have the app's own design.**
- **A collection's colour** is given at random when the collection is made. It can be changed to one of the predefined colours or to any colour with a picker. It is stored with the collection on the server, so everyone sees the same.
