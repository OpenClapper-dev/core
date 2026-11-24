# Camera layouts and the phone link

> **Built in step B8 ([#380](https://github.com/OpenClapper-dev/core/issues/380)).** Specification: [03 capture](../rewrite/03-capture.md), [08 extensions](../rewrite/08-extensions.md), [U5 phone](../rewrite/ux-5-phone.md), [U6 devices](../rewrite/ux-6-devices.md). Replaces the first app's viewfinder layouts (up to four bars of the rig viewfinder, HUD chips, the preview room); that page is in the history up to v0.16.0.

## The layout (`packages/model/src/layout.ts`, file type `layout`)

A camera layout says which controls the phone's camera shows and where, per orientation, with its look and options. A control that is not placed is off, so a layout is also the capture profile. A file of the **account home**, like the devices it is designed for.

`{ portrait: { bars }, landscape: { bars }, look, options, device }`

- **Bars**: any number (at most 12 per orientation), each `{ id, name, edge: top | bottom | left | right, over, distribution: start | center | end | between | around, items }`. Bars at one edge stack in the order listed. Upright, top and bottom bars take the full width and side bars the height left between them; in landscape the other way round. A bar `over` the picture lies on it and takes no room from it.
- **Controls** (`CONTROLS`), each placed at most once per orientation; the **shutter** is needed in each:

| Control | Kind | What it does |
| --- | --- | --- |
| `shutter` | shutter | One photo |
| `lenses` | strip | The phone's real lenses (`display` list or stepped; `size` fill or fit) |
| `frame` | button | The frame on the picture: an optics preset of the project, free-form values, an aspect ratio, or none |
| `focal` | strip | A preset's focal lengths: buttons for primes, a slider for a zoom (`display` list or stepped) |
| `fit` | button | Zoom to frame: the picture enlarged on the screen so the frame fills it (never the photo) |
| `blackout` | button | Darkens outside the frame |
| `upright` | button | Turns the optics frame to portrait |
| `reference` | button | A second frame, full frame at 35, 43, 50 mm |
| `collection` | button | Collection mode |
| `folder` | button | The folder for new photos |
| `torch`, `uploads`, `last`, `layout` | button | Torch; the queue (with its count); the last photo; the layout picker |
| `read-project`, `read-lens`, `read-frame`, `read-fov`, `read-collection`, `read-folder`, `read-warnings` | readout | Tags on the picture: the project, the lens in use, the preset and focal length, the angle of view, the collection, the folder, warnings (coloured) |

  A button may carry its short `label` under the icon. A stepped strip has full-size back and on buttons (stacked in an upright bar).
- **Look**: `frameColor` (#rrggbb or rgba; offered: white, amber, green, blue, red, black), `frameWidth` 1–12 (offered 1, 2, 3, 4, 6), `blackoutColor` (offered: neutral 62 %, black 85 %, red 50 %, white 50 %), `blackoutOn` (the blackout's state when the camera opens).
- **Options**: `reference` (`cycle` through 35, 43, 50 mm and off, or `toggle` one `mm`), `lenses` (`all`, `main`, or `pick` by the lens's id on the device), `lensNames` (`account`, or fixed `phone` / `focal`).
- `device`: the device the layout is designed for (the editor previews at its camera's size), or null.
- **Built in**, read-only, duplicated to change (`BUILTIN_LAYOUTS`, ids `camera` and `viewfinder`, not files): **Camera** (readouts over the picture; lenses; uploads, collection, shutter, torch, last photo) and **Viewfinder** (also the frame, focal lengths, zoom to frame, blackout, upright, reference frame, the layout picker and the folder).

## The device's layout

A device file keeps `layout` (`camera`, `viewfinder` or a layout's id; `viewfinder` to start with) and `camera` (the size of the camera's area per orientation, bars and picture without the tab bar, as the phone measured it). Registering again keeps the layout and the tabs (the person's choices) and replaces what the hardware reports.

## The phone link (`apps/worker/src/link.ts`)

One connection between a person's Studio tabs and their phones and tablets: `GET /api/link?role=phone|studio` (a websocket) into one Durable Object per person (`PreviewRoom`, its first name; the hibernation API). Every message names its channel `ch`; at most 64 KiB each.

| Channel | Messages |
| --- | --- |
| `link` | phone: `hello { device: { id, name } }`; Studio: `readout` (the phones register again); to the Studio tabs: `presence { phones: [{ id, name }], previewing }` on every change |
| `layout` | Studio: `preview { layout, orientation, device? }` (a layout shown on the phone without saving it; checked; kept for a phone that connects later), `stop`; phone: `exit`. The last Studio tab gone ends a preview |
| any other | An extension's: carried from the Studio to the phones and back, unread |
