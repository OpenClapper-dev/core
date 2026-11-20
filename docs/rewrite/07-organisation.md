# 07 · Organisation and filesystem

Workshop [#334](https://github.com/OpenClapper-dev/core/issues/334). Status: **decided** (2026-11-20).

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

## The model

### Everything is a file

Every object a user makes is a **file**, in the sense Linux uses the word. A file has an id, a type, the system properties, whatever properties its type carries, one place in a tree, and an app that opens it. It can be binned and restored.

| File type | Content | Lives in |
| --- | --- | --- |
| Folder | Any files, including folders and collections | A project or an account home |
| Collection | Photos only; cannot hold folders or collections | A project |
| Photo, canvas, shot, timeline | See [01](01-media.md), [05](05-composition.md), [04](04-shots.md), [06](06-timeline.md) | A project |
| Master timeline | An order of timelines; exactly one, cannot be created, moved or binned | A project |
| Filter | A saved query over files (below) | A project |
| Optics preset | See [02](02-optics.md) | A project |
| Property definition, naming pattern | See Properties and [04](04-shots.md) | A project's settings folder |
| Device, camera layout | See [03](03-capture.md) | An account home |

Extensions bring file types of their own (workshop 08).

### Two kinds of root

- **A project** is a root. It is a hard scope: nothing moves between projects, and both clients enter a project first.
- **An account home** is the other root, one per account: files that belong to a person and are with them in every project. Devices and camera layouts live there.

### Containers

A file sits in exactly one container, or at the top level of its root.

| Container | Holds | Nests |
| --- | --- | --- |
| Folder | Any files | Yes |
| Collection | Photos | No; it can sit in a folder |

- There is no manual order in a folder: sorting is by name, date, type or a property. A collection has an order for the media library ([I1](i1-interjection.md)).
- "A photo is in at most one collection" is this rule: a photo has one place.
- **Fixed folders** per project, which cannot be renamed, moved or binned: **Desktop** (its contents are the desktop's icons, as today; shortcuts to apps and to files elsewhere stay) and **Settings** (property definitions and naming patterns live only there; they are edited through project settings and visible in the tree).
- **Internal files** ([I1](i1-interjection.md)) are in no container; they show inside their parent.
- A shot is not a container: a folder is where a file lives, a shot points at files and adds intent and order ([04](04-shots.md)).

### The bin

Every delete bins; restore puts a file back where it was; purge after 30 days, as today. Because everything points at files by reference, a binned file only shows as missing where it was used, and a restore brings every use back. A container is binned with its contents, an internal file with its parent. A photo's stored image is removed only when the last photo sharing it is purged.

### Properties in detail

The catalogue of [04](04-shots.md), made concrete. A property definition is a file in the project's Settings folder.

**Four kinds of property:**

| Kind | Examples | Defined by | Editable value | Can be hidden |
| --- | --- | --- | --- | --- |
| System | Name, type, created, updated, created by | The base | Name only | No |
| Facts of the file type | A photo's angle of view, device | The file type | No | Yes |
| Provided by an app or extension | A light condition a scheduling feature calculates with | That app; fixed meaning and values | Yes | Yes |
| Project-defined | Scene, shot size, status | The project | Yes | Yes |

The third kind is reserved: a feature that has to calculate with a property brings that property itself, so the core never has to understand a project's own fields. Nothing uses it yet.

**A project-defined property:**

| Part | Meaning |
| --- | --- |
| Name | Free text |
| Field type | Text, long text, number, yes/no, single choice, multiple choice, date |
| Options | For choices: a label and a colour each |
| Attached to | The file types that carry it |
| Depends on | Optional, for a choice: its options depend on another choice's value (line → station); changing the parent clears a value that no longer fits |
| Section | Optional heading that groups properties in the list; visual only |
| Hidden | Per file type; values are kept |

- **Structure is flat.** Sections are headings; there are no nested groups.
- **Default template** of a new project: for shots a typical shot list (scene, shot number, shot size, angle, movement, support, lens, INT/EXT, day or night); for a canvas a "kind" (floor plan, lighting diagram, blocking, storyboard); none for other types. No location property: places have their own workshop.
- **Deleting a definition** bins it with its values; a restore brings both back.
- **AI import** as today: a prompt explains the format, the answer is imported as definitions.
- A "reference to a file" field type may follow; it is a question of the places workshop.

### Finding and bulk editing

One file browser serves every place files are listed (the Files app, the media library, the timeline's file panel):

- **Search** over names and property values, across all file types.
- **Filter:** a saved query over files (types, properties, container), itself a file. Opening it lists what matches now. It replaces saved views.
- **Views of a list:** list, grid, and **board**: columns by one single-choice property; dragging a file to another column sets it. The board replaces the Metadata app and works on every file type.
- **Bulk edit:** select files, set a property on all.

### Places

Not in the base for now: no locations, spots, positions or maps. Places get a workshop of their own, [#352](https://github.com/OpenClapper-dev/core/issues/352), after workshop 09. Its starting note from the owner: in film a location is a place in the story (German: Motiv). A Motiv can have an address, but it is not in itself a geographic location.

### Roles

Who may do what in a project or workspace is business logic for later ([00](00-principles.md)).

## What goes

Locations, spots and their pins, positions and maps (until the places workshop), saved views (filters replace them), extra-field groups and their nesting, the Metadata app (a board view of the browser), days as a file type, "apps, not files" for rigs, layouts and devices, per-type exceptions in what a file can do.

## Handed to other workshops

- **08 (extensions):** file types and properties an extension brings.
- **09 (shells):** the Files app and the media library as uses of one browser; the desktop; project settings; the account home in the Studio and on the phone.
- **09a (places), [#352](https://github.com/OpenClapper-dev/core/issues/352).**
- **UX workshops:** the browser, the board, the property editor.

## Decided

2026-11-20, by the owner:

- **Everything is a file,** as in Linux: folders and collections too, and presets, property definitions, naming patterns, devices and camera layouts.
- **A folder is a file that contains any files; a collection is a file that contains only photos.** A folder nests, a collection does not.
- **Account-owned files live in an account home,** a root of its own next to the project roots.
- **A project's property definitions and naming patterns live in a fixed Settings folder.**
- **Properties:** the field types text, long text, number, yes/no, single choice, multiple choice, date; a flat list with section headings; a choice can depend on another choice; no nested groups. A fourth kind of property, provided by an app or extension with a fixed meaning, is reserved.
- **Places are postponed** to a workshop of their own after 09 ([#352](https://github.com/OpenClapper-dev/core/issues/352)). No locations, spots, positions or maps in the base until then.

Taken from the proposal with the above: the bin with restore of every use; one file browser with search, saved filters, list, grid and board views and bulk edit; the Desktop folder and shortcuts as today.
