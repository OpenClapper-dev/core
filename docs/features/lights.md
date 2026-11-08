# Lights

Control film lights and read a battery from the phone, so one app drives every fixture on set and, later, keyframed sequences can drive them together (epic [#206](https://github.com/OpenClapper-dev/core/issues/206)). Setup → **Lights** pairs and lists them.

First fixtures:

| Kind | How it is reached | Can do |
| --- | --- | --- |
| NEEWER FS230B, FS300B | Bluetooth LE, its own connection (GATT) | Power, intensity, white 2700–6500 K, dimming curves; green/magenta on the FS300B |
| NEEWER PS099S (V-mount battery) | Bluetooth LE, its own connection | Charge, volts, current, watts, estimated time left (read-only) |
| Aputure MC | Bluetooth Mesh the phone provisions (one connection per network) | Power, intensity, white 3200–6500 K, colour; reports its state and its built-in battery; dimming curve; 9 built-in effects |

**Status:** pairing, the synced list and the connection manager (#208), control of the NEEWER FS230B and FS300B (#209), the PS099S battery readout (#210), and Aputure MCs over the phone's own mesh (#211–#213), with their battery (#293), effects (#291) and dimming curve (#289), are built. The MC's device-side fade (Program Continue, see below) is not used yet.

## Kinds (`packages/vocab/src/lighting.ts`)

`FIXTURE_KINDS` lists every supported model with its transport, its driver id and its capabilities (power, intensity, white range with green/magenta, colour, dimming curves, telemetry). Hardcoded on purpose: a new model is one entry there and, when its protocol is new, one driver on the phone. Kind ids are stored with each fixture and never change. `CURVES` are the four dimming curves both makers' apps offer (linear, exponential, logarithmic, S); the sequence editor will use them as easing too.

## On the phone (`apps/mobile/src/fixtures/`, `src/ble/`)

- **`types.ts`**: `Fixture` (label, kind, Bluetooth address, mesh address once provisioned), `Command` (power, intensity, white, colour, curve, status, in normalised units), `Telemetry`, and the three seams a driver plugs into: `Link` (one open connection), `Driver` (how a family is reached: which connection serves a fixture, the pause between writes, how to open a session) and `Session` (sends commands).
- **`registry.ts`**: drivers by id, and `suggestKinds`, which guesses the model from a scanned name or service: NEEWER lights advertise `NW-<model code>&…` (`20230051` is the FS230B; other codes fall back to every NEEWER kind), Aputure the mesh services. Only a guess: the person pairing confirms the model.
- **`hubCore.ts`**: the connection manager, free of React Native and unit-tested.
  - A screen (or, later, a running sequence) holds a **lease** on the fixtures it shows. Connections exist only while leased, and close 2 s after the last lease, so moving between screens does not reconnect.
  - A failed or lost connection retries after 1, 2, 5, 15, then every 30 s while it is still leased.
  - In the background every connection closes (Android stops Bluetooth work there); back in the foreground the leased ones reopen.
  - One fixture per Bluetooth address for NEEWER; one connection per mesh network for Aputure, shared by all its lights.
- **`queue.ts`**: the writes of one connection, one at a time with the driver's pause between them. A newer command of the same kind for the same fixture replaces a queued one and moves to the back: a slider drag sends only what the light can take, and the last thing asked is the last thing sent.
- **`hub.ts`**: the app's hub on the real Bluetooth stack, `useFixtureLease`, `useFixtureStatus`, `sendToFixture`.
- **`library.ts`**: the paired fixtures, kept on the phone and synced like the rigs (save locally, push, the server list wins; also on every flush of the upload queue).
- **`ble/link.ts`** is the only file that uses the Bluetooth library ([`@sfourdrinier/react-native-ble-plx`](https://github.com/sfourdrinier/react-native-ble-plx), a maintained fork for Expo SDK 57 / React Native 0.86). It asks for an MTU of 247 and gives up on a connection after 15 s. **`ble/permissions.ts`** asks for "Nearby devices" (Android 12+) or location (older Android).
- The manifest declares Bluetooth scanning as never used for location; the app's own location permission (GPS) is unchanged.

## NEEWER lights (`drivers/neewerInfinity.ts`, `codecs/neewer.ts`, #209)

Decoded from an HCI snoop of the NEEWER app driving an FS230B (#207); every captured frame was rebuilt byte for byte. Tested on an FS230B and an FS300B on 2026-10-23: every control, a fast drag and reconnecting.

- **Connection**: service `69400001-b5a3-f393-e0a9-e50e24dcca99`; commands are written without response to `…0002`, replies come as notifications on `…0003`. On connect the driver turns notifications on and replays the app's hello and its five queries.
- **Frame**: `78 <tag> <len> <MAC> <payload> <checksum>`; `len` counts the MAC and the payload, the checksum is the sum of every byte before it, the MAC is the light's own address.
- **Power**: tag `8d`, `81 01` on, `81 02` off. A light gets 150 ms after power-on before the next white frame.
- **Intensity, white and curve share one frame** (tag `90`, `87 <intensity 0–100> <kelvin/100> <green/magenta + 50> <curve> 00`). There is no intensity-only command, so the driver keeps each light's last values and always sends all three. Curve bytes: `1` exponential, `2` logarithmic, `3` S, `4` linear. The FS230B's app has no green/magenta control and always sends neutral (`50`); the FS300B gets a green/magenta slider on the same byte, −50..+50 (sent as +50), which follows the published NEEWER protocol (not captured, confirmed on the light).
- **Pace**: one write per 100 ms on a connection, as the app does while a slider moves; the queue coalesces faster input.
- The lights report their model in an info reply (an FS230B says "FS150B": same firmware), which goes to the debug log. They do not report their settings, so nothing is read back.

## NEEWER battery (`drivers/neewerBattery.ts`, `codecs/neewerBattery.ts`, #210)

Decoded from an HCI snoop of the NEEWER app reading a PS099S, with an FS300B at about 100 W as the load (#207).

- **Same service as the lights**, but the battery's own frames carry no address: `78 <tag> <len> <payload> <checksum>`.
- **On connect** the driver sends what the app sends: a short status query (`78 cd 01 01`), the lights' hello, and an info query (`78 80 00`, answered with the model name "PS099S").
- **Readout**: polled once a second with `78 cd 01 00`, as the app does. The reply is 85 bytes, split over several notifications when the connection's MTU is small; `FrameAssembler` joins them, and drops a partial reply that is still waiting at the next poll.
- **Fields**: charge % at offset 4, pack voltage in mV at 5–6 and current in mA at 7–8 (both big-endian), state at 10 (2 = feeding a load). Watts are volts × amps: the battery reports current, not power (101 W against the ~100 W load). The rest of the reply holds per-output voltages (5 V USB, 8 V, 12 V, the pack voltage on D-tap/BP), not shown yet.
- **Time left** is not in the data, so the phone estimates it (`fixtures/batteryEstimate.ts`): rated energy (`capacityWh`, 99 Wh for the PS099S) × charge ÷ power. The power is an exponential moving average over about 20 s, so a one-second dip does not swing it and a light ramping up settles gradually. No estimate while the battery is idle or under 2 W (it draws 0.7 W on its own). It assumes the full rated energy is usable, so near empty it is optimistic.
- The info reply's third byte is not its length, unlike every other frame; a notification that checks out on its own is taken as one frame.

## Bluetooth Mesh client (`fixtures/mesh/`, #211)

The Aputure lights are Bluetooth Mesh nodes (Telink firmware). The phone talks to them as a mesh client through one light acting as GATT proxy, so it carries the mesh stack itself. Pure TypeScript, no Bluetooth in it: provisioning (#212) and the light session (#213) put it on a connection. Every layer is tested against the Mesh Profile 1.0.1 §8 sample data.

- **`crypto.ts`**: AES-CMAC (from `@noble/ciphers`), `s1`, `k1`–`k4`, the beacon key, and AES-CCM built on AES-ECB (noble has no CCM; 13-byte nonce, 4- or 8-byte MIC).
- **`network.ts`**: network PDUs: header obfuscation, encryption with the NetKey, network or proxy nonce, the IV index's low bit. Twelve spec messages (#1–#11, #22) encode byte for byte and decode back.
- **`transport.ts`**: access messages encrypted with an AppKey (AKF 1 and its AID) or a node's device key; split into 12-byte segments above 15 bytes; reassembly in any order with the SeqAuth of the first segment; the Segment Acknowledgment. A Telink light command (1 + 10 bytes) stays in one PDU.
- **`access.ts`**: opcodes and the configuration messages provisioning needs: AppKey Add, Composition Data Get and its parsing, Model App Bind (every model except the configuration ones), their status.
- **`proxy.ts`**: proxy PDUs split to the connection's MTU and joined back; the proxy filter (accept list, then the phone's address), without which no reply reaches the phone; the Secure Network Beacon, authenticated, which tells the IV index.
- **`seq.ts`**: sequence numbers. A number used twice makes every light drop the phone silently as a replay, so they are reserved in blocks of 128 and the block is saved *before* its first number goes out; after a crash or a kill the phone resumes past the block.
- **`message.ts`**: an access message in, network PDUs out (one sequence number per segment); `Inbox` turns what the proxy forwards into access messages and answers segmented ones with an acknowledgment.
- **`session.ts`** (#212): one connection to a network through a proxy node. On start it reads the IV index from the proxy's beacon (and stores a change with the network), then sets the proxy filter to an accept list with the phone's address; then `send`, and `request`, which waits for the matching answer and repeats up to three times with fresh sequence numbers.
- **`provision.ts`** (#212): provisioning over PB-GATT (service `0x1827`): invite, capabilities, P-256 public keys, confirmation and random, then the network key, IV index and unicast address encrypted with the session key. No OOB authentication (the lights offer none); algorithm 0 (P-256 with CMAC). The whole exchange reproduces the specification's provisioning sample data byte for byte.
- **`configure.ts`** (#212): reads the light's composition data, adds the AppKey and binds it to every model except the configuration ones, all with the light's device key. Safe to repeat.

## Pairing an Aputure light (`fixtures/provisionFlow.ts`, `fixtures/meshNetworks.ts`, #212)

The phone is the provisioner of its own mesh network, so a light paired here leaves Sidus Link: to use it there again, reset it and add it in Sidus Link.

- **Before pairing**, take the light out of Sidus Link: remove it in the app (the light's settings → remove), or reset it on the light (see its manual). A light still in another network advertises the proxy service instead of the provisioning service, and the phone says so instead of trying.
- **One network per phone**, made on the first pairing: a random NetKey and AppKey, the phone at address `0x0001`, lights from `0x0002` on. Its record (name, IV index, next free address) syncs to the server like the fixtures (`/api/mesh-networks`); the keys and every light's device key stay in the phone's secure store (`openclapper.mesh.<networkId>`, scoped per server). A light paired on another phone shows there as "paired on another phone".
- **Pair** (a light's screen → Pair with OpenClapper): find the light (10 s scan), provision it, store its device key *first*, then its address with the fixture, wait for it to restart as a proxy, reconnect, configure. Each step is shown; the debug log has the details.
- **Resumable**: if the configuration does not finish (out of range, the app closed), the light's screen offers **Finish setup**, which only reconnects and configures. A paired light offers **Run setup again** (the same, safe to repeat) and **Pair again** (after a reset: a fresh provisioning at a new address).
- **Addresses**: a light takes one unicast address per element (an MC has 3). Setup compares the element count from provisioning with the composition data, keeps the real one, and refuses when the light's addresses overlap another light's (`fixtures/meshAddress.ts`); the light's screen warns about an overlap too.
- **What an MC is made of** (composition data, company 0x0131, product 0x300b): element 0 with the configuration and health servers, generic on/off, level, power on/off and default transition time, scenes, scheduler, time, light lightness and CTL, plus a vendor model 0x03F4:0x1000; elements 1 and 2 with generic level and the CTL temperature and HSL hue/saturation servers. Not every MC is the same: one of the owner's MCs reports a single element (other firmware), so a light's element count comes from its own data, never from the model. The Telink light commands (0x26) go to the primary element (#213).
- If provisioning breaks off after the network key went out but before the light confirmed, the light may hold the keys while the phone has no device key for it: reset it and pair again.

## Key backup and one phone at a time (`fixtures/keyBackup.ts`, `fixtures/keySeal.ts`, #303)

Without the keys, a lost or reset phone (or a reinstall) means resetting every Aputure light by hand. Setup → Lights → **Key backup**:

- **Recovery passphrase** (at least 12 characters), set once. The phone keeps only the key derived from it (scrypt, 2^15 × 8, in the secure store), never the passphrase. Every change to a network's keys (a new network, a paired light) is sealed with it (AES-GCM, the network id as associated data) and stored on the server (`/api/mesh-networks/:id/key-backup`), right away or on the next sync when offline. The server cannot open it.
- **Restore**: a phone without a network's keys but with a backup asks for the passphrase, opens the backup, and **claims** the network: it becomes the network's `holder`.
- **One phone at a time**: every phone sends from the same mesh address `0x0001` (the lights report to it), so two phones at once would collide on sequence numbers and the lights would drop one of them. The server refuses writes naming another holder (409); a phone that learns this on its next sync keeps its keys but stops controlling the network ("In use on another phone"), until it takes it back with **Use this phone again** (a claim the other way).
- **Sequence numbers**: the holder pushes how far it has counted (`seq_floor`) every 4096 numbers while online. A claim starts 2^20 above the higher of that floor and its own counter, to cover what the old phone used offline since. A network has 2^24 numbers before it needs an IV index update, which is not built (see #304).
- No transfer between installs: each app (Dev, staging, production) has its own network; a light belongs to one and is reset and paired again to move (owner's decision on #303).

## Aputure lights (`drivers/sidusMesh.ts`, `codecs/sidus.ts`, #213)

- **One connection per network**: the hub's link for every paired MC of a network is the same mesh session, through whichever light it reaches first; that light relays to the others. Unpaired MCs cannot be the proxy.
- **Commands** are Telink access messages (opcode `0x26`, 10-byte payload: checksum, bit-packed fields, command type) to the light's primary address with the network's application key: power (`0x8c`), intensity 0–1000 (`0x8f`), white (`0x82`; its green/magenta field is sent neutral, the MC has no such control), colour with hue and saturation (`0x81`). Layout from wesbos/amaran-BLE-control (MIT); the encoder is checked against vectors produced by that implementation.
- **Unacknowledged**, so each command goes out twice, 40 ms apart; one write per 120 ms per network, newer values replacing queued ones.
- **The light reports its state**: on connect the driver asks every light of the network (`0x0e`), and each report (`0x02` white, `0x01` colour) becomes the light's state, so the controls show what the light really shows. The lights also report after changes, to the provisioner, which is the phone; while a slider moves, those reports trail behind. So the hub ignores a light's reports for 1.5 s after the phone last sent it a command (`REPORT_HOLD_MS`), or a late report would pull the control back to a value already left.
- **Reaction time** (owner's test on MC 1 and MC 3): the lights follow fast changes, but not instantly. Before the keyframe editor, measure how long a light takes to settle on a new value, per kind, and plan keyframe spacing around it.
- **Built-in effects** (#291): the MC offers 9 of the 15 first-generation effects (Paparazzi, Lightning, TV, Fire, Pulsing, Faulty bulb, Cop car, Party lights, Fireworks; tested on the owner's MCs), with Sidus Link's default settings. The codec knows all 15 (Club lights, Candle, Strobe, Explosion, Welding and Color chase too), for other models: command `0x87`, the effect's code in byte 8, the default fields, intensity at bit 46 or 54, run bit 8; stop is code 15 (`96000000000000000f87`). From neyako/amaran-hacs (MIT), which took them from the decompiled Sidus Link app and confirmed them on amaran lights; each encoding is checked against that table. Intensity changes re-send the running effect; white or colour ends it, as in the maker's app; stopping returns the light to white and the driver asks what it shows. A running effect also comes back in the light's reports. **Options** (#292, #300, from Sidus Link 2.0.42's own effect classes, with its names): every MC effect has its options on the screen while it runs, rendered from `EFFECT_OPTIONS` in `packages/vocab/src/lighting.ts`; the defaults are the app's presets, which reproduce the amaran-hacs presets byte for byte (an independent check of the layouts).

| Effect | Options | Layout (bit: field) |
| --- | --- | --- |
| Faulty bulb, Pulsing | White (colour temperature) or Colour (hue, saturation); Frequency, Speed 1–10 or Random | intensity 46, frequency 56, colour mode 60 (0 white, 1 colour); white: temperature flag 20, speed 23, trigger 27, green/magenta 29 (neutral), kelvin/10 at 36; colour: speed 24, trigger 28, saturation 30, hue 37 |
| Paparazzi | White; Frequency 1–10 | temperature flag 30, green/magenta 33, kelvin/10 at 40, frequency 50, intensity 54 |
| Lightning | White; Frequency, Speed 1–10 or Random; **Strike now** | temperature flag 24, speed 27, trigger 31 (2 automatic, 1 one strike now, sent once), green/magenta 33, kelvin/10 at 40, frequency 50, intensity 54 |
| TV, Fire | Tone: Warmer, Natural, Cooler; Speed 1–10 or Random | tone 40, frequency 50, intensity 54 |
| Cop car | Colours: Red, Blue, Red + blue, Blue + white, Red + blue + white; Flash 1–5 and Cycle 1–5 | colours 46, flash 50, intensity 54 |
| Party lights | Saturation; Speed 1–10 or Random | saturation 43, frequency 50, intensity 54 |
| Fireworks | Kind: White, Colour, Multi; Frequency 1–10 or Random | kind 42, frequency 50, intensity 54 |

The tone and kind orders follow the app's resource names (`warmer_natural_cooler`, `white_color_multi`); the strings themselves were not in the decompiled output.
- **Built-in battery** (#293): on connect and then every minute the driver asks each light for its battery page (type `0x0a`): charge %, battery voltage, the light's own time left, and whether an external supply is connected (layout from neyako/amaran-hacs, MIT). It shows in the light's battery block; the power dashboard across all batteries is #294.
- **Firmware**: each light's composition data (maker, product, version, elements) is stored with its device key at setup and shown on its screen. The owner's MCs are not all on the same firmware (one reports one element, another three); nothing depends on it.
- **Dimming curve** (#289): its own command, type `0x08` (wire `0x88`), the curve in byte 8: 0 linear, 1 exponential, 2 logarithmic, 3 S. Found in Sidus Link 2.0.42, decompiled with Aputure's permission (the owner asked them); no Aputure code is in this repository, only the layout. Sidus Link offers it in white only, so the screen does too; the light does not report it back.
- **Fades in Sidus Link** (from the same source): its "Dimming Design" is **not** a device feature. The app runs a 100 ms timer and sends an ordinary white or colour command with the interpolated intensity each tick, i.e. what our sequence engine will do. The one device-side fade is the "Program → Continue" effect (type `0x15`, wire `0x95`): fade-in curve and time, hold time, fade-out curve and time (tenths of a second, 8 bits each for the fades, 10 bits for the hold, 1023 = hold forever), one intensity with a white or colour setting. Not used yet; a candidate for the sequence editor.

## Screens (`apps/mobile/src/screens/Lights.tsx`)

- **Lights** (Setup → Lights): every fixture with its model and sync state. Tap opens it, long press edits it, **Add light** pairs a new one.
- **Add light**: scans for 10 s (Scan again repeats). Likely fixtures come first, with the model they look like; devices already paired are greyed out. Pick one, confirm the model, name it (default: the model and a number), **Pair**.
- **Edit light**: name and model; delete (only from the phone and the server; the light itself is not changed).
- **A battery**: its connection state, then charge %, voltage, current, power, whether it feeds a load and the estimated time left, updated every second; a reading older than 5 s shows its age. An Aputure light shows its built-in battery the same way (charge, voltage, power source, its own time left), updated every minute.
- **A light**: its connection state, held open while the screen is shown, and the controls its model has: power, intensity, an Effect picker and White/Colour with hue and saturation (Aputure), white, green/magenta, dimming curve (NEEWER). Sliders drag or step with − and + (1 % and 100 K). Until the phone has set a value they show the shared start values (half intensity, the middle of the white range, linear), because the lights report nothing back. Controls are greyed out while not connected.

## On the server

`fixtures` and `mesh_networks` ([data model](../data-model.md#tables), [API](../api.md)) belong to a workspace and are shared by its projects, like rigs. Pairing is checked strictly: the kind must be known, the address must look like one, mesh fields only on a mesh kind and only with a network of the same workspace. **Mesh keys are never sent to the server**: they stay in the phone's secure store, so a mesh light synced to a second phone cannot be controlled there until keys can be moved between phones.

## Not done

- The Aputure's native dimming curve and fade (see Status above).
- Removing a light from the phone's network over the mesh (Config Node Reset): deleting a fixture leaves the light in the network until it is reset.
- More than one mesh network per phone, and moving keys to another phone.
- The battery's per-output voltages.
- Reading a light's current settings: the NEEWER lights answer queries, but what the replies mean is not decoded.
- The keyframed sequence editor (a later epic): it will hold leases as `"sequence"` and send through the same queues.
- Sequences in the background: Android stops Bluetooth work there, so a running sequence will need the screen on.
- Deleting a fixture while offline: it comes back with the next sync (the rigs behave the same).
