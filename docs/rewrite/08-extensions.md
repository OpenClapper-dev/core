# 08 · Extensions

Workshop [#335](https://github.com/OpenClapper-dev/core/issues/335). Status: **decided** (2026-11-20).

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

## The model

### What an extension is

An **extension** is a package of features that is off until enabled. Switched off, the core behaves exactly as if the code were not there (principle 6).

What an extension can bring, each through a registration point that the core offers without knowing who uses it:

| It brings | Meaning |
| --- | --- |
| File types | With their viewer, editor and inspector ([06](06-timeline.md), [07](07-organisation.md)) |
| Device types | New types in the device registry, with what they expose (below) |
| Apps and screens | In the Studio's app list; on the phone |
| Properties | Of the kind "provided by an app or extension" ([07](07-organisation.md)) |
| Camera controls | Controls that a camera layout can place ([03](03-capture.md)) |
| Channels on the phone link | Its own messages between Studio and phone (below) |
| Sync tasks | Its own data kept in step between phone and server (below) |
| Server routes and tables | Its own; no column on a core table |

### Packaging

Extensions are first-party: written in this repository and compiled into the Studio and the phone app. Enabling one is a switch, not an install. The build forbids core code from importing extension code. Native parts (Bluetooth, the video module) are in the phone app either way. There is no plugin interface for third parties.

### Enabling

Per project. A project's settings list its enabled extensions; everyone in the project sees the same apps, file types and properties. Files an extension keeps in the account home are there for the person in every project that has it on.

When an extension is switched off, its files stay where they are and show as "needs the … extension"; nothing is deleted.

### Phone link and sync

- **One live link, with channels.** The core keeps one connection between a person's Studio and their phone (it needs one for previewing camera layouts). An extension registers a named channel on it; the core carries a channel's messages without reading them. Signing in, reconnecting and the handling of foreground and background exist once. An extension can be given a connection of its own later if its traffic ever needs it. Media streams do not use the link: the live picture goes from the transmitter to the phone directly.
- **Sync tasks run beside the uploads, not inside them.** An extension registers what it keeps in step. It runs after the photo queue and cannot delay or fail a photo upload.

### Devices: one word, one registry

A **device** is any registered piece of hardware. This widens the device of workshops 00 and 03 (capture hardware) and replaces "fixture".

| Part | Meaning |
| --- | --- |
| Type | Phone, tablet (core); light, battery, camera, video transmitter and more (the Hardware extension) |
| Registry | One, in the account home ([07](07-organisation.md)): hardware follows its owner |
| Core | Knows phones and tablets: they register themselves and take photos ([03](03-capture.md)) |
| Extension | Adds the other types and everything about controlling and reading them |

### The Hardware extension

Built on a **catalogue of supported hardware** that grows with the app: brand → model → type. It is part of the code, as today.

Each model declares what it exposes:

| Exposes | Examples |
| --- | --- |
| Controls (values that can be set) | A light's power, intensity, white, colour, effect; a camera's record, ISO, shutter |
| State (values it reports) | Connection, battery level, a camera's timecode |
| Feeds (streams) | A video transmitter's picture |
| Relations to other devices | A battery powers a COB light, with the light as the parent |

| Today | In the catalogue |
| --- | --- |
| Aputure MC | Light: controls, state including its own battery, effects |
| NEEWER FS230B, FS300B | Light (COB): controls; can be powered by a battery |
| NEEWER PS099S | Battery: state only; can power a light |
| Blackmagic Pocket Cinema Camera | Camera: controls and state |
| Hollyland Mars 400S Pro | Video transmitter: a feed |

The extension contains pairing, the phone as proxy (it holds the Bluetooth connections and runs the drivers), the connection manager, and the apps to control and read devices (the Studio's **Devices** app; the proxy screen on the phone). The **live picture** is not an extension of its own: it is the feed of a video transmitter.

### The Flows extension

A **flow** is a timed programme that drives controls (today "light sequence"). It needs the Hardware extension and can drive any control a registered device exposes, not only lights: a camera's recording can start at a point in a flow.

- A flow is a file of a project; its app is Flows; it can play from the Studio or from the phone itself.
- A flow has no relation to a shot's progression for now ([I1](i1-interjection.md)); as a file it can be in a shot's content list.

### What Day planning takes with it

Deleted with it: shooting days, the schedule, the daylight math and forecast, step-through and offline days on the phone. If scheduling returns, it returns as an extension that brings its own property for the light a shot needs ([07](07-organisation.md)).

Offline mode and keeping a project on the phone are not part of day planning; they are a matter of the phone's shell (workshop 09).

### Extra fields

No longer a question for this workshop: they are properties in the core ([04](04-shots.md), [07](07-organisation.md)).

## What goes

Lights traffic and its rules in the layout preview's relay, device sync inside `flush()`, the word "fixture" and fixtures as workspace records, a separate Live picture screen in Setup, lights and sequences apps in everyone's app list, "light sequence" as a name, day planning.

## Handed to other workshops

- **09 (shells):** where extension apps and screens appear; the registration points as part of what an app is; offline mode.
- **UX workshops:** the extension switch, the "needs the extension" state, the Devices app across types.

## Decided

2026-11-20, by the owner:

- **Extensions are enabled per project.**
- **Extensions are first-party and compiled in;** enabling is a switch. No third-party plugins.
- **One phone link with channels:** the core carries extensions' messages without reading them; extension sync runs after the photo queue.
- **"Device" is the word for all registered hardware,** in one registry with types. "Fixture" is dropped; this reopens workshops 00 and 03.
- **Two extensions:** **Hardware** (a catalogue of brands, models and types, where each model exposes controls, state, feeds and relations; pairing, the phone as proxy, the control apps) and **Flows** (needs Hardware; drives any exposed control).
- **Live picture is part of Hardware:** the feed of a video transmitter.

Taken from the proposal with the above: the registration points; an extension that is switched off keeps its files; day planning goes entirely, offline mode moves to workshop 09.
