# Releasing

## One version

OpenClapper has **one version for the whole product**: the Worker and the Studio deploy together, the admin plane reads the same database, and the phone talks to that API. Nothing is published as a separate library. The workspace packages (`apps/*`, `packages/*`) are private and stay at `0.0.0`.

- **Source**: the `version` of the root `package.json`, and nothing else.
- **SemVer, `0.x` while experimental and through the alpha**:
  - a minor bump (`0.2.0`) for new features and anything that changes behaviour or data in a way a deployment or a phone has to follow;
  - a patch (`0.1.1`) for fixes only.
  - `1.0.0` will mean "stable".
- **Releases** are git tags `vX.Y.Z` on `main`, each with a GitHub release whose notes list the merged pull requests. While the major version is 0 they are marked as pre-releases.
- **Where it shows**, always with the commit it was built from:
  - `GET /api/ping` → `{ ok, version, commit, instance }`; the admin Worker's `/api/whoami` too (`instance` names a second instance such as staging, [self-hosting](self-hosting.md#a-second-instance-staging)). The commit is a wrangler `define` written by `scripts/deploy-config.mjs`; locally it is `dev`.
  - Studio: Settings › General › About, next to the server's version. They differ while a tab still has the bundle from before a deploy.
  - Admin board: its header.
  - Phone: the Setup footer and the debug log.
- **Android**: `versionName` is the version and `versionCode` is derived from it (`major·1 000 000 + minor·1 000 + patch`: 0.1.0 → 1000), so it grows with every release (`apps/mobile/app.config.ts`). Builds between releases carry the same code as the last release; Android installs a same-code update over it. Google Play takes each code once, so production goes to Play once per release.
- **The staging app** (`APP_VARIANT=staging`) uses the build time instead: minutes since 2020-01-01 UTC, set by Build phone app. Every build is higher than the one before, whatever ref it comes from, so a build of an older tag installs on the phone as an ordinary update (data kept): staging can be rolled back, server and app. The version name and the commit in the Setup footer say what a build contains.
- **Testing a release on staging**: after `scripts/release.sh`, the deployment's staging Update with `ref: vX.Y.Z` puts exactly that tag on staging (server and app) without moving the deployment's pin; its production Release then ships the same tag.

## Cutting a release

Try it first where a deployment has a staging instance: deploy `main` there (its Deploy server workflow with `ref: main`), click through, then release.

From an up-to-date, clean `main`:

```sh
scripts/release.sh 0.2.0
```

It checks the branch, a clean tree, that `main` matches `origin/main`, and that the new version is greater than the current one (or is the current one while that has no tag yet: then nothing is bumped, only tagged). Then it:
1. sets the root `package.json` version;
2. commits "Release v0.2.0";
3. tags `v0.2.0` and pushes both;
4. runs `gh release create --generate-notes`.

The release carries no APK. An APK is built for one server and signed with its deployment's key ([self-hosting](self-hosting.md#the-phone)).

## After a release, per deployment

1. Move the deployment to the tag. With this repository as a submodule: `scripts/bump.sh v0.2.0`, then commit and push. In a fork: merge the tag.
2. Run **Deploy server**. It applies new migrations before the new code goes live.
3. Run **Build phone app** and install the APK on the phones.
