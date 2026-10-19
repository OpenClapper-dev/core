# Self-hosting

Fielder runs entirely on your own Cloudflare account: one Worker serves the API and the dashboard, a second one the admin plane, D1 holds the data, R2 the photos. Nothing calls home, and nothing is shared between instances. You pay Cloudflare for what you use (the free plan goes a long way for a crew, see [the free plan](#the-free-plan)).

## What you need

- A Cloudflare account. Zero Trust (free for up to 50 users) is used for the admin plane's sign-in.
- A copy of this repository on GitHub (a fork, or "Use this template"), to deploy with GitHub Actions. Deploying from your own machine works too.
- For the phone app: a free Expo account, to build the Android app with your server's address (see [The phone](#the-phone)).

## 1. A Cloudflare API token

Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token, with these permissions on your account:

| Permission | Access |
| --- | --- |
| Account · Workers Scripts | Edit |
| Account · D1 | Edit |
| Account · Workers R2 Storage | Edit |
| Account · Account Settings | Read |
| User · Memberships | Read |

Copy the token; it is shown once. Your **account id** is on the Workers & Pages overview.

## 2. Settings

**With GitHub Actions** (your copy of the repository → Settings → Secrets and variables → Actions):

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Variables, all optional (the names are those of [`deploy.env.example`](../deploy.env.example)):
  - `D1_DATABASE_NAME`, `R2_BUCKET`, `APP_WORKER_NAME`, `ADMIN_WORKER_NAME`. The defaults are `fielder-db`, `fielder-shots`, `fielder-api` and `fielder-admin`.
  - Later, `ACCESS_TEAM_DOMAIN` and `ADMIN_ACCESS_AUD` (step 4).

**From your machine**: copy `deploy.env.example` to `deploy.env` (gitignored) and fill it in. A deployment repository that holds this one as a submodule can keep (and commit) its `deploy.env` beside the submodule; the scripts look there too.

## 3. Deploy

- **GitHub**: Actions → Deploy → Run workflow. The first run:
  1. creates the D1 database and the R2 bucket;
  2. applies every migration;
  3. builds the dashboard;
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

The app is at `https://<APP_WORKER_NAME>.<your-subdomain>.workers.dev`. A custom domain can be added to the Worker in the Cloudflare dashboard.

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

Sign in on the dashboard with it. There is no public sign-up; every account is made this way.

## Updating

Releases are tagged. Bring your copy up to the new tag (merge or rebase), then run Deploy again. Migrations only ever add (they never delete data), and the workflow applies them before the new code goes live.

## The phone

The Android app is built for one server: its address goes into the APK. Build it with the **Build APK** workflow (`.github/workflows/build-apk.yml`).

Once:
1. A free [Expo](https://expo.dev) account. Create an access token (expo.dev → Account settings → Access tokens) and add it as the repository secret `EXPO_TOKEN`.
2. Add the repository variable `APP_URL`: your app's address, `https://<APP_WORKER_NAME>.<your-subdomain>.workers.dev`.
3. Your own Expo project: in a checkout, `cd apps/mobile && npx eas init` and copy the project id and your Expo account name into the variables `EAS_PROJECT_ID` and `EAS_OWNER` (`app.json` names the reference instance's project).
4. A signing key, once: `npx eas credentials -p android` in `apps/mobile` (with `EAS_OWNER`/`EAS_PROJECT_ID` set in your shell) → production → generate a keystore. Expo keeps it; every build signs with it, so updates install over the old app.

Then Actions → Build APK → Run workflow, with a mode:
- **runner** (default): the build runs on GitHub's runner (about 20–30 minutes; no EAS quota). The APK is the run's artifact, **deleted after 3 days** (`retention-days`; GitHub removes it itself, nothing to clean up). Download it, open it on the phone and allow installs from that source. A private repository on GitHub's Free plan has 500 MB of artifact storage, so a few builds a week fit.
- **cloud**: the workflow queues the build on EAS and ends; it sets `EXPO_PUBLIC_API_URL` in the Expo project's production environment first. Download the APK from the build's page on expo.dev. EAS's free plan has a monthly build quota.

Without GitHub: `API_URL=… PROFILE=apk bash scripts/apk-local.sh` builds it locally in Docker ([development](development.md#apk-builds)).

## The free plan

The Workers free plan allows 10 ms of CPU per request. Checking a password with 100 000 PBKDF2 iterations takes about 16 ms, so a sign-in may fail there. Set `PBKDF2_ITERATIONS` lower, e.g. `50000`; stored passwords are rehashed to the new count on their next sign-in. Everything else stays well within the free limits for a small crew.

## Your own sign-in

The app signs users in itself (`apps/worker/src/authn/`), behind one seam: the module `@fielder/auth-provider`. To use your own (an SSO bridge, a different account store), point `AUTH_PROVIDER` at a module that exports `provider: AuthProvider` (`apps/worker/src/authn/provider.ts`); the deploy config maps the seam to it. Wrapping the first-party provider and adding checks in `allow` is the simplest start.
