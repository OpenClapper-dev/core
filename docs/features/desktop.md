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
- **Closing** asks first when the app registered a guard (`wm/closeGuards.ts`).
- **Layout per project and browser** (`wm/desktopState.ts`): windows, z-order, each window's route and the desktops in `localStorage["desktop.<projectId>"]` (`v: 3`; anything else starts fresh), saved 600 ms after a change, on a project switch and on `pagehide`.

## Desktops and task view

- **Desktops** are virtual desktops ("workspace" now means only the tenancy unit): every window sits on one. The taskbar, Show desktop and window cycling work on the active one. Windows of the other desktops stay mounted (hidden), so their apps keep their state.
- **Task view** (`wm/TaskView.tsx` on the design system's `TaskView`; the taskbar button next to the launcher, ⌘Alt V, or ⌘K): the desktops as tiles with a miniature of their windows, and the windows of the tile under the pointer as cards with a picture of what they show (a copy of the window's content, scaled down and `inert`; `wm/windowPreview.ts`). Click a tile to go there, a card to bring that window up (`Enter` too; arrows move between cards, `Delete` closes one); drag a card onto a tile (or onto New desktop) to move the window; double-click a name to rename; × removes a desktop (its windows go to the one before). Esc leaves.
- The taskbar button carries the active desktop's number once there are two; right-click it for the list and New desktop.
- **Keys:** ⌘Alt V task view, ⌘Alt N new desktop (and go there), ⌘Alt⇧ ←/→ previous/next, ⌘Alt 1–9 go to desktop n, ⌘Alt⇧ 1–9 move the focused window there. Digits are matched by their physical key.

## Taskbar, launcher, palette

- **Taskbar** (`wm/Taskbar.tsx` on the design system's `Taskbar`): the launcher, task view, the **pins**, one button per window of the active desktop (click focuses, or minimises the focused one; right-click: pin the app, the window's menu), then the instance marker, the project switcher (with "Manage projects…"), Go to… (⌘K), the theme (as the system → light → dark), the account menu and the clock.
  - **Position and alignment** (Settings › Appearance): on any edge; items at the start or centred. On a side bar the labels are tooltips and the clock takes two lines.
  - **Pins** are apps for now (files and folders join with the Files app): an app's pin is also the button of its windows, with a bar under it while one is open and a number with several (click lists them). Pin from the launcher or a window's taskbar menu, reorder by dragging. Pins are a preference, kept per project (`prefs.ts`).
- **Launcher** (the design system's `Launcher`): every app with a search field, extensions in their own group; right-click pins an app to the taskbar. Esc or a click beside it closes it.
- **Go to…** (⌘K, the design system's `CommandPalette`): apps, open windows, the other projects, and the shell's actions (theme, show desktop, task view, new desktop, shortcuts, reload, sign out).
- **Desktop:** clicking it takes focus away from the windows (the URL shows `#/`); right-click for task view, new desktop, theme and Settings. Icons come with the Files app.
- **Hosts** (`hosts.tsx`): `toast`, `confirm`, `prompt` and `contextMenu`, callable from any app and drawn once above every window. No browser dialogs anywhere.

## Apps (`apps/registry.ts`)

An app declares its name, glyph and colour, tier, whether it is one window in all, the file types it opens, its sizes, and how a deep link becomes a launch. The shell knows apps only through the registry; each build step adds the apps it builds.

| App | File | What |
| --- | --- | --- |
| Project | `apps/ProjectApp.tsx` | This project (name, facts, delete) and all projects (open, new, rename, delete). Properties, naming patterns and extensions join with their steps |
| Settings | `apps/SettingsApp.tsx` | Appearance (theme, taskbar), account (who is signed in, workspaces, sign out), shortcuts, about |

## Preferences (`prefs.ts`, `theme.ts`)

Taskbar position, alignment and pins are one preferences object behind `prefs.ts`. For now it is kept in the browser; the last part of step B1 moves it into a file of the account home, so it follows the account ([09 · shells](../rewrite/09-shells.md)). The theme is `localStorage["theme"]` (`light` | `dark`, absent: as the system) and is set before the first paint by the inline script of `index.html`.

## URL and keys

- **Hash routes** are launch commands (`wm/routeBridge.ts`): `#/<app>[/<rest>]`, where `rest` is whatever the app reported with `setRoute` (a tab). On load and on every `hashchange` the hash opens or focuses its window. The address bar always shows the focused window's route (`history.replaceState`); the desktop is `#/`.
- **Keys** (`keys.ts`, `wm/keyboard.ts`): one keydown listener. An app's keys reach it only while its window has focus. Global keys (⌘K, `?`, the G jumps) and the window keys work everywhere. An open dialog, palette or menu pauses them all (`[data-overlay]`).
- Every shortcut is declared once in `src/shortcuts.ts`; apps bind handlers by action (`useKeys(bind(scope, { … }))`). The `?` sheet, Settings › Shortcuts and [docs/shortcuts.md](../shortcuts.md) are rendered from it; `pnpm -C apps/studio test` fails when a key does two things in scopes that are live together, and when the page drifts.

## Styles

Everything visible comes from `@openclapper/design` (`packages/design`); `src/shell.css` holds only the shell's own layout (resize handles, the launcher's place, hosts). No colour is written outside the design tokens.
