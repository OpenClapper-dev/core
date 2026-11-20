# U1 · Files and properties

UX workshop [#357](https://github.com/OpenClapper-dev/core/issues/357) ([plan](ux-plan.md)). Status: **round 2 built**; first decisions recorded below.

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

## Stand-ins

- **Pictures** are generated placeholders. Real example photos are still to come ([02](02-optics.md)).
- **The icons for set and location** are existing glyphs standing in; both are to be drawn.
- **File-type colours** are a first assignment from the eight categorical colours.

## Not in round 1

The Project app (property editor, AI import, naming patterns, extensions), creating and saving a filter, the "new" flows, context menus, drag and drop between folders, the account home as a second root, keyboard handling.

## Questions for the owner

1. Which collection mark: bar, dot or frame?
2. Does the scrubbing feel right?
3. Who sets a collection's colour: assigned automatically and changeable, or chosen when the collection is made?
4. What next: the Project app (property editor, AI import, naming patterns, extensions), or more on the browser first?

## Decided

2026-11-20, by the owner, after round 1:

- **The five entries stay as they are:** one browser in five settings.
- **The properties panel** can sit on the right, at the bottom, or be off; those three are enough.
- **List is the default view** of every entry.
- **A collection is a stacked tile that can be scrubbed** by moving the pointer across it.
- **A collection has a colour,** and its photos show it when collections are spread out. How the mark is drawn is open (question 1).
