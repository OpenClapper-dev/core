# 07 · Organisation and filesystem

Workshop [#334](https://github.com/OpenClapper-dev/core/issues/334). Status: **proposal, nothing decided yet**.

Where files live, how they are found and described, and what happens to places. This workshop collects the hand-overs of 01–06 and the [interjection](i1-interjection.md).

## As-is

| Fact | Where |
| --- | --- |
| A project is a hard scope: shots, locations, saved views, extra-field definitions, days and timelines belong to one project; entering a project is the first step in both clients | `docs/features/projects.md` |
| Six record types are **files**: shot, timeline, day, view, location, field. Rigs (per workspace), viewfinder layouts and devices (per user) are apps, not files | `packages/vocab/src/files.ts`, `docs/features/files.md` |
| **Folders** belong to a project and nest up to 8 deep; a file sits in at most one folder; there is no manual order. Every project has a **Desktop** folder whose contents are the desktop's icons; shortcuts point at apps and at files elsewhere | `files.md` (Model, Desktop icons) |
| **Recycle bin:** every delete bins; restore puts a file back in its folder; purge after 30 days. A restored shot does not get back its timeline clips or day places | `files.md` (Recycle bin), `docs/known-issues.md` |
| **Saved views** are stored filters over shots, opened in the Gallery | `packages/vocab/src/filter.ts`, `views` table |
| **Extra fields** are defined per project as JSON (text, number, yes/no, select, group; a select can depend on a sibling inside a group; groups nest 4 deep), with an AI prompt and import. Values live on shots only | `docs/features/extra-fields.md`, `packages/vocab/src/fields.ts` |
| The **Metadata board** sets one single-value tag on many shots by drag and drop between columns | `docs/features/review-and-tagging.md` |
| **Locations** are named places of a project with an optional map pin; **spots** are places inside a location. A shot has one location and one spot; a shot can take its map position from them | `projects.md` (Spots), `docs/features/positions.md` |
| Photos carry GPS; maps show shots; positions can be corrected | `positions.md` |

## Problems and leaks

1. **"File" is a list of exceptions.** Six types are files, three are not, and what a file can do (rename, move, open) differs by type.
2. **Organising is tied to shots.** Views filter shots, fields describe shots, the board edits shots.
3. **Places are a built-in hierarchy** (location › spot) with map positions, made for one way of working. Workshop 01 removed positions from photos and handed places here with the owner's note: a location is usually a place from the screenplay, each one its own, and several may share an address.
4. **The bin forgets links.** Restoring a shot does not restore where it was used.

## Proposal

### What is a file

A **file** is something a user makes in a project that has content of its own. Every file has properties, can sit in a folder, can be binned and is opened by an app.

| Object | File? | Why |
| --- | --- | --- |
| Photo, canvas, shot, timeline | Yes | Content the user makes |
| Filter | Yes | A saved query that opens as a list of files (below) |
| Master timeline | A fixed item | Exactly one per project; it cannot be created, moved or binned |
| Optics preset | No: managed in its app | A reusable setting, not content |
| Property definition, naming pattern | No: project settings | They describe files |
| Device, camera layout | No: managed in their apps | They belong to an account, not a project |

Open question 1.

### Folders

As today: a folder belongs to a project, folders nest, a file sits in at most one folder or at the top level, and there is no manual order (sorting by name, date, type or a property). The Desktop folder and shortcuts stay as they are.

- **Internal files** ([I1](i1-interjection.md)) are not in any folder and not in the browser; they show inside their parent.
- A shot is not a folder: a folder is where a file lives, a shot points at files and adds intent and order ([04](04-shots.md)).

### Collections

Proposed: a **collection is a kind of folder** (open question 2). It holds only photos and no subfolders, the camera can create one, and the media library shows it as one tile or spread out. "A photo is in at most one collection" is then the folder rule that already exists, and there is one answer to "where is this photo".

### The bin

Unchanged in behaviour: every delete bins, restore, purge after 30 days. Better than today in one way: because everything points at files by reference, a binned file only shows as missing where it was used, and a restore brings every use back. An internal file is binned and restored with its parent. A photo's stored image is removed only when the last photo sharing it is purged.

### Properties in detail

The catalogue from [04](04-shots.md), made concrete:

| Part of a definition | Meaning |
| --- | --- |
| Name, field type | Text, long text, number, yes/no, single choice, multiple choice, date |
| Options | For choices: a label and a colour each |
| Attached to | The file types that carry it |
| Depends on | Optional, for a choice: its options depend on another choice's value (line → station) |
| Section | Optional heading that groups properties in the list |
| Hidden | Per file type; values are kept |

- **Structure:** flat. Today's nested groups become section headings; a dependent choice stays (open question 4).
- **Default template** of a new project: for shots a typical shot list (scene, shot number, shot size, angle, movement, support, lens, INT/EXT, day or night); for a canvas a "kind" (floor plan, lighting diagram, blocking, storyboard); none for photos and timelines.
- **Deleting a definition** bins it with its values; a restore brings both back.
- **AI import** as today: a prompt explains the format, the answer is imported as definitions.
- **Naming patterns** ([04](04-shots.md)) and the catalogue are edited in the project's settings.

### Finding and bulk editing

One file browser serves every place files are listed (the Files app, the media library, the timeline's file panel):

- **Search** over names and property values, across all file types.
- **Filters:** a saved query over files (types, properties, folder), stored as a file. Opening it lists what matches now. It replaces saved views.
- **Views of a list:** list, grid, and **board**: columns by one single-choice property, drag a file to another column to set it. The board replaces the Metadata board and works on every file type.
- **Bulk edit:** select files, set a property on all.

### Places

Proposed (open question 3): no location objects, no spots, no map in the base for now. A place is described with what already exists:

- "Location" is a property on shots (a choice), part of the default template; an address is another property.
- Photos and canvases of a place sit in a folder.
- Several script locations at one address are two options with the same address value.

A richer shape is recorded for later: a location as a file type of its own, with properties and a content list like a shot, and shots pointing at it through a "reference" property.

### Projects and scope

Unchanged: a project is a hard scope, nothing moves between projects, and both clients enter a project first. Project settings hold the property catalogue, the naming patterns and, through their app, the optics presets. Who may do what (roles) is business logic for later ([00](00-principles.md)).

### What goes

Locations, spots and their pins, positions and maps, saved views (filters replace them), extra-field groups and their nesting, the Metadata app (a board view of the browser), days as a file type, per-type exceptions in what a file can do.

## Handed to other workshops

- **09 (shells):** the Files app and the media library as uses of one browser; the desktop; which apps exist.
- **UX workshops:** the browser, the board, the property editor, project settings.

## Open questions

1. **Files:** is the split above right (photo, canvas, shot, timeline and filter are files; presets, definitions, devices and layouts are not)?
2. **Collections:** a kind of folder, or a grouping of their own next to folders?
3. **Places:** a property and folders for now, or a location file type?
4. **Property structure:** flat with sections and dependent choices, or nested groups as today?

## Decided

Nothing yet.
