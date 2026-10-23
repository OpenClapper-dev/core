# Infrastructure

Everything runs on one Cloudflare account per instance; nothing else is needed. The tracked `wrangler.jsonc` files are for local development and name no account, database or Access application: each deployment's settings are GitHub variables and secrets (per instance, a GitHub environment), the Deploy server workflow exports them, and `scripts/deploy-config.mjs` writes the deploy configs from the environment alone, never from a file ([self-hosting](self-hosting.md)). The reference instances' identifiers live in the deployment repository's environments and notes, not here.

| Resource | Details |
| --- | --- |
| Worker `APP_WORKER_NAME` (default `openclapper-api`) | API and Studio on one hostname; `assets.run_worker_first` routes `/api/*`, `/auth/*`, `/health` to the Worker, everything else is the SPA, served with the CSP and security headers of `apps/studio/public/_headers`. `preview_urls: false` (both Workers): a preview URL would run an unreviewed version with the production bindings. A daily cron empties the recycle bin and old sessions and snapshots storage ([monitoring](features/monitoring.md)). Observability enabled. |
| Worker `ADMIN_WORKER_NAME` (default `openclapper-admin`) | The admin plane (`apps/admin`), its own hostname, the same D1 and R2, behind its own Cloudflare Access application ([admin](features/admin.md)). Without `ACCESS_TEAM_DOMAIN` and `ADMIN_ACCESS_AUD` it refuses every request. A daily cron keeps Cloudflare analytics for the board when `CF_ANALYTICS_TOKEN` is set ([monitoring](features/monitoring.md)). |
| D1 `D1_DATABASE_NAME` (default `openclapper-db`) | Binding `DB`, migrations in `apps/worker/migrations/` (only the app Worker's config applies them) |
| R2 `R2_BUCKET` (default `openclapper-media`) | Binding `SHOTS_BUCKET`, objects `photos/<photoId>.<ext>` and `renders/…`, with the workspace in their custom metadata |
| Durable Object `PreviewRoom` (SQLite-backed) | Binding `PREVIEW`, migration tag `v1` (applied by `wrangler deploy`). One room per user for the live layout preview; holds websockets, no data. |
| Cloudflare Access | The admin plane's sign-in. |
| Android signing key | Per deployment, made once with `scripts/keystore.sh` (into a folder outside the checkout); in the deployment's GitHub secrets and a backup, never in git or a checkout. The staging app (`org.openclapper.staging`) uses the same key. Builds need no other service; the only build-time setting is `EXPO_PUBLIC_API_URL` ([self-hosting](self-hosting.md#the-phone)) |
| Open-Meteo | Weather forecast, called from the Studio browser directly (free, no key); the only origin besides the tiles in the Studio's CSP `connect-src` |
| OpenStreetMap tiles | Maps in the Studio (Leaflet) and the phone (Leaflet in a WebView, loaded from unpkg) |

## Auth

- **App users** sign in with email and password ([accounts](features/accounts.md)): the Studio keeps an HttpOnly session cookie, the phone a bearer token in its keystore. Accounts are made in the admin plane (or with `scripts/user.mjs`); there is no public sign-up.
- **Operators** of the admin plane sign in through its Cloudflare Access application, never with an app account.
- **Local development**: the app signs in as in production, as `dev@localhost` / `openclapper-local-dev` (the bootstrap user, `make init`). Only the admin plane has a bypass, `ADMIN_DEV_BYPASS="true"` in its gitignored `.dev.vars`, since no Access application sits in front of it on a laptop; it works only for requests to `localhost` / `127.0.0.1` and must never be set in a deployed config.

## An instance from before accounts

The reference instance ran behind Cloudflare Access until 2026-10-19 (epic #107); migration 0021 gave all its data to the bootstrap user. Such an instance switches over like this:

1. Deploy (it applies migrations 0021 and 0022), set up the admin plane's Access application ([self-hosting](self-hosting.md#4-the-admin-planes-sign-in)).
2. Give the bootstrap user your email and a password: `node scripts/user.mjs --bootstrap --email … --remote`. It keeps its id, so the data stays with it.
3. Delete the Access application (not only its policy) of the app's hostname. The Studio shows its sign-in page; the phone needs an APK from #115 on.

## Secrets and rotation

- To cut a user off: block the account in the admin plane (every session ends at once) or reset its password.
- The deploy API token (`CLOUDFLARE_API_TOKEN`, [self-hosting](self-hosting.md#1-a-cloudflare-api-token)) the optional read-only analytics token for the admin board (`CF_ANALYTICS_TOKEN`, a Worker secret on the admin plane, [monitoring](features/monitoring.md)) and, for Play uploads, the service account's JSON key (`PLAY_SERVICE_ACCOUNT_JSON`; rotate by adding a new key to the service account in Google Cloud, replacing the secret, then deleting the old key) are the secrets; Access AUDs, team domains and resource ids are not secret (they show in login redirects and URLs).
- Wrangler's OAuth login lacks `account:read`; an exported `CLOUDFLARE_ACCOUNT_ID` (read by `scripts/deploy-config.mjs`) fills it in.
