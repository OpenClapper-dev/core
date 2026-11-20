# UX workshops: the plan

Status: **proposal, nothing decided yet**. Part of epic [#326](https://github.com/OpenClapper-dev/core/issues/326).

Workshops 00–09a specified features. This second series prototypes the interface for them on the design system ([`packages/design`](../../packages/design/README.md)), feeds the design track's step D4 (feature-level patterns) and may reopen a decision. Workshop 10 comes after it.

## How a UX workshop runs

1. I prepare prototypes of the workshop's screens and flows, with fake but realistic data, and where a choice matters two or three variants side by side.
2. The owner clicks through and reacts; I change them until they hold.
3. The page `ux-N-<topic>.md` records what was chosen (with pictures or links to the prototypes), what it changed in a specification page, and which patterns go into the design system.
4. Patterns that several screens share are built into `packages/design` and shown in the specimen app (D4).

A UX workshop writes no product code: prototypes have no server behind them.

## The cut

Along surfaces that share components, not along the old topics. Each later workshop uses what the earlier ones settled.

| # | Workshop | Screens and flows | Specified in |
| --- | --- | --- | --- |
| U1 | **Files and properties** | The file browser in its entries (Files, Media, Shots, Sets, Locations): tree, list, grid, board, map; search and saved filters; the properties panel and bulk edit; collections as one tile or spread out; the bin; the Project app (property editor with AI import, naming patterns, extensions); file icons for every type | [07](07-organisation.md), [09](09-shells.md), [09a](09a-places.md), [04](04-shots.md) (properties, names) |
| U2 | **Canvas** | The tool: blank and base-photo canvases, layers, placed pictures, drawing tools; frames (free-form, preset, aspect; several at once, compare); the optics preset picker and the preset create flow with its preview; the edit lock; the same tool on a tablet | [05](05-composition.md), [02](02-optics.md) |
| U3 | **Shot, set, location** | The three windows: properties, content list; the shot's progression editor, its generator, overlay and default frame; mounting another app's editor and inspector in place; internal files | [04](04-shots.md), [09a](09a-places.md), [I1](i1-interjection.md), [06](06-timeline.md) (hosting) |
| U4 | **Timeline** | Strip, preview and playback; the two file panels; shots spread and collapsed; placeholders; chapter markers; the master timeline; editing a file from within the cut | [06](06-timeline.md) |
| U5 | **Phone and tablet** | The camera with its layouts, optics frame, real lenses and collection mode; Media and Shots in their touch forms; choosing tabs per device; Setup, gates, uploads, offline | [03](03-capture.md), [09](09-shells.md) |
| U6 | **Devices, layouts, extensions** | The Devices app across device types; the camera layout editor with live preview; switching extensions on; the Hardware and Flows apps in the new design | [03](03-capture.md), [08](08-extensions.md) |

The Studio's desktop shell (windows, taskbar, launcher) was designed with the foundation and is not a workshop of its own; changes to it are handled where they come up.

## Order

U1 first: every other surface lists files and shows properties. Then U2, because the canvas is mounted inside the shot window and the timeline. U3 and U4 follow. U5 can run any time after U1. U6 is last and can be shortened, since its apps exist and mainly need the new design.

## What the prototypes need

- **Pictures.** Realistic photos, canvases and shots to fill the screens. For the optics frames these should be the example photos planned in [02](02-optics.md).
- **The two new file icons** (set, location) and any other missing file icons, drawn in U1.

## Open questions

1. Is the cut right?
2. In which form are the prototypes built?
3. How much of U6 belongs to this series?

## Decided

Nothing yet.
