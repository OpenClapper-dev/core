# U6 · Devices, layouts, extensions

UX workshop [#362](https://github.com/OpenClapper-dev/core/issues/362) ([plan](ux-plan.md)). Status: **in progress** (round 1, 2026-11-23).

The camera layout editor, the Devices app, and the two extensions with their apps. Specified in [03](03-capture.md), [08](08-extensions.md) and [U5](ux-5-phone.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u6>. Code: `apps/specimen/src/ux/u6/`. Fake data, no phone, no Bluetooth, no server; a reload resets everything except the arrangement of the panels. The bar at the very top is not part of the design: it switches between four places.

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

## Open questions for the owner

1. **Sections or free bars.** Today a layout has up to four bars at two edges. Here it has three named sections, with the rail and the row each at an edge of choice. Is that enough freedom, or are more than one rail or row wanted?
2. **Moving controls.** Inside a section a control is dragged; to another section it goes by the menu. Should dragging work across sections, and directly in the preview?
3. **Per layout or per account.** Lens names can be fixed for a layout or follow the account. The collection's name prompt and the folder are account matters. Right this way round?
4. **Devices: the phone's own entry.** A phone's panel shows its tabs and its camera layout. Should both be changeable from the Studio, or only on the device?
5. **Flows** are shown in low fidelity, as the app exists today and nothing about it was reconsidered. Is a full round on the flow editor wanted in this workshop, or is "carried over in the new design" enough for the plan?
6. **The live picture** of a transmitter sits in its device panel. Where else should it show: in the phone's camera as a control, in a window of its own in the Studio?

## Not prototyped

The phone's Proxy screen, pairing an Aputure mesh, effects with their options, the power overview, dimming curves, editing the steps of a flow, device specs read out again, a layout laid out for a device it was not designed for.

## Into the design system

Nothing yet. Candidates: the phone-link pill, the battery bar, the device tile.
