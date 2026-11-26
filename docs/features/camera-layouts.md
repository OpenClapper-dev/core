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
| `hardware` (Hardware extension) | button | The device cards over the camera ([hardware](hardware.md)). Offered in the editor only while the project has the extension on; placed and switched off, it is greyed in the editor and left out on the phone |
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
| `link` | phone: `hello { device: { id, name } }`; Studio: `readout` (the phones register again); to the Studio tabs: `presence { phones: [{ id, name }], previewing }` on every change; to the phones: `presence { studios }` (how many Studio tabs are open) |
| `layout` | Studio: `preview { layout, orientation, device? }` (a layout shown on the phone without saving it; checked; kept for a phone that connects later), `stop`; phone: `exit`. The last Studio tab gone ends a preview |
| any other | An extension's ([extensions](extensions.md)): carried unread from the Studio to the phones, and from a phone to the Studio tabs and the other phones |

## The Camera layouts app (`apps/studio/src/apps/LayoutsApp.tsx`)

- **Layouts** panel: the built-in Camera and Viewfinder (read-only: "Duplicate to change") and the account's own; **New layout** starts from the Viewfinder.
- **The preview** draws the camera as the device the layout is designed for: its camera's area per orientation (else its screen, else a usual phone of 412 × 760), its real lenses with the layout's lens names, the bars around the picture (upright: top and bottom bars take the full width, side bars the height left; landscape the other way round), bars over the picture stacked at their edge inside it, readouts as tags (a warning in colour), stepped strips as back, value, on, a sample frame with the look when a frame control is placed. **Upright** and **Landscape** are arranged separately.
- **Dragging**: a control is dragged to another place in its bar or into another bar, in the preview or in the Bars panel; a line shows where it lands.
- **Bars** panel: per bar its name, edge, over the picture, distribution, its controls (a button's label, a strip all or stepped, the lens strip fit or fill, remove; the shutter cannot be removed and its bar cannot go while it is there), "Add a control" (what is not placed yet), remove the bar; "+ Bar" at an edge.
- **Look** panel: the frame's colour and width, the blackout's tint and whether it is on when the camera opens. **Options** panel: the device it is designed for, the reference frame (steps through 35, 43, 50 mm, or on and off at one), phone lenses (every real lens, the main one, or those picked from the device's lenses), lens names (as set for the account, the phone's, focal lengths).
- **Saving**: 0.6 s after the last change, and only while the layout is valid; until then a banner says what is missing ("Not saved yet").
- **The phone link pill**: no phone (or the link offline), "<phone> connected", "Previewing on <phone>". A click starts the live preview: the phone shows the layout as it is changed, in the orientation shown; a click again, closing the app or the phone leaving the preview ends it. Nothing is saved on the phone.

- **For previewing only** (#426, never saved in the layout): *As …* picks whose camera and real lenses the preview shows (phones and tablets only, not the hardware extension's gear; default: the device showing the live preview, else the one the layout is designed for, else a usual phone; switched-off lenses are left out); *With …* picks an optics preset whose focal lengths the focal length control shows (to see early whether many primes fit a strip; a zoom preset shows the slider, as on the device); **Grid** outlines every bar with a faint fill, here and on the device's live preview. These and Upright / Landscape stay as set while the Studio is open, across layouts and reopening the editor; a reload resets them. The layout's own *Device* also lists only phones and tablets.
- **From the preview**: a click on a control scrolls its entry in Bars into view and flashes it; a right-click offers *Show in Bars* and *Remove* (not the shutter).

## The camera on the phone (`apps/mobile/src/apps/Camera.tsx`, `src/camera/`, `src/link.ts`)

- **The layout in use**: the device's choice (`device.layout`, chosen with the Layout control or in Setup, or set from the Studio), else the Viewfinder; the account's layouts are kept on the phone (loaded with each sync) so the camera opens with them offline. A layout the Studio previews takes its place meanwhile: its bars are dimmed and do nothing, the shutter is off, a chip "Studio preview · buttons off · tap to leave" ends it. A preview never outlives the link.
- **Bars** as the layout says, per orientation (the phone held upright or in landscape): bars beside the picture take room from it, bars over the picture lie on it; distribution as set. The camera's area is measured as laid out and sent with the device's next registration, so the Studio previews at it.
- **Controls**: the shutter; the phone's real lenses (as the layout offers them: all, the main one, or those picked; named as the layout or the account says; a list or stepped; fill scrolls); **Frame** (a sheet: an optics preset of the project, free-form values (format, focal length, squeeze, delivery) or an aspect ratio, or none; kept per project on the phone); **focal lengths** (a preset's primes as buttons, a zoom as a slider along its bar with − and + that takes the room the bar has left, 150 down to 56 points, and sets the focal length at most every 80 ms while dragged; free values stepped through the primes); **zoom to frame** (the picture enlarged on the screen so the frame fills it; never the photo); **blackout** (the layout's tint outside the frame; its start state from the layout); **upright** (the optics frame turned to portrait); **reference frame** (full frame at 35, 43, 50 mm stepped through, or one switched, as the layout says; dashed); **collection mode**; **folder** (where new photos go: the top level, a folder, a new folder; kept per project); torch; uploads (the count; stuck in colour; opens Setup, Uploads); the last photo (opens it in Media); **Layout** (the sheet of layouts). A control that is not placed is off.
- **The frame**: drawn in the layout's colour and width against the live picture's angle of view, which comes only from what the camera reports for the lens in use (its 35 mm equivalent); a lens without a report gets no optics frame and the warnings readout says so (aspect frames still work). A frame wider than the lens is the **container**: the picture is drawn smaller inside it and the frame dashed; the readout notes it. A delivery's inner box is dashed inside the frame.
- **Readouts**: tags on the picture: the project, the lens in use (with its 35 mm equivalent), the preset and focal length (and upright), the angle of view, the collection with its count, the folder, warnings in colour.
- **Collection mode**: on starts a new collection (needs a connection; named by the project's pattern, or asked for at the start, as the account's "ask for a collection's name" says) in the folder for new photos; what is shot goes into it and the button shows the count; off ends it (asked for a name at the end, when set so).
- **A capture** keeps the frame on the screen as a fact of the photo (`frame`: frame values, for a preset its factors copied with its name and the preset's id), and goes into the collection or the folder for new photos. The server takes the fact leniently: one that does not fit is left out, the photo kept.
- **In the Studio** a photo's facts show "Frame when taken"; a canvas made from such a photo (Make a canvas, Draw or frame, Make a canvas from it) starts with that frame as its picture, from its preset while the preset is there, else from the copied factors. Settings, Canvas switches that off (`canvasTakesFrame`).

## Devices (`apps/studio/src/apps/DevicesApp.tsx`)

The account's registered hardware; in the core its phones and tablets (they register themselves; the Hardware extension, step B9, adds its device types to the same registry). Two views: **cards** across the full width and a **table** (name, type, model, connection, camera layout, app version). State is shown in colour: connected now (the phone link sees it) or registered. A card: the name (renamed in place), kind, make, model and app version, what it reported (screen, camera area, real lenses with their focal lengths or none), its **tabs** (switch on and off, order; Setup always last), its **camera layout** (built in or the account's), **Take the setup of another device** (copies its tabs and layout), and in its menu **Read out again** (a connected device registers again now) and **Remove** (to the recycle bin; it registers again when the app runs on it). Whatever is set here is set on the device, and the other way round.

## On the phone: Setup, Camera

The camera layout on this device (the built-in ones and the account's; the same choice as the Layout control and Devices in the Studio), and for a layout of one's own its **look** (frame colour and width, blackout tint, blackout on at the start) and **options** (reference frame, every real lens or the main one, lens names in this layout); a built-in layout offers **Make a copy to change**. Bars and controls are arranged in the Studio. An edit shows at once, waits on the phone and is sent as a patch on the server's layout as it is then, so what the Studio changed meanwhile stays; a layout that is gone or a refused edit is dropped with a message. Below: the account's preferences (lens names, a collection's name).
