# Projects

Every shot belongs to exactly one project (a film, a commercial). Projects are a **hard scope** ([issue #44](https://github.com/bubulux/fielder/issues/44)): locations, saved views, extra-field definitions, shooting days and timelines belong to one project; only rigs are shared. There is no view across projects: entering a project is the first step in both clients.

## Behaviour

- **Active project, chosen once.** Both clients ask which project to work on and remember it until you change it: Studio in `localStorage["project"]`, phone in the kv-store (`activeProjectId.v1`).
- **Studio:**
  - A first visit (or a remembered project that no longer exists) shows the full-window project picker (`ProjectGate` in `Projects.tsx`).
  - The taskbar's project switcher lists the projects and "Manage projects…"; ⌘K → a project name switches too. Switching swaps the whole desktop: each project has its own windows (per browser) and its own icons and folders (on the server, [files](files.md)). Every app (Gallery, Timeline, Metadata, Plan, Fields, Locations, Files, saved views) shows the active project only.
  - Projects (an app; Library on the old sidebar): a list (shots, fields, "can be deleted") and a detail with name and notes (saved when leaving the field), the project's [extra fields](extra-fields.md) in order ("Edit fields" makes it active and opens Fields), "Show n shots" and "Make active". Only empty projects can be deleted; its locations, fields and views go with it.
  - **Inline creation** when moving shots: the inspector's Project box, the Move to project dialog and the bulk-edit panel offer "Create “…”" for a new name (`createProjectNamed` in `api.ts`). A name that exists already is taken instead (the 409 carries its id), so nothing is duplicated.
  - A shot moves to another project via the Project box in the shot view's inspector (or bulk edit). Its **location follows by name**: the target project's location of that name, created when missing (with the pin). Extra values the target's fields don't accept are dropped. When the move leaves shooting days or drops extra values, a warning names them and Move confirms.
- **Phone:**
  - After sign-in (or skipping it), a full-screen gate asks for a project if none is active (`screens/Gates.tsx`). You switch with the **project pill** in every header, the HUD project chip on Shoot or Setup → Project; all open the Project sheet (`components/ProjectSheet.tsx`, a search above 8 projects, "New project" by name, works offline). A switch says "Now shooting for …".
  - Projects can be created offline; they sync before any queued shot uploads.
  - The camera HUD shows the active project name. The shutter is disabled without a project.
  - History, Shots and Day show only the active project (`useShots(projectId)` → `GET /api/shots?project_id=`). The tag editor offers the shot's project's locations and creates new ones there; the remembered location (LAST) only carries over within the same project.
  - Uploads stay lenient: a shot that arrives with a location of another project (a stale phone) gets its project's location of that name, created when missing.

## Spots

A **Spot** is a named place within a location (the north gate, the roof, the bridge's east end; "Position" already means GPS, hence the name). It has an optional pin and belongs to one location; a shot has at most one, always of its own location.

- **Studio**: Library › Locations shows the focused location's spots in a side panel (Add spot, rename, Set position, delete). The inspector has a Spot box under Location ("Create “…”" adds one). Lists show "Location · Spot" (`placeLabel`); the filter has a Spot field.
- **Phone**: the tag editor's Spot row appears once a location is set; spots are created offline like locations (`spots.v1`, synced after locations in `flush()`, a name clash adopts the server's spot).
- Changing a shot's location clears its spot. Moving a shot to another project takes the spot along by name under the remapped location. Uploads resolve a stale spot leniently (by name under the shot's location, else none).
- Maps: a synced shot uses the spot's pin, else the location's ([positions](positions.md)).

## Sync details (phone)

`flush()` in `apps/mobile/src/uploads.ts` runs `syncProjects` (`namedSync.ts`) first:
1. It pushes unsynced projects. A name clash (409) adopts the server's id and remaps queued shots and the active project id.
2. It pulls the server list (with `field_ids`) and keeps projects created while the sync was running.
3. It notifies `onFlushed` listeners, which lets `App.tsx` pick up renamed or remapped ids.

## Code

- Worker: `apps/worker/src/projects.ts`
- Studio: `project.ts` (active project, switch guards), `data.ts` (`useProjectData`: one project's slice), `wm/Shell.tsx` (gate, desktop per project), `Projects.tsx`, `apps/LibraryApps.tsx`
- Phone: `App.tsx`, `screens/Gates.tsx`, `components/ProjectSheet.tsx`, `namedSync.ts`, `storage.ts`
