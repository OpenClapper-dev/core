# Admin plane

Issue [#116](https://github.com/bubulux/fielder/issues/116), epic [#107](https://github.com/bubulux/fielder/issues/107). User management for an instance, on its own hostname. Its operators are **not** app users: they sign in through a separate Cloudflare Access application, which brings whatever its policy asks (email PIN, SSO, 2FA). Nothing in the app can reach it.

## Pieces

- `apps/admin/src/index.ts`: the admin Worker (`fielder-admin`).
  - It verifies the Access JWT of its own application on every request (`verifyAccessJwt` with its own `ACCESS_AUD`) and then reads across all workspaces.
  - Same D1 and R2 bindings as the app. It never runs migrations; those belong to `apps/worker`.
- `apps/admin/ui/`: the board, a Preact page on the dashboard's design system (it imports `apps/dashboard/src/ui`), built into `apps/admin/dist` and served by the admin Worker.
- `packages/service-kit`: what both Workers share.
  - The router, request checks and JSON errors.
  - Access verification.
  - Password hashing, so the admin plane makes passwords the app accepts.
  - The bootstrap user's id.

## The board

- **Totals**:
  - accounts (active in 30 days, blocked);
  - workspaces and projects;
  - shots and photos;
  - storage (`photos.size_bytes`; photos from before migration 0021 have no recorded size and are counted apart).
- **Accounts**: email, name, status (active, blocked, locked after failed sign-ins, no password), live sessions, last seen, workspaces, created.
  - **New account** (email, name): the account and its personal workspace. A temporary password is shown once, in 4 groups of 4 easy-to-read characters, for the operator to pass on.
  - **Password**: a new temporary password, shown once. The old one stops working and every session ends.
  - **Block / Unblock**: blocking ends every session at once and refuses sign-in (the data stays). Unblocking also clears a sign-in lock.
  - **Delete**: only when the account's workspaces hold no projects; its devices, layouts and empty workspaces go with it. The bootstrap user is never deleted.
- **Workspaces**: name, personal or shared, owner, members, projects, shots, photos, storage.

Every change is written to the Worker log as `{ "audit": "user.create" | "user.update" | "user.password" | "user.delete", "by": <operator>, … }` (Workers observability).

## API (`apps/admin/src/index.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/whoami` | `{ email }` of the operator |
| GET | `/api/overview` | `{ users, blocked, active_30d, workspaces, projects, shots, photos, bytes, unsized }` |
| GET | `/api/users` | Every account with status, sessions, last seen, workspaces (never a password hash) |
| POST | `/api/users` | `{ email, name? }` → `{ user, password }` (201); `409` for a taken email |
| PATCH | `/api/users/:id` | `{ email?, name?, status? }` |
| POST | `/api/users/:id/password` | → `{ password }` |
| DELETE | `/api/users/:id` | `409` while its workspaces hold projects, `400` for the bootstrap user |
| GET | `/api/workspaces` | Every workspace with owner, counts and storage |

Without a valid Access JWT of the admin application every request is `401`. Until its AUD is set in `apps/admin/wrangler.jsonc` that includes every request.

## Local

`pnpm -C apps/admin dev` runs the admin Worker on :8788 (on the app's local D1, `--persist-to ../worker/.wrangler/state`) and the board on :5174. `ADMIN_DEV_BYPASS="true"` in `apps/admin/.dev.vars` (written by `make init`) stands for Access: every request is `admin@localhost`.
