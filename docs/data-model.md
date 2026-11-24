# Data model

> **Mid-rewrite (epic [#371](https://github.com/OpenClapper-dev/core/issues/371)).** This is the schema on `main`: the baseline of the rebuild, which each build step extends ([target model](rewrite/10-conclusion.md#target-data-model)). The first app's schema is in the history up to release v0.16.0.

D1 (SQLite) database `openclapper-db`, schema in `apps/worker/migrations/`. Stored images live in the R2 bucket `openclapper-media` (see `photos`).

## Migrations

| File | What |
| --- | --- |
| `0006_canvas_live.sql` | `projects.canvas_live`: how watchers of the project's canvases see them change, `realtime` (default) or `gradual` (step B5 follow-up, #377) |
| `0005_canvas.sql` | `frames` (every frame of every canvas: preset, focal length, the picture mark) and `renders` (a canvas's render and thumbnail) (step B5, #377) |
| `0004_name_counters.sql` | `name_counters`: the running number of each naming pattern, per project and file type (step B4, #376) |
| `0003_devices.sql` | `devices`: a device file's owner and hardware fingerprint (step B3, #375) |
| `0002_photos.sql` | `photos`: a photo's facts and stored images (step B2, #374) |
| `0001_rewrite_baseline.sql` | The baseline of the rewrite (step B0, #372): accounts and tenancy, `projects`, `files`, `refs`, `property_values`, and the admin plane's tables. For databases created new: it carries nothing over, and it fails on purpose on a database of the first app |

A new numbered file for every change; an applied one is never edited.

## Tables

**Tenancy** (epic #107). `users(id, email UNIQUE NOCASE, name, password_hash, status active|blocked, failed_logins, locked_until, created_at, updated_at)` (`failed_logins` and `locked_until` are unused since the lockout was dropped, #224): `password_hash` is `pbkdf2-sha256$<iterations>$<salt>$<hash>`, or `!`, which never verifies (sign-in disabled). `sessions(id, user_id → users CASCADE, client dashboard|mobile, expires_at, last_used_at, created_at)`: the id is the SHA-256 (hex) of the opaque token; the token itself is never stored; `dashboard` is the Studio (the value predates the rename and is kept, not migrated). `workspaces(id, name, owner_user_id → users, kind personal|shared, created_at, updated_at)` and `workspace_members(workspace_id → CASCADE, user_id → CASCADE, role owner|admin|editor|viewer)`, primary key (workspace, user). Access is decided by `workspace_members` alone; `owner_user_id` is bookkeeping and nullable, so organisations can own workspaces later (an added `owner_org_id`). `kind`: each user's own workspace is `personal` (where their new projects go by default); the ones they create to share are `shared`.

`projects(id, workspace_id → workspaces, name UNIQUE NOCASE per workspace, canvas_live realtime|gradual, created_at, updated_at)`: a project is a root of files and a hard scope. `canvas_live` is the project's choice of live updates for its canvases ([canvas](features/canvas.md)).

`files(id, project_id → projects CASCADE, home_of → users CASCADE, type, name, container → files SET NULL, internal_of → files CASCADE, fixed, created_at, updated_at, created_by → users SET NULL, deleted_at, deleted_with, lock_by → users SET NULL, lock_holder, lock_until, body JSON, body_version)`: everything a user makes ([organisation](rewrite/07-organisation.md)).

| Column | Meaning |
| --- | --- |
| `project_id`, `home_of` | The root, exactly one of the two: a project, or the account home of a user |
| `type` | A file type registered in `packages/model` |
| `name` | Free text, not unique |
| `container` | The folder or collection it sits in; null at the top level. Cleared when the container is purged, so a file binned on its own inside it restores to the top level |
| `internal_of` | The file it was made inside; never together with `container`. Purged with its parent |
| `fixed` | `desktop` or `settings`: a project's fixed folders, made with the project, one of each |
| `deleted_at`, `deleted_with` | The recycle bin. `deleted_with` names the file whose binning took this one along (a folder's contents, a file's internal files); null for the file the user binned |
| `lock_by`, `lock_holder`, `lock_until` | One editor at a time: the user, the editing window's own token, and until when. Written from step B5 |
| `body`, `body_version` | The type's own document, saved whole and checked by `packages/model` on every save, and the version of its shape. A change of shape raises the version and upgrades stored bodies when they are read; it needs no migration |

`refs(from_file → files CASCADE, kind, position, to_file, data JSON | null)`, primary key (from_file, kind, position): one row per pointer from a file to a file. `kind` is what it is for (`content`, `item`, `clip`, `overlay`, `base`, `placed`, `property`, `target`), `position` its place in the file's list, `data` what the kind needs besides (an item's time, the frame it shows). `to_file` has no foreign key on purpose: a removed file leaves a missing reference, and a restore brings every use back. Indexed on `to_file` for "where is this used".

`photos(file_id → files CASCADE, object_id, origin capture|import, media_type, taken_at, width, height, original_bytes, preview_bytes, preview_type, thumbnail_bytes, thumbnail_type, aov_horizontal, aov_vertical, aov_source, device_id, frame JSON)`: what the server searches and counts about a photo ([media](rewrite/01-media.md)). The raw EXIF and the device readout are in the file's body. `object_id` names the stored images, in R2 under `photos/<object_id>/original|preview|thumbnail.<ext>`; a copy of a photo has the same `object_id`, and the images go when the last row with it is purged. A size that is null: that image has not arrived. `device_id` is filled from step B3, `frame` from B8.

`devices(file_id → files CASCADE, user_id → users CASCADE, fingerprint, seen_at)`, unique on (user, fingerprint): ties a device file to the hardware it stands for, so a reinstall finds its record and two phones of one model are two devices. What the device reports is the file's body.

`property_values(file_id → files CASCADE, definition_id → files CASCADE, value JSON)`, primary key (file, definition): a property's value on a file ([properties](features/properties.md)). The definition is a file of the type `property` in the project's Settings folder; the value's shape follows its field type (`packages/model/src/properties.ts`). A reference value also keeps `refs` rows of kind `property` with `data: { property }`, rewritten whenever the file's values change and removed when the definition is purged.

`frames(canvas_id → files CASCADE, frame_id, preset_id, focal, is_picture)`: a canvas's frames, rewritten from its body on every save, so whether a preset's lens is in use is one query ([canvas](features/canvas.md)). A shot's default frame from a preset is a row too (frame id `default`, [shots](features/shots.md)).

`renders(file_id → files CASCADE, part render|thumbnail, type, bytes, at)`: a canvas's flattened images in R2 under `canvases/<file id>/<part>`.

`name_counters(project_id → projects CASCADE, type, next)`: the counter of a file type's naming pattern in a project, raised in the statement that reads it.

## What is a table and what is a body

Decided in [workshop 10](rewrite/10-conclusion.md#tables-and-json-bodies): what the server searches, joins or keeps consistent across rows is in tables (files, references, property values; photos, frames and devices from their steps on); what one editor loads and saves whole is the file's JSON body (a canvas's objects, a flow's tracks, a layout's bars).

D1 takes at most 2 000 000 bytes per string and per row. A body is therefore limited to 1 500 000 bytes of JSON (`MAX_BODY_BYTES`). A type that could outgrow that (a canvas with very many pen strokes, step B5) has to store its strokes compactly or move the large part out of the row.

## Monitoring

`storage_daily(day YYYY-MM-DD UTC, workspace_id, bytes, objects, unsized)`, primary key (day, workspace): the app Worker's daily cron writes one row per workspace with photos (`bytes`: its stored images, each shared image once; `objects`: its photos) and one row with `workspace_id = ''` for the bound bucket's total from an R2 listing. No foreign key: the history outlives a deleted workspace. `admin_settings(key, value JSON, updated_at, updated_by)`: the admin plane's own settings, written by the admin Worker (the operator's storage marks). `cf_usage_daily(day, metric, value, taken_at)`: the Cloudflare analytics the admin Worker's cron keeps beyond the API's window, key/value so a new metric needs no migration. See [monitoring](features/monitoring.md).

`admin_audit(id, at, operator_email, action, target_user_id, target_email, detail JSON)`: the admin plane's audit trail (#224). `action` is `user.create`, `user.update`, `user.password`, `user.delete` or `settings.update`; `target_email` is the account's email at the time; `detail` what changed (never a password). Each row goes in the same D1 batch as the change it records. No foreign key: the trail outlives a deleted account. Indexed on `(at DESC, id DESC)` for the newest-first pages.

