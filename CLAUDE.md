# Fielder — agent guide

Single-user tool for film location scouting and shoot planning:
- an Android phone app (Expo, a development build "Fielder Dev" or an APK; not Expo Go since vision-camera) is a viewfinder that shows a cinema rig's frame and captures reference photos
- a Cloudflare Worker (D1 + R2) stores them
- a Preact dashboard reviews, organises and plans shooting days

The owner talks to you in English.

## Read first

- `docs/README.md`: index of all docs. `docs/architecture.md` gives the big picture in five minutes.
- Before changing a feature, read its page in `docs/features/`. **Update that page (and `docs/api.md` / `docs/data-model.md`) in the same commit when behaviour changes.**
- `apps/mobile/AGENTS.md`: Expo changed a lot; check the SDK 57 docs before using an Expo API.

## Map

| Path | What |
| --- | --- |
| `apps/worker/src` | API routes (`shots.ts`, `projects.ts`, `fields.ts`, `days.ts`, …), `http.ts` router + `assert*` helpers |
| `apps/worker/migrations` | D1 schema, numbered, additive |
| `apps/dashboard/src` | `App.tsx` (state, routes), `Sidebar.tsx`, one file per page (`ShotsPage`, `ShotView` + `Inspector`, `Timeline`, `Plan`, library pages), `shortcuts.ts` (every shortcut) + `keys.ts` (`bind`), `ui/` (component library: design-system components by group, `ui/design/` tokens + component CSS), `styles.css` (layouts) |
| `apps/mobile` | `App.tsx` (tabs, gates, pushed-screen stack), `src/screens/` (Viewfinder + Tag, Review, Shots + ShotDetails, Day + StepThrough, Setup hub + sub-screens, Uploads, Gates), `src/ui/` (component library: `theme.tsx`, primitives by design-system group, `chrome.tsx` header/rows/bars, `dialogs.tsx` confirm + toast), `src/components/` (`TagEditor.tsx`, sheets, viewfinder parts), `uploads.ts` (queue), `sync.ts`, `rigs.ts`, `storage.ts` (kv), `api.ts` |
| `packages/vocab` | Shared vocabularies, filters, extra-field definitions, daylight math: anything both the Worker and a client must agree on |
| `packages/fov-math` | Camera/lens/FOV/overlay/reframe math |

## Core model in one paragraph

A **shot** holds the metadata (name, location, INT/EXT, light phases + artificial flag, weather, review state, extra fields) and owns 1..n **photos**; a sequence is one shot with many photos. Rig, lens, framing and GPS are per photo, and the first photo is the cover. Every shot belongs to a **project**; locations, rigs, views and field definitions are shared. Ids are client-generated UUIDs; PUTs are upserts.

## Rules of the house

- **Never lose a capture on the phone.**
  - Uploads are idempotent.
  - The server accepts stale references (it nulls them) rather than rejecting.
  - Rejected uploads stay queued as `stuck`.
  - Drafts and sequences are persisted.
  Keep it that way.
- **Shared rules go in `packages/vocab`** and are reused by the Worker. Interactive edits are validated strictly, uploads leniently.
- **Migrations**: a new numbered file for every change; never edit an applied one. Production holds real data now: ask before anything destructive.
- **Match the surrounding code**: terse doc comments on exported functions explaining *why*; plain CSS on the design tokens, never hard-coded colours (`docs/design.md`; both themes, Sun and Set, must stay high contrast); mobile UI from `src/ui` (primitives, `makeStyles`/`useTheme`). No new dependencies without a reason (the sun math and combobox are hand-written on purpose).
- **Deploys to production are done by the owner** (`pnpm -C apps/worker run deploy`). You prepare, check and commit. You may apply additive remote migrations when asked. Commit only when asked or when working through an agreed plan; work on a branch.

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
for p in packages/vocab packages/fov-math apps/worker apps/dashboard apps/mobile; do (cd $p && npx tsc -p .); done
pnpm -C packages/vocab test && pnpm -C packages/fov-math test && pnpm -C apps/dashboard test && (cd apps/mobile && node --test src/*.test.ts)
(cd apps/dashboard && npx vite build)
(cd apps/mobile && npx expo export --platform android --output-dir /tmp/fielder-export)
```

For the API, run the local worker (`pnpm dev:worker`, no auth locally) and exercise it with `curl`. There is no browser automation. Say so when UI was not clicked through, and ask the owner to test on the phone. For phone bugs, ask for the debug log (Setup → Debug log → Share). More in `docs/development.md`.
