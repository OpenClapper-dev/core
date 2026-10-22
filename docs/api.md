# API

All routes live in `apps/worker/src/` and are registered in `index.ts`. Every request except the sign-in routes below needs a user (see [Sign-in](#sign-in-authn-epic-107)); without one the answer is `401`. Errors are JSON `{ "error": "…" }` with a 4xx/5xx status. Ids are UUIDs chosen by the client unless noted.

Every JSON answer carries `cache-control: no-store`, `x-content-type-options: nosniff` and `referrer-policy: same-origin` (`json()` in `packages/service-kit`); the image and render proxies keep their own caching and add `nosniff`. A JSON body needs `content-type: application/json` exactly (parameters such as `charset` allowed), else `415`. A path parameter with a malformed `%` sequence is `400`. A change (anything but GET/HEAD) that rides on the Studio's cookie and that the browser marks `Sec-Fetch-Site: cross-site` is refused with `403`, the sign-in routes included; bearer requests (the phone) are not affected (#224).

## Sign-in (`authn/`, epic #107)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login` | Public. `{ email, password, client?: "studio" \| "mobile" }` (anything but `mobile` is stored as `sessions.client = dashboard`) → `{ user: { id, email, name }, expires_at }`. The Studio gets the session as an HttpOnly cookie `openclapper_session`; `client: "mobile"` gets `token` in the body, to send as `Authorization: Bearer <token>`. One `401` for an unknown email and a wrong password (no lockout, no rate limit yet: #224, [accounts](features/accounts.md)); `403` for a blocked account (only after the right password) |
| POST | `/api/auth/logout` | Public. Deletes the request's session if any and clears the cookie; always `204` |
| POST | `/api/auth/password` | Session required (cookie or bearer; under `/api/auth/` because only the first-party provider has passwords). `{ current, password }` → `204`. The new password follows `passwordProblem` (400), must differ from the current one (400). A wrong current password is `403` (not 401, which the clients read as signed out). Every other session of the account ends (#148) |
| GET | `/api/me` | `{ user: { id, email, name }, workspaces: [{ id, name, role, personal }] }`; the clients' signed-in probe |
| GET | `/api/ping` | Public. `{ ok: true, version, commit, instance }`: the product version, the deployed commit (`dev` locally, [releasing](releasing.md)) and the instance (`INSTANCE_LABEL`, `""` for production; the Studio shows it as a badge, even on sign-in); touches nothing |
| GET | `/api/workspaces` | The caller's: `[{ id, name, role, personal, member_count, project_count, created_at }]`, personal first |
| PUT | `/api/workspaces/:id` | `{ name }`: a new shared workspace, the caller its owner (201), or a rename (admin) |
| GET | `/api/workspaces/:id/members` | `[{ user_id, email, name, role, created_at }]`, any member |
| POST | `/api/workspaces/:id/members` | `{ email, role }` (admin, editor, viewer): adds an existing account of this instance (`404` for an unknown email) or changes its role. Admins manage editors and viewers, the owner also admins; the owner's role never changes |
| DELETE | `/api/workspaces/:id/members/:user` | Remove (same rule), or leave (your own id). The owner cannot leave (`400`) |

Who a request is (`index.ts` `identify`): a session (bearer header, else cookie; sliding: Studio 30 days, phone 180, extended at most once a day). Local development too: there is no bypass. Before any change the auth provider's `allow` is asked (`403` when it says no; the first-party provider always allows).

**Access** (`tenancy.ts`). Lists hold what is in the caller's workspaces. A route by id answers `404` for a row of a workspace the caller is not in (exactly like a missing one) and `403` when their role there is too low: `viewer` reads, `editor` changes content, `admin`/`owner` manage the workspace. A PUT upsert to an id of another workspace is a `404`, never an overwrite. A project named in a body (an upload, a move target) that the caller cannot reach is `400 project_id does not exist`, as an unknown one, so a phone parks such an upload as stuck. Shots never move to a project of another workspace (`400`). Lists without `?project_id=` (locations, spots, fields, views, days, shots) cover every project of the caller's workspaces. A location or spot named by id is only ever matched or copied by name within the same workspace: an upload naming one of another workspace drops it (as a deleted one), an edit is `400`. Files, the desktop and the recycle bin need `viewer` on the project to read and `editor` to change. Timelines and days never move to a project of another workspace (`400`); a sketch is copied only within its workspace, and a framing's rig must be one of the photo's workspace.

## Projects (`projects.ts`, `fields.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/projects` | Each with `workspace_id`, `shot_count` and `field_ids` (ordered) |
| PUT | `/api/projects/:id` | `{ name, notes?, workspace_id? }` upsert. A new project goes to `workspace_id` (editor there), default the caller's own workspace; an existing one keeps its workspace. Names are unique per workspace: clash → `409 { existing_id }` (of that workspace) |
| DELETE | `/api/projects/:id` | Only without live shots, else `409`; the project's recycle bin is emptied first |
| PUT | `/api/projects/:id/fields` | `{ field_ids: [...] }` reorders the project's own fields (must list exactly them) |

## Shots and photos (`shots.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/shots?project_id=&state=&location_id=&limit=&before=&before_id=` | Newest first, keyset pagination on `(captured_at, id)`, `next` cursor. Photos embedded. |
| GET | `/api/shots/:id` | |
| POST | `/api/shots` | Multipart: `metadata` (JSON) + one `photo.<photoId>` file per photo not yet stored. See below. |
| PATCH | `/api/shots/:id` | Any of `name, light, artificial, weather, int_ext, shot_size, camera_support, movement, location_id, extra, description, position_from_location, state, project_id`. `extra` is validated against the project's fields. Moving to another project removes the shot from the old project's shooting days and timelines. |
| PATCH | `/api/shots` | Bulk edit: `{ ids: uuid[] (≤ 500), set?: { any single-PATCH field except extra }, extra?: { key: value \| null } }`. Only the given fields change. `extra` is per key and merged into each shot's values (groups child by child, null clears, dependent selects that no longer fit are dropped), then the edited keys are checked against each shot's (new) project. Unknown ids → 404, any error → nothing written (one transaction). Moving removes the shots from the old project's shooting days. Returns `{ shots }`. |
| DELETE | `/api/shots/:id` | Moves the shot to the [recycle bin](#recycle-bin-trashts-epic-90) (`{ deleted, binned: true }`); its timeline clips and day places go now. Purging deletes photos, overlays, sketches and their R2 objects |
| GET | `/api/photos/:id/image` | Image from R2, immutable caching, conditional requests: `If-None-Match` hit `304`, a failed `If-Match` `412` (#224) |
| PATCH | `/api/photos/:id` | `{ lat, lon, all_in_shot? }` position correction (also sets a position on photos captured without one); sets `position_corrected` |

`POST /api/shots` metadata:

```json
{ "id": "<shot uuid>", "project_id": "…", "name": null, "location_id": null, "int_ext": null,
  "light": ["dusk"], "artificial": false, "weather": null, "shot_size": "ws", "camera_support": null, "movement": ["pan"],
  "extra": {}, "state": "unreviewed",
  "photos": [{ "id": "…", "ordinal": 0, "timestamp": "ISO", "lat": 52.5, "lon": 13.4, "gps_accuracy_m": 5, "position_corrected": false,
               "preset_id": null, "lens_mm": 24, "width": 1280, "height": 960, "framing": {…}, "device": {…} }] }
```

- Idempotent. An existing shot keeps its tags (they may have been edited since); only photos not stored yet are added. That is how retries and chunked sequence uploads work (the phone sends 12 photos per request, the server allows 60). A photo id already stored in another shot is `409` before anything is written (the R2 key comes from the id).
- Limits (#224), all checked before anything is written: a declared `content-length` above 60 × 3 MB + 1 MB is `413` before the body is read; each image at most 3 MB (`413`); the stored type comes from the file's magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF….WEBP`), whatever the part's declared type, and anything else is `415`; a shot holds at most **200 photos** across its uploads (`413` with the count). The phone parks such a rejection as `stuck` and keeps the files ([capture](features/capture.md)).
- `lat`/`lon` may be null or missing (captured without GPS); half a position is dropped. `position_corrected` marks a position set by hand on the phone before upload. `state` carries a review decision made on the phone before upload; anything invalid becomes `unreviewed`.
- `photos[].source`: `camera` (default), `upload` or `drawn` (Studio-made, [new shot](features/new-shot.md)); for the last two `lens_mm` is optional and stored as 0.
- Lenient on purpose: unknown `preset_id`/`location_id` become null, names over 120 characters are cut, `extra` is only pruned, not validated.
- `201` for a new shot, `200` for an existing one; `duplicate: true` when nothing was added.

## Framings (`framings.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| PUT | `/api/framings/:id` | Upsert `{ photo_id, name, rig_id?, lens_mm, frame: { width_fraction, height_fraction, x?, y? }, root? }`. The centre is clamped to the photo; `root: true` also makes it the photo's root. A framing cannot move to another photo (`409`). Returns `{ shot }`. |
| DELETE | `/api/framings/:id` | A deleted root falls back to as captured. Returns `{ deleted, shot }` |
| PUT | `/api/photos/:id/root` | `{ framing_id: uuid \| null }` (null = as captured) → `{ shot }` |

Overlay and timeline-clip presentations accept `frame.x`/`frame.y` and `framing_id`.

## Overlays and sketches (`compose.ts`)

Shots embed both lists without the drawing; see [compose](features/compose.md) for the model.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/overlays/:id` | With `drawing` |
| PUT | `/api/overlays/:id` | Upsert. JSON `{ photo_id, name, description?, drawing, presentation, position? }`, or `multipart/form-data` with `metadata` (that JSON) and `render` (JPEG, PNG or WebP by its magic bytes, else `415`; ≤ 6 MB; a declared `content-length` above 6 MB + 1 MB + 64 KB is `413` before the body is read, #224). `drawing` is validated by `validateDrawing(v, true)` (a look is required), `presentation` by `validatePresentation`. An overlay cannot move to another photo (`409`). Returns `{ overlay, shot }`; `201` when new. |
| PATCH | `/api/overlays/:id` | `{ name?, description?, position? }` → `{ overlay, shot }` |
| DELETE | `/api/overlays/:id` | Removes the render too → `{ deleted, shot }` |
| GET | `/api/overlays/:id/render` | The render; `render_url` on the overlay carries `?v=<updated_at>`, so it is cached as immutable. Conditional requests as for photos (`304`, `412`) |
| GET / PUT / PATCH / DELETE | `/api/sketches/:id` | Same, with `{ shot_id, name, kind?, description?, drawing (look null), aspect (0.25..4), position? }`; PATCH takes `kind` too |
| GET | `/api/sketches/:id/render` | |
| POST | `/api/overlays/:id/copy` · `/api/sketches/:id/copy` | `{ id, timeline_id, clip_id }`: copy (with the render) as a timeline clip's own overlay / sketch; used when a clip is duplicated. `201` |

**Clip-owned overlays and sketches** (issue #31): with `timeline_id` + `clip_id` in the PUT body (instead of `shot_id` for a sketch) the row belongs to that timeline clip. The owner is fixed at creation (`409` on a change); the timeline must be in the photo's project. Shots never embed clip-owned rows, so the phone does not see them; they carry `timeline_id`/`clip_id` (null when shot-owned). A sketch PUT/PATCH/DELETE of a clip-owned sketch returns `shot: null`.

## Timelines (`timelines.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/timelines?project_id=` | Each with `clips: [{ id, photo_id, shot_id, overlay_id, presentation, duration_ms, notes, title, sketch_id, group_id }]` in order, `groups: [{ id, mode, total_ms, split, edge_weight }]` (sequence blocks, issue #37), plus `overlays` and `sketches`: the clips' own (issue #31), without drawings. A placeholder clip has `photo_id`/`shot_id`/`overlay_id`/`presentation` null and a `title`. |
| GET | `/api/timelines/:id` | |
| PUT | `/api/timelines/:id` | `{ project_id, name, notes?, lock_mode?, groups?, clips: [...] }` replaces the whole timeline (≤ 500 clips). `lock_mode` (a presentation mode or null) forces one mode on every clip. A clip is `{ id, photo_id, overlay_id?, presentation, duration_ms, notes? }` or a placeholder `{ id, title, duration_ms, notes? }`; a placeholder with `sketch_id` is a **sketch clip**. A clip may show a shot overlay of its photo or its own overlay, never another clip's (nulled); a sketch clip's sketch must be its own or a shot sketch in the project (else it falls back to a placeholder). Clips that leave the timeline take their own overlays and sketches (and renders) along. Clips whose photo is not in the project are dropped silently; an overlay that is not the photo's is nulled. **Sequence blocks**: a photo clip may carry `group_id` of one of `groups` (`mode` `each` · `total`, `total_ms`, `split` `even` · `edges`, `edge_weight` 1..3, rules in `packages/vocab/src/timeline.ts`). A block's clips must be adjacent and show photos of one shot (400 otherwise); blocks without clips are dropped, and a `total` block's clip durations are recomputed with `splitDuration` on every save. |
| DELETE | `/api/timelines/:id` | To the recycle bin. Purging deletes the clips' own overlays and sketches with their renders too. |
| POST | `/api/timelines/:id/clips/:clip/promote` | `{ what: "framing" \| "overlay" \| "sketch", name?, shot_id? }`: the clip's own re-frame becomes a saved framing of its photo (an identical framing — same rig, lens and frame — is linked instead; the clip then references it), its own overlay becomes the photo's (the clip keeps pointing at it), or a sketch clip's own sketch becomes a sketch of `shot_id` (a shot in the project). The clip must be saved. → `{ timeline, shot }` |

## Locations, rigs, views

| Method | Path | Notes |
| --- | --- | --- |
| GET / PUT / DELETE | `/api/locations[/:id]` | `{ project_id, name, lat?, lon? }`: `project_id` is required to create and never changes (GET takes `?project_id=`); names are unique per project. Without `lat`/`lon` the stored pin is kept, `null` for both removes it; `shot_count`, `approved_count`; clash → `409 { existing_id }` (a binned location's name is free); DELETE bins it: its shots read as without a location until it is restored, uploads naming it drop it, edits naming it are 400 |
| GET (websocket) | `/api/preview/socket?role=phone\|studio` | Live layout preview ([viewfinder layouts](features/viewfinder-layouts.md#live-preview-on-the-phone-50)): one Durable Object room per user. The Studio sends `{ type: "preview", layout, orientation }` / `{ type: "stop" }` / `{ type: "readout" }`; the phone `{ type: "hello", device: { id, model } }`, `{ type: "exit" }`, `{ type: "specs", id, specs }` (relayed to dashboards, checked by `validateDeviceSpecs`); dashboards get `{ type: "presence", phones: [{ id, model }], previewing }`. Without `Upgrade: websocket`: 426 |
| GET / PUT / DELETE | `/api/viewfinder-layouts[/:id]` | `{ name, layout, device_id? }`, layout checked by `validateViewfinderLayout` ([viewfinder layouts](features/viewfinder-layouts.md)); `device_id` absent keeps it, null clears it, an unknown one or another user's device is 400; a user's own (`user_id`): lists, PUT and DELETE see only yours |
| GET / PUT / DELETE | `/api/devices[/:id]` | Device specs ([viewfinder layouts](features/viewfinder-layouts.md#device-specs-68)): PUT `{ name?, specs }`, specs checked by `validateDeviceSpecs`; `name` required to create, absent keeps the stored one (the phone's updates); a user's own, keyed `(user_id, id)`: PUT upserts the caller's own row (`201` new, `200` updated); the same phone id under another account is that account's row and is never touched (#224). DELETE clears the caller's layouts' `device_id` for it; `404` when the caller has no such device |
| GET / PUT / DELETE | `/api/spots[/:id]` | `{ location_id, name, lat?, lon? }`: a place within a location ([projects](features/projects.md)); `location_id` required to create, never changes (GET takes `?project_id=`); names unique per location (409 + `existing_id`); `shot_count`; delete nulls `shots.spot_id` |
| GET / PUT / DELETE | `/api/presets[/:id]` | Rigs: `name, camera_id, format_id, sensor_width_mm, sensor_height_mm, speedbooster_factor, lens_min_mm, lens_max_mm`, plus `workspace_id` for a new rig (default the caller's own workspace; an existing rig keeps its own). Lists hold the rigs of all the caller's workspaces, each with its `workspace_id`. An upload naming a rig of another workspace stores the photo without it |
| GET / PUT / DELETE | `/api/views[/:id]` | `{ project_id, name, filter }` (`project_id` required to create), filter validated by `validateFilter` |

## Extra fields (`fields.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/fields` | `{ fields: [{ id, project_id, position, key, definition, … }] }`; `?project_id=` for one project |
| PUT | `/api/fields/:id` | `{ project_id, definition }` (`project_id` required to create; new fields go last), validated by `validateFieldDef`; key clash within the project → 409 |
| POST | `/api/fields/import` | `{ project_id, fields: [def, …] }`: new keys created in the project, its existing keys replaced; all validated first. Returns the project's list plus `created`/`updated`. |
| DELETE | `/api/fields/:id` | To the recycle bin; stored values on shots stay. A binned field's key is free |

## Shooting days (`days.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/days?project_id=` | Days ordered by date, each with `shots: [{ shot_id, planned_time, notes }]` in order |
| GET | `/api/days/:id` | |
| PUT | `/api/days/:id` | `{ project_id, date, title?, notes?, shots: [...] }` replaces the whole day. Shots not (or no longer) in the project are dropped silently. |
| DELETE | `/api/days/:id` | To the recycle bin |

## Folders and desktop (`files.ts`, epics #72 and #90)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/files?project_id=` | `{ folders, items, desktop }`: the project's live folders (each with `kind`: `normal`, or `desktop` for the Desktop folder, created here on first use; a top-level folder already named "Desktop" becomes it), placements in them (`{ resource_type, resource_id, folder_id }`, none = root) and desktop items of both areas (taskbar ones by `position`), in one payload |
| PUT | `/api/folders/:id` | `{ project_id, name, parent_id? }`: `project_id` required to create, never changes; `parent_id` absent keeps, `null` = root. 400 for a cycle, more than 8 levels, a parent in another project, or renaming/moving the Desktop folder; a name taken in the directory → 409 + `existing_id`; a binned folder → 409 |
| DELETE | `/api/folders/:id` | Moves the folder to the recycle bin with its subfolders and the files placed in them (`{ deleted, binned: true }`); 400 for the Desktop folder |
| PUT | `/api/folder-items/:type/:id` | `{ folder_id }` puts the resource in a folder of its own project (400 otherwise, 404 for an unknown resource); `null` moves it back to the root. `:type` from `FILE_RESOURCE_TYPES` |
| PUT | `/api/desktop/:id` | `{ project_id, kind, resource_type + resource_id \| folder_id \| app_id, label?, area? (`desktop` default \| `taskbar`), position?, x, y }`, checked by `validateDesktopItem`; target and area never change after create (409); a target already in that area → 409 + `existing_id`. Updates set `label`, `x`, `y`, `position` |
| DELETE | `/api/desktop/:id` | |

Binning keeps a file's placement and shortcuts (they come back with it); purging deletes them. A shot moved to another project (single or bulk `PATCH`) lands at that project's root and keeps only shortcuts on the target project's desktop.

## Recycle bin (`trash.ts`, epic #90)

Every DELETE of a shot, timeline, day, view, location, field or folder only marks the row (`deleted_at`); every list and lookup leaves binned rows out. A folder takes its subtree along (`deleted_with` = that folder). Rows are purged for good when the bin is emptied, one at a time, or by the daily cron (`scheduled` in `index.ts`, 03:17 UTC) once they are `TRASH_RETENTION_DAYS` (30) old. The same cron snapshots storage for the admin board ([monitoring](features/monitoring.md)).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/trash?project_id=` | `{ entries: TrashEntry[] }`, newest first: `{ type (a file type or folder), id, name, sub, deleted_at, folder_id (the live folder it comes back to, null = top level), photo_id? (a shot's cover), count? (a folder's files) }`. Only what was binned on its own; a folder's contents are inside it |
| POST | `/api/trash/:type/:id/restore` | Back where it was. A file whose folder is gone or binned comes back at the top level; a folder whose parent is gone or binned too. A taken name gets " (restored)" (a field key `_restored`). A folder binned along with another → 400. `{ restored, name? }` |
| DELETE | `/api/trash/:type/:id` | Purge one entry (a folder with everything binned with it); shots take their R2 images and renders |
| DELETE | `/api/trash?project_id=` | Empty the project's bin → `{ purged }` |

A binned shot comes back by itself when the phone uploads to it again (a continued or retried capture) or anything `PATCH`es it: a capture or an offline edit is never lost.

## Other

- `GET /health`: D1 and R2 reachability plus the caller's email; needs a user.
