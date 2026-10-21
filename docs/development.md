# Development

Node 22 and pnpm 11 (via nvm). `pnpm install` enforces a 7-day dependency cooldown (`pnpm-workspace.yaml`). The root `Makefile` wraps the root `package.json` scripts, which stay the source of truth: `make` lists the targets.

## Checks (run before every commit)

```sh
make check          # = pnpm check: lint, typecheck, test, build, in that order
```

Each step is a root script that runs these:

```sh
pnpm lint           # oxlint, config in .oxlintrc.json
pnpm typecheck      # scripts/typecheck.sh: tsc -p . in
                    #   packages/vocab packages/fov-math packages/service-kit packages/ui
                    #   apps/worker apps/worker/test/routes apps/admin apps/admin/test apps/admin/ui apps/studio apps/mobile
pnpm test           # unit and route tests (docs/testing.md):
                    #   pnpm -C packages/vocab test        fields, filters, daylight
                    #   pnpm -C packages/fov-math test     FOV, overlay, reframe
                    #   pnpm -C apps/worker test           unit: passwords, sessions, roles; routes (workerd, D1, R2):
                    #                                      tenancy on every route, uploads, recycle bin, images, sign-in
                    #   pnpm -C apps/admin test            admin plane: Access JWT, local bypass, account actions
                    #   pnpm -C apps/studio test           shortcut registry: collisions, docs/shortcuts.md
                    #   pnpm -C apps/mobile test           calibration, EXIF, framing, lens, zoom, layouts
pnpm build          # scripts/build-check.sh, dry runs only, nothing is deployed:
                    #   vite build in apps/studio and apps/admin
                    #   scripts/csp-hash.mjs --check: each _headers CSP still allows its index.html inline script
                    #   wrangler deploy --dry-run in apps/worker and apps/admin (tracked local wrangler.jsonc,
                    #     after the Vite builds: both serve them as assets)
                    #   expo export --platform android in apps/mobile: proves Metro can bundle
```

The Workers' typechecks need `worker-configuration.d.ts` (gitignored): `pnpm -C apps/worker types` and `pnpm -C apps/admin types` generate them (`make init` does both; `pnpm typecheck` does it when they are missing). Regenerate them after changing a `wrangler.jsonc`.

What each test suite covers, the route-test helpers and the rule for new routes: [testing](testing.md).

