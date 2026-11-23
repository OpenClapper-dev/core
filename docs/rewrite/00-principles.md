# 00 · Principles, layers, glossary

Workshop [#327](https://github.com/OpenClapper-dev/core/issues/327). Status: **decided 2026-11-12**; principles, tiers and glossary brought in line with workshops 01–06 in the [interjection](i1-interjection.md) on 2026-11-19. [model.md](model.md) shows the current model in one picture.

This page sets the rules every later workshop is checked against, separates the base layer from the business logic on top of it, and gives each concept one name.

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
3. **Properties, not required fields.** Extra knowledge about a file is a property: a fact of its type (a photo's angle of view) or something the project defines (a status). A file without them is complete.
4. **Automation is a shortcut, never the only way.** What the app does for the user (a collection made by the camera, a framing series made by a generator) can also be made by hand, and the result is the same data.
5. **Generic first, bundles on top.** The base is the generic statement (format, focal length); the convenient bundle (an optics preset with its lenses) is a saved shortcut that resolves to the generic statement.
6. **Core does not know extensions.** An extension can be switched off and the core runs unchanged: own tables, own sync, own transport, own apps. Core code never imports extension code.
7. **One name per concept, one concept per name**, the same in UI, API, schema and docs.
8. **The Studio is an operating system.** Objects the user makes are files; features are apps that open file types. The phone is a companion that offers some of those apps.
9. **Never lose a capture.** Unchanged from today: idempotent uploads, lenient upload validation, rejected uploads stay queued.
10. **No compatibility code.** The rebuild carries nothing for old data or old clients.
11. **The base layer has no opinion about roles.** No primitive assumes a persona, a department or a workflow. Anything of that kind is expressed on top of the base layer (see [Two layers](#two-layers)).

### Tiers

| Tier | Meaning | Candidates (decided per block in workshops 01–09) |
| --- | --- | --- |
| Core | Always present; what "the app" is for anyone on a production | Media (photos, collections), capture, the angle of view and optics math, shots, properties, the canvas, organisation (projects, files), the shells |
| Standard apps | Shipped and visible by default, each removable from the desktop; built only on core | Optics presets, timeline and master timeline, camera layouts |
| Extensions | Off by default, enabled per project; own data, own channel on the phone link | Hardware (lights, batteries, cameras, video transmitters), Flows; later: scheduling, automations |

### Two layers

The app is thought of in two realms:

| Layer | What it is | Examples |
| --- | --- | --- |
| **Base layer** | Flexible primitives without an opinion about who uses them or how work is divided: objects, facets, links, apps, devices | A photo, optics, a frame, a canvas, a shot, a camera layout, a folder |
| **Business-logic layer** | Opinions laid over the base layer, as a layer of its own: roles and personas, the distribution of responsibilities, team workflows, automations | "A location scout's camera", an approval process, a hand-off between departments |

The rewrite builds the **base layer**. It does not design for personas: a persona is already an opinion about roles, and it belongs to the business-logic layer, which comes later and is modelled *with* the base primitives, not baked into them.

Roles such as DP, location scout or gaffer are used in the workshops only as **test cases**: a base layer is good when the experience each of them needs can be assembled from the same primitives without changing them. A plain camera and a DP's camera with an optics frame are two camera layouts of one capture block, not two features.

### Glossary

Proposed target vocabulary. Each later workshop refines the definition of its own terms; the names are fixed here.

| Term | Meaning | Replaces |
| --- | --- | --- |
| **File** | Every object a user makes: it has a type, properties, one place in a tree and an app that opens it ([07](07-organisation.md)) | "apps, not files" |
| **Folder** | A file that contains any files and nests | — |
| **Account home** | A person's own root, next to the project roots, for files that follow them (devices, camera layouts) | — |
| **Property** | A piece of metadata on a file: a system property, a fact of its file type, or one the project defines ([04](04-shots.md)) | tags, extra fields, "facet" |
| **Internal file** | A file created inside another file and bound to it ([I1](i1-interjection.md)) | — |
| **Photo** | A still image in the media library, taken with the app or imported. Complete on its own ([01](01-media.md)) | photo as part of a shot |
| **Media library** | All photos of a project | — |
| **Collection** | A file that contains only photos that belong together; a photo is in at most one ([01](01-media.md), [07](07-organisation.md)) | capture sequence |
| **Angle of view** | What a picture sees, horizontally and vertically ([02](02-optics.md)) | rig snapshot, FOV |
| **Optics** | The generic factors that give an angle of view: format, multiplier, squeeze, focal length, orientation ([02](02-optics.md)) | rig snapshot, `lens_mm` |
| **Optics preset** | A saved, fixed set of those factors with its lenses ([02](02-optics.md)) | rig, `presets` |
| **Frame** | A rectangle on a photo inside a canvas: an optics frame or an aspect frame ([02](02-optics.md), [05](05-composition.md)) | framing fractions, saved framings |
| **Canvas** | The file type for drawings, floor plans and photos with marks, looks and frames ([05](05-composition.md)) | sketch, layers on a shot, the Framing stage |
| **Render** | The flattened image of a canvas ([05](05-composition.md)) | bake |
| **Device** | Any registered piece of hardware, with a type: phone and tablet in the core; light, battery, camera, video transmitter in the Hardware extension ([03](03-capture.md), [08](08-extensions.md)) | `devices` (phone specs only), fixtures |
| **Camera layout** | Which controls the phone's camera screen shows, and where; it doubles as the capture profile ([03](03-capture.md)) | viewfinder layout, capture settings |
| **Viewfinder** | The built-in camera layout with an optics frame | the whole Shoot screen |
| **Zoom to frame** | The camera control that enlarges the live picture to the frame | "Fit" button |
| **Shot** | A planned picture in a film: an intent with properties, a content list and optionally a progression ([04](04-shots.md)) | shot as container of photos |
| **Progression** | A shot's timed order of pictures ([04](04-shots.md)) | sequence, steps |
| **View mode** | How something with a frame is displayed: **Mask**, **Outline**, **Crop**, **Full**; a window's choice | mask / frame / fit / raw ("off") |
| **Timeline**, **Clip** | A rough cut; a reference with a hold time ([06](06-timeline.md)) | — |
| **Set** | The place in the story where a scene plays (German: Motiv); a file type ([09a](09a-places.md)) | location (as script location) |
| **Location** | The real place where something is filmed (German: Drehort); a file type ([09a](09a-places.md)) | location with spots and pins |
| **Placeholder** | A clip without a file | same |
| **Chapter marker** | A title at the start of a clip that organises a timeline | — |
| **Master timeline** | The project's one order of timelines ([06](06-timeline.md)) | — |
| **Flow** | A timed programme that drives the controls of devices; the Flows extension ([08](08-extensions.md)) | light sequence |
| **Filter** | A saved query over files | `views` / "saved view" |
| **Workspace** | The tenancy unit: members and roles | same |
| **Desktop** | One virtual desktop in the Studio | desktop "workspace" |
| **App** | A program that opens file types, with a window form, optionally a touch form, and a viewer, editor and inspector that other apps can mount ([09](09-shells.md)) | — |
| **Extension** | A first-party package of features that is off until enabled per project: Hardware, Flows ([08](08-extensions.md)) | — |
| **Light**, **Dark** | The two themes | Sun, Set |

Dropped words: *fixture* (it is a device), *facet* (it is a property), *rig* and *vignetting* (no equipment for now), *framing* as a saved object (a frame lives in a canvas), *step*, *sequence* and *series* (a shot has a progression; photos have collections), *layer* and *sketch* as file types (parts and uses of a canvas), *block* (a shot with a progression, shown spread), *capture profile* (a camera layout), *bake* (a render), *preset* (as a table name), *overlay* (as stored data), *day* (Day planning is deleted), *extra field* (replaced by properties).

## Open questions

None. The principles and the glossary are a starting point; each workshop details the ones it touches and records changes here.

## Decided

2026-11-12, by the owner:

- The **principles** stand as a start and are detailed during the workshops.
- **Two layers, no personas.** The rewrite builds a base layer of primitives; personas, roles and team workflows are business logic modelled on top of it later. Roles appear in the workshops only as test cases for the primitives.
- The **glossary** stands as a beginning.
- ~~**Series** is the name for several photos taken as one capture. A series stays grouped in the media library and can be linked to a shot as a whole.~~ Reopened by [01](01-media.md) on 2026-11-13: there is no series in the base; a multi-photo capture produces several photos, and grouping belongs to a layer above.
- **Device** and **Fixture** are two concepts. A device is registered capture hardware with specs (phone, camera) and belongs to the core. A fixture is controllable equipment (light, battery) inside the lights extension. Flows drive fixtures.
- **View modes** are Mask, Outline, Crop and Full. The viewfinder control is "Zoom to frame". "Frame" means only the rectangle.
- **Three tiers**: core, standard apps (shipped and visible, removable, built only on core), extensions (off until enabled). Which block sits in which tier is decided in that block's workshop.
- Reopened by [04](04-shots.md) on 2026-11-19: **Step** is dropped; **Sketch** and layers become one canvas file type (named in 05); extra fields are no longer parked but return as generic **properties** on every file.
- Changed by [05](05-composition.md) on 2026-11-19: **Canvas** is the one file type for drawings, floor plans and photos with marks, looks and frames; it replaces Sketch and Layer as separate concepts. **Framing** as a saved object on a photo is dropped: a frame lives in a canvas. Composition is core, not a standard app.
- Changed by [08](08-extensions.md) on 2026-11-20: **Device** is the one word for all registered hardware; **Fixture** is dropped. The earlier decision above (device in the core, fixture in the lights extension) is replaced: the core knows phones and tablets, the Hardware extension adds the other types to the same registry.
