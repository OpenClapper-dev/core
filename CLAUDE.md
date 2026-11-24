# OpenClapper — agent guide

Single-user tool for film location scouting and shoot planning:
- an Android phone app (Expo, a development build "OpenClapper Dev" or an APK; not Expo Go since vision-camera) is a viewfinder that shows a cinema rig's frame and captures reference photos
- a Cloudflare Worker (D1 + R2) stores them
- a Preact web client, the Studio, reviews, organises and plans shooting days

The owner talks to you in English.

**Mid-rewrite (epic #371).** The app is being rebuilt on `main` step by step from the decided specification in `docs/rewrite/` (`10-conclusion.md` has the target model and the build order B0–B11). The Worker serves the new model and the Studio is being rebuilt on it (the first app's Studio code is at tag v0.16.0, read it there for a step's inventory); the phone app is still the first app's and does not work until its step lands. When building a step: the prototypes show the design, not the feature list. Carry over everything today's app can do unless a workshop page drops it.

## Read first

- `docs/README.md`: index of all docs. `docs/architecture.md` gives the big picture in five minutes.
- Before changing a feature, read its page in `docs/features/`. **Update that page (and `docs/api.md` / `docs/data-model.md`) in the same commit when behaviour changes.**
- `apps/mobile/AGENTS.md`: Expo changed a lot; check the SDK 57 docs before using an Expo API.

## Map

| Path | What |
| --- | --- |
| `apps/worker/src` | API routes (`files.ts`: one set for every file type; `projects.ts`, `workspaces.ts`; registered in `routes.ts`), `authn/` (sign-in, sessions, the provider seam), `tenancy.ts` (workspace access checks) |
| `apps/admin` | Admin plane: its own Worker (`src/index.ts`) and board (`ui/`) behind its own Cloudflare Access app; user management across the instance |
| `apps/worker/migrations` | D1 schema, numbered, additive; `0001_rewrite_baseline.sql` is the rebuild's baseline |
| `packages/model` | The rebuild's shared model (`@openclapper/model`): file types, the rules for their bodies and references, placement; used by the Worker and the rebuilt clients |
| `apps/studio/src` | The rebuilt Studio on `@openclapper/design`: `wm/` (desktop shell: `Shell.tsx`, window manager `wm.ts`, taskbar, task view, route bridge), `apps/` (one file per app + `registry.ts`), `hosts.tsx` (toast, confirm, prompt, context menu), `prefs.ts`, `theme.ts`, `shortcuts.ts` (every shortcut) + `keys.ts` (`bind`), `shell.css` |
| `apps/mobile` | `App.tsx` (tabs, gates, pushed-screen stack), `src/screens/` (Viewfinder + Tag, Review, Shots + ShotDetails, Day + StepThrough, Setup hub + sub-screens, Uploads, Gates), `src/ui/` (component library: `theme.tsx`, primitives by design-system group, `chrome.tsx` header/rows/bars, `dialogs.tsx` confirm + toast), `src/components/` (`TagEditor.tsx`, sheets, viewfinder parts), `uploads.ts` (queue), `sync.ts`, `rigs.ts`, `storage.ts` (kv), `api.ts` |
| `packages/vocab` | The first app's shared vocabularies, still used by its clients until they are rebuilt; nothing new goes here |
| `packages/fov-math` | Camera/lens/FOV/overlay/reframe math |
| `packages/ui` | The first app's web design system (`@openclapper/ui`); still used by the admin board, goes at the cutover |
| `packages/design` + `apps/specimen` | The design system (`@openclapper/design`, `docs/rewrite/`) of the rebuilt clients and its specimen app (`make specimen`); never on the same page as `@openclapper/ui`. Fixes to how something looks or behaves go here, not into an app |
| `packages/service-kit` | What both Workers share: `http.ts` router + `assert*` helpers, Access verification, password hashing |

## Core model in one paragraph

A **shot** holds the metadata (name, location, INT/EXT, light phases + artificial flag, weather, review state, extra fields) and owns 1..n **photos**; a sequence is one shot with many photos. Rig, lens, framing and GPS are per photo, and the first photo is the cover. Every shot belongs to a **project**; locations, rigs, views and field definitions are shared. Ids are client-generated UUIDs; PUTs are upserts.

## Rules of the house

- **Never lose a capture on the phone.**
  - Uploads are idempotent.
  - The server accepts stale references (it nulls them) rather than rejecting.
  - Rejected uploads stay queued as `stuck`.
  - Drafts and sequences are persisted.
  Keep it that way.
- **Shared rules go in `packages/model`** and are reused by the Worker. Interactive edits are validated strictly, uploads leniently.
- **Migrations**: a new numbered file for every change; never edit an applied one. Production holds real data now: ask before anything destructive.
- **Match the surrounding code**: terse doc comments on exported functions explaining *why*; plain CSS on the design tokens, never hard-coded colours (`docs/design.md`; both themes, Sun and Set, must stay high contrast); mobile UI from `src/ui` (primitives, `makeStyles`/`useTheme`). No new dependencies without a reason (the sun math and combobox are hand-written on purpose).
- **The Android signing key** lives in the deployment repository's GitHub secrets and the owner's offline backup, never in git or a checkout; a new key cannot update installed apps. Builds use no Expo account (`expo prebuild` + Gradle). Locally only keyless builds: the dev client (`make dev-build`) and OpenClapper Local (`make apk-local`, debug-signed).
- **One product version** (root `package.json`, SemVer 0.x; workspace packages stay `0.0.0`). Releases: `scripts/release.sh X.Y.Z`, only when the owner asks ([releasing](docs/releasing.md)).
- **CI is a gate**: never pass `--admin` to `gh pr merge`; a red check is fixed, not bypassed.
- **Deploys to production are done by the owner**, from the deployment repository `OpenClapper-dev/deploy` (its "Production · …" and "Staging · …" workflows: Release (production), Update (staging: server and app from one commit), Deploy server, Build phone app, Recreate from production (staging); its GitHub environments `production` and `staging` hold each instance's settings, see `docs/self-hosting.md`). This repository is for development and is a black box to that one: scripts and reusable workflows read every setting from the environment, never from a settings file or a path outside the checkout, and the Makefile's targets are local-only (no deploy targets, nothing a deployment calls). The tracked `wrangler.jsonc` files are local-dev only: never put an account, database or Access id back into them. You prepare, check and commit. You may apply additive remote migrations when asked. Commit only when asked or when working through an agreed plan; work on a branch.

## Working from a GitHub issue

When the owner hands you an issue (a number or a link), that means: read it, challenge it, then build it on a branch with a PR.

1. **Read it** with `gh` (installed and logged in): `gh issue view <n> --json title,body,comments,labels`. The plain `gh issue view` fails on this repo (classic Projects deprecation).
2. **Challenge it before writing code.** Issues are written brainstorm-style: treat them as ideas to check, not as a spec. Read the affected code and the feature page in `docs/features/`, then stop and reply with:
   - questions on anything unclear, ambiguous or contradictory;
   - where the idea is weak, inconsistent with the rest of the app, or has a better alternative: say so plainly, including UX improvements;
   - your proposed approach (UX and data/API) in a few lines.

   Wait for the owner's answers before implementing. Skip this stop only if the issue is unambiguous and you have no objections, and say so.
3. **Branch** from an up-to-date `main`: `feat/<n>-<slug>` or `fix/<n>-<slug>`.
4. **Implement**, update the docs in the same commits, run the checks below, commit per meaningful step.
5. **Push and open a PR** that links the issue (`Closes #<n>` in the body). The body covers what changed, the decisions you made, what was checked, and what was not clicked through.
6. **Report back** with the PR link, open points and what the owner should test. Risks you couldn't rule out go into `docs/known-issues.md`. Merge only when asked (`gh pr merge <n> --merge`; that also closes the issue).

## Verify before you say "done"

```sh
make check   # lint, typecheck, unit and route tests (docs/testing.md), build dry runs: the same lane CI runs on every PR
```

What it runs, and how lint findings are handled: `docs/development.md` ("Checks").

For the API, run the local worker (`pnpm dev:worker`) and exercise it with `curl`, signed in as `dev@localhost` / `openclapper-local-dev` (the snippet is in `docs/development.md`). For the Studio, the Playwright MCP (headless Chrome, configured per machine) can click through `localhost:5173` with `pnpm dev` running. Say what was and was not clicked through, and ask the owner to test on the phone. For phone bugs, ask for the debug log (Setup → Debug log → Share). More in `docs/development.md`.