**CI** runs the same lane on every pull request and every push to `main`: `.github/workflows/ci.yml`, one job per step (`lint`, `typecheck`, `test`, `build`), plus `expo-doctor` as an advisory step in `build` (it reports the Expo packages trailing the SDK's newest patches, a consequence of the 7-day cooldown). The four jobs are required checks on `main`: a red check is fixed, never bypassed (no `gh pr merge --admin`).

**Lint findings** are fixed in the code when the fix is obvious and keeps the behaviour. A rule that only produces false positives or fights a deliberate pattern is switched off in `.oxlintrc.json` with a one-line comment saying why; no inline disables. A finding that looks like a real bug is a bug: fix it on its own, not as a lint cleanup.

The admin plane locally: part of `make all`, or alone with `make admin` (`pnpm -C apps/admin dev`: Worker on :8788 on the app's local D1, board on :5174, no Access: see [admin](features/admin.md#local)).

## Local API + Studio

```sh
pnpm dev:init       # once per checkout: gitignored dev files + local D1 migrations
pnpm dev            # worker on :8787 + Studio on :5173 (proxies /api and /health to 8787)
pnpm dev:worker     # or separately
pnpm dev:studio
```

`dev:init` never overwrites existing files. It creates:
- an empty `apps/studio/dist`: `wrangler dev` refuses to start without it

Both Vite dev servers (Studio, admin board) watch the `packages/ui/src` folder as a whole: files outside an app's root are otherwise watched one by one, and a git branch switch replaces them, so later edits to the ui package went unseen until a restart.

Local D1 and R2 state lives in `apps/worker/.wrangler/state` (delete it to start fresh, then `pnpm -C apps/worker migrate:local`). Local data is separate from production: say which one you mean.

Demo data: `pnpm dev:seed [count]` (worker running) uploads 40 shots by default with stock photos from picsum.photos into the projects "Stock demo" and "Stock demo B", with locations, random tags (camera fields too), review states, some sequences and some shots without a position. Ids are derived from the seed, so a re-run adds nothing twice. It refuses any API other than localhost.

API smoke tests with `curl` against `localhost:8787` sign in first, as everywhere (`dev@localhost` / `openclapper-local-dev`, from `make init`; on an older checkout `OPENCLAPPER_PASSWORD=openclapper-local-dev node scripts/user.mjs --bootstrap --email dev@localhost`):

```sh
T=$(curl -s localhost:8787/api/auth/login -H 'content-type: application/json' -d '{"email":"dev@localhost","password":"openclapper-local-dev","client":"mobile"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -H "Authorization: Bearer $T" localhost:8787/api/projects
```

More accounts: `node scripts/user.mjs --email you@example.com` (password from `OPENCLAPPER_PASSWORD` or asked).

Worker tests (unit and route tests, see [testing](testing.md)): `pnpm -C apps/worker test`. Multipart uploads: `curl -F "metadata=…" -F "photo.<id>=@file.jpg;type=image/jpeg"`.

Agents can click through the Studio with the Playwright MCP: headless Chrome against `localhost:5173` (`pnpm dev` running). It is set up per machine, not in the repo: `claude mcp add playwright -- npx -y @playwright/mcp@latest --headless --isolated`, then `npx playwright install --with-deps chrome`. Snapshots land in `.playwright-mcp/` (gitignored). The phone app cannot be driven this way.

## Phone dev loop (development build)

```sh
make dev-build      # once, and after every native change: "OpenClapper Dev" APK into the Windows Downloads folder
make mobile         # local Worker behind a quick tunnel + Metro for OpenClapper Dev; the phone works on LOCAL data
make all            # all of it at once: Worker, Studio, admin board and mobile in one tmux session ("openclapper"), one pane each
make all-down       # stop all of it and close the session · make all-restart: restart the servers in place
make studio      # beside it: the Studio on :5173 against the same local Worker
```

- **The development build** ("OpenClapper Dev", `org.openclapper.dev`) is this app with its native modules plus Expo's dev launcher and menu (`expo-dev-client`). It carries no JavaScript: it loads the bundle from Metro, so Fast Refresh works as in Expo Go. Rebuild only when the native side changes: a new native module, a plugin or permission in `app.json`, an SDK upgrade. A bundle that calls a native module the build lacks fails at runtime.
- `APP_VARIANT=development` (`make dev-build` and `make mobile`) switches `app.config.ts` to the dev name, package id, scheme and the green dev icons, so it installs next to the production app with its own storage. The Studio and admin dev servers show the green icons too (tab, installed app); builds the real ones ([design](design.md)).
- `make dev-build` = `VARIANT=dev scripts/apk-local.sh`: `expo prebuild` and `./gradlew assembleDebug` in the Docker toolchain, no account. Signed with the debug key of Expo's prebuild template, the same on every machine. Install the APK from Downloads once (allow installs from the file manager); later builds install over it.
- **On GitHub instead**: Actions → **Build APK** → Run workflow with `variant: dev` (in a deployment repository its Build APK workflow passes the same input). Same runner setup as the release build; the APK `openclapper-dev-<version>-<commit>.apk` is the run's artifact for 3 days. Built from the same template debug key, so it installs over a local `make dev-build` and vice versa.
- In OpenClapper Dev, open the `exp.direct` URL Metro prints (or pick the server in the launcher). Shake or the notification opens the dev menu.

- `scripts/dev-all.sh` (`make all`) opens a tmux session `openclapper`: Worker, Studio (:5173) and admin board (:5174, its Worker on :8788) stacked on the left, `make mobile` on the right (it and the admin pane wait for the Worker: mobile only adds a tunnel, and two wranglers starting together collide on their inspector port), and a **control strip** across the bottom showing which servers answer (● up, ○ down). Click it, then `r` restarts the three servers in their panes, `q` stops everything and closes the session, `d` detaches. Mouse mode is on, panes stay open after a crash so the error is readable, and running `make all` again attaches. Ctrl-C in a server pane stops just that server and leaves a shell to run it again. From another terminal: `make all-down` (Ctrl-C to every server, then it stops anything started from this repo that still listens on :8787, :5173 or Metro's :8081, plus a stray `cloudflared`; other folders' processes are left alone, then the session closes) and `make all-restart` (the same as `r`).
- `scripts/mobile.sh` starts `wrangler dev --tunnel` on :8787, or, when `make dev`/`make worker` already runs there, only a quick tunnel to it (`wrangler tunnel quick-start`), waits for the `https://….trycloudflare.com` URL, then starts Metro (`expo start --dev-client --tunnel --clear`) with `EXPO_PUBLIC_API_URL` set to it and `EXPO_PUBLIC_STORAGE_SCOPE=local`. It refuses to start while an `apps/mobile/.env*` file sets `EXPO_PUBLIC_*`: in development Expo serves those files ahead of the environment (`expo/virtual/env`), so the app would talk to that server instead of the tunnel. Ctrl-C stops both. Both tunnels are needed because WSL2 in NAT mode is not reachable from the phone over LAN.
- Expo Go no longer runs the app: react-native-vision-camera (issue #26) is a native module it does not ship.
- Sign in once with `dev@localhost` / `openclapper-local-dev`: `make init` (`scripts/dev-init.sh`) gives the local bootstrap user that login. On an older checkout run `OPENCLAPPER_PASSWORD=openclapper-local-dev node scripts/user.mjs --bootstrap --email dev@localhost`.
- The `local` scope keeps the phone's local queue, caches, drafts and session apart from production's (`src/kv.ts`: prefixed kv keys and photo folders), so a production build on the same phone never sees them.
- The tunnel URL is new on every run, so Metro starts with `--clear` (the URL is inlined into the bundle). While it runs, the local Worker is public at that random URL; like production, it answers only with a session.
- Production is reached only by a production APK, built for a deployment ([self-hosting](self-hosting.md#the-phone)). The local loop needs no deployment settings: the quick tunnel takes no account.
- If the tunnel fails with `Cannot read properties of undefined (reading 'body')`, an old ngrok session is still registered: wait 30 s or set `EXPO_TUNNEL_SUBDOMAIN`.
- Expo changed a lot. Read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before using an Expo API (`apps/mobile/AGENTS.md`). Example: `expo-file-system` exposes `File`/`Directory`/`Paths` with sync `copySync`, `textSync`, `write`, and `File.downloadFileAsync`.

## Deploy and migrations

Not from this checkout: deploying and production APKs belong to a deployment, which runs the GitHub workflows (`deploy.yml`, `build-apk.yml`) or the `pnpm` deploy scripts with its `deploy.env` ([self-hosting](self-hosting.md)). The reference instance deploys from its private repository `OpenClapper-dev/deploy`, which holds this one as a submodule. Versions and releases: [releasing](releasing.md). The tracked `wrangler.jsonc` are for local development only.

- The owner runs production deploys. AI sessions prepare the change and the migration, then ask.
- Migrations are additive: always a new numbered file. Locally: `pnpm -C apps/worker migrate:local` (`make init` runs it).

## APK builds

- **The development build** for the phone loop: `make dev-build`, or Build APK with `variant: dev` (above).
- **Production APKs** are built for one server and signed with its deployment's key: the Build APK workflow, or locally `API_URL=https://… make apk-local` with the key from `scripts/keystore.sh` in `.secrets/` ([self-hosting](self-hosting.md#the-phone)).

`scripts/apk-local.sh` builds in a Docker container (`docker/android.Dockerfile`: JDK 17, Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006, cmake 3.22.1, Node 22.20.0, pnpm 11.13.1; nothing installed in WSL):
- Once: Docker Desktop → Settings → Resources → WSL integration → enable this distro.
- It builds the image (cached after the first run), then in the container with the repo mounted and Gradle's cache in the `openclapper-gradle` volume: `expo prebuild --platform android` (generates the gitignored `apps/mobile/android/` from the template in `node_modules/expo`, removed again afterwards) and Gradle. It writes `~/openclapper-builds/openclapper-dev-<commit>.apk` (a production one `openclapper-<version>-<commit>.apk`) and copies it to the Windows Downloads folder (`DOWNLOADS=…` overrides).
- `VARIANT=release` (`make apk-local`) needs `API_URL=…` and the key: `.secrets/android/openclapper-release.jks` and its passwords in `.secrets/android.env` (`scripts/keystore.sh`). Release signing comes from a config plugin in `app.config.ts` that reads `ANDROID_KEYSTORE*` at Gradle time; a release that still carries the debug key fails the build. The first run downloads Gradle's dependencies (several GB); later builds take about 10 minutes.
- Native code is compiled only for `arm64-v8a` (`-PreactNativeArchitectures`; `ANDROID_ABIS=arm64-v8a,x86_64` for an emulator, comma-separated). All four architectures would take about four times the native build and the APK size.
- `versionCode` and `versionName` come from the root `package.json` version (`app.config.ts`), the commit from `GIT_COMMIT`.

## Debugging on the phone

Turn on Setup → Debug log, reproduce, then share the log ([debug log](features/debug-log.md)). Worker logs: Workers observability is enabled (`wrangler.jsonc`), queryable in the Cloudflare dashboard or through the API.
