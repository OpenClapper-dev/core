# Rewrite planning

Planning for the composition-first rewrite (epic [#326](https://github.com/OpenClapper-dev/core/issues/326)). These pages describe where the app is going, not what it does today: the reference documentation in [`docs/`](../README.md) stays the truth about the current code until the rebuild replaces it.

The app grew out of a viewfinder helper. A photo cannot exist without a rig and a shot, frame logic reaches into layers, bakes, timeline clips and thumbnails, and expert features (lights, flows, camera control) sit in the core path. The rewrite turns this into isolated building blocks that the user links, with expert features packaged as extensions, on a new design system built for the desktop-style Studio.

## Rules of this phase

- **Planning only.** No product code until workshop 10 is approved. The one exception is the design track's step D3 (a new UI package, proven on a specimen app and the desktop shell).
- **Zero backwards compatibility** in the rebuild. Production data is dropped; the rebuild goes to staging first. Before the production buckets are deleted, the owner downloads `/photos` from the production media bucket.
- This branch, `rewrite/plan`, is long-lived. Each workshop is a PR into it.

## How a workshop runs

1. A page `NN-<topic>.md` is prepared with four parts: **As-is** (what exists, with file paths), **Problems and leaks**, **Proposal** (target concepts, data shape, boundaries to neighbouring blocks, what is deleted) and **Open questions**.
2. Mockups, where UX is at stake, are static HTML in `mockups/NN/`: low-fidelity until the design foundation exists, then built on it.
3. The owner decides. The decisions go into the page's **Decided** section and into the sub-issue, and the PR is merged.
4. The **Decided** section is the spec for the rebuild. A later workshop reopens an earlier decision only by editing that section.

## Workshops

| # | Topic | Issue | Page | Status |
| --- | --- | --- | --- | --- |
| 00 | Principles, personas, glossary | [#327](https://github.com/OpenClapper-dev/core/issues/327) | [00-principles.md](00-principles.md) | open |
| 01 | Media library | [#328](https://github.com/OpenClapper-dev/core/issues/328) | 01-media.md | not started |
| 02 | Optics and frames | [#329](https://github.com/OpenClapper-dev/core/issues/329) | 02-optics.md | not started |
| 03 | Capture on the phone | [#330](https://github.com/OpenClapper-dev/core/issues/330) | 03-capture.md | not started |
| 04 | Shots and planning | [#331](https://github.com/OpenClapper-dev/core/issues/331) | 04-shots.md | not started |
| 05 | Composition | [#332](https://github.com/OpenClapper-dev/core/issues/332) | 05-composition.md | not started |
| 06 | Timeline | [#333](https://github.com/OpenClapper-dev/core/issues/333) | 06-timeline.md | not started |
| 07 | Organisation and filesystem | [#334](https://github.com/OpenClapper-dev/core/issues/334) | 07-organisation.md | not started |
| 08 | Extensions | [#335](https://github.com/OpenClapper-dev/core/issues/335) | 08-extensions.md | not started |
| 09 | Shells and app catalogue | [#336](https://github.com/OpenClapper-dev/core/issues/336) | 09-shells.md | not started |
| 10 | Conclusion: target model and build plan | [#337](https://github.com/OpenClapper-dev/core/issues/337) | 10-conclusion.md | not started |

Workshops 01–03 are the root of the entanglement and come first; 04–06 build on them; 07–09 depend on a stable block list. Workshop 10 maps every current table, route group, Studio app and phone screen to "kept as", "replaced by" or "deleted".

## Design track

Runs in parallel, starting after workshop 00. The foundation (tokens, atoms, OS chrome, icons, marks) is designed now; feature-level patterns follow each workshop. The current feature pages are not restyled.

| # | Step | Issue | Status |
| --- | --- | --- | --- |
| D1 | Design brief (master prompt), [design-brief.md](design-brief.md) | [#338](https://github.com/OpenClapper-dev/core/issues/338) | done |
| D2 | Design the foundation | [#339](https://github.com/OpenClapper-dev/core/issues/339) | not started |
| D3 | Adopt the foundation | [#340](https://github.com/OpenClapper-dev/core/issues/340) | not started |
| D4 | Feature-level patterns | [#341](https://github.com/OpenClapper-dev/core/issues/341) | not started |

## Decided so far (2026-11-12)

- Design system: foundation now, patterns later.
- Production data is dropped; staging first.
- Day planning is deleted. Extra fields are removed for now and parked as a future extension mechanism.
- Themes are called Light and Dark.
