# U6 · Devices, layouts, extensions

UX workshop [#362](https://github.com/OpenClapper-dev/core/issues/362) ([plan](ux-plan.md)). Status: **in progress** (round 3, 2026-11-23).

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
| **Flows** | A list of flows and an editor (rebuilt in round 3) |

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

## Round 3 (2026-11-23)

| Change | What to try |
| --- | --- |
| **Bars over the picture** | Any bar can be switched to "Over the picture": it lies on the camera's picture at its edge and takes no room from it. Switched off, the bar takes its room and the picture gets smaller |
| **Readouts are controls** | Each readout (project, lens in use, preset and focal length, angle of view, collection, folder, warnings) is a control that is added to a bar, moved and removed like the others. The built-in layouts start with a bar "Readouts" that lies over the picture. The switches in Look are gone |
| **Devices as cards** | One card per device across the full width: who it is, its connection in colour, its battery, and beside that everything it exposes, ready to use (a light's power, intensity, white, colour, effect or power source; a camera's record, ISO, shutter, timecode; a battery's output; a phone's tabs and layout) |
| **Devices as a table** | A real table: name, type (a coloured tag), model, connection (a coloured mark), battery (a bar), power |
| **The flow editor** | Rebuilt as one component for the Studio and for the phone or tablet, following today's sequences: tracks of a device type with an assigned device, colour and mute; a start keyframe that stays at 0; keyframes that hold power, intensity, white or colour and an effect; the strip under a gap that makes it a fade with a curve; markers as points or ranges; the views intensity graph, light colour and value labels; Select and Insert modes (V, I); Space, M, Delete; loop and live |
| **Flows on the phone and tablet** | "On the phone", Flows: the same editor in a touch form, on the same flows as the Studio. A flow can be made, changed and played there. The switch at the right draws a tablet instead of a phone |
| **Hardware on the phone as a table and as cards** | "On the phone", Hardware: a table (device, type as a coloured tag, connection as a coloured mark, battery as a bar); a tap on a row opens the device's own screen with its controls. The switch at the top shows cards instead: one per device across the width with its controls, to use without opening it. The transmitter's card and screen show its picture |
| **A thumb to take hold of** | The playhead of a flow and of the timeline ([U4](ux-4-timeline.md)) has a larger thumb with the grabbing hand; the ruler shows the pointing hand, not the text cursor |

## Decided so far

2026-11-23, by the owner:

- **A camera layout is a set of free bars** at the four edges, per orientation: any number, stackable, each with its controls in order and a distribution. No named sections.
- **Controls are moved by dragging,** in the preview and in the list, within a bar and across bars.
- **A stepped control (carousel) has separate, full-size back and on buttons,** stacked in an upright bar.
- **Readouts on the picture are separate tags,** not one line of text.
- **Lens names can be fixed per layout or follow the account;** the collection's name prompt and the folder for new photos are account matters.
- **Whatever can be set on a phone or tablet can be set from the Studio,** and the other way round: tabs and camera layout to begin with.
- **Any bar can lie over the picture** instead of taking room from it. **Readouts are controls** placed in bars; by default they sit in a bar over the picture.
- **No device profiles.** The setup lives on the device and is editable from both sides; "Take the setup of another device" covers reuse.
- **Devices has two views:** cards across the full width that expose a device's controls, and a table. State is shown in colour, not as text alone.
- **Flows is made, changed and played on the phone and tablet as in the Studio:** one editor, the same flows. Its logic is today's.
- **The prototypes show the design, not the feature list.** What today's app can do stays unless a workshop page says it goes: every control and state the written device drivers offer (Aputure MC, NEEWER FS230B and FS300B, PS099S, the Blackmagic camera, the Hollyland transmitter), and everything today's sequences can do (multi-selection, box selection, keyframe sizes, native and stepped fades, smoothing, track markers, run on phone and the rest of [lights](../features/lights.md)). The build takes its inventory from the current code and docs, in [workshop 10](README.md).
- **A part of a device can be limited to where it works.** A video transmitter's picture is shown on the phone only; its state shows everywhere. The catalogue declares such limits per model.
- **Hardware and Flows are apps on the phone and tablet too** and can be tabs.

## Not prototyped

Pairing an Aputure mesh, effects with their options, dimming curves, device specs read out again, a layout laid out for a device it was not designed for; in the flow editor: selecting several, the box selection, keyframe sizes, markers on one track, ranges drawn by dragging, the native and stepped fades, run on phone as a state.

## Into the design system

Nothing yet. Candidates: the phone-link pill, the battery bar, the device tile.
