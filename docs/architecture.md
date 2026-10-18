# Architecture

Single-user tool for film location scouting and shoot planning. A phone (Android, Expo) is the viewfinder and camera; a Cloudflare Worker stores everything; a web dashboard is where shots are reviewed, organised and shoots are planned.

## Repo layout (pnpm workspace)

| Path | Stack | Role |
| --- | --- | --- |
| `apps/worker` | Cloudflare Worker, D1 (SQLite), R2, a daily cron | JSON API, image proxy, serves the dashboard as static assets. Hand-written router (`src/http.ts`). The cron (`scheduled` in `src/index.ts`) empties what has been in the recycle bin for 30 days. |
| `apps/dashboard` | Vite + Preact + Leaflet, plain CSS (component library and design-system classes in `src/ui/`, layouts in `src/styles.css`), a desktop shell (window manager with workspaces in `src/wm/`, one app per page in `src/apps/`, shared data store `src/data.ts`), hash routes as launch commands | Web UI: a desktop per project with windows, workspaces, a taskbar, folders and a recycle bin ([desktop](features/desktop.md), [files](features/files.md)). Built into `dist/`, served by the Worker. |
| `apps/mobile` | Expo SDK 57, React Native 0.86, react-native-vision-camera; runs as a **development build** (Fielder Dev) or an APK, not in Expo Go | Viewfinder, capture, review, shots, day mode; 5 tabs plus pushed screens ([phone app](features/phone-app.md)). Own component library in `src/ui/`. |
| `packages/fov-math` | Pure TS, `node --test` | Camera bodies/formats, lenses, speedboosters, FOV and overlay math, re-framing. |
| `packages/vocab` | Pure TS, `node --test` | Shared vocabularies (light, weather, INT/EXT, states), filter model, extra-field definitions, sun/daylight math. |

Both shared packages are imported as TypeScript source (`"exports": { ".": "./src/index.ts" }`), no build step. Anything used by the Worker **and** a client (validation, vocabularies) belongs in `packages/vocab` so rules cannot drift.

## Data flow

1. **Capture** (`apps/mobile/src/screens/Viewfinder.tsx`): photo + GPS fix + framing snapshot (rig, lens, FOV, frame fractions). The image is resized to 1280 px JPEG.
2. **Draft**: goes to the Tag screen (`screens/Tag.tsx`), or straight to the queue with direct upload. Sequences collect several photos into one draft. Drafts are persisted (see [capture](features/capture.md)).
3. **Queue** (`src/uploads.ts`): photos copied to `pending-photos/`, entry stored in the kv-store. `flush()` syncs projects, field definitions and locations first, then posts each shot.
4. **Upload**: `POST /api/shots` (multipart, idempotent). Worker writes each photo to R2 (`photos/<photoId>.jpg`) and the shot + photo rows to D1 in one batch.
5. **Dashboard** loads all shots (`fetchAllShots`, paginated) and filters client-side by the active project. Images come through `GET /api/photos/:id/image`.
6. **Planning** (dashboard Plan) stores shooting days; the phone's Day tab reads them and can keep a day offline.

The phone uses the **deployed** Worker, even in the dev loop. The dashboard dev server proxies to a local Worker.

## Core concepts

- **Project**: every shot belongs to one. The active project is chosen once per client and remembered. See [projects](features/projects.md).
- **Shot vs photo**: a shot carries the metadata (name, tags, review state, extra fields); it owns 1..n photos. A sequence is one shot with many photos. Rig, lens, framing and GPS are per photo. The first photo is the **cover** (`cover(shot)` in both clients).
- **Location, view, field definition**: belong to one project (a hard scope, [issue #44](https://github.com/bubulux/fielder/issues/44)); rigs are shared by all projects of a workspace; devices and viewfinder layouts belong to a user (tenancy, [epic #107](https://github.com/bubulux/fielder/issues/107), [data model](data-model.md#tables)).
- **Recycle bin**: deleting a shot, timeline, day, view, location, field or folder only marks it (`deleted_at`); every list leaves it out, and it can be restored for 30 days ([files](features/files.md#recycle-bin-epic-90), `apps/worker/src/trash.ts`).
- **Client-owned UUIDs**: projects, locations, rigs, views, days and shots get their id on the client. PUT is an upsert, which allows offline creation. Name clashes on projects/locations answer `409` + `existing_id` so the client adopts the existing row (`apps/mobile/src/namedSync.ts`).

## Auth

Moving from Cloudflare Access to first-party sign-in (epic #107): email + password accounts in D1, opaque sessions (`src/authn/`), behind one seam, `@fielder/auth-provider` (`src/authn/provider.ts`), which wrangler's `alias` maps to the first-party provider; another build (the hosted one) points it at its own module. Until the cutover the Worker takes either a session or the Access JWT, which stands for the bootstrap user that owns the pre-sign-in data ([api](api.md#sign-in-authn-epic-107)). Today, in production: Access (One-time PIN) in front of the Worker hostname, and the Worker verifies the Access JWT again (`src/access.ts`). Details in [infrastructure](infrastructure.md).

- Dashboard: Access session cookie.
- Phone: signs in with email and password (`client: "mobile"`), keeps the session token in `expo-secure-store` and sends it as `Authorization: Bearer`. Until the cutover Access blocks that at the edge, so new APKs work only after it (#107).
- Local dev: `ACCESS_DEV_BYPASS="true"` in `apps/worker/.dev.vars` makes every request without a session the bootstrap user.

## Principles worth keeping

- **The phone never loses a capture.** Uploads are idempotent; the server nulls stale references (deleted rig/location) and cuts overlong names instead of rejecting; an upload or edit to a shot in the recycle bin brings it back; rejected shots stay in the queue flagged `stuck` instead of being deleted; drafts and running sequences survive app restarts.
- **Validation lives in `packages/vocab`** and is reused by the Worker. Interactive edits (PATCH) are validated strictly, uploads leniently.
- **Worker handlers** use the `assert*` helpers from `src/http.ts` and throw `HttpError`; D1 has a 100-bound-parameter limit, so id lists are passed as one JSON string and expanded with `json_each`.
