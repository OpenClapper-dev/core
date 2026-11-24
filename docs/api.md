# API

> **Mid-rewrite (epic [#371](https://github.com/OpenClapper-dev/core/issues/371)).** This page describes the Worker on `main`, which the rebuild fills step by step ([build order](rewrite/10-conclusion.md#build-order-proposal)). The Studio and the phone app in this repository still speak the first app's API and do not work against it until their steps land.

All routes live in `apps/worker/src/` and are registered in `index.ts`. Every request except the sign-in routes below needs a user (see [Sign-in](#sign-in-authn-epic-107)); without one the answer is `401`. Errors are JSON `{ "error": "…" }` with a 4xx/5xx status. Ids are UUIDs chosen by the client unless noted.

Every JSON answer carries `cache-control: no-store`, `x-content-type-options: nosniff` and `referrer-policy: same-origin` (`json()` in `packages/service-kit`); A JSON body needs `content-type: application/json` exactly (parameters such as `charset` allowed), else `415`. A path parameter with a malformed `%` sequence is `400`. A change (anything but GET/HEAD) that rides on the Studio's cookie and that the browser marks `Sec-Fetch-Site: cross-site` is refused with `403`, the sign-in routes included; bearer requests (the phone) are not affected (#224).

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

**Access** (`tenancy.ts`, `files.ts`). A project belongs to a workspace: `viewer` reads it and its files, `editor` changes them, `admin`/`owner` manage the workspace. A route by id answers `404` for a row the caller cannot reach (exactly like a missing one) and `403` when their role is too low. A PUT upsert to an id of another workspace is a `404`, never an overwrite. A project named in a body that the caller cannot reach is `400 project_id does not exist`, as an unknown one. A file of an **account home** is its owner's alone: `404` for everyone else. Nothing moves between projects, or between a project and an account home.

## Projects (`projects.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/projects` | `{ projects: [{ id, name, workspace_id, created_at, updated_at, file_count, canvas_live, master }] }` of all the caller's workspaces. `file_count`: live files, without the two fixed folders and internal files |
| PUT | `/api/projects/:id` | `{ name, workspace_id?, canvas_live?, master? }`. `master`: the master timeline, a list of timeline ids, each once (else `400`); left out, it stays. `canvas_live` (`realtime` or `gradual`, else `400`): how watchers of the project's canvases see them change ([canvas](features/canvas.md)); left out, it stays. A new project (`201`) goes to `workspace_id` (default: the caller's personal workspace) and gets its fixed folders, Desktop and Settings; an existing one is renamed and never changes workspace. A name taken in the workspace (any case) is `409` with `existing_id` |
| DELETE | `/api/projects/:id` | Only a project without live files: `409` otherwise. Its recycle bin is emptied with it |

## Files (`files.ts`)

Everything a user makes is a file ([organisation](rewrite/07-organisation.md), [target model](rewrite/10-conclusion.md)). One set of routes serves every type; what a type's body and references may hold, and where a file may sit, is decided by `@openclapper/model` (`packages/model`), which the Worker runs on every save.

A file as the API gives it:

| Field | Meaning |
| --- | --- |
| `id` | UUID, chosen by the client |
| `project_id`, `home` | Its root: a project, or (`project_id: null`, `home: true`) the caller's account home |
| `type` | A registered file type. So far `folder`, `shortcut`, `preferences` (a person's preferences, in their account home), `photo`, `collection`, `device` (a phone or tablet, in its owner's account home), `property` and `naming` (a property definition and a naming pattern, only in the project's Settings folder), `filter` (a saved query), `shot` (properties only until step B6), `canvas` and `preset` (an optics preset; [canvas](features/canvas.md)); each build step adds the types it builds |
| `name` | Free text, up to 120 characters, not unique |
| `container` | The folder or collection it sits in; `null` at the top level |
| `internal_of` | The file it was made inside ([internal files](rewrite/i1-interjection.md)); such a file sits in no container and is left out of lists unless asked for (`internal=1`, `internal_of`) |
| `fixed` | `desktop` or `settings` for a project's fixed folders, else `null` |
| `created_at`, `updated_at`, `created_by`, `deleted_at` | System properties; `deleted_at` is set while the file is in the recycle bin |
| `lock` | `{ by, until }` while someone edits it, else `null`. The routes that take and release it come with the canvas (step B5) |
| `body_version`, `body` | The type's own document and the version of its shape. `body` is in single-file answers, and in lists only with `body=1` |
| `photo` | A photo's facts, on every answer about a photo: `origin`, `media_type`, `taken_at`, `width`, `height` (upright), `stored` (bytes of `thumbnail`, `preview`, `original`; null until it arrived), `angle_of_view` (`{ horizontal, vertical, source }` or null), `device_id` |
| `refs` | Single-file answers, and lists with `refs=1`: the file's references in order, `[{ kind, to, data, missing }]`. `missing` is true when the file pointed at is gone, binned or not of this root |

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/files` | `?project_id=` or `?home=1` (exactly one). The live files of the root that are not internal (`internal=1`: internal files too), by name. Narrowed by `container` (an id, or `top`), `type` (comma-separated), `q` (search: every word must be in the name or in a property value as text; case, accents and ß folded) and `internal_of`. `values=1` adds each file's property `values` (by definition id). `bin=1` lists the bin's entries instead, newest first, each with `binned_with` (how many files went along). `body=1` adds the bodies, `refs=1` each file's `refs`. `limit` (at most 2000) and `offset` page it; the answer says `more` |
| GET | `/api/files/:id` | `{ file }` with `body`, `refs` and `values`. A binned file answers too |
| GET | `/api/files/:id/uses` | `{ uses: [{ id, type, name, internal_of, kind }] }`: the live files of the root that point at it |
| PUT | `/api/files/:id` | Upsert. `{ type, project_id \| home: true, name?, container?, internal_of?, body?, body_version?, refs? }`. `type`, the root and `internal_of` are set when the file is made and never change (`400`). What is absent is kept; a new file of a project without a name gets one from its type's naming pattern ("Shot 001"; [properties](features/properties.md#naming-patterns)), one in an account home "New <type>"; the type's empty body. Saving a `property` definition fits the values it has to it (and those of choices that depend on it). `container: null` is the top level. `refs`, when sent, replaces the file's references. Body and references are checked together by the type's rules (`400` with what is wrong); a reference kind that points only at certain types (a shot's `item`: photo or canvas; its `overlay`: canvas; a timeline's `clip`: photo, canvas or shot) is refused with `400` when the file it names is here and of another type, and kept when that file is missing; a body sent at an older `body_version` is upgraded, a newer one refused. `201` when made, `200` when changed, `409` while it is in the bin. A fixed folder cannot be renamed or moved |
| POST | `/api/files/move` | `{ ids, container: id \| null }`. All or none. Refused (`400`): a container that is not a live folder or collection of the same root, a type the container does not hold, a folder inside itself, more than 8 levels of containers, a fixed folder, an internal file |
| POST | `/api/files/bin` | `{ ids }`. To the recycle bin, each with everything inside it and its internal files. A file that is binned already is left as it is. A fixed folder: `400` |
| POST | `/api/files/restore` | `{ ids }` → `{ restored, to_top }`. Each comes back where it was with everything that went along; when its container is gone or still binned it comes back at the top level and is listed in `to_top`. `400` for a file that went to the bin with another one (restore that one), `409` for an internal file whose parent is still binned |
| POST | `/api/files/purge` | `{ ids }`, each in the bin (`400` otherwise). Deleted for good, with what went along |
| DELETE | `/api/bin` | `?project_id=` or `?home=1`. Empties the root's bin → `{ purged }` (entries) |
| POST | `/api/files/:id/duplicate` | `{ id, name?, container? }`: `id` is the copy's. Copies the file with what is inside it, its internal files, their references and property values; a reference to a file that was copied along points at the copy. Default name "<name> copy", default place next to the original. Sent again with the same `id` it answers `200` with the copy that exists. At most 500 files in one copy |
| PUT | `/api/files/:id` with a photo | Only its name and place change; a photo is never made here, nor its body changed (400) |
| POST | `/api/files/:id/release` | `{ container? }`. Makes an internal file a file of its root; one-way |

## Properties (`properties.ts`)

Values of a project's properties on its files ([properties](features/properties.md)). A property must be live, of the file's project and attached to the file's type; a value must fit its field type, strictly (`400` with the property's name and what is wrong). `null` (or an empty value) removes one. A dependent choice whose parent changes keeps only a value that still fits. A reference names live files of the project of the types it allows. Each answer carries the file's values after the change.

| Method | Path | Notes |
| --- | --- | --- |
| PUT | `/api/files/:id/properties` | `{ values: { <property id>: value \| null } }` → `{ values }` |
| POST | `/api/properties/set` | Bulk edit: `{ ids, values }` (files of one project, at most 500) → `{ values: { <file id>: values } }`. All or none |

A new project starts with the default properties in its Settings folder (`PUT /api/projects/:id`); they are not counted in `file_count` and do not keep a project from being deleted.

## Canvases and the edit lock (`canvas.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/files/:id/lock` | `{ holder }` (the editing window's token) → `{ lock: { by, until } }`: taken when free, run out or this window's; renewed the same way (it holds 60 s). `423` with `lock` when someone else holds it. Lockable types only (a canvas) |
| DELETE | `/api/files/:id/lock?holder=` | Lets go; only the holder's call changes anything. `204` |
| GET | `/api/canvases/:id/live?holder=` | WebSocket (`426` without the upgrade) to the file's `CanvasRoom` (`live.ts`; any lockable file: canvas, shot, timeline, else `400`): the editor when the window `holder` holds the lock, else a viewer (viewer access is enough). `409` when the project's `canvas_live` is `gradual`. Editor sends `doc { body, base?, refs? }`, `draft { draft }`, `saved`, `held`; viewers get those and `editor { by }` (a user id or null). Other messages, and anything a viewer sends, are dropped |
| PUT | `/api/canvases/:id/render`, `/thumbnail` | The body is the image (PNG, JPEG, WebP; 12 MB and 600 KB). Replaces the one stored |
| GET | `/api/web?to=<path>` | The bearer session (the phone's) as the cookie of the same session, and a `302` to that path of this site (for the Studio in the phone's web view). `400` for a path that is not of this site or without a bearer token |
| GET | `/api/canvases/:id/image?size=render\|thumbnail` | Default `render`. An ETag; with `?v=` (the file's `updated_at`) cached for good, else revalidated. `404` until made |

While a lockable file is held by someone else, `PUT /api/files/:id` and a render upload answer `423`; send the holder as `x-lock-holder`. Saving a canvas keeps its frames in `frames`. Saving an optics preset follows the additive rule (`400` with the lenses in use); binning one that frames use is `409` (archive it). Copies take a canvas's frames and renders along; purging removes the renders.

## Photos (`photos.ts`)

A photo is a file made by uploading it ([media](rewrite/01-media.md)): first what is known about it, then its three images, each on its own and in any order. The adding client makes the thumbnail (about 400 px) and the preview (about 2048 px); the original is the untouched file. A photo is usable as soon as its preview is there. Every step can be sent again and answers the same, so a client may retry anything.

| Method | Path | Notes |
| --- | --- | --- |
| PUT | `/api/photos/:id` | `{ project_id, origin: capture \| import, media_type?, taken_at?, width, height, name?, container?, exif?, readout?, device_id?, frame? }` → `{ file }`, `201`. `frame`: the frame the camera showed (frame values; for a preset its factors and `presetName`); one that does not fit the rules is left out, the photo kept. Answers carry it as `photo.frame`. `width`/`height`: the original as shown (upright). `exif`: the raw tags by name (text, numbers, lists of numbers; others are dropped). `readout`: `make`, `model`, `lens`. The angle of view is computed here from `FocalLengthIn35mmFilm`, else `FocalLength` with the focal-plane resolution (`packages/fov-math` `photoAov`). Without `name` the project's naming pattern for photos names it (its device and focal tokens read the readout's model and `FocalLengthIn35mmFilm`). A `container` that is gone or cannot hold photos is dropped (the photo comes in at the top level), a missing `taken_at` is the time of the upload. Sent again for a photo that exists: nothing changes, `200`. An id of another file: `409` |
| PUT | `/api/photos/:id/thumbnail`, `/preview`, `/original` | The body is the image. Thumbnail up to 400 KB, preview up to 4 MB, JPEG or WebP; original up to 60 MB, JPEG, PNG, WebP or HEIC. The type is read from the bytes (`415` otherwise). Stored once: a second upload is not read and answers `200` with `already: true`. Asks the auth provider for `upload` |
| GET | `/api/photos/:id/image?size=thumbnail\|preview\|original` | Default `preview`. `404` until that image arrived. Its stored type, `nosniff`, an ETag, `private, max-age=31536000, immutable`; `If-None-Match` answers `304`, a failed `If-Match` `412` |

A **copy** of a photo (`duplicate`) shares the stored images: it costs no storage. Images are removed when the last photo using them is purged.

## Devices (`devices.ts`)

A device is a phone or tablet running the app ([capture](rewrite/03-capture.md)): a file of the type `device` in its owner's account home, made only by registering itself. Its body holds what it reports (`kind`, `make`, `model`, `lenses` with the 35 mm equivalent and zoom of each real lens, `screen`, `app`) and the person's choice of `tabs`, which can be changed through `PUT /api/files/:id` from the phone or the Studio.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/devices/register` | `{ fingerprint, kind: phone \| tablet, make, model, lenses, screen, camera?, app }` → `{ file }`. `camera`: the camera's area per orientation (kept when not sent). The record is found by the caller and the fingerprint (on Android `ANDROID_ID`): `201` the first time (named after the model, tabs Camera, Media, Shots, Setup), else `200` with what is reported replaced and the name, tabs and camera layout kept; a device in the recycle bin comes back (`restored: true`). The same fingerprint under another account is another record |
| GET | `/api/link?role=phone\|studio` | WebSocket (`426` without the upgrade) into the caller's phone link: channels `link` (hello, presence, readout), `layout` (preview, stop, exit) and extensions' channels carried unread ([camera layouts](features/camera-layouts.md)) |

Bulk routes take at most 500 ids, all of one root; an id the caller cannot reach makes the whole request `404`.

**The recycle bin.** A binned file is kept 30 days, then the daily cron purges it. References are never touched by binning: a binned file shows as `missing` where it was used and is back everywhere once restored. When a container is purged, a file that was binned on its own inside it stays in the bin and restores to the top level.

**Limits** (`packages/model/src/files.ts`): a body of at most 1 500 000 bytes of JSON (D1 takes 2 000 000 bytes per string and per row), 2 000 references per file, 2 000 bytes of `data` per reference.

## Other

- `GET /health`: D1 and R2 reachability plus the caller's email; needs a user.
