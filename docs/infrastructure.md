# Infrastructure

Everything runs on one Cloudflare account per instance; nothing else is needed. The tracked `wrangler.jsonc` files are for local development and name no account, database or Access application: each deployment's settings come from `deploy.env` (gitignored) or the GitHub workflow's secrets and variables, and `scripts/deploy-config.mjs` writes the deploy configs from them ([self-hosting](self-hosting.md)). The reference instance's identifiers live in its `deploy.env` (from #119 in the private deployment repository), not here.

| Resource | Details |
| --- | --- |
| Worker `APP_WORKER_NAME` (default `fielder-api`) | API and dashboard on one hostname; `assets.run_worker_first` routes `/api/*`, `/auth/*`, `/health` to the Worker, everything else is the SPA. A daily cron empties the recycle bin and old sessions. Observability enabled. |
| Worker `ADMIN_WORKER_NAME` (default `fielder-admin`) | The admin plane (`apps/admin`), its own hostname, the same D1 and R2, behind its own Cloudflare Access application ([admin](features/admin.md)). Without `ACCESS_TEAM_DOMAIN` and `ADMIN_ACCESS_AUD` it refuses every request. |
| D1 `D1_DATABASE_NAME` (default `fielder-db`) | Binding `DB`, migrations in `apps/worker/migrations/` (only the app Worker's config applies them) |
| R2 `R2_BUCKET` (default `fielder-shots`) | Binding `SHOTS_BUCKET`, objects `photos/<photoId>.<ext>` and `renders/…`, with the workspace in their custom metadata |
| Durable Object `PreviewRoom` (SQLite-backed) | Binding `PREVIEW`, migration tag `v1` (applied by `wrangler deploy`). One room per user for the live layout preview; holds websockets, no data. |
| Cloudflare Access | The admin plane's sign-in. |
| Android signing key | Per deployment, made once with `scripts/keystore.sh`; in the deployment repository's secrets and a backup, never in git. Builds need no other service; the only build-time setting is `EXPO_PUBLIC_API_URL` ([self-hosting](self-hosting.md#the-phone)) |
| Open-Meteo | Weather forecast, called from the dashboard browser directly (free, no key) |
| OpenStreetMap tiles | Maps in the dashboard (Leaflet) and the phone (Leaflet in a WebView, loaded from unpkg) |

## Auth

- **App users** sign in with email and password ([accounts](features/accounts.md)): the dashboard keeps an HttpOnly session cookie, the phone a bearer token in its keystore. Accounts are made in the admin plane (or with `scripts/user.mjs`); there is no public sign-up.
- **Operators** of the admin plane sign in through its Cloudflare Access application, never with an app account.
- **Local development**: `AUTH_DEV_BYPASS="true"` (app) and `ADMIN_DEV_BYPASS="true"` (admin) in the gitignored `.dev.vars` stand for a signed-in user; they must never be set in a deployed config. Locally the bootstrap user signs in as `dev@localhost` / `fielder-local-dev` (`make init`).

## An instance from before accounts

The reference instance ran behind Cloudflare Access until 2026-10-19 (epic #107); migration 0021 gave all its data to the bootstrap user. Such an instance switches over like this:

1. Deploy (it applies migrations 0021 and 0022), set up the admin plane's Access application ([self-hosting](self-hosting.md#4-the-admin-planes-sign-in)).
2. Give the bootstrap user your email and a password: `node scripts/user.mjs --bootstrap --email … --remote`. It keeps its id, so the data stays with it.
3. Delete the Access application (not only its policy) of the app's hostname. The dashboard shows its sign-in page; the phone needs an APK from #115 on.

## Secrets and rotation

- To cut a user off: block the account in the admin plane (every session ends at once) or reset its password.
- The deploy API token (`CLOUDFLARE_API_TOKEN`, [self-hosting](self-hosting.md#1-a-cloudflare-api-token)) is the only secret; Access AUDs, team domains and resource ids are not secret (they show in login redirects and URLs).
- `.secrets/` (gitignored, never commit) is the place for local copies of such values.
- Wrangler's OAuth login lacks `account:read`; `CLOUDFLARE_ACCOUNT_ID` (from `deploy.env`, read by `scripts/deploy-config.mjs`) fills it in.
