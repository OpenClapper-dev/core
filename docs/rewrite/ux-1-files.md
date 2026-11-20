# U1 · Files and properties

UX workshop [#357](https://github.com/OpenClapper-dev/core/issues/357) ([plan](ux-plan.md)). Status: **round 1 built, nothing decided yet**.

The file browser in its five entries, and how properties are shown and edited. Specified in [07](07-organisation.md), [09](09-shells.md), [09a](09a-places.md) and [04](04-shots.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u1> (also under "UX workshops" in the specimen's navigation). Code: `apps/specimen/src/ux/u1/`. It runs on a fake project ("Nachtzug": 4 sets, 4 locations, 10 shots, 17 photos in 2 collections, 5 canvases) and has no server; a reload resets every change.

The bar at the top is not part of the design: it switches between the five apps, between variants, and the theme.

## Round 1: what is in it

| Part | What to try |
| --- | --- |
| Five entries on one browser | Files, Media, Shots, Sets, Locations in the top bar. Each opens with the view that suits it: Shots as a board, Locations as a map |
| Files | The folder tree, the breadcrumb, double-click into folders and collections; the fixed Desktop and Settings folders carry a lock |
| Views | List, grid, board, map in the toolbar; a view is offered only where it can show something |
| Board | Columns by a property (the select next to the views). Drag a card to another column to set the value; select several and drag one to move all |
| Map | Locations with a position as pins; the note says how many have none. The map itself is a stand-in drawing |
| Collections | In Media a collection is one stacked tile; the switch next to the views spreads them out |
| Search | Looks at names and at every property value, including the names of referenced files (search "kitchen" in Files) |
| Types | In Files, the Types menu narrows to file types; searching or filtering lists the whole project, marked as such |
| Saved filters | "Night interiors" and "Shots without a picture" in the sidebar |
| Recycle bin | In Files' sidebar, with Restore |
| Account home | Shown in Files' sidebar as "Ada's home"; not clickable yet |
| Properties panel | Select a file: picture, name (editable), the project's properties in their sections, the facts of the file type, its content, where it is used. Select several (Ctrl or Shift): the shared properties, edited together, "Mixed" where they differ |

Two variants can be switched in the top bar:

- **Properties:** a panel on the right, a strip at the bottom, or off.
- **Board cards:** with the picture, or compact.

## Stand-ins

- **Pictures** are generated placeholders. Real example photos are still to come ([02](02-optics.md)).
- **The icons for set and location** are existing glyphs standing in; both are to be drawn.
- **File-type colours** are a first assignment from the eight categorical colours.

## Not in round 1

The Project app (property editor, AI import, naming patterns, extensions), creating and saving a filter, the "new" flows, context menus, drag and drop between folders, the account home as a second root, keyboard handling.

## Questions for the owner

1. Do the five entries feel like one tool in five settings, or should they differ more?
2. Properties: right panel, bottom strip, or something else?
3. Is the board the right default for Shots, and the map for Locations?
4. Collections as a stacked tile: clear enough?
5. What is missing or wrong at first sight?

## Decided

Nothing yet.
