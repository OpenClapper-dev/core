# Self-hosting

OpenClapper runs entirely on your own Cloudflare account: one Worker serves the API and the Studio, a second one the admin plane, D1 holds the data, R2 the photos. Nothing calls home, and nothing is shared between instances. You pay Cloudflare for what you use (the free plan goes a long way for a crew, see [the free plan](#the-free-plan)).

OpenClapper is open source under the [Apache License 2.0](../LICENSE): you may run instances for yourself, your crew, your company or anyone else, and offer them as a service. Keep the licence and the [NOTICE](../NOTICE) with your copy. If you offer an instance to others, give it a name of your own: the licence does not cover the project's name.

## What you need

- A Cloudflare account. Zero Trust (free for up to 50 users) is used for the admin plane's sign-in.
- A copy of this repository on GitHub (a fork, or "Use this template"), to deploy with GitHub Actions. Deploying from your own machine works too.
- For the phone app: a signing key you make once (see [The phone](#the-phone)).

## 1. A Cloudflare API token

Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token, with these permissions on your account:

| Permission | Access |
| --- | --- |
| Account · Workers Scripts | Edit |
| Account · D1 | Edit |
| Account · Workers R2 Storage | Edit |
| Account · Account Settings | Read |
| User · Memberships | Read |

With `APP_DOMAIN` / `ADMIN_DOMAIN` (custom domains), the deploy also edits the domains' zone; add:

| Permission | Access |
| --- | --- |
| Zone · Workers Routes | Edit |
| Zone · DNS | Edit |

Copy the token; it is shown once. Your **account id** is on the Workers & Pages overview.

## 2. Settings

**With GitHub Actions** (your copy of the repository → Settings → Secrets and variables → Actions):

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Variables, all optional (the names are those of [`deploy.env.example`](../deploy.env.example)):
  - `D1_DATABASE_NAME`, `R2_BUCKET`, `APP_WORKER_NAME`, `ADMIN_WORKER_NAME`. The defaults are `openclapper-db`, `openclapper-media`, `openclapper-api` and `openclapper-admin`.
  - `APP_DOMAIN`, `ADMIN_DOMAIN`: custom domains for the two Workers, e.g. `app.example.com` and `admin.example.com`. The zone must be in the same Cloudflare account; the deploy attaches them, and the workers.dev addresses keep working beside them.
  - Later, `ACCESS_TEAM_DOMAIN` and `ADMIN_ACCESS_AUD` (step 4).

**From your machine**: copy `deploy.env.example` to `deploy.env` (gitignored) and fill it in. A deployment repository that holds this one as a submodule can keep (and commit) its `deploy.env` beside the submodule; the scripts look there too.

## 3. Deploy

- **GitHub**: Actions → Deploy → Run workflow. The first run:
  1. creates the D1 database and the R2 bucket;
  2. applies every migration;
  3. builds the Studio;
  4. deploys the app Worker;
  5. deploys the admin plane (locked until step 4).

  The log names the D1 id it found or created; you can pin it as the `D1_DATABASE_ID` variable.
- **Your machine** (`pnpm install` first):

  ```sh
  node scripts/deploy-config.mjs --provision   # once: creates D1 and R2; put the printed database id in deploy.env
  pnpm -C apps/worker migrate:remote
  pnpm -C apps/worker run deploy
  pnpm -C apps/admin run deploy
  ```

  Wrangler needs `CLOUDFLARE_API_TOKEN` in the environment, or a login (`pnpm exec wrangler login --device`; its token lacks `account:read`, which `CLOUDFLARE_ACCOUNT_ID` from `deploy.env` fills in).

The app is at `https://<APP_WORKER_NAME>.<your-subdomain>.workers.dev`, and on `APP_DOMAIN` if you set it.

## 4. The admin plane's sign-in

The admin plane (`<ADMIN_WORKER_NAME>.<your-subdomain>.workers.dev`) is where accounts are made, blocked and reset ([admin](features/admin.md)). Its operators sign in through Cloudflare Access, not with an app account:

1. Zero Trust → Access → Applications → Add an application → Self-hosted, on the admin Worker's hostname.
2. Add a policy: Allow, the operators' emails. Pick the login methods you trust: the one-time PIN by email, or an identity provider with 2FA.
3. Copy the application's **Audience (AUD) tag**, and your **team domain** (`<team>.cloudflareaccess.com`, under Settings → Custom pages or in the login URL).
4. Set them as `ADMIN_ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` and deploy again.

## 5. The first account

Open the admin plane, add an account under Accounts → New account, and pass on the temporary password it shows once. Without the admin plane, from a machine with `deploy.env`:

```sh
node scripts/user.mjs --email you@example.com --name "You" --remote
```

Sign in to the Studio with it. There is no public sign-up; every account is made this way.

## Updating

Releases are tags `vX.Y.Z` with release notes on GitHub ([releasing](releasing.md)). Bring your copy up to the new tag (merge it), then run Deploy, then Build APK. Migrations only ever add (they never delete data), and the workflow applies them before the new code goes live. Settings › General › About in the Studio shows which version runs.

## The phone

The Android app is built for one server: its address goes into the APK. Every build of one deployment must be signed with the same key, or Android refuses to install it over the app. No Expo account is needed: the build is `expo prebuild` and Gradle.

Once:
1. Make the signing key in a checkout: `bash scripts/keystore.sh <owner>/<repo>` (needs a JDK's `keytool`, or Docker). It writes `.secrets/android/openclapper-release.jks` and `.secrets/android.env` (gitignored) and prints the commands that set the four repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
2. **Back up both files** (a password manager or an encrypted drive). Lose them and nobody can update the app without uninstalling it, which deletes whatever is still queued on the phones.
3. Add the repository variable `APP_URL`: your app's address, `https://<APP_DOMAIN>` or `https://<APP_WORKER_NAME>.<your-subdomain>.workers.dev`.

Then Actions → **Build APK** → Run workflow (`variant: release`, the default; `dev` builds the development client for the phone dev loop instead, [development](development.md)). The build runs on GitHub's runner. It compiles only for `arm64-v8a`, which every current Android phone runs; for older 32-bit phones set the variable `ANDROID_ABIS=arm64-v8a,armeabi-v7a` (each architecture adds build time, disk and APK size). The job first deletes preinstalled tools it does not use, since a standard runner has only about 14 GB free. The APK is the run's artifact and is **deleted after 3 days** (`retention-days`: GitHub removes it, nothing to clean up). Download it, open it on the phone and allow installs from that source. A private repository on GitHub's Free plan has 500 MB of artifact storage; one APK is about 50 MB.

Without GitHub, from a checkout with the key in `.secrets/` and Docker: `API_URL=https://… make apk-local` ([development](development.md#apk-builds)).

## The free plan

The Workers free plan allows 10 ms of CPU per request. Checking a password with 100 000 PBKDF2 iterations takes about 16 ms, so a sign-in may fail there. Set `PBKDF2_ITERATIONS` lower, e.g. `50000`; stored passwords are rehashed to the new count on their next sign-in. Everything else stays well within the free limits for a small crew.

## Your own sign-in

The app signs users in itself (`apps/worker/src/authn/`), behind one seam: the module `@openclapper/auth-provider`. To use your own (an SSO bridge, a different account store), point `AUTH_PROVIDER` at a module that exports `provider: AuthProvider` (`apps/worker/src/authn/provider.ts`); the deploy config maps the seam to it. Wrapping the first-party provider and adding checks in `allow` is the simplest start.
