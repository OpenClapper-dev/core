# Admin plane

Issue [#116](https://github.com/OpenClapper-dev/core/issues/116), epic [#107](https://github.com/OpenClapper-dev/core/issues/107). User management for an instance, on its own hostname. Its operators are **not** app users: they sign in through a separate Cloudflare Access application, which brings whatever its policy asks (email PIN, SSO, 2FA). Nothing in the app can reach it.

## Pieces

- `apps/admin/src/index.ts`: the admin Worker (`fielder-admin`).
  - It verifies the Access JWT of its own application on every request (`verifyAccessJwt` with its own `ACCESS_AUD`) and then reads across all workspaces.
  - Same D1 and R2 bindings as the app. It never runs migrations; those belong to `apps/worker`.
- `apps/admin/ui/`: the board, a Preact page on the shared web design system (`@fielder/ui`, `packages/ui`; theme button in the header), built into `apps/admin/dist` and served by the admin Worker.
  - **Installable (PWA)**, like the Studio: `ui/public/icons/<set>/manifest.webmanifest` ("Fielder admin", standalone, start `/`; the `prod` set in builds, the green `dev` set on the dev server), the padlock icons next to it, linked from `ui/index.html` with `crossorigin="use-credentials"` so the manifest request carries the admin Access cookie. No service worker. Chrome or Edge: the install button in the address bar; the installed app opens in its own window with its own taskbar icon, separate from the Studio's.
- `packages/service-kit`: what both Workers share.
  - The router, request checks and JSON errors.
  - Access verification.
  - Password hashing, so the admin plane makes passwords the app accepts.
  - The bootstrap user's id.

## The board

The header shows the operator and the board's version with its commit.

- **Totals**:
  - accounts (active in 30 days, blocked);
  - workspaces and projects;
  - shots and photos;
  - storage (`photos.size_bytes`; photos from before migration 0021 have no recorded size and are counted apart).
- **Accounts**: email, name, status (active, blocked, locked after failed sign-ins, no password), live sessions, last seen, workspaces, created.
  - **New account** (email, name): the account and its personal workspace. A temporary password is shown once, in 4 groups of 4 easy-to-read characters, for the operator to pass on.
  - **Edit** (#148): email and name. The email is what the account signs in with from now on; its sessions stay. A taken email is refused (409) inside the dialog.
  - **Password**: a new temporary password, shown once. The old one stops working and every session ends.
  - **Block / Unblock**: blocking ends every session at once and refuses sign-in (the data stays). Unblocking also clears a sign-in lock.
  - **Delete**: only when the account's workspaces hold no projects; its devices, layouts and empty workspaces go with it. The bootstrap user is never deleted.
- **Workspaces**: name, personal or shared, owner, members, projects, shots, photos, storage.

Every change is written to the Worker log as `{ "audit": "user.create" | "user.update" | "user.password" | "user.delete", "by": <operator>, … }` (Workers observability).

## API (`apps/admin/src/index.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/whoami` | `{ email, version, commit }`: the operator and what runs |
| GET | `/api/overview` | `{ users, blocked, active_30d, workspaces, projects, shots, photos, bytes, unsized }` |
| GET | `/api/users` | Every account with status, sessions, last seen, workspaces (never a password hash) |
| POST | `/api/users` | `{ email, name? }` → `{ user, password }` (201); `409` for a taken email |
| PATCH | `/api/users/:id` | `{ email?, name?, status? }`; `400` for an email without `@`, `409` for a taken one |
| POST | `/api/users/:id/password` | → `{ password }` |
| DELETE | `/api/users/:id` | `409` while its workspaces hold projects, `400` for the bootstrap user |
| GET | `/api/workspaces` | Every workspace with owner, counts and storage |

Without a valid Access JWT of the admin application every request is `401`. Until its AUD is set (`ADMIN_ACCESS_AUD`, [self-hosting](../self-hosting.md#4-the-admin-planes-sign-in)) that includes every request.

## Local

`make all` (its own pane) or `make admin` (`pnpm -C apps/admin dev`) runs the admin Worker on :8788 (on the app's local D1, `--persist-to ../worker/.wrangler/state`) and the board on :5174. `ADMIN_DEV_BYPASS="true"` in `apps/admin/.dev.vars` (written by `make init`) stands for Access: every request is `admin@localhost`.
