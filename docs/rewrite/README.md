# Rewrite planning

Planning for the composition-first rewrite (epic [#326](https://github.com/OpenClapper-dev/core/issues/326)). These pages describe where the app is going, not what it does today: the reference documentation in [`docs/`](../README.md) stays the truth about the current code until the rebuild replaces it.

The app grew out of a viewfinder helper. A photo cannot exist without a rig and a shot, frame logic reaches into layers, bakes, timeline clips and thumbnails, and expert features (lights, flows, camera control) sit in the core path. The rewrite turns this into isolated building blocks that the user links, with expert features packaged as extensions, on a new design system built for the desktop-style Studio.

## Rules of this phase

- **Planning only.** No product code until workshop 10 is approved. The one exception is the design track's step D3 (a new UI package, `packages/design`, proven on a specimen app, `apps/specimen`; the current Studio is not touched because both systems share token names).
- **Zero backwards compatibility** in the rebuild. Production data is dropped; the rebuild goes to staging first. Before the production buckets are deleted, the owner downloads `/photos` from the production media bucket.
- This branch, `rewrite/plan`, is long-lived. Each workshop is a PR into it.

## How a workshop runs

1. A page `NN-<topic>.md` is prepared with four parts: **As-is** (what exists, with file paths), **Problems and leaks**, **Proposal** (target concepts, data shape, boundaries to neighbouring blocks, what is deleted) and **Open questions**.
2. A workshop specifies features: concepts, rules, data shape. It does not prototype the interface, because a screen depends on blocks that later workshops still change. Where a workshop sees UX at stake it notes it under "Handed to other workshops".
3. The owner decides. The decisions go into the page's **Decided** section and into the sub-issue, and the PR is merged.
4. The **Decided** section is the spec for the rebuild. A later workshop reopens an earlier decision only by editing that section.

## Workshops

| # | Topic | Issue | Page | Status |
| --- | --- | --- | --- | --- |
| 00 | Principles, layers, glossary | [#327](https://github.com/OpenClapper-dev/core/issues/327) | [00-principles.md](00-principles.md) | decided |
| 01 | Media library | [#328](https://github.com/OpenClapper-dev/core/issues/328) | [01-media.md](01-media.md) | decided |
| 02 | Optics and frames | [#329](https://github.com/OpenClapper-dev/core/issues/329) | [02-optics.md](02-optics.md) | decided |
| 03 | Capture on the phone | [#330](https://github.com/OpenClapper-dev/core/issues/330) | [03-capture.md](03-capture.md) | decided |
| 04 | Shots and planning | [#331](https://github.com/OpenClapper-dev/core/issues/331) | [04-shots.md](04-shots.md) | decided |
| 05 | Canvas (was: composition) | [#332](https://github.com/OpenClapper-dev/core/issues/332) | [05-composition.md](05-composition.md) | decided |
| 06 | Timeline | [#333](https://github.com/OpenClapper-dev/core/issues/333) | [06-timeline.md](06-timeline.md) | decided |
| 07 | Organisation and filesystem | [#334](https://github.com/OpenClapper-dev/core/issues/334) | [07-organisation.md](07-organisation.md) | decided |
| 08 | Extensions | [#335](https://github.com/OpenClapper-dev/core/issues/335) | [08-extensions.md](08-extensions.md) | decided |
| 09 | Shells and app catalogue | [#336](https://github.com/OpenClapper-dev/core/issues/336) | [09-shells.md](09-shells.md) | open |
| 09a | Places (Motiv, address, geography) | [#352](https://github.com/OpenClapper-dev/core/issues/352) | 09a-places.md | not started |
| I1 | Interjection after 06: collections, progression, internal files, master timeline | — | [i1-interjection.md](i1-interjection.md) | decided |
| 10 | Conclusion: target model and build plan | [#337](https://github.com/OpenClapper-dev/core/issues/337) | 10-conclusion.md | not started |

Workshops 01–03 are the root of the entanglement and come first; 04–06 build on them; 07–09 depend on a stable block list. After 01–09 a second series of **UX workshops** follows, split along the feature set that came out of them rather than along these topics. They prototype the interface on the design system (static HTML in `mockups/`), feed the design track’s D4 and may reopen a decision. Workshop 10 comes after them.

Workshop 10 maps every current table, route group, Studio app and phone screen to "kept as", "replaced by" or "deleted".

## Design track

Runs in parallel, starting after workshop 00. The foundation (tokens, atoms, OS chrome, icons, marks) is designed now; feature-level patterns follow the UX workshops. The current feature pages are not restyled.

| # | Step | Issue | Status |
| --- | --- | --- | --- |
| D1 | Design brief (master prompt), [design-brief.md](design-brief.md) | [#338](https://github.com/OpenClapper-dev/core/issues/338) | done |
| D2 | Design the foundation | [#339](https://github.com/OpenClapper-dev/core/issues/339) | done: designer export "Graphite" round 2 (2026-11-13) |
| D3 | Adopt the foundation | [#340](https://github.com/OpenClapper-dev/core/issues/340) | done: `packages/design` + `apps/specimen` (`make specimen`) |
| D4 | Feature-level patterns | [#341](https://github.com/OpenClapper-dev/core/issues/341) | not started |

## Decided so far

[model.md](model.md) shows the model of workshops 00–08 in one picture.

- Design system: foundation now, patterns later.
- Production data is dropped; staging first.
- Day planning is deleted. Extra fields return as generic properties (see 04).
- Themes are called Light and Dark.
- Workshops 01–09 are specification only; UX and UI are prototyped afterwards in a second series of workshops split by the resulting feature set (2026-11-17).
- The rewrite builds a base layer of primitives without personas; roles and workflows are business logic on top, later ([00](00-principles.md)).
- A photo is a standalone primitive of one project (hard-scoped, no move or copy): untouched original plus client-made preview and thumbnail, stills only, properties instead of ownership. Photos that belong together form a collection, at most one per photo. No GPS or place on photos; locations are re-thought in 07 ([01](01-media.md)).
- Optics is generic factors (format, multiplier, squeeze, focal length, orientation); a photo's angle of view is computed once from EXIF; framings are free-form or made from a project's optics preset, which changes additively only. No rigs, equipment or vignetting for now ([02](02-optics.md)).
- The phone's base is a camera that needs only a project: a capture is one photo, with no tagging, drafts or sequences. Real lenses only, no digital zoom; the live angle of view comes from what the camera reports. Camera layouts stay customisable; devices are an account-owned registry that phones and tablets join automatically ([03](03-capture.md)).
- A shot is an intent: properties plus an ordered, generic list of referenced files (photo, canvas; later anything). It can carry one progression, a timed order of pictures with an optional overlay and default frame. No review state, no fixed tags, no built-in note or description. Properties are a per-project catalogue for all file types; files get generated names. Drawing, framing and floor plans become one canvas file type ([04](04-shots.md)).
- The canvas is one core file type and tool: a blank surface or a base photo, layers, placed pictures, and frames, which live only inside a canvas (no framing on a photo, no Framing app). A render of the whole surface replaces bakes; view modes are never stored; one editor at a time; the tablet uses the embedded editor if the test holds ([05](05-composition.md)).
- A timeline is an ordered list of clips for deciding; a clip is a reference to any file with a picture (photo, canvas, shot) or a placeholder, plus a hold time, and carries nothing of its own. Files are edited in place by hosting their app (viewer, editor, inspector). A shot with a progression plays it and shows spread or collapsed. Chapter markers organise a timeline, and one master timeline per project orders timelines. No review, no clip notes ([06](06-timeline.md)).
- Everything is a file: folders and collections, presets, property definitions, devices and camera layouts too. A file has one place in a project or in an account home. Properties are a flat list of typed fields with sections and dependent choices; one file browser offers search, saved filters and list, grid and board views. Places are postponed to workshop 09a ([07](07-organisation.md)).
- Extensions are first-party, compiled in and enabled per project; they plug in at fixed points and share one phone link through channels. "Device" is the word for all registered hardware. Two extensions: Hardware (catalogue of brands, models and types; live picture is a transmitter's feed) and Flows ([08](08-extensions.md)).
- Internal files: a file created inside another (a shot's generated canvas, a progression's overlay) is hidden from the file browser and lives with its parent ([I1](i1-interjection.md)).
