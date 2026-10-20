# Data model

D1 (SQLite) database `openclapper-db`, schema in `apps/worker/migrations/`. Images live in R2 bucket `openclapper-media` under `photos/<photoId>.<ext>`.

## Migrations

| File | What |
| --- | --- |
| `0023_monitoring.sql` | `storage_daily` (a day's storage per workspace and the bucket total, written by the cron) and `admin_settings` (the admin plane's settings as JSON). Additive (epic #67, issue #214; see [monitoring](features/monitoring.md)) |
| `0001_baseline.sql` | Schema reset of 2026-09-27: projects, presets, locations, shots, photos, views |
| `0002_photo_position_corrected.sql` | `photos.position_corrected` |
| `0003_field_definitions.sql` | `field_definitions`, `project_fields` |
| `0004_shooting_days.sql` | `shooting_days`, `day_shots` |
| `0005_capture_flow.sql` | `shots.shot_size`, `camera_support`, `movement`; `photos` rebuilt with nullable `lat`/`lon` (copied row by row, both or neither set) |
| `0006_compose.sql` | `shots.description`; `overlays`, `sketches` ([compose](features/compose.md)) |
| `0017_viewfinder_layouts.sql` | `viewfinder_layouts` ([viewfinder layouts](features/viewfinder-layouts.md)) |
| `0018_devices.sql` | `devices` (device specs), `viewfinder_layouts.device_id` ([viewfinder layouts](features/viewfinder-layouts.md#device-specs-68)) |
| `0019_folders_desktop.sql` | `folders`, `folder_items`, `desktop_items`: folders and desktop shortcuts per project; additive, no backfill (epic #72; see Tables) |
| `0020_trash_desktop_taskbar.sql` | The recycle bin: `deleted_at`, `deleted_with` on `shots`, `timelines`, `shooting_days`, `views`, `locations`, `field_definitions`, `folders`, and the unique name/key indexes of locations, fields and folders made partial (`WHERE deleted_at IS NULL`); `folders.kind` (`normal` \| `desktop`, one Desktop folder per project); `desktop_items.area` (`desktop` \| `taskbar`) and `position`, the target index per area. Additive (epic #90, issue #91) |
| `0022_workspace_kind.sql` | `workspaces.kind` (`personal` \| `shared`); every workspace before it was personal. Additive (#114) |
| `0021_tenancy.sql` | `users`, `sessions`, `workspaces`, `workspace_members`; `projects.workspace_id` (name unique per workspace), `presets.workspace_id`, `devices.user_id`, `viewfinder_layouts.user_id`, `photos.size_bytes`. A bootstrap user and workspace own all existing rows. Additive (epic #107, issue #108; see Tables) |
| `0016_spots.sql` | `spots` (a place within a location, optional pin); `shots.spot_id` ([projects](features/projects.md)) |
| `0015_project_scope.sql` | `locations.project_id`, `field_definitions.project_id` + `position`, `views.project_id`; shared rows copied per project, unused ones to the project with the most shots; `project_fields` folded in and dropped ([projects](features/projects.md)) |
| `0014_sequence_blocks.sql` | `timelines.groups` (JSON), `timeline_clips.group_id`: sequence blocks ([timeline](features/timeline.md)) |
| `0013_clip_owned_compose.sql` | `overlays.timeline_id`, `clip_id`; `sketches` rebuilt (copied) with nullable `shot_id` + `timeline_id`, `clip_id`; `timeline_clips.sketch_id` (sketch clips) ([timeline](features/timeline.md)) |
| `0012_timeline_lock.sql` | `timelines.lock_mode`: one presentation mode forced on every clip ([timeline](features/timeline.md)) |
| `0011_placeholder_clips.sql` | `timeline_clips` rebuilt (copied): nullable `photo_id`/`presentation`, new `title` for placeholder clips ([timeline](features/timeline.md)) |
| `0010_framings.sql` | `framings`; `photos.root_framing_id` ([framing](features/rig-explorer.md)) |
| `0009_photo_source.sql` | `photos.source` (camera · upload · drawn) ([new shot](features/new-shot.md)) |
| `0008_location_positions.sql` | `locations.lat`, `lon`; `shots.position_from_location` ([positions](features/positions.md)) |
| `0007_timelines.sql` | `timelines`, `timeline_clips` ([timeline](features/timeline.md)) |

Add a new numbered file for every change; never edit one that was applied to production. Apply with `pnpm -C apps/worker migrate:local` / `migrate:remote` (see [development](development.md)).

## Tables

**Tenancy** (epic #107). `users(id, email UNIQUE NOCASE, name, password_hash, status active|blocked, failed_logins, locked_until, created_at, updated_at)`: `password_hash` is `pbkdf2-sha256$<iterations>$<salt>$<hash>`, or `!`, which never verifies (sign-in disabled). `sessions(id, user_id → users CASCADE, client dashboard|mobile, expires_at, last_used_at, created_at)`: the id is the SHA-256 (hex) of the opaque token; the token itself is never stored; `dashboard` is the Studio (the value predates the rename and is kept, not migrated). `workspaces(id, name, owner_user_id → users, kind personal|shared, created_at, updated_at)` and `workspace_members(workspace_id → CASCADE, user_id → CASCADE, role owner|admin|editor|viewer)`, primary key (workspace, user). Access is decided by `workspace_members` alone; `owner_user_id` is bookkeeping and nullable, so organisations can own workspaces later (an added `owner_org_id`). `kind`: each user's own workspace is `personal` (where their new projects and rigs go by default); the ones they create to share are `shared`.

Every project and rig belongs to a workspace, every device and viewfinder layout to a user. Migration 0021 gave all existing rows to a bootstrap user `00000000-0000-4000-8000-000000000001` (email `owner@openclapper.invalid`, sign-in disabled) and its workspace `00000000-0000-4000-8000-000000000002` (`tenancy.ts`). New projects and rigs go to the workspace the client names, by default the caller's own; new devices and layouts to the caller. Devices are keyed by the phone's own id, so a phone signed in to another account takes its row over (and that account's layouts drop their `device_id`).

`projects(id, workspace_id → workspaces, name UNIQUE NOCASE per workspace, notes, created_at, updated_at)`

`presets(id, workspace_id → workspaces, name, camera_id, format_id, sensor_width_mm, sensor_height_mm, speedbooster_factor, lens_min_mm, lens_max_mm, created_at, updated_at)`: rigs. Sensor dimensions are the source of truth for the math; `camera_id`/`format_id` refer to `packages/fov-math/src/cameras.ts` (null = custom sensor).

`locations(id, project_id → projects CASCADE, name UNIQUE NOCASE per project, lat, lon, created_at, updated_at)`: a location belongs to one project. `lat`/`lon` is the location's pin (null = none). No district (removed in the rework).

`spots(id, location_id → locations CASCADE, name UNIQUE NOCASE per location, lat, lon, created_at, updated_at)`: a named place within a location (the north gate, the roof), with an optional pin. `shots.spot_id → spots SET NULL` is always a spot of the shot's location; the API adds `spot_name`.

`shots(id, project_id → projects RESTRICT, location_id → locations SET NULL, name, int_ext, light JSON array, artificial 0/1, weather, shot_size, camera_support, movement JSON array, state, extra JSON object, description, captured_at, created_at, updated_at)`
- `state`: `unreviewed` (on upload) → `approved` / `archived`.
- `light`: subset of `dawn, day, dusk, night`, stored in that canonical order. Empty = no requirement.
- Camera language (`packages/vocab`): `shot_size` one of `ews, ws, mws, ms, mcu, cu, ecu`; `camera_support` one of `static, handheld, steadicam, gimbal, dolly, slider, crane, drone, vehicle`; `movement` any subset of `pan, tilt, push_in, pull_out, tracking, pedestal, orbit, zoom` in that order. `cameraLabel()` gives "WS · Steadicam · Pan / Push in".
- `artificial`: lit artificially, independent of phases and INT/EXT.
- `captured_at`: earliest photo timestamp; recomputed when photos are added. Lists sort and paginate on `(captured_at, id)`.
- `extra`: values of the project's extra fields ([extra fields](features/extra-fields.md)).
- `position_from_location` 0/1: maps use the place's pin (the spot's, else the location's; the API's `location_position`) instead of the photos' GPS (the photos keep theirs). The API adds `location_position: { lat, lon } | null` from the join.
- `description`: Markdown subset (`packages/vocab/src/markdown.ts`), max 20 000 characters.

`photos(id, shot_id → shots CASCADE, ordinal UNIQUE per shot, source camera|upload|drawn (non-camera photos: no framing, lens_mm 0), timestamp, lat, lon (both NULL when captured without GPS), gps_accuracy_m, position_corrected, preset_id → presets SET NULL, lens_mm, r2_object_key UNIQUE, width, height, framing JSON, device JSON, created_at, size_bytes)`. `size_bytes` (the stored image, for storage accounting) is NULL for photos uploaded before migration 0021

`overlays(id, photo_id → photos CASCADE, name, description, drawing JSON, presentation JSON, render_key UNIQUE, position, created_at, updated_at)`: a drawing + look over one photo. `drawing` = `{ v: 1, shapes: [...], look: {...} }`, `presentation` = `{ mode, frame: { width_fraction, height_fraction } | null, label, rig_id?, lens_mm? }` (shapes in `packages/vocab/src/compose.ts`). `render_key` is the flattened image in R2 (`renders/overlays/<id>.<ext>`). See [compose](features/compose.md). `timeline_id → timelines CASCADE` + `clip_id` (no FK) make it a timeline clip's own overlay (issue #31); shots do not embed those.

`sketches(id, shot_id → shots CASCADE | null, name, kind, description, drawing JSON (look null), aspect REAL w/h, render_key UNIQUE, position, created_at, updated_at, timeline_id → timelines CASCADE, clip_id)`: a free canvas on the shot, or (shot null, timeline + clip set; a CHECK enforces one of the two) a sketch clip's own canvas. `kind` is free text; `SKETCH_KINDS` are only suggestions.

`framings(id, photo_id → photos CASCADE, name, rig_id → presets SET NULL (null = as shot), lens_mm, frame JSON { width_fraction, height_fraction, x, y }, position, created_at, updated_at)` and `photos.root_framing_id → framings SET NULL` (null = as captured). The API embeds `framings` and `root_framing_id` in every photo. See [framing](features/rig-explorer.md).

`viewfinder_layouts(id, user_id → users, name, layout JSON, device_id → devices SET NULL, created_at, updated_at)`: phone layouts made in the Studio; a user's own. The shipped default is in code. `device_id` is the device the layout is designed for.

`devices(id, user_id → users, name, specs JSON, created_at, updated_at)`: phones read out in the Studio (issue #68), a user's own. The id is the phone's own (`device.v1` on the phone), so the phone keeps the row current. `specs` (`DeviceSpecs` in `packages/vocab/src/devices.ts`): `{ v: 1, model, viewport: { portrait, landscape } (dp or null), zoom: { min, max } | null, stops: [0.5, 1, …], mainEquivalentMm, calibration: auto|manual }`.

`views(id, project_id → projects CASCADE, name, filter JSON, …)`: a project's saved Studio filters (model in `packages/vocab/src/filter.ts`).

`folders(id, project_id → projects CASCADE, parent_id → folders SET NULL, name, …)`: a project's folders for the desktop's Files app (epic #72). `parent_id` null = at the root; at most 8 deep and no cycles (checked by the Worker); names unique per directory, case-insensitively. `folder_items(resource_type, resource_id, folder_id → folders CASCADE)`, primary key (type, id): which folder a file sits in (at most one; no row = the root). The file types are `FILE_RESOURCE_TYPES` in `packages/vocab/src/files.ts` (shot, timeline, day, view, location, field); there is no foreign key on the resource, so each delete route (and a shot's project move) sweeps its rows. `desktop_items(id, project_id → projects CASCADE, kind resource|folder|app, resource_type + resource_id | folder_id → folders CASCADE | app_id, label, x, y, …)`: shortcuts on a project's desktop, one per target (unique index); CHECKs keep exactly the kind's target set. Window layouts are not here: they are per browser (`localStorage["desktop.<projectId>"]`).

`folders.kind = 'desktop'` marks the project's Desktop folder (one per project, at the root, named "Desktop"; the Worker makes it on the first `GET /api/files` and refuses to rename, move or bin it). `desktop_items.area` is `desktop` (an icon at `x`, `y`) or `taskbar` (a pin, ordered by `position`); one item per target and area.

**Recycle bin** (epic #90): `deleted_at` (NULL = live) on every file table and on `folders`. A row binned on its own has `deleted_with` NULL; the subfolders and placed files that went along with a binned folder carry that folder's id there, so restoring or purging the folder covers them. Every read filters `deleted_at IS NULL`; placements and desktop rows of a binned file stay until it is purged (`trash.ts`: emptied bin, one entry, or the daily cron after 30 days). A shot's `timeline_clips` and `day_shots` rows are deleted when it is binned. Locations, fields and folders free their name/key while binned (partial unique indexes); a restore that meets a taken one renames.

`field_definitions(id, project_id → projects CASCADE, position, key UNIQUE per project, definition JSON, …)`: a project's extra fields in order. (`project_id` columns are nullable in SQL because `ALTER TABLE` can't add a NOT NULL reference; the Worker always sets them.)

`shooting_days(id, project_id → CASCADE, date YYYY-MM-DD, title, notes, …)` and `day_shots(day_id, shot_id, position, planned_time HH:MM, notes)`.

`timelines(id, project_id → projects CASCADE, name, notes, lock_mode, groups JSON, created_at, updated_at)` and `timeline_clips(id, timeline_id → CASCADE, position, photo_id → photos CASCADE, overlay_id → overlays SET NULL, presentation JSON, duration_ms 100..3600000, notes, title, group_id)`. `groups` holds the sequence blocks' settings (`[{ id, mode each|total, total_ms, split even|edges, edge_weight }]`); `group_id` (no FK, checked on PUT) puts a photo clip in one. A block's clips are adjacent and of one shot; a `total` block's `duration_ms` are the computed split. A clip is either a photo clip (`photo_id` + `presentation`) or a placeholder (`title` only, no photo/overlay/presentation; a CHECK enforces the two shapes); a placeholder with `sketch_id → sketches SET NULL` is a sketch clip (deleting the sketch turns it back into a placeholder). See [timeline](features/timeline.md).

## Monitoring

`storage_daily(day YYYY-MM-DD UTC, workspace_id, bytes, objects, unsized)`, primary key (day, workspace): the app Worker's daily cron writes one row per workspace with photos (from `photos.size_bytes`; `objects` = its photos, `unsized` = photos without a recorded size) and one row with `workspace_id = ''` for the bound bucket's total from an R2 listing. No foreign key: the history outlives a deleted workspace. `admin_settings(key, value JSON, updated_at, updated_by)`: the admin plane's own settings, written by the admin Worker (the operator's storage marks). See [monitoring](features/monitoring.md).

## JSON shapes on photos

`framing` (written by the phone at capture, `Viewfinder.tsx`):

```json
{ "preset_name": "6K FULL", "camera_id": "bmpcc6k", "format_id": "6k",
  "sensor_width_mm": 23.1, "sensor_height_mm": 12.99, "speedbooster_factor": 1,
  "lens_mm": 24, "rig_orientation": "landscape",
  "effective_focal_mm": 24, "full_frame_equivalent_mm": 39.2, "hfov_deg": 51.4, "vfov_deg": 30.3,
  "frame": { "width_fraction": 0.6, "height_fraction": 0.45 },
  "phone_equivalent_focal_mm": 25 }
```

`frame` is the rig frame relative to the photo as captured, centred. Saved framings add a centre (`x`, `y`) and one can be the photo's root ([framing](features/rig-explorer.md)); views use the root. Fractions > 1 mean the rig saw more than the phone. Everything that draws a frame (Studio `Framed.tsx`, mobile `FramedImage.tsx`) and the [rig explorer](features/rig-explorer.md) works from it. The framing snapshot also preserves the rig if the preset is deleted later.

`device`: phone model, EXIF focal lengths, GPS altitude/heading, `gps_fix_age_ms`; since issue #26 also `zoom` (the phone lens: 0.5, 1, 3…), `phone_main_equivalent_mm` (the main lens; `framing.phone_equivalent_focal_mm` is it times the zoom) and `camera_id`.

## API shapes

The Worker returns a shot with its photos embedded (`shotToApi` in `apps/worker/src/shots.ts`); `light` as array, `artificial` as boolean, `extra` as object, plus joined `project_name`, `location_name` and per photo `preset_name` and `image_url`. It also embeds `overlays` and `sketches` (ordered, without their `drawing`; each with `render_url` or null). Client types: `apps/studio/src/api.ts`, `apps/mobile/src/api.ts`.
