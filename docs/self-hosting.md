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

Every setting is a GitHub variable or secret: your copy of the repository → Settings → Secrets and variables → Actions. The deploy reads them from the environment of the run and from nowhere else (no settings file).

| Name | Kind | |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secret | Required: the token of step 1. |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Required: your account id. |
| `D1_DATABASE_NAME`, `R2_BUCKET` | variable | Default `openclapper-db`, `openclapper-media`. |
| `D1_DATABASE_ID` | variable | Optional: found by name otherwise (the first run creates the database). |
| `APP_WORKER_NAME`, `ADMIN_WORKER_NAME` | variable | Default `openclapper-api`, `openclapper-admin`; they become `<name>.<your-subdomain>.workers.dev`. |
| `APP_DOMAIN`, `ADMIN_DOMAIN` | variable | Optional custom domains, e.g. `app.example.com` and `admin.example.com`. The zone must be in the same Cloudflare account; the deploy attaches them, and the workers.dev addresses keep working beside them. Universal SSL covers the zone and its first-level subdomains, so `staging-admin.example.com` works and `staging.admin.example.com` does not. |
| `APP_URL` | variable | The app's address, which the phone builds talk to: `https://<APP_DOMAIN>` or the workers.dev address ([the phone](#the-phone)). |
| `ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD` | variable | Later, step 4. |
| `INSTANCE_LABEL` | variable | Optional: a name such as `staging` for an instance that is not production ([a second instance](#a-second-instance-staging)). Empty for production. |
| `PBKDF2_ITERATIONS` | variable | Optional, [the free plan](#the-free-plan). |
| `AUTH_PROVIDER` | variable | Optional, [your own sign-in](#your-own-sign-in). |
| `CF_ANALYTICS_TOKEN` | secret | Optional, step 6. |

## 3. Deploy

- **GitHub**: Actions → Deploy server → Run workflow. The first run:
  1. creates the D1 database and the R2 bucket;
  2. applies every migration;
  3. builds the Studio;
  4. deploys the app Worker;
  5. deploys the admin plane (locked until step 4).

  The log names the D1 id it found or created; you can pin it as the `D1_DATABASE_ID` variable.
- **Your machine**: not part of this repository's setup. If you deploy without GitHub, export the same names as in the table yourself (`pnpm install` first), then run the steps of the workflow:

  ```sh
  node scripts/deploy-config.mjs --provision   # once: creates D1 and R2 when missing
  pnpm -C apps/worker migrate:remote
  pnpm -C apps/worker run deploy
  pnpm -C apps/admin run deploy
  ```

The app is at `https://<APP_WORKER_NAME>.<your-subdomain>.workers.dev`, and on `APP_DOMAIN` if you set it.

## 4. The admin plane's sign-in

The admin plane (`<ADMIN_WORKER_NAME>.<your-subdomain>.workers.dev`) is where accounts are made, blocked and reset ([admin](features/admin.md)). Its operators sign in through Cloudflare Access, not with an app account:

1. Zero Trust → Access → Applications → Add an application → Self-hosted, on the admin Worker's hostname.
2. Add a policy: Allow, the operators' emails. Pick the login methods you trust: the one-time PIN by email, or an identity provider with 2FA.
3. Copy the application's **Audience (AUD) tag**, and your **team domain** (`<team>.cloudflareaccess.com`, under Settings → Custom pages or in the login URL).
4. Set them as `ADMIN_ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` and deploy again.

## 5. The first account

Open the admin plane, add an account under Accounts → New account, and pass on the temporary password it shows once. Without the admin plane, from a machine with the settings of step 2 exported:

```sh
node scripts/user.mjs --email you@example.com --name "You" --remote
```

Sign in to the Studio with it. There is no public sign-up; every account is made this way.

## 6. Monitoring (optional)

The admin plane's Monitoring tab works without any setup ([monitoring](features/monitoring.md)). Its Cloudflare section, with the account-wide numbers (R2 storage across every bucket, Worker requests and CPU, D1 rows), needs a second API token:

1. My Profile → API Tokens → Create Token → Custom token, with the single permission **Account · Account Analytics · Read** on your account.
2. Set it as the secret `CF_ANALYTICS_TOKEN` and run Deploy server again. A deployment repository that calls the Deploy server workflow passes it on (`secrets: inherit`, or the one name).

The token is read-only; to rotate it, make a new one and run Deploy server again.

## A second instance (staging)

A second instance (a staging copy to try a release on, say) is the same setup again with other names: its own Workers, D1 database, R2 bucket, domains and Access application, in the same Cloudflare account or another. Nothing is shared with the first one.

- Make one **GitHub environment** per instance (Settings → Environments: `production`, `staging`) and give each the variables and secrets of step 2 under the same names; an environment's values win over the repository's, so shared ones (the API token, the signing key) can stay repository secrets. Environments in a private repository need a paid GitHub plan; in a public one they are free.
- Give the second one `INSTANCE_LABEL=staging`: the Studio puts it in front of the tab title and shows it as a badge in the taskbar and on sign-in, the admin board in its header. Production has no label and shows nothing.
- Run Deploy server and Build phone app with the `environment` input set. To try another version than the one the run starts from (a branch), set `ref`.
- A deployment repository that holds this one as a submodule calls the workflows with `path`, `environment` and `ref` (`secrets: inherit`). The job names the environment itself, since GitHub does not hand environment secrets from a caller to a reusable workflow. With `ref`, the workflow's steps come from the ref in the caller's `uses:` line and the code from `ref`, checked out in full instead of the submodule: a staging caller tracks `@main` for both.
- **Copy one instance into another** (staging ← production, to try a migration or a refactor on real data): the **Clone instance** workflow, run in the target's environment with `confirm` set to the target's database name. It replaces the target completely: the R2 bucket is synced with deletion (compared by checksum, custom metadata kept), then the D1 database is deleted, created again by name and filled with the source's export (reordered so every table exists before its rows and every row after the rows it references; an optional reference in a cycle or to its own table is set afterwards, since a remote import does not run in one transaction). Sessions are not copied, so everyone signs in again there; accounts, password hashes and all data are production's. The source is only read. Deploy the target right after: it applies newer migrations on top, and until then its Workers point at the deleted database. The target's environment needs:
  - `SOURCE_D1_DATABASE_NAME`, `SOURCE_R2_BUCKET` (variables), and no `D1_DATABASE_ID` (the recreated database has a new id; the deploy finds it by name); optionally `D1_LOCATION` (`weur`…, the source's location).
  - Two R2 API tokens (R2 → Manage API tokens), as secrets: `SOURCE_R2_ACCESS_KEY_ID` / `SOURCE_R2_SECRET_ACCESS_KEY` with **Object Read only** on the source bucket, `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` with Object Read & Write on the target bucket. The deploy token can still edit every D1 database of the account (Cloudflare cannot limit a token to one database): the script's refusal when source and target are the same is the guard there.

## Updating

Releases are tags `vX.Y.Z` with release notes on GitHub ([releasing](releasing.md)). Bring your copy up to the new tag (merge it), then run Deploy server, then Build phone app. Migrations only ever add (they never delete data), and the workflow applies them before the new code goes live. Settings › General › About in the Studio shows which version runs.

## The phone

The Android app is built for one server: its address goes into the APK. Every build of one deployment must be signed with the same key, or Android refuses to install it over the app. No Expo account is needed: the build is `expo prebuild` and Gradle.

Once:
1. Make the signing key: `bash scripts/keystore.sh [folder] <owner>/<repo>` (needs a JDK's `keytool`, or Docker). It writes `openclapper-release.jks` and `android.env` (its passwords) into a folder outside the checkout (default `~/openclapper-android-key`; it refuses one inside) and prints the commands that set the four secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
2. **Back up both files** (a password manager or an encrypted drive). Lose them and nobody can update the app without uninstalling it, which deletes whatever is still queued on the phones. The GitHub secrets and the backup are the key's home: nothing reads it from a checkout.
3. Add the repository variable `APP_URL`: your app's address, `https://<APP_DOMAIN>` or `https://<APP_WORKER_NAME>.<your-subdomain>.workers.dev`.

Then Actions → **Build phone app** → Run workflow (`variant: release`, the default; `staging` builds "OpenClapper Staging", `org.openclapper.staging` with the clay icon and the same key, which installs next to the production app, for a [second instance](#a-second-instance-staging); `dev` builds the development client for the phone dev loop instead, [development](development.md)). The build runs on GitHub's runner. It compiles only for `arm64-v8a`, which every current Android phone runs; for older 32-bit phones set the variable `ANDROID_ABIS=arm64-v8a,armeabi-v7a` (each architecture adds build time, disk and APK size). The job first deletes preinstalled tools it does not use, since a standard runner has only about 14 GB free. The APK is the run's artifact and is **deleted after 3 days** (`retention-days`: GitHub removes it, nothing to clean up). Download it, open it on the phone and allow installs from that source. Release and staging runs also make the App Bundle for [Google Play](#play-store). A private repository on GitHub's Free plan has 500 MB of artifact storage; one APK is about 80 MB, a bundle about as much.

Without GitHub, a release build is your own setup: export the key's four values (with `ANDROID_KEYSTORE` as the path to the `.jks`) and `EXPO_PUBLIC_API_URL`, then run the workflow's build step. `make apk-local` is no release: it builds "OpenClapper Local", debug-signed, for trying the app ([development](development.md#apk-builds)).

## Play Store

Google Play delivers the app instead of sideloading, starting with the **internal testing** track: up to 100 testers by email, no review, no store listing, updates on the phones within minutes. No Expo account and no third-party service is involved: Build phone app makes the bundle, and Google's own API takes it (the upload, deploy#11).

- **The bundle.** Release and staging runs of Build phone app produce an Android App Bundle (`.aab`) next to the APK, from the same build and key, as a second artifact. Play takes only bundles; the APK stays for sideloading. `ANDROID_ABIS` limits which devices Play can serve.
- **Requirements**, checked by the workflow's "Play requirements" step:
  - Target API level 36 or higher: Play has rejected new apps and updates below it since 31 August 2026. The step fails below.
  - 16 KB page size: native libraries' load segments aligned to 16 KB. The step reports any library that is not, as a warning for now.
- **Version codes.** Play takes each version code once per app. Production's grows with each release (`0.10.0` → `10000`, [releasing](releasing.md)), so production uploads once per release. The staging app counts commits instead, so every build of `main` is a new version (it needs the full history, which a run with `ref` has).
- **Signing.** Play signs what it delivers (Play App Signing). Let Google generate each app's signing key (the Console's default on the first release); your deployment's key from `scripts/keystore.sh` becomes the app's **upload key**: Build phone app signs every bundle with it, and Play accepts only bundles signed with it. A lost upload key can be reset through Google, so no app is ever stuck. The price: an APK from Build phone app (signed with your key) and the app from Play (signed with Google's) cannot update each other, so a phone has one or the other; uninstall to switch. (Uploading your own key as the signing key with Google's PEPK tool keeps them interchangeable, but a lost key then means an app that can never be updated.)
- **The first bundle of each app** is uploaded by hand in the Play Console: the API can neither create an app nor choose its signing key. Play Console → Create app → the package (`org.openclapper`, `org.openclapper.staging`) → Testing → Internal testing → Create release → keep "Google-generated key" → the `.aab` from Build phone app, which registers its key as the upload key. Then add the testers' emails and open the opt-in link on each phone once.
- **Uploads from the workflow.** Google Cloud Console → a project → IAM → Service accounts → create one and a JSON key for it. Play Console → Users and permissions → invite the service account's email with "Release to testing tracks" on the app (on each app). Store the JSON as the secret `PLAY_SERVICE_ACCOUNT_JSON` (in each GitHub environment that uploads). Then Build phone app with `track: internal` uploads the bundle after the build (`scripts/play-upload.mjs`: Google's androidpublisher API with the service account, no dependency). A version code Play already has is a notice, not a failure. An app that was never published takes draft releases only: the run says so, and you roll the release out in the Console once. A newly invited service account may be refused for up to a day.

## The free plan

The Workers free plan allows 10 ms of CPU per request. Checking a password with 100 000 PBKDF2 iterations takes about 16 ms, so a sign-in may fail there. Set `PBKDF2_ITERATIONS` lower, e.g. `50000`; stored passwords are rehashed to the new count on their next sign-in. Everything else stays well within the free limits for a small crew.

## Your own sign-in

The app signs users in itself (`apps/worker/src/authn/`), behind one seam: the module `@openclapper/auth-provider`. To use your own (an SSO bridge, a different account store), point `AUTH_PROVIDER` at a module that exports `provider: AuthProvider` (`apps/worker/src/authn/provider.ts`); the deploy config maps the seam to it. Wrapping the first-party provider and adding checks in `allow` is the simplest start.
