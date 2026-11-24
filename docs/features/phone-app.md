# Phone app overview

> **Mid-rewrite (epic [#371](https://github.com/OpenClapper-dev/core/issues/371)), step B3 ([#375](https://github.com/OpenClapper-dev/core/issues/375)).** The phone app is rebuilt on the new model: this page describes the rebuilt app. Specification: [03 capture](../rewrite/03-capture.md), [09 shells](../rewrite/09-shells.md), [U5 phone](../rewrite/ux-5-phone.md). The first app's phone code is at tag v0.16.0.

One app for phones and tablets. Its apps come from one catalogue and the person chooses, per device, which are tabs.

## Builds

One app, five installs side by side, each with its own package id, storage and icon colour (`APP_VARIANT`, `app.config.ts`): **OpenClapper** (production, blue), **OpenClapper Staging** (`org.openclapper.staging`, clay, for a staging instance; built by Build phone app, same signing key), **OpenClapper Dev** (`org.openclapper.dev`, the dev client from Google Play, moss, JavaScript from Metro), **OpenClapper Dev Local** (`org.openclapper.dev.local`, the same dev client debug-signed, `make dev-build`) and **OpenClapper Local** (`org.openclapper.local`, moss, debug-signed, `make apk-local`). Each talks to the server built into it; the Setup footer names it ([development](../development.md#apk-builds), [self-hosting](../self-hosting.md#the-phone)).

## Shell (`apps/mobile/App.tsx`, `src/shell/`)

- **One tab bar for every app**: under the screen held upright, at its right edge held in landscape. The app turns with the device.
- **Tabs per device**: the device file's `tabs` (below), in its order, without apps this build does not have (they stay in the file, for a later build or the Studio), and Setup always last. A new device starts with Camera, Media, Shots, Setup. Apps stay mounted once opened, so switching tabs keeps their state.
- **Gates** (`shell/Gates.tsx`, `shell/signin.ts`): without a session the app opens on the sign-in gate: sign in (email and password, the Studio's account, client `mobile`, a bearer token in the keystore, `src/auth.ts`) or continue without an account. Whoever continued without is not asked again at every start; a request answered with 401 shows the gate again. An app that works inside a project shows the project list in its place until one is chosen; Setup is always reachable.
- **Android back**: a sheet or a page of an app goes back first (`shell/back.ts`), then the first tab, then out of the app.
- **Sync** (`src/sync.ts`): projects first (a project made on the phone is created on the server; a name that exists there makes the phone take that project and repoint what refers to the old id), then the preferences and the device, then the steps other modules add. It runs at start, on sign-in, when the app comes to the front, when the server answers again, and every 20 s while it does not.
- **The catalogue** (`src/apps/registry.ts`): an app has the catalogue's id, a label, a glyph, whether it needs a project, and its screen.

## Data on the phone

| What | Where | Notes |
| --- | --- | --- |
| Session | Keystore (`src/auth.ts`) | Token, email, user id |
| Projects, the active one | `projects.ts` | Made offline or without an account and created at the next sync |
| Preferences | `prefs.ts` | The account's `preferences` file, shared with the Studio. The phone sets theme, collection mark, lens names, asking for a collection's name, originals on Wi-Fi; a save merges only what was changed here into the file as it is on the server, so the Studio's keys stay. A copy per account works offline |
| This device | `device.ts` | The `device` file of the account (below) |
| Offline mode, keeping the project, debug log | `settings.ts` | This phone only |
| Upload queue, Media's copy, image cache | `media/` | [Capture](capture.md#upload-queue-srcmediaqueuets-rules-in-stepsts-tested) |

Everything is kept in the key-value store scoped to the server the build talks to (`src/kv.ts`).

## This device (`src/device.ts`, `src/lenses.ts`)

The app registers its device itself (`POST /api/devices/register`, [api](../api.md#devices-devicests)) once signed in, and again at every sync, so model, real lenses, screen size and app version stay current. The fingerprint is `ANDROID_ID` (stable across reinstalls, new after a factory reset, one per signing key, so each build variant is its own device). Kind: a tablet from 600 dp on the short side.

**Real lenses** (`lenses.ts`, tested): read from the camera library (`react-native-vision-camera`).

1. A logical back camera made of several physical ones: each physical camera is a lens, used by setting the logical camera's zoom. That zoom comes from the library's switch factors when there is one per lens change, else from the ratio of focal lengths to the main lens. A lens with neither is left out.
2. Separate back cameras (wide, ultra-wide, tele): each is opened on its own.
3. Otherwise the default back camera only.

Each lens keeps the 35 mm equivalent the camera reports (`focal35`; none means no optics frame on it) and its name as the phone calls it (0.5×, 1×, 5×). Renaming the device and changing its tabs save to the file (`PUT /api/files/:id`); offline they wait for the next sync.

## Camera

The base camera: [capture](capture.md).

## Media (`src/apps/Media.tsx`, `src/media/library.ts`)

- The active project's photos, collections and folders (`GET /api/files`), kept on the phone so Media opens at once and offline; photos still in the queue are merged in with a badge (waiting, preview sent, stuck). Reloads when the tab comes to the front, on pull, at every sync and when an upload's preview arrived.
- **All photos or folders** (a switch at the top): every photo of the project, or the folders with what sits at the top level below them; a folder opens with its subfolders, collections and photos.
- **Collections stacked or spread** (the header button): a stack in its colour with the count and name, opening on its photos; spread out, each photo carries its collection's mark (Setup, Appearance: bar, bar left, dot or frame, the Studio's preference).
- **Import** from the phone (the download button): [capture](capture.md#what-a-capture-produces-srcmediapipelinets).
- **Choose several** (the tick): make a collection of them, named "Collection n", in a random one of the eight colours, where they are. Needs a connection.
- **A photo**: its preview, name (rename), facts (taken, size, lens readout, angle of view, device), where it is (folder, collection), its project properties (`apps/PhotoProperties.tsx`, below), the collection (put in, take out), the recycle bin. A photo not yet announced to the server is deleted for good instead, after asking. A stuck one shows the server's error with Retry and Discard.
- Images come from the phone when it has them (sent from here, or the project kept on the device), else from the server (`GET /api/photos/:id/image`, cached by `expo-image`).

**Properties on a photo** (`apps/PhotoProperties.tsx`, `media/values.ts`): the project's properties shown on photos, in their sections, from the catalogue Media loads with the library. Text, numbers (with unit), dates (YYYY-MM-DD) and positions ("latitude, longitude") are typed and saved when the field is left; yes / no is a switch of three; a choice, several choices or a reference opens a sheet (a dependent choice offers what its parent allows, references list the files they may point at). A value shows at once and waits on the phone until the server has it (offline, or for a photo still in the queue); one the server refuses is dropped with a message.

## Canvas (`src/apps/Canvases.tsx`, `CanvasView.tsx`)

Canvases in Media and the Canvas tab, with the Studio's editor in a web view: [canvas](canvas.md#on-the-phone-and-the-tablet).

## Setup (`src/apps/Setup.tsx`)

| Page | What |
| --- | --- |
| Project | The projects to choose from; a new one (works offline) |
| Account | Signed in as; change password (every other session ends); sign out (the queue stays on the phone) or sign in |
| This device | Name (rename), model, kind, screen, the real lenses with what they report |
| Tabs on this device | The tabs in order (up, down, off); Setup locked; the apps not on the device to add |
| Uploads | The queue photo by photo with its state, Retry and Discard for a stuck one, Send now; originals on Wi-Fi only |
| Camera | Lens names (the phone's or focal lengths); a collection's name (by the pattern, ask at start, ask at end) |
| Appearance | Theme (like the phone, Light, Dark); how a photo shows its collection (bar, bar left, dot, frame) |
| Offline | Offline mode: no requests at all; keep the project on this device (its thumbnails and previews, for Media without a connection; originals stay on the server) |
| Debug log | Record, share as text, clear |

The footer names the version and the server.

## The UI kit (`src/ui/`)

The phone's components on the design system's tokens (`@openclapper/design/tokens`: the palette is derived from them, Light and Dark) and its glyphs (`@openclapper/design/glyphs`, drawn with `react-native-svg`), the same names as in the Studio.

## Kept, not mounted

The drivers, codecs and mesh stack of lights and the camera control (`src/ext/hardware/ble/`, `src/ext/hardware/bt/`, `modules/video-link/`) belong to the Hardware extension ([hardware](hardware.md)).
