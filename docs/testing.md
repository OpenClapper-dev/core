# Testing

What runs where, and how to add a test. All of it runs in `make check` (`pnpm test`) and in the `test` job of CI ([development](development.md#checks-run-before-every-commit)).

## What runs where

| Suite | Runner | Where | What it covers |
| --- | --- | --- | --- |
| `packages/vocab`, `packages/fov-math` | `node --test` | Node | Pure functions: fields, filters, daylight; FOV, overlay, reframe math |
| `apps/worker` project `unit` (`test/unit/`) | Vitest | Node | Password hashing, session tokens, workspace roles |
| `apps/worker` project `routes` (`test/routes/`) | Vitest + `@cloudflare/vitest-plugin` | workerd (Miniflare), local D1 + R2 | Requests through the Worker's own `fetch` and `scheduled`: tenancy on every route, uploads, name clashes, recycle bin, image proxy, sessions, response headers and the CSRF guard |
| `apps/admin` (`test/`) | Vitest + `@cloudflare/vitest-plugin` | workerd, the app's schema | The admin plane: the Access JWT check, the local bypass and its hostname guard, account actions, the audit trail |
| `apps/studio` | `node --test` | Node | The shortcut registry |
| `apps/mobile` | `node --test` | Node | Calibration, EXIF, framing, lens, zoom, layouts; lights: the command queue, the connection manager (fake link and timers), scan suggestions, byte helpers, the NEEWER frames and driver (`src/**/*.test.ts`) |
| End-to-end | | | Not yet (#222) |

`pnpm -C apps/worker test` runs both Worker projects; `npx vitest run --project routes` (in `apps/worker`) only the route tests, `npx vitest run test/routes/trash.test.ts` one file, `npx vitest` watches.

The plugin and `wrangler` go together: the plugin pins one `wrangler` version, and the root `package.json` pins exactly that one, so there is a single copy (`pnpm why wrangler`). Upgrade both in one change.

## Route tests

`apps/worker/vitest.config.ts` runs the Worker from its `wrangler.jsonc` (bindings, Durable Object, the `@openclapper/auth-provider` alias mapped again for Vite). Every test file gets its own D1 and R2; `test/routes/setup.ts` applies the migrations to it. Tests within one file share that storage, so give every test its own rows (fresh ids, a fresh world) instead of relying on order. Only `/api/*` is tested: assets are not served through the test fetch.

The helpers in `test/routes/helpers.ts`:

- `newUser()`: a user with a personal workspace, created straight in D1 (hashed with the real password helper at the lowest iteration count), signed in through `POST /api/auth/login` as the phone, so `token` is a bearer token.
- `api(token, method, path, body?, headers?)`: one request through the Worker's fetch; a `FormData` body goes as multipart, anything else as JSON. `ok(res, status)` asserts the status (showing the body when it is wrong) and returns the JSON.
- `buildWorld(user)`: everything a user can own, created through the API in a shared workspace of its own: project, rig, location, spot, field, view (and a binned one), a shot with a photo in R2, day, framing, timeline with a clip, overlay and sketch with renders, folder, desktop shortcut, device, viewfinder layout, a second member. Every name carries the world's `mark`.
- `uploadForm(meta, files?)`: the phone's multipart upload; `files` limits which images are attached (a sequence continued in parts).
- `snapshot()`: every row of every domain table and every R2 object, as one string; compare before and after a request that must change nothing.
- `runCron()`: the daily `scheduled` handler, to completion. Time-based behaviour is tested by moving stored timestamps (`deleted_at`, `expires_at`) into the past, never by waiting.

A test that shows a real bug stays: mark it `test.fails` (or `test.skip`) with a comment naming the bug or its issue, so it turns red once the bug is fixed. (The `If-Match` case in `images.test.ts` was one until #224 fixed it.)

## The tenancy map

`test/routes/tenancy.test.ts` reads the registered routes from `src/routes.ts` (`Router.list()`), and fails when a route has no entry in its `ROUTES` map (or an entry has no route). **A new route needs an entry in the same change.** The kinds:

- `id`: the route reaches a resource by id (in the path, the query or the body). User B sends the request for user A's resource; it must answer 403/404 (or `refused`), show nothing of A's, and leave every row and R2 object unchanged. Then A sends it, which must pass (`ownerStatus`, default 200/201), proving the refusal came from the workspace check. `body(a, actor)` gets both worlds, so B's attempt can name B's own project or photo next to A's id: the realistic attack on an upsert.
- `list`: B's response never contains any of A's ids or marks. List routes with a `?project_id=` filter are also asked for A's project.
- `exempt`: not workspace-scoped; say why (the preview socket picks the room by the caller's own id).

A per-user upsert keyed by a client id (`PUT /api/devices/:id`: the id is the phone's) is an `id` case whose B attempt writes B's own row (`refused: [201]`); its `undo` deletes that row, and then nothing of A's may have changed.

References to another workspace's rows inside a body (a new location in A's project, a framing with A's rig, …) are a separate table in the same file: refused with 400/403/404 and nothing changed. New routes that take such references add a line there.

New public routes (before sign-in) are listed in `PUBLIC`; the session tests cover the existing ones.

## Admin plane

`apps/admin/test/admin.test.ts` calls the admin Worker's `fetch` directly with a modified env, so each test sets `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ADMIN_DEV_BYPASS` itself. The Access JWKS endpoint is answered by a stubbed `fetch` with a key generated in the test, so valid and invalid JWTs (audience, issuer, expiry, signature, service token) are checked end to end.
