# Development

Node 22 and pnpm 11 (via nvm). `pnpm install` enforces a 7-day dependency cooldown (`pnpm-workspace.yaml`). The root `Makefile` wraps the root `package.json` scripts, which stay the source of truth: `make` lists the targets.

## Checks (run before every commit)

```sh
for p in packages/vocab packages/fov-math apps/worker apps/dashboard apps/mobile; do (cd $p && npx tsc -p .); done
pnpm -C packages/vocab test        # fields, filters, daylight
pnpm -C packages/fov-math test     # FOV, overlay, reframe
(cd apps/mobile && node --test src/*.test.ts)
pnpm -C apps/dashboard test         # shortcut registry: collisions, docs/shortcuts.md
(cd apps/dashboard && npx vite build)
(cd apps/mobile && npx expo export --platform android --output-dir /tmp/fielder-export)   # proves Metro can bundle
```

The Worker typecheck needs `apps/worker/worker-configuration.d.ts` (gitignored): `pnpm -C apps/worker types` generates it.

## Local API + dashboard

```sh
pnpm dev:init       # once per checkout: gitignored dev files + local D1 migrations
pnpm dev            # worker on :8787 + dashboard on :5173 (proxies /api and /health to 8787)
pnpm dev:worker     # or separately
pnpm dev:dashboard
```

`dev:init` never overwrites existing files. It creates:
- `apps/worker/.dev.vars` with `ACCESS_DEV_BYPASS="true"` (every request is `dev@localhost`)
- `apps/mobile/.env.local`
- an empty `apps/dashboard/dist`: `wrangler dev` refuses to start without it

Local D1 and R2 state lives in `apps/worker/.wrangler/state` (delete it to start fresh, then `pnpm -C apps/worker migrate:local`). Local data is separate from production: say which one you mean.

Demo data: `pnpm dev:seed [count]` (worker running) uploads 40 shots by default with stock photos from picsum.photos into the projects "Stock demo" and "Stock demo B", with locations, random tags (camera fields too), review states, some sequences and some shots without a position. Ids are derived from the seed, so a re-run adds nothing twice. It refuses any API other than localhost.

API smoke tests work with plain `curl` against `localhost:8787` (no auth needed locally). Multipart uploads: `curl -F "metadata=…" -F "photo.<id>=@file.jpg;type=image/jpeg"`.

## Phone dev loop (Expo Go)

```sh
make mobile         # expo start --go --tunnel; phone against PRODUCTION (apps/mobile/.env.local)
make mobile-local   # local Worker behind a quick tunnel + Metro; phone against LOCAL data
```

- Open Expo Go and enter the `exp://….exp.direct` URL Metro prints. The tunnel is needed because WSL2 in NAT mode is not reachable from the phone over LAN.
- JS changes hot-reload. Every native module the app uses ships in Expo Go.
- `make mobile`: the phone talks to the **deployed** Worker (`EXPO_PUBLIC_API_URL`), so Worker changes need a deploy first. Without that variable the login WebView loads `/auth/mobile` against `file://` and fails.
- `make mobile-local` (`scripts/mobile-local.sh`): starts `wrangler dev --tunnel` on :8787 (stop `make dev`/`make worker` first; run `make dashboard` beside it), waits for the `https://….trycloudflare.com` URL, then starts Metro with `EXPO_PUBLIC_API_URL` set to it and `EXPO_PUBLIC_STORAGE_SCOPE=local`. Ctrl-C stops both.
  - Sign in once per scope: under `ACCESS_DEV_BYPASS` `/auth/mobile` hands out an unsigned placeholder token for `dev@localhost`.
  - The scope keeps the phone's local queue, caches, drafts and session apart from production's (`src/kv.ts`: prefixed kv keys and photo folders). Going back to `make mobile` finds production's data untouched.
  - The tunnel URL is new on every run, so Metro starts with `--clear` (the URL is inlined into the bundle). While it runs, the local Worker is public at that random URL with auth bypassed.
- A native module that Expo Go lacks means switching to a dev client: `pnpm -C apps/mobile build:dev-client` once, then `pnpm -C apps/mobile start:dev-client`.
- If the tunnel fails with `Cannot read properties of undefined (reading 'body')`, an old ngrok session is still registered: wait 30 s or set `EXPO_TUNNEL_SUBDOMAIN`.
- Expo changed a lot. Read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before using an Expo API (`apps/mobile/AGENTS.md`). Example: `expo-file-system` exposes `File`/`Directory`/`Paths` with sync `copySync`, `textSync`, `write`, and `File.downloadFileAsync`.

## Deploy and migrations

Shortcuts (`make help` lists all): `make login` (wrangler, device code), `make deploy` (remote migrations, then the deploy below), `make apk-cloud` (EAS), `make apk-local` (`scripts/apk-local.sh`: the local build below, then copies `fielder-<commit>.apk` to the Windows Downloads folder; override with `DOWNLOADS=…` or `API_URL=…`).

```sh
CLOUDFLARE_ACCOUNT_ID=3868cbc17be171c90972dd32e41e7783 pnpm -C apps/worker migrate:remote   # apply new migrations first
pnpm -C apps/worker run deploy     # builds the dashboard, deploys Worker + assets
```

- Wrangler needs a login (`npx wrangler login --device` works in WSL). The OAuth token lacks `account:read`, so set `CLOUDFLARE_ACCOUNT_ID` when a command cannot find the account.
- The user runs production deploys themselves. AI sessions prepare the change and the migration, then ask.
- Migrations are additive: always a new numbered file.

## APK builds

Cloud: `pnpm -C apps/mobile eas build --platform android --profile apk` (EAS free plan has a monthly build quota).

Local (same keystore, fetched from Expo): `make apk-local`, in a Docker container (`docker/android.Dockerfile`: JDK 17, Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006, cmake 3.22.1, Node 22.20.0, pnpm 11.13.1; nothing installed in WSL).
- Once: Docker Desktop → Settings → Resources → WSL integration → enable this distro; `npx eas login` (the session in `~/.expo` is mounted into the container; `EXPO_TOKEN` works too).
- `scripts/apk-local.sh` builds the image (cached after the first run), runs `eas build --local --profile apk` with the repo mounted and Gradle's cache in the `fielder-gradle` volume, writes `~/fielder-builds/fielder-<commit>.apk` and copies it to the Windows Downloads folder.
- The app points at `https://fielder-api.fielder-worker.workers.dev` unless `API_URL=…` is set. The first run downloads the SDK and Gradle dependencies (several GB); later builds take about 10 minutes.

## Debugging on the phone

Turn on Setup → Debug log, reproduce, then share the log ([debug log](features/debug-log.md)). Worker logs: Workers observability is enabled (`wrangler.jsonc`), queryable in the Cloudflare dashboard or through the API.
