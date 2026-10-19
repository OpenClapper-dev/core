# Fielder docs

Reference documentation for the whole app. Start with [architecture](architecture.md), then read the feature page for whatever you are changing.

## Project

| Page | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | Repo layout, stack per app, how data flows from the phone to the dashboard, auth |
| [data-model.md](data-model.md) | D1 tables, the shot/photo split, JSON columns, migrations |
| [api.md](api.md) | Every Worker endpoint, with request and response shapes |
| [development.md](development.md) | Local dev loops, checks, deploy, migrations, APK builds |
| [infrastructure.md](infrastructure.md) | Cloudflare resources, auth, secrets |
| [self-hosting.md](self-hosting.md) | Running your own instance: API token, settings, the deploy workflow, the admin plane's Access app, updates, the phone |
| [known-issues.md](known-issues.md) | Risks and untested cases we know about, with where they live |
| [design.md](design.md) | Design system: Sun/Set themes, contrast rules, tokens, icons, where the styles live |

## Features

| Page | What it covers |
| --- | --- |
| [features/accounts.md](features/accounts.md) | Sign-in, sessions, workspaces and their members and roles, the Account settings |
| [features/admin.md](features/admin.md) | The admin plane: its own Worker and board behind its own Access app, accounts and workspaces across the instance |
| [features/projects.md](features/projects.md) | Projects as a hard scope, the active project on both clients |
| [features/capture.md](features/capture.md) | Phone Shoot tab: rigs, lenses, overlay, controls, HUD chips, Tag after capture, sequences, direct upload, upload queue |
| [features/viewfinder-layouts.md](features/viewfinder-layouts.md) | Viewfinder layouts: the model, the dashboard editor, how the phone renders them |
| [features/review-and-tagging.md](features/review-and-tagging.md) | Tags (light model, INT/EXT, weather, location, spot), the shot view, Metadata board, History on the phone, view modes (mask/frame/fit/raw) |
| [features/extra-fields.md](features/extra-fields.md) | User-defined fields as JSON, AI import, per-project selection |
| [features/positions.md](features/positions.md) | GPS modes (High · Low · Off), photos without a position, manual pin correction, location pins and shots synced to them |
| [features/rig-explorer.md](features/rig-explorer.md) | Framing: re-frame a photo (other rig + lens, moved), saved framings, the root frame, Compare A / B |
| [features/new-shot.md](features/new-shot.md) | New shot on the dashboard from uploaded images or a drawn sketch |
| [features/compose.md](features/compose.md) | Shot descriptions, overlays (drawing + look on a photo), sketches (floor plans, diagrams); dashboard editor, phone viewer, renders |
| [features/schedule.md](features/schedule.md) | Shooting days, daylight phases, forecast, shootable windows |
| [features/timeline.md](features/timeline.md) | Timelines: rough cuts of photos and overlays with hold times, playback (dashboard only) |
| [features/day-mode-offline.md](features/day-mode-offline.md) | Phone "Day" tab, offline days, offline project, offline mode, edits kept on the phone |
| [features/phone-app.md](features/phone-app.md) | Phone shell: 5 tabs, gates, pushed screens, header and sync state, Setup hub, shared components |
| [features/files.md](features/files.md) | Files on the desktop: folders, the Desktop folder, the Files app, desktop icons and selection, the recycle bin |
| [features/desktop.md](features/desktop.md) | The dashboard desktop: startup and projects, windows and the side-by-side split, workspaces and task view, taskbar and pins, launcher, the apps, URL and keys, the Gallery (grid/list/map, filters, views) |
| [shortcuts.md](shortcuts.md) | Every dashboard keyboard shortcut, generated from `apps/dashboard/src/shortcuts.ts` |
| [features/debug-log.md](features/debug-log.md) | The phone's background debug log |

## History

- Before 2026-09-27: prototype with one shot = one photo, districts and a hard-coded U-Bahn list.
- 2026-09-27: rework from [GitHub issue #1](https://github.com/bubulux/fielder/issues/1). Schema reset to `0001_baseline.sql` (prototype data dropped), then all features above. The implementation plan is in the git history of branch `rework/phase-1-projects-photos`.
- 2026-09-28: redesign on a design system from Claude Design ([design.md](design.md)), then a ground-up rework of the dashboard and the phone screens from Claude Design ([dashboard](features/desktop.md), [phone app](features/phone-app.md)); features unchanged.
- 2026-10-16: the dashboard became a desktop scoped to one project (epic #72): apps in windows, a taskbar, folders and desktop shortcuts on the server ([desktop](features/desktop.md), [files](features/files.md)).
- 2026-10-16: desktop v2 (epic #90): a recycle bin for every delete (30 days), the Desktop folder with real icons on a grid and rubber-band selection, workspaces with a task view, a split grip for side-by-side windows, taskbar position, alignment and server-side pins.
