# Infrastructure

Everything runs on Cloudflare (account id pinned in `apps/worker/wrangler.jsonc`); no Google Cloud. Identifiers are also in `.secrets/` locally.

| Resource | Details |
| --- | --- |
| Worker `fielder-api` | https://fielder-api.fielder-worker.workers.dev. API and dashboard on one hostname; `assets.run_worker_first` routes `/api/*`, `/auth/*`, `/health` to the Worker, everything else is the SPA. Observability enabled. |
| D1 `fielder-db` (WEUR) | Binding `DB`, migrations in `apps/worker/migrations/` |
| R2 `fielder-shots` (WEUR) | Binding `SHOTS_BUCKET`, objects `photos/<photoId>.jpg` |
| Cloudflare Access | Team `weathered-salad-6072`, app "Fielder" on the Worker hostname, one policy: Allow the single allow-listed email via One-time PIN. No service tokens. |
| Expo / EAS | Project `@bubulux/fielder`; the only production env var is `EXPO_PUBLIC_API_URL` |
| Open-Meteo | Weather forecast, called from the dashboard browser directly (free, no key) |
| OpenStreetMap tiles | Maps in the dashboard (Leaflet) and the phone (Leaflet in a WebView, loaded from unpkg) |

## Auth

- **Dashboard**: Access session cookie from the PIN login. A `401` or redirect makes the dashboard reload, which triggers the login.
- **Phone**: the app opens `/auth/mobile` in a WebView; Access shows the same PIN login, then the Worker page posts the Access JWT to the app. The app keeps it in the Android keystore (`expo-secure-store`) and sends it as `cf-access-token`, which Access validates at the edge. The session lasts as long as the Access app session (720 h), then the app shows the login again. Shots taken while signed out stay queued. The APK contains no credential.
- **Worker**: verifies the JWT on every request (`src/access.ts`, JWKS cached per isolate). `ACCESS_DEV_BYPASS="true"` in `.dev.vars` is for local development only and must never be set in `wrangler.jsonc`. Under it `/auth/mobile` hands the phone an unsigned placeholder token (`dev@localhost`), since there is no Access JWT to pass on.

## Secrets and rotation

- To cut a phone off, revoke its session in Zero Trust (Access → Users) or shorten the app session.
- The service token early builds used was revoked on 2026-09-13; APKs from before then cannot reach the API.
- `.secrets/` (gitignored, never commit) holds `access-app.json` (Access app id / AUD, not secret) and `cf-access-token`, a short-lived scoped Cloudflare API token used only for Access administration from the CLI.
- Wrangler's OAuth login lacks `account:read`; the account id is pinned in `wrangler.jsonc` (and `CLOUDFLARE_ACCOUNT_ID` helps when a command still cannot find it).
