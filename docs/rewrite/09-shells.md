# 09 · Shells and app catalogue

Workshop [#336](https://github.com/OpenClapper-dev/core/issues/336). Status: **decided** (2026-11-20).

What an app is, which apps exist, and what the two shells (the Studio's desktop and the phone or tablet app) are made of. This is where the hand-overs of 03–08 land.

## As-is

| Fact | Where |
| --- | --- |
| The Studio is a desktop per project: windows with snapping and side-by-side splits, virtual desktops ("workspaces") with a task view, a taskbar with pins, a launcher, a command palette (⌘K), desktop icons and a recycle bin | `docs/features/desktop.md`, `apps/studio/src/wm/` |
| Window layout is saved per project and browser; pins, folders and icons on the server; preferences (theme, stage background, taskbar position and more) per browser | `desktop.md`, `apps/studio/src/settings.ts` |
| 15 apps in one registry: Gallery, Shot, Timeline, Plan, Metadata, Files, Projects, Fields, Rigs, Locations, Viewfinder layouts, Devices, Sequences, Settings, Recycle bin. An app declares an id, a name, an icon, window sizes and the file types it opens | `apps/studio/src/apps/registry.ts` |
| Apps are wired to each other by hand: the shot view contains the Framing and Compose stages, the Timeline contains its own copies of both editors | `apps/studio/src/ShotView.tsx`, `ClipEditing.tsx` |
| Every shortcut is declared once in a registry; a page's keys work only while its window has focus | `apps/studio/src/shortcuts.ts`, `keys.ts` |
| The phone has five tabs (Shoot, History, Shots, Day, Setup) behind two full-screen gates: sign in (or continue without) and pick a project. Without a project nothing is reachable | `docs/features/phone-app.md`, `apps/mobile/src/screens/Gates.tsx` |
| The phone has an offline mode (no requests at all) and can keep a project's shots and photos on the phone | `docs/features/day-mode-offline.md` |
| The phone keeps a live connection to the server while in the foreground | `apps/mobile/src/preview.ts` |
| The admin board is a separate plane on its own hostname: accounts, workspaces, audit, monitoring | `docs/features/admin.md` |
| A workspace is the tenancy unit: every project belongs to one; a personal one per user, shared ones with members and roles | `docs/features/accounts.md` |

## Problems and leaks

1. **Apps are pages, not parts.** An editor that is needed in two places is built twice or wired by hand.
2. **The catalogue mirrors the old model:** Gallery, Plan, Metadata, Fields, Rigs, Locations and Sequences each stand for a concept that has gone or changed.
3. **The phone's gate blocks everything,** including settings that have nothing to do with a project.
4. **Preferences stay in one browser.**
5. **Two meanings of "workspace"** ([00](00-principles.md)).

## The model

### What an app is

An **app** is a program that opens one or more file types. It declares:

| Part | Meaning |
| --- | --- |
| Identity | Name, icon, tier (core, standard app, extension) |
| File types | Which it opens, and which it can create |
| Window | Its full form in the Studio: sizes, one window per file or one in all |
| Viewer | Shows a file of its type anywhere: a stage, a preview pane, a list |
| Editor | Works directly on the picture, mounted on another app's stage |
| Inspector | Settings in another app's side panel |
| Thumbnail | How a file of its type looks small |
| Shortcuts | Declared in the one registry, active while the app or its mounted editor has focus |
| Forms | A window form for the Studio and, where it has one, a touch form for phones and tablets |

Viewer, editor and inspector are the hosting mechanism of [06](06-timeline.md). A host (the timeline, the shot window, the file browser's preview pane) mounts them and gets the same edit lock, saving and key handling everywhere. Extensions register apps the same way ([08](08-extensions.md)).

### The Studio's apps

| App | Tier | Opens | Notes |
| --- | --- | --- | --- |
| **Files** | Core | Folders, filters, both roots | The file browser: tree, search, list, grid and board views, bulk edit ([07](07-organisation.md)). Shows the project and the account home |
| **Media** | Core | Photos, collections | The same browser, set to photos: import, collections as one tile or spread out |
| **Shots** | Core | The list of shots | The same browser, set to shots; new shot |
| **Sets**, **Locations** | Core | The lists of sets and of locations | The same browser, set to each type; new set, new location; Locations also in the map view ([09a](09a-places.md)) |
| **Shot** | Core | A shot | Properties, content list, progression; hosts other apps' editors |
| **Set**, **Location** | Core | A set; a location | Properties and content list; first-class types that will grow parts of their own ([09a](09a-places.md)) |
| **Photo** | Core | A photo | View, properties, "make a canvas" |
| **Canvas** | Core | A canvas | The tool of [05](05-composition.md) |
| **Recycle bin** | Core | The bin | |
| **Project** | Core | Project settings | Properties, naming patterns, extensions; switching and managing projects |
| **Settings** | Core | Preferences, account | |
| **Devices** | Core | Devices | The person's phones and tablets; the Hardware extension adds its types and controls here |
| **Timeline** | Standard | Timelines, the master timeline | |
| **Optics presets** | Standard | Optics presets | |
| **Camera layouts** | Standard | Camera layouts | With live preview on the phone |
| **Flows** | Extension | Flows | |

Files, Media, Shots, Sets and Locations are entries on one browser component.

Gone or absorbed: Gallery (Shots and Media), Plan, Metadata (the board view), Fields (Project), Rigs (Optics presets), Locations (places workshop), Viewfinder layouts (Camera layouts), Sequences (Flows).

### The Studio's shell

Kept as it is: the desktop per project, windows with snapping and splits, the taskbar with pins, the launcher, the command palette, desktop icons, one window per file. Changes:

- Virtual desktops are called **desktops**; "workspace" means only the tenancy unit ([00](00-principles.md)).
- A double-click opens a file in the app registered for its type; nothing is wired by hand.
- A file someone else is editing shows who has it ([05](05-composition.md)).
- The account home is a second root in Files.

### The phone and tablet shell

One app for phones and tablets. Its shell follows the same idea as the Studio's: the apps come from the one catalogue, and the person decides what is on a device.

- **Tabs are chosen per device.** On each phone or tablet the person picks which apps are tabs and in which order. The choice is stored with the device ([03](03-capture.md), [08](08-extensions.md)), so two devices of one person can differ: a phone as a camera, a tablet for drawing.
- **Any app with a touch form can be a tab,** on a phone as well as on a tablet. Nothing is withheld by device size; whether drawing on a small screen is comfortable is the person's call. Extensions add their apps to the choice.
- **Apps are customisable in themselves** where it makes sense, as the camera already is through camera layouts ([03](03-capture.md)). Which other apps get layouts of their own is settled app by app in the UX workshops.
- **One tab bar for every app,** the camera included: under the screen held upright, at its right edge held in landscape ([U5](ux-5-phone.md)).
- **Setup cannot be removed.** It is where tabs are chosen, so it is always reachable. It also holds project, account, devices, offline and uploads.
- **A new device starts with a default set:** Camera, Media, Shots, Setup.

What a device can do therefore follows from which apps have a touch form, not from a fixed table. Proposed first set, with the order of building decided in workshop 10: Camera, Media (photos, collections, import, the queue), Shots (view: properties, content, the progression played back), Canvas (through the embedded editor, [05](05-composition.md)), Devices.

**Gates.** Signing in stays (or continuing without: photos stay on the phone). An app that works inside a project asks for one when none is chosen; Setup is always reachable. A new project can still be made offline.

**Offline.** Both of today's switches stay: offline mode (no requests) and keeping a project on the device (its previews and renders, not the originals). Photos taken offline queue as always.

**The phone link** ([08](08-extensions.md)) is up while the app is in the foreground and signed in.

### Preferences

Personal preferences (theme, taskbar position, changed shortcuts, stage background) belong to the account and follow it to every browser and device; they are a file in the account home ([07](07-organisation.md)). Window layouts stay per browser, because they depend on the screen. A device's tabs are stored with the device.

### Shortcuts

One registry, as today: every shortcut declared once, bound by action. A mounted editor owns the keys while it is active.

### Admin board and workspaces

The admin plane stays separate and unchanged in purpose; its counts follow the new file types. A workspace stays the tenancy unit that projects belong to. Roles are business logic for later ([00](00-principles.md)).

### What goes

The app-to-app wiring by hand, the old app names, the fixed five tabs with History and Day, the project gate as a wall, "workspace" for a virtual desktop, preferences that live in one browser.

## Handed to other workshops

- **09a (places).**
- **UX workshops:** every app and screen.

## Decided

2026-11-20, by the owner:

- **Files, Media and Shots** are three apps on one file browser.
- **The phone and tablet shell is composable:** each person chooses per device which apps are tabs, and apps offer their own customisation as the camera does. Nothing is fixed by device size; what can be done on a device follows from the apps chosen.
- **Preferences belong to the account** and follow it; window layouts stay per browser.

Taken from the proposal with the above: what an app declares (including viewer, editor and inspector); the Studio's catalogue and tiers; the Studio's shell kept, with "desktops" for virtual desktops; Setup always reachable and not removable; the default tabs of a new device; gates and offline as described; the admin plane and workspaces unchanged.
