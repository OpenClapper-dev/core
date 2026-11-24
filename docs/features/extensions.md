# Extensions

Rebuild step B9 ([#381](https://github.com/OpenClapper-dev/core/issues/381)); the model is [08 · Extensions](../rewrite/08-extensions.md).

An **extension** is a package of expert features that is off until a project switches it on. Switched off, the core behaves as if the code were not there; nothing an extension made is deleted.

## Switching

- **Project app › Extensions**: one switch per extension, with what it brings. Everyone in the project sees the same.
- An extension can need another (Flows needs Hardware): switching it on switches on what it needs, switching that off switches it off too.
- The phone reads the project's switches with the project list (at each sync).

What depends on the switch:

| Where | On | Off |
| --- | --- | --- |
| Studio launcher, palette, desktop search | The extension's apps are offered (under "Extensions" in the launcher) | Not offered |
| A window of an extension's app (restored, or from a link) | The app | "Needs the … extension" with a way to the switch |
| Phone tabs | The extension's apps can be tabs | A device's tab of it is kept in its choice and not shown; Setup › Tabs does not offer it |
| Its files and devices | Usable | Kept; shown as needing it |

## Packaging

- First-party and compiled in: enabling is a switch, not an install. Native parts (Bluetooth, the video module) are in the phone app either way.
- An extension's shared code is a package `packages/ext-<id>` (its model, catalogue and protocol); client code sits in `src/ext/<id>/` of the Worker, the Studio and the phone.
- **The build rule:** core code never imports extension code. Each client has one composition root, `src/extensions.ts`, the only core file allowed to; `scripts/check-extensions.mjs` fails `pnpm lint` otherwise.

## Registration points

| Point | Where |
| --- | --- |
| The extension itself (id, name, what it needs and brings) | `registerExtension` (`packages/model/src/extensions.ts`) |
| File types | `registerFileType` (`packages/model/src/files.ts`) |
| Device kinds beyond phone and tablet, with the rules for their bodies | `registerDeviceKind` (`packages/model/src/extensions.ts`); the device file type checks a registered kind with its rules |
| Studio apps | `registerApp` with `extension` (`apps/studio/src/apps/registry.ts`) |
| Phone apps | `registerApp` with `extension` (`apps/mobile/src/apps/registry.ts`) |
| Camera controls | `registerCameraControl` (`packages/model/src/layout.ts`), what a tap does on the phone `registerCameraControlView` (`apps/mobile/src/camera/controls.ts`, a sheet over the camera) |
| Devices app | `registerDeviceView` and `registerPhoneTab` (`apps/studio/src/devices.ts`) |
| Sync tasks on the phone | `onSync` (`apps/mobile/src/sync.ts`), registered after the upload queue |
| Channels on the phone link | Any channel name other than `link` and `layout` is carried unread ([camera layouts](camera-layouts.md), "The phone link") |
| Worker routes and tables | `registerExtensionRoutes` (`apps/worker/src/extensions.ts`); tables of its own, no column on a core table |

The Worker registers every extension whatever the projects switch: an extension's routes work for the account, the switch governs what the clients offer.

## Extensions of this build

| Extension | Needs | Brings |
| --- | --- | --- |
| Hardware ([hardware](hardware.md)) | — | Lights, batteries, cameras, video transmitters in the device registry; pairing; the phone as proxy; Devices across types; Hardware on the phone; the camera control Hardware |
