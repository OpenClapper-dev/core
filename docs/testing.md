# Testing

What runs where, and how to add a test. All of it runs in `make check` (`pnpm test`) and in the `test` job of CI ([development](development.md#checks-run-before-every-commit)).

## What runs where

| Suite | Runner | Where | What it covers |
| --- | --- | --- | --- |
| `packages/model` | `node --test` | Node | The shared model of the rewrite: file types, body and reference checks, placement rules |
| `packages/vocab`, `packages/fov-math` | `node --test` | Node | Pure functions of the first app, until its clients are rebuilt: fields, filters, daylight; FOV, overlay, reframe math |
| `apps/worker` project `unit` (`test/unit/`) | Vitest | Node | Password hashing, session tokens, workspace roles |
| `apps/worker` project `routes` (`test/routes/`) | Vitest + `@cloudflare/vitest-plugin` | workerd (Miniflare), local D1 + R2 | Requests through the Worker's own `fetch` and `scheduled`: tenancy on every route, the file routes (making, moving, the recycle bin, copies, internal files, roles), project names, sessions, response headers and the CSRF guard, the storage snapshot, the preview room |
| `apps/admin` (`test/`) | Vitest + `@cloudflare/vitest-plugin` | workerd, the app's schema | The admin plane: the Access JWT check, the local bypass and its hostname guard, account actions, the audit trail |
| `apps/studio` | `node --test` | Node | The shortcut registry |
| `apps/mobile` | `node --test` | Node | Calibration, EXIF, framing, lens, zoom, layouts; lights: the command queue, the connection manager (fake link and timers), scan suggestions, byte helpers, the NEEWER light and battery frames and drivers, the Bluetooth Mesh stack and provisioning against the Mesh Profile 1.0.1 §8 sample data, the proxy session, configuration and the Aputure driver against a simulated light (`mesh/fakeNode.testlib.ts`), the Aputure commands against the reference's vectors (`src/**/*.test.ts`) |
| End-to-end | | | Not yet (#222) |

`pnpm -C apps/worker test` runs both Worker projects; `npx vitest run --project routes` (in `apps/worker`) only the route tests, `npx vitest run test/routes/files.test.ts` one file, `npx vitest` watches.

The plugin and `wrangler` go together: the plugin pins one `wrangler` version, and the root `package.json` pins exactly that one, so there is a single copy (`pnpm why wrangler`). Upgrade both in one change.

## Route tests

`apps/worker/vitest.config.ts` runs the Worker from its `wrangler.jsonc` (bindings, Durable Object, the `@openclapper/auth-provider` alias mapped again for Vite). Every test file gets its own D1 and R2; `test/routes/setup.ts` applies the migrations to it. Tests within one file share that storage, so give every test its own rows (fresh ids, a fresh world) instead of relying on order. Only `/api/*` is tested: assets are not served through the test fetch.

The helpers in `test/routes/helpers.ts`:

- `newUser()`: a user with a personal workspace, created straight in D1 (hashed with the real password helper at the lowest iteration count), signed in through `POST /api/auth/login` as the phone, so `token` is a bearer token.
- `api(token, method, path, body?, headers?)`: one request through the Worker's fetch; a `FormData` body goes as multipart, anything else as JSON. `ok(res, status)` asserts the status (showing the body when it is wrong) and returns the JSON.
- `buildWorld(user)`: everything a user can own, created through the API in a shared workspace of its own: a project, a folder with a shortcut in it, a shortcut pointing at the folder with an internal file, a binned folder, a folder in the account home, a second member. Every name carries the world's `mark`.
- `folderBody(root, name, extra?)`, `shortcutBody(project, name, extra?)`: the body of a PUT for a new file.
- `snapshot()`: every row of every domain table and every R2 object, as one string; compare before and after a request that must change nothing.
- `runCron()`: the daily `scheduled` handler, to completion. Time-based behaviour is tested by moving stored timestamps (`deleted_at`, `expires_at`) into the past, never by waiting.

A test that shows a real bug stays: mark it `test.fails` (or `test.skip`) with a comment naming the bug or its issue, so it turns red once the bug is fixed.

A file type that a later build step brings can be stood in for in a test: `files.test.ts` registers `t-note` with `registerFileType` (the test and the Worker share one module graph), which exercises versioned bodies, references and the copy's remapping before a real type needs them.

## The tenancy map

`test/routes/tenancy.test.ts` reads the registered routes from `src/routes.ts` (`Router.list()`), and fails when a route has no entry in its `ROUTES` map (or an entry has no route). **A new route needs an entry in the same change.** The kinds:

- `id`: the route reaches a resource by id (in the path, the query or the body). User B sends the request for user A's resource; it must answer 403/404 (or `refused`), show nothing of A's, and leave every row and R2 object unchanged. Then A sends it, which must pass (`ownerStatus`, default 200/201), proving the refusal came from the workspace check. `body(a, actor)` gets both worlds, so B's attempt can name B's own project next to A's id: the realistic attack on an upsert.
- `list`: B's response never contains any of A's ids or marks.
- `exempt`: not workspace-scoped; say why (the preview socket picks the room by the caller's own id).

Account homes have a test of their own in the same file: another user's home file answers 404 on every route, and nothing crosses between a home and a project.

References to another workspace's rows inside a body (a new file in A's project, B's file into A's folder, A's file in a bulk request next to B's, …) are a separate table in the same file: refused with 400/403/404 and nothing changed. New routes that take such references add a line there. The one reference that is accepted on purpose is a file's `refs`: it is kept as sent, shows as missing, and never counts as a use of the other workspace's file.

New public routes (before sign-in) are listed in `PUBLIC`; the session tests cover the existing ones.

## Admin plane

`apps/admin/test/admin.test.ts` calls the admin Worker's `fetch` directly with a modified env, so each test sets `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ADMIN_DEV_BYPASS` itself. The Access JWKS endpoint is answered by a stubbed `fetch` with a key generated in the test, so valid and invalid JWTs (audience, issuer, expiry, signature, service token) are checked end to end.
