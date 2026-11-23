# UX workshops: the plan

Status: **decided** (2026-11-20). Part of epic [#326](https://github.com/OpenClapper-dev/core/issues/326).

Workshops 00–09a specified features. This second series prototypes the interface for them on the design system ([`packages/design`](../../packages/design/README.md)), feeds the design track's step D4 (feature-level patterns) and may reopen a decision. Workshop 10 comes after it.

## How a UX workshop runs

1. I prepare prototypes of the workshop's screens and flows in the specimen app (`apps/specimen`, `make specimen`): clickable, built from the design system's real components, with fake but realistic data and no server. Where a choice matters, two or three variants side by side.
2. The owner clicks through and reacts; I change them until they hold.
3. The page `ux-N-<topic>.md` records what was chosen (with pictures or links to the prototypes), what it changed in a specification page, and which patterns go into the design system.
4. Patterns that several screens share are built into `packages/design` and shown in the specimen app (D4).

A UX workshop writes no product code. The prototypes live in the specimen app, next to the foundation's cards and kits; what holds becomes a pattern of the design system directly.

## The cut

Along surfaces that share components, not along the old topics. Each later workshop uses what the earlier ones settled.

| # | Workshop | Issue | Screens and flows | Specified in |
| --- | --- | --- | --- | --- |
| U1 | **Files and properties** | [#357](https://github.com/OpenClapper-dev/core/issues/357) | The file browser in its entries (Files, Media, Shots, Sets, Locations): tree, list, grid, board, map; search and saved filters; the properties panel and bulk edit; collections as one tile or spread out; the bin; the Project app (property editor with AI import, naming patterns, extensions); file icons for every type | [07](07-organisation.md), [09](09-shells.md), [09a](09a-places.md), [04](04-shots.md) (properties, names) |
| U2 | **Canvas** | [#358](https://github.com/OpenClapper-dev/core/issues/358) | The tool: blank and base-photo canvases, layers, placed pictures, drawing tools; frames (free-form, preset, aspect; several at once, compare); the optics preset picker and the preset create flow with its preview; the edit lock; the same tool on a tablet | [05](05-composition.md), [02](02-optics.md) |
| U3 | **Shot, set, location** | [#359](https://github.com/OpenClapper-dev/core/issues/359) | The three windows: properties, content list; the shot's progression editor, its generator, overlay and default frame; mounting another app's editor and inspector in place; internal files | [04](04-shots.md), [09a](09a-places.md), [I1](i1-interjection.md), [06](06-timeline.md) (hosting) |
| U4 | **Timeline** | [#360](https://github.com/OpenClapper-dev/core/issues/360) | Strip, preview and playback; the two file panels; shots spread and collapsed; placeholders; chapter markers; the master timeline; editing a file from within the cut | [06](06-timeline.md) |
| U5 | **Phone and tablet** | [#361](https://github.com/OpenClapper-dev/core/issues/361) | The camera with its layouts, optics frame, real lenses and collection mode; Media and Shots in their touch forms; choosing tabs per device; Setup, gates, uploads, offline | [03](03-capture.md), [09](09-shells.md) |
| U6 | **Devices, layouts, extensions** | [#362](https://github.com/OpenClapper-dev/core/issues/362) | The Devices app across device types; the camera layout editor with live preview; switching extensions on; the Hardware and Flows apps in the new design | [03](03-capture.md), [08](08-extensions.md) |

The Studio's desktop shell (windows, taskbar, launcher) was designed with the foundation and is not a workshop of its own; changes to it are handled where they come up.

## Order

U1 first: every other surface lists files and shows properties. Then U2, because the canvas is mounted inside the shot window and the timeline. U3 and U4 follow. U5 can run any time after U1. U6 is last; it is a full workshop, although its apps exist today.

## What the prototypes need

- **Pictures.** Realistic photos, canvases and shots to fill the screens. For the optics frames these should be the example photos planned in [02](02-optics.md).
- **The two new file icons** (set, location) and any other missing file icons, drawn in U1.

## Decided

2026-11-20, by the owner:

- **Six UX workshops** as cut above, in the order U1, U2, U3, U4, with U5 any time after U1 and U6 last.
- **Prototypes are built in the specimen app** from the design system's components.
- **U6 is a full workshop:** the Devices app, the camera layout editor, Hardware and Flows are prototyped and reconsidered like the other surfaces.
