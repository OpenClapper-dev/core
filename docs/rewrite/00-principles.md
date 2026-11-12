# 00 · Principles, personas, glossary

Workshop [#327](https://github.com/OpenClapper-dev/core/issues/327). Status: **four naming and tier questions decided; principles, personas and the remaining glossary await the owner's read**.

This page sets the rules every later workshop is checked against, names who the app is for, and gives each concept one name.

## As-is

The current model in one line (from `CLAUDE.md`): a shot holds the metadata and owns 1..n photos; rig, lens, framing and GPS are per photo.

What that means in the code today:

| Fact | Where |
| --- | --- |
| The shutter is disabled without a rig; a "Set up a rig" card covers the preview | `apps/mobile/src/screens/Viewfinder.tsx:240`, `:430`, `:503` |
| Every phone photo carries a rig snapshot and a mandatory `lens_mm` | `apps/mobile/src/types.ts` (`PhotoMetadata`), `photos.framing` |
| A photo is always created inside a shot, which carries review state and about 12 tag properties | `shots` table, `apps/worker/src/shots.ts` |
| Uploaded and drawn photos have no snapshot: no re-framing, no vignetting, `lens_mm` stored as 0 | `photos.source`, `docs/features/new-shot.md` |
| The frame a photo is shown with is resolved through five places: as-captured snapshot, saved framings, the root framing, the step's framing, the clip's presentation copy | `packages/vocab/src/framing.ts`, `packages/vocab/src/compose.ts` |
| Rig data is read from two sources that can disagree: FOV from the photo's snapshot, vignetting from the live rig | `apps/studio/src/format.ts` (`sourceRigOf`), `apps/studio/src/vignette.ts` |
| The math itself needs only sensor width and height, focal length, reducer factor, orientation | `packages/fov-math/src/fov.ts` |
| Lights sync runs inside every photo upload round; the layout-preview socket also carries light commands | `apps/mobile/src/uploads.ts:145`, `apps/mobile/src/preview.ts` |
| Without an active project the whole phone app is blocked, not only capture | `apps/mobile/src/screens/Gates.tsx` (`ProjectGate`) |
| "Files" in the Studio are views onto six record types (shot, timeline, day, view, location, field); rigs, layouts and devices are apps, not files | `packages/vocab/src/files.ts` |

## Problems and leaks

1. **No base objects.** There is no photo without a shot, no shot without a photo (a drawn shot fakes one with a rendered PNG), no optics without a rig. Each feature assumes the features next to it.
2. **Data that should be optional is structural.** Rig, lens and frame are part of what a photo *is*, so anything showing a photo (thumbnails, layers, bakes, clips) depends on them.
3. **One path in.** The viewfinder is the only way to take a photo on the phone, with all its opinions.
4. **Expert features are not separable.** Lights, mesh, camera control and light sequences share sync, transport and the app list with everything else.
5. **Names are overloaded:**

| Word | Meanings today |
| --- | --- |
| sequence | a shot captured with several photos · a block of clips on a timeline · a keyframed light programme · (mesh sequence numbers) |
| device | this phone's spec record (`devices`) · the Studio's Devices app, which controls light fixtures |
| workspace | the tenancy unit (members, roles) · a virtual desktop in the Studio |
| fit | the viewfinder button (digital zoom to the frame) · the view mode that crops a stored photo |
| view | a saved filter (`views`) · a view mode (mask/frame/fit/raw) |
| preset | the table behind rigs · lens and speedbooster preset lists |
| camera | a rig's body (`camera_id`) · the Blackmagic camera controlled as a fixture · the phone's camera |
| step | a stage of a shot · (colloquially) a stop when stepping through a day |
| overlay | the frame overlay on the viewfinder · the dead `overlays` table (drawings before layers) |

## Proposal

### Principles

1. **A block works alone.** Each building block (media, optics, capture, shot, composition, timeline, organisation) is usable with every other block absent or empty. Test: can a user who never opens the other apps get value from this one?
2. **Links are optional references.** Blocks are connected by references the user makes (or an automation makes for them) and can remove. A missing or removed link degrades what is shown; it never blocks an action or makes an object invalid.
3. **Facets, not required fields.** Extra knowledge about an object (position, capture device, optics, review state, tags) is an optional facet that can be added at any time, by hand, in bulk, or at capture. An object without a facet is complete.
4. **Automation is a shortcut, never the only way.** Everything a capture profile or device registration fills in automatically can also be added by hand later, and the result is the same data.
5. **Generic first, bundles on top.** The base is the generic statement (sensor size, focal length); the convenient bundle (a rig with its lenses and vignetting) is a saved shortcut that resolves to the generic statement.
6. **Core does not know extensions.** An extension can be switched off and the core runs unchanged: own tables, own sync, own transport, own apps. Core code never imports extension code.
7. **One name per concept, one concept per name**, the same in UI, API, schema and docs.
8. **The Studio is an operating system.** Objects the user makes are files; features are apps that open file types. The phone is a companion that offers some of those apps.
9. **Never lose a capture.** Unchanged from today: idempotent uploads, lenient upload validation, persistent drafts, rejected uploads stay queued.
10. **No compatibility code.** The rebuild carries nothing for old data or old clients.

### Tiers

| Tier | Meaning | Candidates (decided per block in workshops 01–09) |
| --- | --- | --- |
| Core | Always present; what "the app" is for anyone on a production | Media, capture, shots, organisation (projects, locations, files), the shells |
| Standard apps | Shipped and visible by default, each removable from the desktop; built only on core | Optics and framing, composition, timeline, camera layouts |
| Extensions | Off by default, enabled deliberately; own data and transport | Lights, flows, Blackmagic camera control, live picture; later: custom fields, automations |

### Personas

| Persona | Needs first | Blocks used | Does not need |
| --- | --- | --- | --- |
| Location scout | Photos fast, a position on each, assigned to a location and spot, notes | Media, capture (plain camera with position and location modules), organisation | Optics, frames, composition, timeline |
| DP | The frame of a given sensor and lens, on the phone and on stored photos; comparing optics; planning shots | Capture with the frame overlay, optics, shots, composition, timeline | — |
| Gaffer / electrician | Reference photos of a place; controlling fixtures; light programmes | Media, capture (plain camera), extensions: lights and flows | Optics, timeline |
| Director | A shot list and a rough cut made of photos and sketches | Shots, composition (sketches), timeline, media | Device and rig detail |
| Line producer (later) | Structured data on objects, hand-offs between departments | Organisation, future custom fields and automations | Capture detail |

The owner is all of these at once; the app must not assume that of anyone else.

### Glossary

Proposed target vocabulary. Each later workshop refines the definition of its own terms; the names are fixed here.

| Term | Meaning | Replaces |
| --- | --- | --- |
| **Photo** | A still image in the media library, from the phone or uploaded. Complete on its own | photo as part of a shot |
| **Media library** | All photos of a project | — |
| **Facet** | An optional group of data on an object (position, capture device, optics, …) | mandatory `framing` / `device` snapshots |
| **Optics** | The generic statement that defines a field of view: sensor size, focal length, reducer, orientation | rig snapshot, `lens_mm` |
| **Rig** | A saved bundle that resolves to optics: body or sensor, lenses, reducer, vignetting | `presets` |
| **Frame** | A rectangle on a photo: what a given optics sees, or a free crop | framing fractions |
| **Framing** | A saved, named frame on a photo | same |
| **Device** | A registered piece of capture hardware with its specs (a phone, a camera) | `devices` (phone specs only) |
| **Fixture** | A controllable piece of equipment in the lights extension (light, battery) | fixtures; the Studio app is no longer called "Devices" |
| **Camera layout** | The arrangement of controls on the phone's camera screen | viewfinder layout |
| **Capture profile** | Which modules are on when taking photos, and which facets are filled automatically | Setup → Capture / Viewfinder settings, the forced rig |
| **Viewfinder** | The capture module that draws a frame over the live picture | the whole Shoot screen |
| **Series** | Several photos taken as one capture | capture "sequence" |
| **Shot** | A planned picture in a film: described by a sketch, by one or more photos, or by nothing yet | shot as container of photos |
| **Step** | One stage in a shot's progression | same |
| **Layer**, **Sketch** | As today; ownership and spaces are decided in workshop 05 | — |
| **View mode** | How a photo with a frame is displayed: **Mask**, **Outline**, **Crop**, **Full** | mask / frame / fit / raw ("off") |
| **Zoom to frame** | The viewfinder control that zooms the live picture to the frame | "Fit" button |
| **Timeline**, **Clip** | As today | — |
| **Block** | Adjacent clips treated as one unit on a timeline | timeline "sequence" / `groups` |
| **Flow** | A timed programme that drives fixtures | light sequence |
| **Filter** | A saved query over objects | `views` / "saved view" |
| **Workspace** | The tenancy unit: members and roles | same |
| **Desktop** | One virtual desktop in the Studio | desktop "workspace" |
| **File**, **Folder**, **App** | An object the user made, shown in the filesystem; a container; a program that opens file types | — |
| **Extension** | A package of apps, data and transport that is off until enabled | — |
| **Light**, **Dark** | The two themes | Sun, Set |

Dropped words: *preset* (as a table name), *overlay* (as stored data), *day* (Day planning is deleted), *extra field* (parked).

## Open questions

1. **Personas**: is anyone missing who should shape the first rebuild (script supervisor, production designer, 1st AD)?

## Decided

2026-11-12, by the owner:

- **Series** is the name for several photos taken as one capture. A series stays grouped in the media library and can be linked to a shot as a whole.
- **Device** and **Fixture** are two concepts. A device is registered capture hardware with specs (phone, camera) and belongs to the core. A fixture is controllable equipment (light, battery) inside the lights extension. Flows drive fixtures.
- **View modes** are Mask, Outline, Crop and Full. The viewfinder control is "Zoom to frame". "Frame" means only the rectangle.
- **Three tiers**: core, standard apps (shipped and visible, removable, built only on core), extensions (off until enabled). Which block sits in which tier is decided in that block's workshop.

Not yet confirmed: the ten principles, the persona table and the rest of the glossary stand as proposed until the owner has read this page.
