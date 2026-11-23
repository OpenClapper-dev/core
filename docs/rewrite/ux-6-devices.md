# U6 · Devices, layouts, extensions

UX workshop [#362](https://github.com/OpenClapper-dev/core/issues/362) ([plan](ux-plan.md)). Status: **in progress** (round 2, 2026-11-23).

The camera layout editor, the Devices app, and the two extensions with their apps. Specified in [03](03-capture.md), [08](08-extensions.md) and [U5](ux-5-phone.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u6>. Code: `apps/specimen/src/ux/u6/`. Fake data, no phone, no Bluetooth, no server; a reload resets everything except the arrangement of the panels. The bar at the very top is not part of the design: it switches between five places.

## Round 1: what is in it

### Camera layouts

| Part | What to try |
| --- | --- |
| **The list** | Camera and Viewfinder are built in and read-only (a banner offers "Duplicate to change"); "Scout, wide" is a layout of one's own. "New layout" starts from the Viewfinder |
| **The preview** | The middle draws the camera as the chosen device would: its screen size, its real lenses, the app's tab bar. Upright and Landscape in the toolbar are arranged separately |
| **Sections** | The three sections of [U5](ux-5-phone.md): the strip over the picture, the lens rail, the control row. Each lists its controls; drag a row to reorder, the "…" menu moves a control to another section or removes it, "Add a control" offers what is not placed yet |
| **Where a section stands** | The rail and the row each at one edge (top or bottom upright, left or right in landscape); the strip at the top or the bottom of the picture |
| **Options of a control** | A button can carry its label under the icon. The phone lenses and the focal lengths show all at once or one at a time (a carousel) |
| **The shutter** | Cannot be removed; a layout without one in an orientation is not saved and says so |
| **Look** | The frame's colour and width, the blackout's tint and strength, and which readouts stand on the picture: project, lens in use, preset and focal length, angle of view, collection, folder, warnings |
| **Options** | The device the layout is designed for; whether the reference frame steps through 35, 43, 50 mm or switches one of them; all real lenses or the main one; lens names as set for the account, or fixed for this layout |
| **Live preview** | The pill in the toolbar is the phone link: no phone, connected, previewing. Click it to step through the states |
| **Controls of extensions** | "Lights (Hardware)" can be placed only while the Hardware extension is on; switched off, a placed one is greyed and left out on the phone |

Taken over from today's editor ([viewfinder layouts](../features/viewfinder-layouts.md)): bars with ordered controls per orientation, labels on buttons, list or carousel, the look with its readouts, the reference frame's behaviour, which phone lenses, the device the layout is designed for, the read-only default with Duplicate, the live preview. Changed: sections instead of up to four free bars; "Seq" is collection mode; the GPS readout is gone; new controls (blackout, frame upright, folder, layout picker, last photo).

### Devices

| Part | What to try |
| --- | --- |
| **One registry** | Phones and tablets are always there (they register themselves). With the Hardware extension on: lights, a battery, a camera, a video transmitter |
| **Two views** | "At a glance" (a tile per device with connection, battery, what it runs on) and "By type" (rows) |
| **A device's panel** | What its model exposes. A light: power, intensity, white, and for the MC colour and effects. A camera: record, ISO, shutter, timecode, card. A battery: charge and output. A transmitter: its picture. A phone or tablet: what it reported (screen, real lenses), its tabs and its camera layout |
| **Relations** | A COB light runs on a socket or on a battery, said in its panel; the battery's panel and tile show what it powers. One battery powers one light |
| **The proxy** | The pill in the toolbar: the phone that holds the Bluetooth connections. Without one, nothing can be controlled or read |
| **Sleep and wake** | In a device's panel: an asleep device is not connected to |
| **Adding a device** | "Add a device": the phone scans, the Studio lists what it found with the likely model, beside the catalogue of supported hardware. Pair one |

### Flows and extensions

| Part | What to try |
| --- | --- |
| **Extensions of the project** | Two cards with a switch each and what the extension brings (device types, apps, file types, camera controls). Flows needs Hardware: switching Hardware off switches Flows off |
| **What a switch changes** | With Hardware off: Devices shows only phones and tablets and says why; the Lights control of a layout is unavailable; Flows shows "needs its extension". Nothing is deleted |
| **Flows** | A list of flows and an editor: one lane per control of a device (a light's intensity or colour, a camera's recording), steps on a time axis, a playhead, play from the Studio through the proxy or on the phone itself. Low fidelity: the steps are fixed |

## Round 2 (2026-11-23)

From the owner's reaction to round 1.

| Change | What to try |
| --- | --- |
| **Free bars instead of named sections** | A layout is any number of bars. A bar stands at the top, bottom, left or right; bars at one edge stack in the order listed. "+ Bar" in the Bars panel adds one at an edge; a bar is renamed, moved to another edge or removed in its section. The strip over the picture of round 1 is a bar like the others |
| **How bars share the screen** | Upright, top and bottom bars take the full width and side bars the height left between them. In landscape, left and right bars take the full height and top and bottom bars the width left between them |
| **Distribution** | Per bar: its controls packed at the start, in the middle or at the end, or spread out between the ends or with room around |
| **Dragging controls anywhere** | A control is dragged to another place in its bar or into another bar, in the list at the right and directly in the preview. A line shows where it lands |
| **A carousel a thumb can use** | "Stepped" shows three full-size parts: back, the value, on. In an upright bar they stack (up, value, down); in a lying bar they sit side by side |
| **Readouts as tags** | Each readout on the picture is a tag of its own; a warning is coloured |
| **A phone's setup from the Studio** | Devices, a phone or tablet: its tabs (switch, order) and its camera layout are changed in its panel, and "Take the setup of another device" copies both |
| **The transmitter's picture** | Marked "On the phone only" in the Studio: the device's connection and state show like any other, its picture does not. The catalogue says so too |
| **Extensions on the phone** | A fifth place, "On the phone": the Hardware tab (the proxy switch, the devices, a device's controls, the transmitter's picture) and the Flows tab (the project's flows, played from the phone) |

## Decided so far

2026-11-23, by the owner:

- **A camera layout is a set of free bars** at the four edges, per orientation: any number, stackable, each with its controls in order and a distribution. No named sections.
- **Controls are moved by dragging,** in the preview and in the list, within a bar and across bars.
- **A stepped control (carousel) has separate, full-size back and on buttons,** stacked in an upright bar.
- **Readouts on the picture are separate tags,** not one line of text.
- **Lens names can be fixed per layout or follow the account;** the collection's name prompt and the folder for new photos are account matters.
- **Whatever can be set on a phone or tablet can be set from the Studio,** and the other way round: tabs and camera layout to begin with.
- **Flows is carried over** with today's logic in the new design; no redesign in this workshop.
- **A part of a device can be limited to where it works.** A video transmitter's picture is shown on the phone only; its state shows everywhere. The catalogue declares such limits per model.
- **Hardware and Flows are apps on the phone and tablet too** and can be tabs.

## Open

**Device profiles.** The owner raised named profiles for phones and tablets (a tab arrangement for "my phone", another for "my tablet"), creatable in the Studio. Today the only thing such a profile would hold is the tabs and the camera layout. Proposal: no profile object for now. The setup lives on the device, is editable from both sides, and "Take the setup of another device" covers reuse. A named profile can be added when a setup holds more than two things. To be confirmed.

## Not prototyped

Pairing an Aputure mesh, effects with their options, the power overview, dimming curves, editing the steps of a flow, device specs read out again, a layout laid out for a device it was not designed for.

## Into the design system

Nothing yet. Candidates: the phone-link pill, the battery bar, the device tile.
