# Phone app overview

Designed in Claude Design (2026-09-28). The IA is organised around what happens on a location: shoot, tag, review (History), find, run the day. The design exports are in the gitignored `references/mobile/`.

## Shell (`apps/mobile/App.tsx`, `src/appState.tsx`)

- **Five tabs**: Shoot · History (badge: unreviewed count) · Shots · Day · Setup. The tab bar is a right-hand column in landscape.
- **Gates**, full screen, before the tabs (`screens/Gates.tsx`):
  - **Sign in**: on launch without a session, and whenever a request finds it gone. "Sign in" opens the email and password form ([accounts](accounts.md)); the eye button beside the password shows it; a wrong password, a blocked account or a web page instead of the server (a Wi-Fi login) each say so. "Continue without signing in" keeps shots on the phone.
  - **Pick a project**: when none is active, or the active one no longer exists. "New project" works offline.
- **Pushed screens** replace the tab (the tab bar is hidden, the tab stays mounted underneath). The stack is `Route` in `appState.tsx`: Uploads, Offline, Shot details, Correct position, the focused map, Step-through, Rigs & lenses, the Rig editor and the Setup sub-screens. Android back pops one; on a tab it returns to Shoot first. There is no navigation library.
- **Sheet vs screen**: a sheet for a single choice that returns you where you were (project, rig pick, lens, tag fields). A full screen for anything with its own photo or map.
- **AppHeader** (`ui/chrome.tsx`), 64 dp, on every screen except Shoot:
  - Without a title: the **project pill** (tap opens the Project sheet; an amber "Pick a project" when none) and the **sync icon** (tap opens Uploads).
  - With a title: back/close, title + sub, an optional trailing action.
  - The **offline banner** pins under it whenever the server can't be reached.
- **Sync state** (`src/sync.ts`): stuck (red, count) › uploading › offline › waiting (amber, count) › all on the server. "Offline" means the last API call failed with a network error (`src/net.ts`). While offline and signed in, the app retries every 20 s.
- **Confirm sheets and toasts** (`ui/dialogs.tsx`) replace Android alerts: `confirm()` (title as a question, one sentence of consequence, Keep | destructive, optional safe alternative), `notice()`, `toast()` (2.5 s; 4 s with Undo).
- **Layout rules**: 52 dp buttons, 56 dp viewfinder controls, 76 dp shutter; 32 dp clearance at the camera cutout and the nav bar, 16 dp sides. Decisions are pinned in the thumb zone (`ActionBar`), in a right-hand column in landscape.

## Tabs and screens

| Tab | Files | What |
| --- | --- | --- |
| Shoot | `screens/Viewfinder.tsx`, `screens/Tag.tsx`, `components/LensStrip.tsx`, `RigSheet.tsx`, `LensSheet.tsx`, `Hud.tsx` | [Capture](capture.md): viewfinder, one control row, Tag after each capture |
| History | `screens/History.tsx`, `components/ShotParts.tsx`, `EditTagsSheet.tsx` | The project's shots one at a time, or only the unreviewed ones ([review](review-and-tagging.md#history-on-the-phone)) |
| Shots | `screens/Shots.tsx`, `screens/ShotDetails.tsx`, `components/LeafletView.tsx`, `mapHtml.ts` | Gallery and Map merged: one filter (All · states · Queued), Grid ⇄ Map; Shot details; [Correct position](positions.md) |
| Day | `screens/Day.tsx`, `screens/StepThrough.tsx` | [Day mode and offline days](day-mode-offline.md) |
| Setup | `screens/Setup.tsx`, `screens/SetupScreens.tsx`, `screens/Rigs.tsx`, `screens/Uploads.tsx` | Hub, see below |

## Setup hub

