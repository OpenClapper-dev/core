# Hardware

The Hardware extension ([extensions](extensions.md)), rebuild step B9 ([#381](https://github.com/OpenClapper-dev/core/issues/381)); the model is [08 · Extensions](../rewrite/08-extensions.md), the design [U6](../rewrite/ux-6-devices.md). Lights, a battery, a camera and a video transmitter join the account's device registry beside its phones and tablets; the phone pairs them and holds their connections, the Studio and the phone control them.

The drivers and protocols are unchanged from the first app: [lights](lights.md) (NEEWER, Aputure mesh, the battery), [cameras](cameras.md) (Blackmagic), [live picture](live-picture.md) (Hollyland).

## The catalogue (`packages/ext-hardware/src/catalogue.ts`)

Brand → model → type. Each model declares what it exposes, as data, so the Studio and the phone draw the same controls (owner's decision 2026-11-24):

| Model | Type | Reached | Controls | State | Feeds | Relations |
| --- | --- | --- | --- | --- | --- | --- |
| Aputure MC | Light | Bluetooth Mesh (the phone's network) | Power, intensity, white 3200–6500 K, colour, 9 effects with options, Lightning's strike, dimming curve | Charge, time left, voltage, on external power | | Its own battery |
| NEEWER FS230B | Light (COB) | Bluetooth | Power, intensity, white 2700–6500 K, 12 effects with options, dimming curve, smooth changes | | | Runs on a socket or a battery |
| NEEWER FS300B | Light (COB) | Bluetooth | As the FS230B, plus green/magenta | | | Runs on a socket or a battery |
| NEEWER PS099S | Battery | Bluetooth | | Charge, time left (estimated), voltage, current, output, feeding a load | | Powers one light |
| Blackmagic Pocket Cinema Camera 6K | Camera | Bluetooth | Record, still; exposure; white balance; lens; image and codec; monitoring per output; colour correction; audio; slate; tally (every control of the first app's panel) | Recording, timecode, protocol, every reported parameter, the incoming log | | |
| Hollyland Mars 400S Pro | Video transmitter | The phone joins its Wi-Fi | | Picture running | Picture, **on the phone only** | |

A control is one of: switch, range, choice (a list or segments), number, text, button; three are drawn by hand on each client because they are more than one value: a light's colour, its effects with their options, and the camera's monitoring per output. Each control binds to the device's live state and to a command (`controlValue`, `controlCommand`), shared so both clients send the same: a light's white keeps its green/magenta, a camera parameter keeps the other values it carries (white balance with tint), switches on a bit field flip one bit.

A part limited to where it works (`where: "phone"`) is shown only there; the transmitter's state shows everywhere.

## Devices (`packages/ext-hardware/src/device.ts`)

A piece of hardware is a **device file of the account home** (hardware follows its owner) whose kind is a hardware type; the extension registers the kinds with the rules for their bodies (`registerDeviceKind`). It replaces the first app's workspace "fixtures"; nothing of them is carried over (pair again).

| Body | Meaning |
| --- | --- |
| `kind` | light, battery, camera, transmitter: the model's type |
| `model` | The catalogue model's id |
| `address` | Its Bluetooth address; null for the transmitter |
| `mesh` | `{ network, unicast, elements }` once paired into the phone's mesh (Aputure), else null |
| `poweredBy` | The battery a COB light runs on; null: a socket |
| `asleep` | The phone does not connect to it until woken |

The general file route renames a device and puts it to sleep; it keeps the kind, model, address, mesh place and battery as stored (`guarded`), which only the extension's routes set, because they keep rules across devices: one battery powers one light, one unicast address per network. A battery that is binned leaves its light pointing at it; the light shows as on a socket.

## Mesh networks

The phone provisions Aputure lights into a Bluetooth Mesh network of its own; the keys stay on the phone. The extension's own table `hw_mesh_networks` (per account) keeps the network's counters, which phone sends in it (`holder`: one at a time, or sequence numbers repeat and lights drop them), the sequence floor, and a **key backup** the phone sealed with a passphrase (scrypt + AES-GCM, `keySeal.ts`), which the server cannot read.

## The phone link channel `hardware` (`packages/ext-hardware/src/protocol.ts`)

The core's phone link carries the channel unread. Requests (to the proxy phone): `command { device, command }`, `hello`, `sync`, `reconnect`, `scan { on }`, `provision { device, fresh? }`; the phone checks each (`parseHardwareRequest`). Reports: `state { phone, proxy, devices }` (link, telemetry and light state per device), `scan.state`, `provision.state`. A change made on one client holds back the device's reports for 1.5 s, so a slider does not jump back.

## In the Studio (`apps/studio/src/ext/hardware/`)

The Devices app is the core's (`apps/studio/src/apps/DevicesApp.tsx`); the extension registers how its kinds show (`registerDeviceView` in `apps/studio/src/devices.ts`) and its phone app as a tab a phone can take (`registerPhoneTab`). With the extension off, its devices are left out and a line says how many need it.

- **Cards** (`DeviceCard` of the design system): the type's icon and colour, name and model, the connection as a coloured mark (`ConnectionMark`), the charge as a bar (`BatteryBar`; a COB light shows the battery it runs on), and the first group of controls ready to use; a camera shows its timecode; a battery what it powers; the transmitter that its picture is on the phone only. The "…" menu: Open, Sleep or Wake, Remove.
- **A device's panel** (a click on its name): every control by group (the camera's Lens, Image and codec, Colour correction, Audio, Slate and Tally start folded, as before), its readings, for the camera every reported parameter and the incoming log, a mesh light's pairing with its steps, what it runs on (a socket or a battery; a battery taken from another light says so), rename, sleep, remove.
- **Table**: name, type, model, connection, battery, and the power source or what it powers (for a phone: its camera layout).
- **Toolbar**: the proxy pill (which phone holds the connections, or none), Reconnect all, **Add a device**: what the proxy phone finds (likely model first) beside the catalogue of supported hardware; the transmitter is added from the catalogue. After adding, the phone is told to read the list again, and an Aputure light is paired.
- **Commands** go on the link's `hardware` channel; slider drags are thinned to one command per device and op every 60 ms (the last value always goes). A value set here shows at once and wins over the device's reports for 1.5 s.

## On the phone (`apps/mobile/src/ext/hardware/`)

The app **Hardware** (a tab like any other while the project has the extension on):

- **The proxy switch** "This phone holds the connections": while on (and the app in front, screen kept awake; Android stops Bluetooth in the background), the phone holds every awake device and runs what comes on the `hardware` channel, from the Studio, the account's other phones, and its own screens. It reports every device at most every 200 ms. Its subtitle says how many Studio tabs are attached. A phone with the switch off controls through the phone that has it on, like the Studio.
- **Table or cards** (kept on the phone): a row per device with its type as a coloured tag, its connection as a coloured mark, its charge as a bar (a COB light shows the battery it runs on); a card shows the first controls ready to use. A tap opens the device.
- **A device's screen**: every control of its model by group, drawn from the catalogue (switches, sliders, choices, numbers, text, buttons; the colour, the effects with their options, the camera's outputs), its reported values (for the camera every parameter and the incoming log), a mesh light's pairing (Pair with OpenClapper, Run setup again, Pair again after a reset), what it runs on or powers, sleep and wake, rename, remove. A transmitter's screen shows its **picture** (`ui/Picture.tsx` on the native `modules/video-link`, Android only).
- **Add a device**: the proxy phone scans for 10 s; the list shows what it found, likely models first; pick the model, name it. An Aputure light is then paired into the phone's network (needs a connection: its address is stored as it is paired). The transmitter is added from the catalogue, without a scan.
- **Key backup** (header): the recovery passphrase (at least 12 characters) and per network: backed up, in use on another phone (take it back), not on this phone (restore with the passphrase).
- **Sync** (a step after the upload queue): mesh networks, then the devices, then the sealed keys of anything paired offline.

Kept from the first app (`hub.ts`, `bt/hubCore.ts`): one connection attempt at a time, only to devices seen advertising (a presence scan runs while one is missing), retries after 1, 2, 5, 15, 30 s, links closed in the background and reopened in front, Reconnect all.

## The camera control

A camera layout can place **Hardware** (`registerCameraControl`). On the phone it opens the device cards over the camera (`ui/CameraSheet.tsx`): set a light or start the camera's recording without leaving it; a card opens the device's full screen. When no phone holds the connections, this one does while the sheet is open.

## On the server

Routes in `apps/worker/src/ext/hardware/routes.ts` ([api](../api.md), "Hardware"); table `hw_mesh_networks` (migration `0009_hardware.sql`).
