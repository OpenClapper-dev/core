# Architecture

> **Mid-rewrite (epic [#371](https://github.com/OpenClapper-dev/core/issues/371)).** The rebuild lands on `main` step by step ([build order](rewrite/10-conclusion.md#build-order-proposal)). Since step B0 the Worker serves the new model (files, [api](api.md)) and since B1 the Studio is rebuilt on it; the phone app and the data flow described below are still the first app's until their steps land. Production runs the last release, v0.16.0.

Single-user tool for film location scouting and shoot planning. A phone (Android, Expo) is the viewfinder and camera; a Cloudflare Worker stores everything; a web app, the Studio, is where shots are reviewed, organised and shoots are planned.

## Repo layout (pnpm workspace)

| Path | Stack | Role |
| --- | --- | --- |
| `apps/worker` | Cloudflare Worker, D1 (SQLite), R2, a daily cron | JSON API, image proxy, serves the Studio as static assets. Hand-written router (`packages/service-kit/src/http.ts`), routes registered in `src/routes.ts`. The cron (`scheduled` in `src/index.ts`) empties what has been in the recycle bin for 30 days, drops expired sessions and snapshots storage for the admin board ([monitoring](features/monitoring.md)). |
| `apps/studio` | Vite + Preact on the design system `@openclapper/design`, a desktop shell (window manager with virtual desktops in `src/wm/`, one app per file in `src/apps/`), hash routes as launch commands | Web UI, being rebuilt: a desktop per project with windows, a taskbar and a launcher ([desktop](features/desktop.md)). Built into `dist/`, served by the Worker. |
| `apps/mobile` | Expo SDK 57, React Native 0.86, react-native-vision-camera; runs as a **development build** (OpenClapper Dev) or an APK, not in Expo Go | Viewfinder, capture, review, shots, day mode; 5 tabs plus pushed screens ([phone app](features/phone-app.md)). Own component library in `src/ui/`. |
| `apps/admin` | Cloudflare Worker + Preact page on the shared web design system (`@openclapper/ui`) | The admin plane: user management across the instance, on its own hostname behind its own Cloudflare Access app; same D1/R2, never migrates ([admin](features/admin.md)). |
| `packages/service-kit` | Pure TS | What both Workers share: router and request checks, Access verification, password hashing. |
| `packages/ui` | Preact components + CSS (`@openclapper/ui`) | The web design system: tokens, component classes, components and the theme switch, shared by the Studio and the admin board ([design](design.md#web-component-library)). |
| `packages/fov-math` | Pure TS, `node --test` | Camera bodies/formats, lenses, speedboosters, FOV and overlay math, re-framing. |
| `packages/model` | Pure TS, `node --test` | The shared model of the rewrite: file types, the rules for their bodies and references, where a file may sit. Used by the Worker; the rebuilt clients follow. |
| `packages/vocab` | Pure TS, `node --test` | Shared vocabularies (light, weather, INT/EXT, states), filter model, extra-field definitions, sun/daylight math. |

The shared packages are imported as TypeScript source (`"exports": { ".": "./src/index.ts" }`), no build step. Anything used by the Worker **and** a client (validation, vocabularies) belongs in a shared package so rules cannot drift: `packages/model` for the rebuild, `packages/vocab` for what is left of the first app.

## Data flow

1. **Capture** (`apps/mobile/src/apps/Camera.tsx`, `src/media/pipeline.ts`): the camera's JPEG is kept as the original; preview (about 2048 px) and thumbnail (about 400 px) are made on the phone and the EXIF is read. Import from the phone and from the Studio run the same steps.
2. **Queue** (`src/media/queue.ts`): one photo per entry with its three files, persisted on the phone. Sync creates projects made on the phone first.
3. **Upload**: `PUT /api/photos/:id` (what is known; the server computes the angle of view from the EXIF), then thumbnail, preview and original, each on its own and idempotent. R2 keys `photos/<object_id>/<part>.<ext>`, the file and its photo row in D1 ([api](api.md#photos-photosts)).
4. **Studio** lists a project's files (`GET /api/files`) and shows them in Media; images come through `GET /api/photos/:id/image`.

The phone uses the **deployed** Worker, even in the dev loop. The Studio dev server proxies to a local Worker.

## Core concepts

- **Project**: every shot belongs to one. The active project is chosen once per client and remembered. See [projects](features/projects.md).
- **Shot vs photo**: a shot carries the metadata (name, tags, review state, extra fields); it owns 1..n photos. A sequence is one shot with many photos. Rig, lens, framing and GPS are per photo. The first photo is the **cover** (`cover(shot)` in both clients).
- **Location, view, field definition**: belong to one project (a hard scope, [issue #44](https://github.com/OpenClapper-dev/core/issues/44)); rigs are shared by all projects of a workspace; devices and viewfinder layouts belong to a user (tenancy, [epic #107](https://github.com/OpenClapper-dev/core/issues/107), [data model](data-model.md#tables)).
- **Recycle bin**: deleting a shot, timeline, day, view, location, field or folder only marks it (`deleted_at`); every list leaves it out, and it can be restored for 30 days ([files](features/files.md#recycle-bin-epic-90), `apps/worker/src/trash.ts`).
- **Client-owned UUIDs**: projects, locations, rigs, views, days and shots get their id on the client. PUT is an upsert, which allows offline creation. Name clashes on projects/locations answer `409` + `existing_id` so the client adopts the existing row (`apps/mobile/src/namedSync.ts`).

## Auth

First-party sign-in (epic #107): email + password accounts in D1, opaque sessions (`src/authn/`), behind one seam, `@openclapper/auth-provider` (`src/authn/provider.ts`), which wrangler's `alias` maps to the first-party provider; another build (the hosted one) points it at its own module ([api](api.md#sign-in-authn-epic-107)). Cloudflare Access guards only the admin plane. Details in [infrastructure](infrastructure.md).

- Studio: an HttpOnly session cookie (`SameSite=Lax`; changes marked `Sec-Fetch-Site: cross-site` are refused on top, #224).
- Phone: signs in with email and password (`client: "mobile"`), keeps the session token in `expo-secure-store` and sends it as `Authorization: Bearer`.
- Local dev signs in like production: `dev@localhost` / `openclapper-local-dev`, a local user made by `make init`.

## Principles worth keeping

- **The phone never loses a capture.** Uploads are idempotent; the server nulls stale references (deleted rig/location) and cuts overlong names instead of rejecting; an upload or edit to a shot in the recycle bin brings it back; rejected shots stay in the queue flagged `stuck` instead of being deleted; drafts and running sequences survive app restarts.
- **Validation lives in `packages/vocab`** and is reused by the Worker. Interactive edits (PATCH) are validated strictly, uploads leniently.
- **Worker handlers** use the `assert*` helpers from `src/http.ts` and throw `HttpError`; D1 has a 100-bound-parameter limit, so id lists are passed as one JSON string and expanded with `json_each`.
