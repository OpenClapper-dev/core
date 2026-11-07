# Lights

Control film lights and read a battery from the phone, so one app drives every fixture on set and, later, keyframed sequences can drive them together (epic [#206](https://github.com/OpenClapper-dev/core/issues/206)). Setup → **Lights** pairs and lists them.

First fixtures:

| Kind | How it is reached | Can do |
| --- | --- | --- |
| NEEWER FS230B, FS300B | Bluetooth LE, its own connection (GATT) | Power, intensity, white 2700–6500 K, dimming curves; green/magenta on the FS300B |
| NEEWER PS099S (V-mount battery) | Bluetooth LE, its own connection | Charge, volts, current, watts, estimated time left (read-only) |
| Aputure MC | Bluetooth Mesh the phone provisions (one connection per network) | Power, intensity, white 3200–6500 K + green/magenta, colour, dimming curves |

**Status:** pairing, the synced list and the connection manager (#208), control of the NEEWER FS230B and FS300B (#209) and the PS099S battery readout (#210) are built. Aputure over the mesh ([#211](https://github.com/OpenClapper-dev/core/issues/211)–[#213](https://github.com/OpenClapper-dev/core/issues/213)) is not: its screen says "the controls for this model are not built yet".

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

## Screens (`apps/mobile/src/screens/Lights.tsx`)

- **Lights** (Setup → Lights): every fixture with its model and sync state. Tap opens it, long press edits it, **Add light** pairs a new one.
- **Add light**: scans for 10 s (Scan again repeats). Likely fixtures come first, with the model they look like; devices already paired are greyed out. Pick one, confirm the model, name it (default: the model and a number), **Pair**.
- **Edit light**: name and model; delete (only from the phone and the server; the light itself is not changed).
- **A battery**: its connection state, then charge %, voltage, current, power, whether it feeds a load and the estimated time left, updated every second; a reading older than 5 s shows its age.
- **A light**: its connection state, held open while the screen is shown, and the controls its model has: power, intensity, white, green/magenta, dimming curve. Sliders drag or step with − and + (1 % and 100 K). Until the phone has set a value they show the shared start values (half intensity, the middle of the white range, linear), because the lights report nothing back. Controls are greyed out while not connected.

## On the server

`fixtures` and `mesh_networks` ([data model](../data-model.md#tables), [API](../api.md)) belong to a workspace and are shared by its projects, like rigs. Pairing is checked strictly: the kind must be known, the address must look like one, mesh fields only on a mesh kind and only with a network of the same workspace. **Mesh keys are never sent to the server**: they stay in the phone's secure store, so a mesh light synced to a second phone cannot be controlled there until keys can be moved between phones.

## Not done

- The Aputure driver (see Status above).
- The battery's per-output voltages.
- Reading a light's current settings: the NEEWER lights answer queries, but what the replies mean is not decoded.
- The keyframed sequence editor (a later epic): it will hold leases as `"sequence"` and send through the same queues.
- Sequences in the background: Android stops Bluetooth work there, so a running sequence will need the screen on.
- Deleting a fixture while offline: it comes back with the next sync (the rigs behave the same).
