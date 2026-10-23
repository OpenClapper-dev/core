# Admin plane

Issue [#116](https://github.com/OpenClapper-dev/core/issues/116), epic [#107](https://github.com/OpenClapper-dev/core/issues/107). User management for an instance, on its own hostname. Its operators are **not** app users: they sign in through a separate Cloudflare Access application, which brings whatever its policy asks (email PIN, SSO, 2FA). Nothing in the app can reach it.

## Pieces

- `apps/admin/src/index.ts`: the admin Worker (`openclapper-admin`).
  - It verifies the Access JWT of its own application on every request (`verifyAccessJwt` with its own `ACCESS_AUD`) and then reads across all workspaces. A refusal answers only `{ "error": "unauthorized" }`; the reason (expired, audience, signature, …) goes to the Worker log. A JWT with an unknown key id refetches Access's keys at most once a minute.
  - Same D1 and R2 bindings as the app. It never runs migrations; those belong to `apps/worker`.
- `apps/admin/ui/`: the board (`App.tsx` shell with three tabs, `Accounts.tsx`, `Audit.tsx`, `Workspaces.tsx`, `Monitoring.tsx`, hand-written SVG `charts.tsx`), a Preact page on the shared web design system (`@openclapper/ui`, `packages/ui`; theme button in the header), built into `apps/admin/dist` and served by the admin Worker.
  - **Installable (PWA)**, like the Studio: `ui/public/icons/<set>/manifest.webmanifest` ("OpenClapper admin", standalone, start `/`; the `prod` set in builds, the green `dev` set on the dev server), the shield icons next to it, linked from `ui/index.html` with `crossorigin="use-credentials"` so the manifest request carries the admin Access cookie. No service worker. Chrome or Edge: the install button in the address bar; the installed app opens in its own window with its own taskbar icon, separate from the Studio's.
- `packages/service-kit`: what both Workers share.
  - The router, request checks and JSON errors.
  - Access verification.
  - Password hashing, so the admin plane makes passwords the app accepts.
  - The bootstrap user's id.

## The board

The header shows the operator and the board's version with its commit. On an instance that is not production (`INSTANCE_LABEL`, e.g. `staging`) a badge after the brand names it, and the tab title starts with it ([self-hosting](../self-hosting.md#a-second-instance-staging)).

- **Totals**:
  - accounts (active in 30 days, blocked);
  - workspaces and projects;
  - shots and photos;
  - storage (`photos.size_bytes`; photos from before migration 0021 have no recorded size and are counted apart).
- **Accounts**: email, name, status (active, blocked, no password), live sessions, last seen, workspaces, created.
  - **New account** (email, name): the account and its personal workspace. A temporary password is shown once, in 4 groups of 4 easy-to-read characters, for the operator to pass on.
  - **Edit** (#148): email and name. The email is what the account signs in with from now on; its sessions stay. A taken email is refused (409) inside the dialog.
  - **Password**: a new temporary password, shown once. The old one stops working and every session ends.
  - **Block / Unblock**: blocking ends every session at once and refuses sign-in (the data stays).
  - **Delete**: only when the account's workspaces hold no projects; its devices, layouts and empty workspaces go with it. The bootstrap user is never deleted.
- **Workspaces**: name, personal or shared, owner, members, projects, shots, photos, storage.
- **Monitoring** (the second tab, `#monitoring`): storage over time, every workspace's share, the operator's marks; a banner on both tabs once the bucket is past a mark ([monitoring](monitoring.md)).

- **Audit** (the third tab, `#audit`): every change made here, newest first, 50 at a time (Older entries): when, the operator, the action, the account, what changed. Read-only.

## Audit trail (#224)

Every change an operator makes (account created, changed, blocked or unblocked, password reset, deleted; the storage marks saved) writes a row to `admin_audit` (migration 0025, [data model](../data-model.md)) **in the same D1 batch** as the change itself, so neither exists without the other. A refused request writes nothing. The row holds the operator's email from the Access JWT, the account's id and its email at the time, and what changed as JSON (never a password). The same is still logged as `{ "audit": <action>, "by": <operator>, … }` (Workers observability), which keeps only days.

## API (`apps/admin/src/index.ts`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/whoami` | `{ email, version, commit, instance }`: the operator, what runs, and on which instance (`instance` is the deployment's `INSTANCE_LABEL`, `""` for production) |
| GET | `/api/overview` | `{ users, blocked, active_30d, workspaces, projects, shots, photos, bytes, unsized }` |
| GET | `/api/users` | Every account with status, sessions, last seen, workspaces (never a password hash) |
| POST | `/api/users` | `{ email, name? }` → `{ user, password }` (201); `409` for a taken email |
| PATCH | `/api/users/:id` | `{ email?, name?, status? }`; `400` for an email without `@`, `409` for a taken one |
| POST | `/api/users/:id/password` | → `{ password }` |
| DELETE | `/api/users/:id` | `409` while its workspaces hold projects, `400` for the bootstrap user |
| GET | `/api/workspaces` | Every workspace with owner, counts and storage |
| GET | `/api/storage?days=` | Storage over time with the operator's marks ([monitoring](monitoring.md)) |
| GET | `/api/cloudflare?days=` | The account-wide numbers from Cloudflare analytics, or `{ configured: false }` ([monitoring](monitoring.md)) |
| GET | `/api/audit?limit=&before=&before_id=` | The audit trail, newest first: `{ entries: [{ id, at, operator_email, action, target_user_id, target_email, detail }], next: { before, before_id } \| null }`. `limit` 1..200 (default 50); pass `next` back for the following page |
| GET | `/api/settings` | `{ storage_marks }` |
| PUT | `/api/settings` | `{ storage_marks: [{ bytes, label }] }`, at most 10, strict |
| POST | `/api/storage/repair-metadata` | `{ cursor?, check? }` → `{ checked, repaired, unknown, examples, cursor }`: one page (100 objects) of the R2 objects' custom metadata checked or rewritten from D1 ([monitoring](monitoring.md)); called again with `cursor` until null. A page that rewrote objects is audited as `storage.repair` |

Without a valid Access JWT of the admin application every request is `401`. Until its AUD is set (`ADMIN_ACCESS_AUD`, [self-hosting](../self-hosting.md#4-the-admin-planes-sign-in)) that includes every request.

## Local

`make all` (its own pane) or `make admin` (`pnpm -C apps/admin dev`) runs the admin Worker on :8788 (on the app's local D1, `--persist-to ../worker/.wrangler/state`) and the board on :5174. `ADMIN_DEV_BYPASS="true"` in `apps/admin/.dev.vars` (written by `make init`) stands for Access: every request is `admin@localhost`. It is honoured only for requests to `localhost` or `127.0.0.1` (#224): set by mistake on a deployment, it opens nothing and every request still needs the Access JWT.
