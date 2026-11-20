# 09 · Shells and app catalogue

Workshop [#336](https://github.com/OpenClapper-dev/core/issues/336). Status: **proposal, nothing decided yet**.

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

## Proposal

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
| Clients | Where it runs: Studio, tablet, phone |

Viewer, editor and inspector are the hosting mechanism of [06](06-timeline.md). A host (the timeline, the shot window, the file browser's preview pane) mounts them and gets the same edit lock, saving and key handling everywhere. Extensions register apps the same way ([08](08-extensions.md)).

### The Studio's apps

| App | Tier | Opens | Notes |
| --- | --- | --- | --- |
| **Files** | Core | Folders, filters, both roots | The file browser: tree, search, list, grid and board views, bulk edit ([07](07-organisation.md)). Shows the project and the account home |
| **Media** | Core | Photos, collections | The same browser, set to photos: import, collections as one tile or spread out |
| **Shots** | Core | The list of shots | The same browser, set to shots; new shot |
| **Shot** | Core | A shot | Properties, content list, progression; hosts other apps' editors |
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

Gone or absorbed: Gallery (Shots and Media), Plan, Metadata (the board view), Fields (Project), Rigs (Optics presets), Locations (places workshop), Viewfinder layouts (Camera layouts), Sequences (Flows).

Open question 1.

### The Studio's shell

Kept as it is: the desktop per project, windows with snapping and splits, the taskbar with pins, the launcher, the command palette, desktop icons, one window per file. Changes:

- Virtual desktops are called **desktops**; "workspace" means only the tenancy unit ([00](00-principles.md)).
- A double-click opens a file in the app registered for its type; nothing is wired by hand.
- A file someone else is editing shows who has it ([05](05-composition.md)).
- The account home is a second root in Files.

### The phone and tablet shell

One app for both; the tablet uses the same screens with more room.

| Tab | Content |
| --- | --- |
| **Camera** | Capture with the chosen camera layout ([03](03-capture.md)) |
| **Library** | The project's photos and collections; import from the gallery; what is queued |
| **Shots** | The project's shots: properties, content, progression played back |
| **Setup** | Project, account, devices and camera layouts, offline, uploads, extension screens |

Open question 2.

**What can be changed on which client** (open question 3):

| | Phone | Tablet | Studio |
| --- | --- | --- | --- |
| Take and import photos, collections | Yes | Yes | Import |
| Names and properties | Yes | Yes | Yes |
| Shots: content and progression | View | View | Yes |
| Canvas | View (the render) | Draw (the embedded editor, [05](05-composition.md)) | Yes |
| Timelines | Later | Later | Yes |

**Gates.** Signing in stays (or continuing without: photos stay on the phone). A project is needed for Camera, Library and Shots, which ask for one when none is chosen; Setup is always reachable. A new project can still be made offline.

**Offline.** Both of today's switches stay: offline mode (no requests) and keeping a project on the phone (its previews and renders, not the originals). Photos taken offline queue as always.

**The phone link** ([08](08-extensions.md)) is up while the app is in the foreground and signed in.

### Preferences

Proposed: personal preferences (theme, taskbar position, shortcut changes, stage background) belong to the account and follow it to every browser and device; they are a file in the account home. Window layouts stay per browser, because they depend on the screen (open question 4).

### Shortcuts

One registry, as today: every shortcut declared once, bound by action. A mounted editor owns the keys while it is active.

### Admin board and workspaces

The admin plane stays separate and unchanged in purpose; its counts follow the new file types. A workspace stays the tenancy unit that projects belong to. Roles are business logic for later ([00](00-principles.md)).

### What goes

The app-to-app wiring by hand, the old app names, the History and Day tabs, the project gate as a wall, "workspace" for a virtual desktop, preferences that live in one browser.

## Handed to other workshops

- **09a (places).**
- **UX workshops:** every app and screen.

## Open questions

1. **Studio apps:** is the catalogue above right, with Files, Media and Shots as three entries on one browser?
2. **Phone tabs:** Camera, Library, Shots, Setup?
3. **Clients:** what can be changed on the phone and on the tablet?
4. **Preferences:** per account, or per browser as today?

## Decided

Nothing yet.
