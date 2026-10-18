# Infrastructure

Everything runs on one Cloudflare account per instance; nothing else is needed. The tracked `wrangler.jsonc` files are for local development and name no account, database or Access application: each deployment's settings come from `deploy.env` (gitignored) or the GitHub workflow's secrets and variables, and `scripts/deploy-config.mjs` writes the deploy configs from them ([self-hosting](self-hosting.md)). The reference instance's identifiers live in its `deploy.env` (from #119 in the private deployment repository), not here.

| Resource | Details |
| --- | --- |
| Worker `APP_WORKER_NAME` (default `fielder-api`) | API and dashboard on one hostname; `assets.run_worker_first` routes `/api/*`, `/auth/*`, `/health` to the Worker, everything else is the SPA. A daily cron empties the recycle bin and old sessions. Observability enabled. |
| Worker `ADMIN_WORKER_NAME` (default `fielder-admin`) | The admin plane (`apps/admin`), its own hostname, the same D1 and R2, behind its own Cloudflare Access application ([admin](features/admin.md)). Without `ACCESS_TEAM_DOMAIN` and `ADMIN_ACCESS_AUD` it refuses every request. |
| D1 `D1_DATABASE_NAME` (default `fielder-db`) | Binding `DB`, migrations in `apps/worker/migrations/` (only the app Worker's config applies them) |
| R2 `R2_BUCKET` (default `fielder-shots`) | Binding `SHOTS_BUCKET`, objects `photos/<photoId>.<ext>` and `renders/…`, with the workspace in their custom metadata |
| Durable Object `PreviewRoom` (SQLite-backed) | Binding `PREVIEW`, migration tag `v1` (applied by `wrangler deploy`). One room per user for the live layout preview; holds websockets, no data. |
| Cloudflare Access | The admin plane's sign-in. On the reference instance also in front of the app until the cutover below. |
| Expo / EAS | Phone builds; the only production env var is `EXPO_PUBLIC_API_URL` |
| Open-Meteo | Weather forecast, called from the dashboard browser directly (free, no key) |
| OpenStreetMap tiles | Maps in the dashboard (Leaflet) and the phone (Leaflet in a WebView, loaded from unpkg) |

## Auth

- **App users** sign in with email and password ([accounts](features/accounts.md)): the dashboard keeps an HttpOnly session cookie, the phone a bearer token in its keystore. Accounts are made in the admin plane (or with `scripts/user.mjs`); there is no public sign-up.
- **Operators** of the admin plane sign in through its Cloudflare Access application, never with an app account.
- **Local development**: `ACCESS_DEV_BYPASS="true"` (app) and `ADMIN_DEV_BYPASS="true"` (admin) in the gitignored `.dev.vars` stand for a signed-in user; they must never be set in a deployed config. Locally the bootstrap user signs in as `dev@localhost` / `fielder-local-dev` (`make init`).

## Cutover from Cloudflare Access (reference instance, epic #107)

Until it, Access guards the app as well (`APP_ACCESS_AUD` in `deploy.env`), and the Worker takes either a session or the Access JWT, which stands for the bootstrap user that owns the pre-sign-in data (`index.ts` `identify`). Old APKs sign in through `/auth/mobile` (a WebView on the Access PIN login, the token sent as `cf-access-token`). In order:

1. Apply migrations 0021 and 0022 (`pnpm -C apps/worker migrate:remote`), deploy the app and the admin plane.
2. Set up the admin plane's Access application ([self-hosting](self-hosting.md#4-the-admin-planes-sign-in)), set `ADMIN_ACCESS_AUD`, deploy it again.
3. Give the bootstrap user your email and a password: `node scripts/user.mjs --bootstrap --email … --remote`.
4. Sign in on the dashboard with that password **while Access is still on** (it accepts both); do not go on until this works.
5. Remove the Access application from the app's hostname (keep a note of its settings to put it back), remove `APP_ACCESS_AUD` from `deploy.env`, deploy.
6. Install the new APK and sign in on the phone. Shots queued meanwhile stay on the phone and upload after the sign-in.
7. Then #118 removes the Access fallback and `/auth/mobile` from the app Worker.

## Secrets and rotation

- To cut a user off: block the account in the admin plane (every session ends at once) or reset its password.
- The deploy API token (`CLOUDFLARE_API_TOKEN`, [self-hosting](self-hosting.md#1-a-cloudflare-api-token)) is the only secret; Access AUDs, team domains and resource ids are not secret (they show in login redirects and URLs).
- `.secrets/` (gitignored, never commit) is the place for local copies of such values.
- Wrangler's OAuth login lacks `account:read`; `CLOUDFLARE_ACCOUNT_ID` (from `deploy.env`, exported by the Makefile) fills it in.
