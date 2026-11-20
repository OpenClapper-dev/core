# 08 · Extensions

Workshop [#335](https://github.com/OpenClapper-dev/core/issues/335). Status: **proposal, nothing decided yet**.

How expert features are packaged so that the core runs unchanged without them, and which features become extensions.

## As-is

| Fact | Where |
| --- | --- |
| **Lights:** the phone pairs and drives film lights and a battery over Bluetooth (NEEWER, direct) and Bluetooth Mesh (Aputure, provisioned by the phone, with a key backup). A connection manager holds leases, retries and write queues; drivers and codecs per maker | `docs/features/lights.md`, `apps/mobile/src/fixtures/`, `src/ble/` (about 5,500 lines) |
| **The phone as proxy:** the controls live in the Studio's Devices app; the phone holds the Bluetooth connections while its Proxy screen is open and runs what the Studio sends | `lights.md` (The phone as proxy), `apps/studio/src/apps/DevicesApp.tsx` |
| **Transport:** light commands travel through the per-user room of the viewfinder-layout preview socket | `apps/worker/src/preview.ts`, `packages/vocab/src/lightProxy.ts` |
| **Sync:** paired fixtures sync like rigs and also inside every flush of the photo upload queue | `apps/mobile/src/fixtures/library.ts`, `uploads.ts` |
| **Power:** which battery or socket feeds a light, and how much is left | `lights.md` (Power) |
| **Light sequences:** keyframed programmes per project with tracks per light type, fades, markers, playback from the Studio or from the phone itself | `lights.md` (Sequences), `packages/vocab/src/lightSequence.ts`, `SequencesApp.tsx` |
| **Camera control:** a Blackmagic Pocket camera is a fixture kind, controlled from the Devices app through the same proxy | `docs/features/cameras.md`, `packages/vocab/src/cameraControl.ts` |
| **Live picture:** a Hollyland transmitter's video on the phone, through a native module of its own; a prototype | `docs/features/live-picture.md`, `apps/mobile/modules/video-link` |
| Fixtures belong to the workspace, light sequences to a project. All of it is always on: the apps are in the Studio's registry and the phone's Setup for everyone | `apps/studio/src/apps/registry.ts`, `docs/data-model.md` |
| **Day planning** (shooting days, daylight windows from sun math, weather forecast, step-through and offline days on the phone) is deleted in the rewrite | [README](README.md), `docs/features/schedule.md`, `day-mode-offline.md` |

## Problems and leaks

1. **Nothing can be switched off.** A location scout's install carries light meshes, camera protocols and a video pipeline.
2. **Shared pipes.** Lights ride on the layout preview's socket and on the photo upload round, so a core path knows about them and can be slowed or broken by them.
3. **Names collide.** The Studio's "Devices" app controls fixtures, while a device is the phone ([00](00-principles.md)); "sequence" meant three things.
4. **No seam.** Core files import the lights code directly; there is no place where an extension registers itself.

## Proposal

### What an extension is

An **extension** is a package of features that is off until enabled. Switched off, the core behaves exactly as if the code were not there (principle 6).

What an extension can bring, each through a registration point that the core offers without knowing who uses it:

| It brings | Meaning |
| --- | --- |
| File types | With their viewer, editor and inspector ([06](06-timeline.md), [07](07-organisation.md)) |
| Apps and screens | In the Studio's app list; on the phone |
| Properties | Of the kind "provided by an app or extension" ([07](07-organisation.md)) |
| Camera controls | Controls that a camera layout can place ([03](03-capture.md)) |
| Channels on the phone link | Its own messages between Studio and phone (below) |
| Sync tasks | Its own data kept in step between phone and server (below) |
| Server routes and tables | Its own; no column on a core table |

The core never imports extension code; the build enforces it.

### Packaging

Extensions are first-party and compiled into the clients; enabling one is a switch, not an install (open question 2). Native parts (Bluetooth, the video module) are in the phone app either way. There is no plugin interface for third parties for now.

### Enabling

Proposed: per project (open question 1). A project's settings list its enabled extensions; everyone in the project sees the same apps, file types and properties.

When an extension is switched off, its files stay where they are and show as "needs the … extension"; nothing is deleted.

### Phone link and sync

- **One live link, with channels.** The core keeps one connection between a person's Studio and their phone (it already needs one for previewing camera layouts). An extension registers a named channel on it; the core relays a channel's messages without reading them. A phone does not hold a connection per extension (open question 3).
- **Sync tasks run beside the uploads, not inside them.** An extension registers what it keeps in step. It runs after the photo queue and cannot delay or fail a photo upload.

### The extensions

Proposed grouping (open question 4):

| Extension | Contains | Brings |
| --- | --- | --- |
| **Fixtures** | Lights, batteries and cameras as controllable equipment: pairing, the phone as proxy, the connection manager and drivers, power | File type *fixture* (in the account home: equipment follows its owner); the Fixtures app (today "Devices"); the phone's proxy screen; a channel |
| **Flows** (needs Fixtures) | Timed programmes that drive fixtures (today "light sequences") | File type *flow* (in a project); the Flows app; playback on the phone |
| **Live picture** | The transmitter's video on the phone | A screen; later a camera control |

A flow has no relation to a shot's progression for now ([I1](i1-interjection.md)); as a file it can be in a shot's content list.

### What Day planning takes with it

Deleted with it: shooting days, the schedule, the daylight math and forecast, step-through and offline days on the phone. If scheduling returns, it returns as an extension that brings its own property for the light a shot needs ([07](07-organisation.md)).

Offline mode and keeping a project on the phone are not part of day planning; they are a matter of the phone's shell (workshop 09).

### Extra fields

No longer a question for this workshop: they are properties in the core ([04](04-shots.md), [07](07-organisation.md)).

### What goes

Lights traffic on the layout preview socket, fixture sync inside `flush()`, the "Devices" name for the fixtures app, lights and sequences apps in everyone's app list, fixtures as workspace records, day planning.

## Handed to other workshops

- **09 (shells):** where extension apps and screens appear; the registration points as part of what an app is; offline mode.
- **UX workshops:** the extension switch, the "needs the extension" state.

## Open questions

1. **Enabling:** per project, per account or per workspace?
2. **Packaging:** first-party and compiled in, or installable plugins?
3. **Transport:** one phone link with channels, or a connection per extension?
4. **Grouping:** Fixtures, Flows and Live picture, or another cut?

## Decided

Nothing yet.
