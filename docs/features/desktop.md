# Studio desktop

> **Mid-rewrite (epic [#371](https://github.com/OpenClapper-dev/core/issues/371)).** This page describes the rebuilt Studio shell (step B1, [#373](https://github.com/OpenClapper-dev/core/issues/373)), on the design system `@openclapper/design`. The apps that fill it come with their build steps; what the first app's Studio could do is in the history up to release v0.16.0 and is carried over step by step.

The Studio is a desktop scoped to one project: apps in windows, a taskbar, virtual desktops. Specified in [09 · shells](../rewrite/09-shells.md).

## Startup and projects

- `main.tsx` mounts `wm/Shell.tsx`. It asks who is signed in (`user.ts`, `GET /api/me`) and shows the sign-in page until someone is ([accounts](accounts.md)). On an instance that is not production, `instance.ts` reads its label from `GET /api/ping`: it goes in front of the tab title, and a marker shows it on the sign-in page, the project picker and in the taskbar (the dev server shows "Development").
- Then the projects load (`projects.ts`). Without a valid project (`project.ts`, `localStorage["project"]`) the **project picker** shows: pick one, or make one (a name that exists opens that project).
- Then that project's desktop is restored as it was left, and a deep link in the URL opens or focuses its window on top.
- **Switching project** (the taskbar's project button, ⌘K, Project › Projects): every app with unsaved work may veto first (`beforeProjectSwitch`); then the current layout is saved and the other project's comes back.

## Windows (`wm/wm.ts`, `wm/Window.tsx`, `wm/useWindowDrag.ts`)

- `wm.ts` is a module store, pure and tested (`wm.test.ts`): windows with bounds, z-order, mode (normal · max · snapped left/right · minimised), the focused one, the desktops. `Window.tsx` draws each with the design system's `AppWindow`.
- Drag by the title bar, resize from the 8 edges and corners (the app's minimum size holds), double-click the bar to maximise. Dragging to the left or right edge of the desktop snaps to that half, to the top maximises; a preview shows the zone. Dragging a maximised or snapped window out restores its normal size under the pointer.
- **Side by side:** between snapped windows a grip sits at the split; dragging moves it and both windows follow live (20–80 %, never below either app's minimum width). A snapped window's inner edge does the same. Double-click for half and half; with the grip focused, ←/→ nudge it and Home resets. The split is per desktop.
- During a drag or resize the window is moved directly in the DOM and committed once at the end; `body.wm-gesture` switches pointer events off inside every window.
- **Motion** comes from the design system's window frame: opening, closing (a closed window fades, then leaves the store), minimising toward its taskbar button, and maximise, snap and restore as one move.
- Click anywhere in a window to bring it to the front. Right-click the title bar for minimise, maximise, snap, **Move to** another desktop, and close.
- **One window per file:** opening something that is open focuses its window, on whichever desktop it is. An app marked `singleton` has one window in all.
- **Start screens** (`apps/StartScreen.tsx`, #426): an app for one file opened without one (from the launcher) shows the project's files of its type, newest first, with search and New, as a desktop program does; a click opens that file in the same window (or brings up its window if it is open). Photo has no New (photos are imported); Timeline lists the master timeline first.
- **Closing** asks first when the app registered a guard (`wm/closeGuards.ts`).
- **Layout per project and browser** (`wm/desktopState.ts`): windows, z-order, each window's route and the desktops in `localStorage["desktop.<projectId>"]` (`v: 3`; anything else starts fresh), saved 600 ms after a change, on a project switch and on `pagehide`.

## Desktops and task view

- **Desktops** are virtual desktops ("workspace" now means only the tenancy unit): every window sits on one. The taskbar, Show desktop and window cycling work on the active one. Windows of the other desktops stay mounted (hidden), so their apps keep their state.
- **Task view** (`wm/TaskView.tsx` on the design system's `TaskView`; the taskbar button next to the launcher, ⌘Alt V, or ⌘K): the desktops as tiles with a miniature of their windows, and the windows of the tile under the pointer as cards with a picture of what they show (a copy of the window's content, scaled down and `inert`; `wm/windowPreview.ts`). Click a tile to go there, a card to bring that window up (`Enter` too; arrows move between cards, `Delete` closes one); drag a card onto a tile (or onto New desktop) to move the window; double-click a name to rename; × removes a desktop (its windows go to the one before). Esc leaves.
- The taskbar button carries the active desktop's number once there are two; right-click it for the list and New desktop.
- **Keys:** ⌘Alt V task view, ⌘Alt N new desktop (and go there), ⌘Alt⇧ ←/→ previous/next, ⌘Alt 1–9 go to desktop n, ⌘Alt⇧ 1–9 move the focused window there. Digits are matched by their physical key.

## Taskbar, launcher, palette

- **Taskbar** (`wm/Taskbar.tsx` on the design system's `Taskbar`): the launcher, task view, the **pins**, one button per window of the active desktop (click focuses, or minimises the focused one; right-click: pin the app, the window's menu; drag to reorder, a line shows where it lands), then the instance marker, the project switcher (with "Manage projects…"), Search (⌘K), the theme (as the system → light → dark), the account menu and the clock.
  - **Position and alignment** (Settings › Appearance): on any edge; items at the start or centred. On a side bar the labels are tooltips and the clock takes two lines.
  - **Pins** are apps, folders and files: a single-window app's pin is also the button of its window, with a bar under it while it is open; an app with one window per file or folder (Files, Photo, Shot, Canvas, …) launches from its pin and each of its windows keeps a button of its own (#426); a folder or file pin opens it. Pin from the launcher or a window's taskbar menu (apps), from a file's menu in Files, or by dragging files from Files or icons from the desktop onto the taskbar (dropped between pins they land there); reorder by dragging. Pins are a preference, kept per project (`prefs.ts`). A project starts with Files and Settings.
- **Launcher** (the design system's `Launcher`): every app with a search field, extensions in their own group; right-click pins an app to the taskbar. Esc or a click beside it closes it.
- **Search** (⌘K or the taskbar's search button; `wm/Search.tsx` on the design system's `CommandPalette` with `large`, #426): every file of the project and of the account home (by name and property values, with its picture, type and path; the newest first, at most 40 per group), the open windows and the apps. The matched part is marked (`--match`). Search only: no actions, no project switching.
- **Desktop:** clicking it takes focus away from the windows (the URL shows `#/`). Its icons are the files of the project's Desktop folder and the recycle bin ([files](files.md#desktop-icons-wmdesktopiconstsx-wmgridts)).
- **Hosts** (`hosts.tsx`): `toast`, `confirm`, `prompt` and `contextMenu`, callable from any app and drawn once above every window. No browser dialogs anywhere.

## Apps (`apps/registry.ts`)

An app declares its name, glyph and colour, tier, whether it is one window in all, the file types it opens, its sizes, and how a deep link becomes a launch. The shell knows apps only through the registry; each build step adds the apps it builds.

| App | File | What |
| --- | --- | --- |
| Files | `apps/FilesApp.tsx` | The file browser: folders of the project and of the account home, one window per folder ([files](files.md)); its side bar's **quick access** sets it to Photos (collections, import; [media](media.md)), Shots, Sets or Locations, as an OS's Pictures or Documents (#426: these were apps of their own) |
| Photo | `apps/PhotoApp.tsx` | One photo with its facts, one window per photo ([media](media.md#photo-app-appsphotoapptsx-route-photoid)) |
| Shot, Set, Location, Canvas, Timeline | `apps/ShotApp.tsx`, `CanvasApp.tsx`, `TimelineApp.tsx` | One file per window; Timeline also shows the project's master timeline ([timeline](timeline.md)) |
| Recycle bin | `apps/BinApp.tsx` | What was deleted: restore, delete permanently, empty |

| Settings | `apps/SettingsApp.tsx`, `apps/AccountPage.tsx`, `apps/ProjectApp.tsx` (the project's pages) | You (Appearance, Account, Shortcuts, About), this project (General: name, facts, delete; Properties; Naming patterns; Extensions; Customizations: the project's behaviour, so far how canvases update while edited) and all projects (open, new, rename, delete). Opens the settings page files, property definitions and naming patterns at their page (#426: the Project app folded in) |

## Preferences (`prefs.ts`, `theme.ts`)

Theme, taskbar position and alignment, the pins, how a collection's colour is drawn, the places of the desktop icons and whether the bin has one are the person's **preferences**: one file of the type `preferences` in their account home ([09 · shells](../rewrite/09-shells.md)), so they follow the account to every browser. `prefs.ts` is the only module that knows where they are kept:

- On sign-in the copy this browser kept for the account is used at once, then the account's file is read and wins. An account without one gets it on first sign-in.
- A change is saved 600 ms later. When the server cannot be reached the change stays in the browser's copy and Settings › Appearance says so; it is saved when the server answers again.
- Window layouts are not preferences: they depend on the screen and stay with the browser.
- The theme is also `localStorage["theme"]` (`light` | `dark`, absent: as the system), read by the inline script of `index.html` before the first paint.
- The file is not listed in Files; the Appearance settings page in the home's Settings folder opens its page. A client writes back only the keys this version knows (`knownPreferences`), so a key that went (`originalsOnWifi`, #426) is dropped instead of refused.

## URL and keys

- **Hash routes** are launch commands (`wm/routeBridge.ts`): `#/<app>[/<rest>]`, where `rest` is whatever the app reported with `setRoute` (a tab). On load and on every `hashchange` the hash opens or focuses its window. The address bar always shows the focused window's route (`history.replaceState`); the desktop is `#/`.
- **Keys** (`keys.ts`, `wm/keyboard.ts`): one keydown listener. An app's keys reach it only while its window has focus. Global keys (⌘K, `?`, the G jumps) and the window keys work everywhere. An open dialog, palette or menu pauses them all (`[data-overlay]`).
- Every shortcut is declared once in `src/shortcuts.ts`; apps bind handlers by action (`useKeys(bind(scope, { … }))`). The `?` sheet, Settings › Shortcuts and [docs/shortcuts.md](../shortcuts.md) are rendered from it; `pnpm -C apps/studio test` fails when a key does two things in scopes that are live together, and when the page drifts.

## Styles

Everything visible comes from `@openclapper/design` (`packages/design`); `src/shell.css` holds only the shell's own layout (resize handles, the launcher's place, hosts). No colour is written outside the design tokens.
