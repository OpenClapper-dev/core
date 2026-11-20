# 09a · Places

Workshop [#352](https://github.com/OpenClapper-dev/core/issues/352). Status: **decided** (2026-11-20).

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

## The model

### Two file types

| | **Set** | **Location** |
| --- | --- | --- |
| What it is | The place in the story where a scene plays: "Joe's kitchen", "the bridge at night" | The real place where it is filmed: a flat, a street, a studio |
| Comes from | The screenplay | Scouting |
| German | Motiv | Drehort |
| Has an address | No | Usually |
| Has a position on the map | No | Optional |

"Set" and "Location" are the two terms script breakdowns and scheduling use side by side. "Set" also means a built set in everyday speech; in the app it is always the story place.

Both are files of a project ([07](07-organisation.md)) and built alike: properties and a content list, as a shot has ([04](04-shots.md)), without a progression.

- A **location's** content list holds what was gathered there: scouting photos, floor plans, other canvases.
- A **set's** content list holds what describes it: references, mood pictures, sketches.
- Nothing is stored per entry, one file can be in several lists, and a removed file leaves a missing reference, as everywhere.

### Relations

| Relation | Meaning | How many |
| --- | --- | --- |
| Shot → set | The shot plays there | One per shot |
| Set → location | A real place found for it: a candidate, or the chosen one | Any number each way |

Several sets at one address are several sets pointing at the same location. There is no parent and child, and there are no spots.

These relations are properties of a new field type.

### New field type: reference

A **reference** is a property whose value is one or several files of a given type.

- It shows as a chip that opens the file.
- Search, filters and the board work with it: shots grouped by set is a board with one column per set.
- A removed file shows as a missing reference.
- It is a generic field type: a project can define references of its own.

In the default template of a new project: "Set" on shots (one set) and "Locations" on sets (any number of locations).

### Geography

- **Address** is a text property on locations, in the default template.
- **New field type: position.** Coordinates, set by placing a pin on a map or by typing them. In the default template it is on locations. Like every field type it is generic: a project can attach a position to other file types.
- **Map view.** The file browser gets a fourth view next to list, grid and board ([07](07-organisation.md)): the files that carry a position, on a map.
- **No lookup for now.** Finding an address on the map automatically is added later; it would send addresses to an outside service.
- **Photos still record no position** at capture ([01](01-media.md)).

### Apps

Sets and locations are listed by the file browser and open in a window like a shot's (properties, content list). Whether they share one app is a question for the UX workshops.

## What goes

Locations and spots as today's tables, the location › spot hierarchy, pins "synced" to shots, positions taken from photos, creating places on the fly by name from a tag form, the Locations app.

## Handed to other workshops

- **UX workshops:** the set and location windows, references in lists and boards, the map view, the pin editor.

## Decided

2026-11-20, by the owner:

- **Two built-in file types: Set** (the story place, Motiv) **and Location** (the real place, Drehort), each with properties and a content list.
- **The names** are Set and Location, the pair used in script breakdowns.
- **A position field type and a map view are part of the rebuild.** A position is set by a pin or by coordinates; address lookup comes later.

Taken from the proposal with the above: the reference field type and the two relations (shot → set, set → locations, many-to-many); address as text; no spots.

Not chosen: generic elements with project-defined kinds. Characters, props and the like would each need a file type of their own if they are wanted later.
