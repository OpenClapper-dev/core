# U1 · Files and properties

UX workshop [#357](https://github.com/OpenClapper-dev/core/issues/357) ([plan](ux-plan.md)). Status: **round 7 built** (the Project app, Edit with AI); decisions so far recorded below.

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

Round 5, same day: the sidebar could not be dragged, because the browser layout's styles hid its grip; that is fixed in the design system. File icons are a quarter larger where they were small (20 px tiles, was 16), and an icon's glyph now always sits exactly in the middle of its tile: the space around it is an even number of pixels at every size.

Three of these went into the design system (`packages/design`), not only the prototype: the scrollbar design (for every scrolling area), a panel that resizes along the bottom and resets on double-click, and a table whose rows have a current row apart from the ticked ones.

## Round 6 (2026-11-20): the Project app

"Project" in the top bar. Code: `apps/specimen/src/ux/u1/Project.tsx`. Its changes stay inside the Project app; the browser's files do not pick them up in this prototype.

| Part | What to try |
| --- | --- |
| Properties: the catalogue | Every property of the project in its sections, with its field type and the file types that carry it as icons. The select at the top narrows to one file type and then also lists what is always there (the system properties) and the read-only facts of that type |
| Editing a property | Click one: name, field type, options with a colour each (click a colour for the next, add and remove options), what a choice depends on, which file types carry it with an eye to hide it per type, its section, Delete |
| A reference | "Set" or "Locations": the field type Reference, what it points at, one file or several |
| New property | Starts as a text property on the file type the list is narrowed to |
| Edit with AI | See round 7 below |
| Provided by apps and extensions | The reserved fourth kind: an empty group with its explanation |
| Naming patterns | A pattern and a number of digits per file type, with the name the next file will get. Every token in a pattern sits in a box: accent-coloured when it exists, red and underlined when it does not (type `{ddd}`) or does not apply to the file type (`{device}` on a shot), with the reason underneath; such a pattern is not in use until it is fixed. Clicking a token in the legend puts it into the pattern being edited, at the caret |
| Extensions | Hardware and Flows as switches; Flows needs Hardware; switching Hardware off switches Flows off too |
| General | The project's name and its fixed folders |

## Round 7 (2026-11-20): Edit with AI, and three corrections

From the owner's reaction to round 6. Code: `AiEdit.tsx`, `catalogue.tsx`.

| Change | What to try |
| --- | --- |
| Section is a combobox | In a property's editor, Section lists the sections that exist; typing a new name offers "Create …". (The design system's combobox learned to create an entry) |
| The property editor can be dragged | Its left edge is a grip, 300 to 560 px, like the other panels |
| Options use the colour chooser | Click an option's dot: the eight predefined colours and "+" for one of your own, the same chooser as for a collection |
| **Edit with AI**, not only import | The button in Properties. Two modes: **Add properties** (only new ones come in) and **Change and add** (existing ones may be renamed, retyped, re-attached or get other options; nothing is removed) |
| Step 1 · Ask | Choose the mode and write what you need. The prompt on the right is built from it live: the task for the mode, your request, the project's properties as they are (so the AI knows what exists and can refer to them), and the answer format. It fills the dialog's height and "Copy the prompt" really copies it |
| Step 2 · Paste the answer | "Use a sample answer" fills in one that fits the mode. The line underneath counts what was understood; an answer wrapped in a code fence is accepted |
| Step 3 · Review, adding | Each new property is drawn as the input it will be in the properties panel, with its options, section and file types. Untick what you do not want |
| Step 3 · Review, changing | Each changed property is shown **now and after**, side by side as inputs, and underneath what changes: name, field type, options added and removed, file types, section. Where a change costs something it says so with the number from the project: "6 files use 'Idea' and lose the value" |
| What cannot be used | Entries with an unknown field type, a missing name, a choice without options, a change in "add" mode, or a name that exists are listed with the reason and left out |

Nothing is applied before "Apply n properties" in the last step.

Afterwards: every dropdown now uses the design system's own list. The design system's Select had been the browser's native menu; it was rebuilt on the same listbox as the combobox, with the same keyboard handling, and opens upward when there is no room below. The picker behind "a colour of your own" was the last native control; it is now the design system's own colour picker (a field for saturation and brightness, a hue bar, the hex value), opened by the "+" next to the eight colours.

"Change and add" can also propose removing a property. A removal is its own group in the review, never ticked for you, and says how many files have a value; the property would go to the bin with its values.

## Stand-ins

- **Pictures** are generated placeholders. Real example photos are still to come ([02](02-optics.md)).
- **The icons for set and location** are existing glyphs standing in; both are to be drawn.
- **File-type colours** are a first assignment from the eight categorical colours.

## Not built yet

Creating and saving a filter, the "new" flows, context menus, drag and drop between folders, the account home as a second root, keyboard handling.

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
- **Small file icons are 20 px,** with the glyph centred exactly.
- **The property catalogue** is one list in sections that can be narrowed by file type. A section is picked from the existing ones or typed new.
- **Colours are always chosen the same way:** the predefined set plus a picker for any colour, for a collection and for an option alike.
- **AI edits the catalogue in two modes,** adding only, or changing and adding. Each has its own review: new properties as the inputs they will be; changed ones as now and after, with what the change costs. In the second mode the AI may propose removing a property; a removal is never ticked for the user.
- **The colour picker is the app's own,** not the browser's.
- **Dropdowns never use the browser's menu;** they use the design system's list.
- **Tokens in a naming pattern are shown as boxes and validated:** an unknown token, or one that does not apply to the file type, is marked with the reason, and the pattern is not used until it is fixed.
- **A collection's colour** is given at random when the collection is made. It can be changed to one of the predefined colours or to any colour with a picker. It is stored with the collection on the server, so everyone sees the same.
