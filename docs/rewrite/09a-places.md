# 09a · Places

Workshop [#352](https://github.com/OpenClapper-dev/core/issues/352). Status: **proposal, nothing decided yet**.

What a place is in the rebuild. Added by [workshop 07](07-organisation.md), which postponed the question.

## Starting notes from the owner

- In film a location usually is not a geographic location but a place in the story (German: *Motiv*). A Motiv can have an address, but it does not inherently have one.
- Each script location is its own, not a child of another. Several may share one physical address, which is a different relation from parent and child ([01](01-media.md)).
- GPS on photos served one past workflow and is gone ([01](01-media.md)).

## As-is

| Fact | Where |
| --- | --- |
| A **location** is a named place of a project with an optional map pin; a shot has at most one | `docs/features/projects.md`, `docs/features/review-and-tagging.md` |
| A **spot** is a place inside a location, with its own optional pin; a shot has at most one, always of its location | `projects.md` (Spots) |
| Photos carry GPS from the phone; a shot's map position is its cover photo's, or its spot's or location's pin when the shot is "synced" to it; positions can be corrected by hand | `docs/features/positions.md` |
| Maps show shots; the Locations app lists places with counts and pins | `apps/studio/src/MapView.tsx`, `Locations.tsx` |
| Locations are created on the fly from the tag form on both clients and synced by name | `projects.md` (Sync details) |

## Problems and leaks

1. **One word for two things.** "Location" is used for the place in the story and for the real place where it is shot. The model has only one object for both, so "the kitchen scene, shot at Hauptstraße 5" and "the hallway scene, also at Hauptstraße 5" cannot both be said.
2. **A hierarchy where the relation is many-to-many.** Location › spot assumes one real place with parts. In fact one story place can have several candidate real places, and one real place can serve several story places.
3. **Geography is built in.** Pins, GPS and maps shape capture and the data model, although a story place needs none of it.
4. **Places can only hang on shots.** A scouting photo belongs to a real place before any shot exists.

## Proposal

### Two things, kept apart

| | Story place | Real place |
| --- | --- | --- |
| What it is | Where a scene plays: "Joe's kitchen", "the bridge at night" | Where it is filmed: a flat, a street, a studio |
| Comes from | The screenplay | Scouting |
| Has an address | No | Usually |
| German | Motiv | Drehort |
| English (proposed) | **Setting** (open question 2) | **Location** |

Relations:

| Relation | Meaning | How many |
| --- | --- | --- |
| Shot → setting | The shot plays there | One per shot |
| Setting → location | A real place found for it: a candidate, or the chosen one | Any number each way |

Several settings at one address are several settings pointing at the same location. There is no parent and child.

### How they are built

Proposed (open question 1): places are not special. The base gets one generic file type and one new field type, and "setting" and "location" are made from them.

- **Element:** a file with properties and a content list, like a shot without a progression. A project defines **kinds** of element (a name, an icon, the properties attached). The word is the one script breakdowns use for what a scene needs.
- **Reference:** a new field type whose value is one or several files of a given type or kind. It shows as a chip that opens the file, and search, filters and the board work with it (shots grouped by setting is a board).
- **The default template** of a new project has two kinds: *Setting* and *Location*, the property "Setting" on shots (a reference), "Locations" on settings (references), and "Address" on locations (text).

What that gives:

- A location's content list holds its scouting photos and floor plans; a setting's can hold references and mood pictures.
- A project that does not think in settings deletes the kind; one that also wants characters or props adds a kind. The base has no opinion.
- Kind definitions are files in the project's Settings folder, like property definitions ([07](07-organisation.md)).

### Geography

Proposed (open question 3): for now an address is text. Positions and maps come later as two generic pieces, not as part of places: a **position** field type (coordinates, optionally filled from an address) and a **map view** of the file browser next to list, grid and board, showing files that carry a position. Photos still record none.

### What goes

Locations and spots as built-in tables, the location › spot hierarchy, pins and "synced" positions, creating places on the fly by name from a tag form.

## Handed to other workshops

- **UX workshops:** elements in the browser and the shot window, the kind editor, references in lists and boards.

## Open questions

1. **Shape:** generic elements with project-defined kinds, two built-in file types, or properties only?
2. **Name** of the story place.
3. **Geography:** address as text now and a map later, a position field and map view now, or none?

## Decided

Nothing yet.