- First the **status card** (tap opens Uploads). Signed out: a warning with "Sign in", and an Uploads row in the list.
- **Theme**: Auto · Sun · Set. This is the only theme control ([design](../design.md)).
- The **footer** shows the app's version with its commit ([releasing](../releasing.md)) and the server address; the debug log carries both too.
- Rows, each with its current value; every row opens a screen, and settings save on change:
  - **Project**: opens the Project sheet.
  - **Rigs & lenses**: the rig list; tap a rig to edit it, "New rig" is pinned.
  - **Viewfinder**: the **Layout** ([viewfinder layouts](viewfinder-layouts.md)) and its look and control options, which belong to the layout (issue #68): a change here edits the layout (saved on the phone, sent with the next flush; the Studio sees it). With the built-in **Default** they are greyed out, with **Make a copy** ("My layout", selected at once). A pinned preview (the latest shot, or black, with the current frame, blackout, human frame and HUD chips) above:
    - **Phone lenses**: All · Pick · Fixed ([capture](capture.md#camera-react-native-vision-camera-issue-26))
    - one switch per HUD chip (Project, Rig and lens, FOV, GPS accuracy, Warnings)
    - frame colour and width
    - blackout and its tint
    - the Human button: cycle or toggle, and the toggle value
  - **Capture**: direct upload, **GPS** (High · Low · Off, [positions](positions.md)), rig orientation, the screen orientation on launch.
  - **Offline**: offline mode, what waits on the phone, and the project kept on the phone ([offline](day-mode-offline.md)).
  - **Phone calibration**: the 35 mm-equivalent of the main camera: **From the photos** (EXIF of each capture, with the phone model it came from) or **Manual** (5–200).
  - **Account**: email, Sign out (queued shots stay). The session renews while the app is used; a 401 signs out, a 403 (your role cannot do it) or a web page (Wi-Fi login) does not. Queued shots remember the account that took them and upload only while it is signed in.
  - **Debug log**: see [debug log](debug-log.md).
- **Uploads** screen:
  - Stuck shots first, with the server's error and Retry | Discard (Discard confirms).
  - Then the waiting ones, oldest first, with "Uploading i of n photos", the failed attempts, or missing photo files.
  - Pinned: "Retry all n now" (`flush({ includeStuck: true })`), disabled while offline and in offline mode.
  - Empty: "All on the server".
  - Then **Uploaded · last 7 days**: name, photos, project, capture time and upload time.

## Shared pieces

- `ui/` (component library, imported as `../ui`; files and components are listed in [design](../design.md#phone-component-library)). Screens build from it; a style that two screens copy belongs there.
- `ui/chrome.tsx`: `AppHeader`, `PushScreen`, `Block`, `OfflineBanner`, `SyncIcon`, `SyncCard`, `Badge`, `FieldRow`, `ActionBar`.
- `components/TagEditor.tsx`: the one tag editor (Tag, History edit, Shot details edit), see [review and tagging](review-and-tagging.md). `components/OptionSheet.tsx`: chips up to 12 options, a search list above, checkboxes for multiple.
- `components/gestures.ts`: `useSwipe` (PanResponder: horizontal swipe, double-tap).
- `components/ComposeParts.tsx`: overlay/sketch strip, sheet rows and the full-screen viewer; `components/Markdown.tsx`: native rendering of descriptions ([compose](compose.md)).
- Data: `src/shots.ts` (`useShots`: server, phone copy, queue and waiting edits merged; labels), `src/localShots.ts` (queued shots as shots, `editShot`, `setPosition`, waiting edits), `src/rigs.ts` (rigs and the one in use, shared by Shoot and Setup), `src/storage.ts` (`usePref` for per-screen choices), `src/device.ts` (this phone as a device: its id, the measured Shoot sizes, its specs and their sync, issue #68), `src/kv.ts` (the kv store and photo folders, scoped per server: `make mobile` keeps local data apart from production).

## Not done (from the designs)

- Map pin clustering and pinch-to-zoom on photos.
- The sticky compact light bar on the Day overview.
