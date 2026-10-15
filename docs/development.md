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

## Phone dev loop (development build)

```sh
make dev-build      # once, and after every native change: "Fielder Dev" APK into the Windows Downloads folder
make mobile         # local Worker behind a quick tunnel + Metro for Fielder Dev; the phone works on LOCAL data
make mobile-go      # the same for Expo Go (CLIENT=go)
make dashboard      # beside it: the dashboard on :5173 against the same local Worker
```

- **The development build** ("Fielder Dev", `app.fielder.scout.dev`) is this app with its native modules plus Expo's dev launcher and menu (`expo-dev-client`). It carries no JavaScript: it loads the bundle from Metro, so Fast Refresh works as in Expo Go. Rebuild only when the native side changes: a new native module, a plugin or permission in `app.json`, an SDK upgrade. A bundle that calls a native module the build lacks fails at runtime.
- `APP_VARIANT=development` (eas.json `dev-client` profile, and `make mobile`) switches `app.config.ts` to the dev name, package id and scheme, so it installs next to the production app with its own storage.
- `make dev-build` = `PROFILE=dev-client scripts/apk-local.sh`: `eas build --local` in the Docker toolchain, no EAS quota. The profile is a debug build (`:app:assembleDebug`, `withoutCredentials`): signed with the debug key, so no keystore from Expo, but the Expo login is still needed. Install the APK from Downloads once (allow installs from the file manager); later builds install over it.
- In Fielder Dev, open the `exp.direct` URL Metro prints (or pick the server in the launcher). Shake or the notification opens the dev menu.

- `scripts/mobile.sh` starts `wrangler dev --tunnel` on :8787 (stop `make dev`/`make worker` first), waits for the `https://….trycloudflare.com` URL, then starts Metro (`expo start --go --tunnel --clear`) with `EXPO_PUBLIC_API_URL` set to it and `EXPO_PUBLIC_STORAGE_SCOPE=local`. Ctrl-C stops both. Both tunnels are needed because WSL2 in NAT mode is not reachable from the phone over LAN.
- Expo Go (`make mobile-go`): enter the `exp://….exp.direct` URL Metro prints. Works only while every native module the app uses ships in Expo Go.
- Sign in once: under `ACCESS_DEV_BYPASS` `/auth/mobile` hands out an unsigned placeholder token for `dev@localhost`.
- The `local` scope keeps the phone's local queue, caches, drafts and session apart from production's (`src/kv.ts`: prefixed kv keys and photo folders), so a production build on the same phone never sees them.
- The tunnel URL is new on every run, so Metro starts with `--clear` (the URL is inlined into the bundle). While it runs, the local Worker is public at that random URL with auth bypassed.
- Production is reached only by a built APK (`make apk-local` / `make apk-cloud`, `API_URL` defaults to the deployed Worker).
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

Cloud: `pnpm -C apps/mobile eas build --platform android --profile apk` (EAS free plan has a monthly build quota). The dev build in the cloud: `pnpm -C apps/mobile build:dev-client`.

Local (same keystore, fetched from Expo): `make apk-local`, in a Docker container (`docker/android.Dockerfile`: JDK 17, Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006, cmake 3.22.1, Node 22.20.0, pnpm 11.13.1; nothing installed in WSL).
- Once: Docker Desktop → Settings → Resources → WSL integration → enable this distro; `npx eas login` (the session in `~/.expo` is mounted into the container; `EXPO_TOKEN` works too).
- `scripts/apk-local.sh` builds the image (cached after the first run), runs `eas build --local --profile apk` with the repo mounted and Gradle's cache in the `fielder-gradle` volume, writes `~/fielder-builds/fielder-<commit>.apk` and copies it to the Windows Downloads folder.
- The app points at `https://fielder-api.fielder-worker.workers.dev` unless `API_URL=…` is set. The first run downloads the SDK and Gradle dependencies (several GB); later builds take about 10 minutes.

## Debugging on the phone

Turn on Setup → Debug log, reproduce, then share the log ([debug log](features/debug-log.md)). Worker logs: Workers observability is enabled (`wrangler.jsonc`), queryable in the Cloudflare dashboard or through the API.
