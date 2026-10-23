# Lights

Control film lights and read a battery from the phone, so one app drives every fixture on set and, later, keyframed sequences can drive them together (epic [#206](https://github.com/OpenClapper-dev/core/issues/206)). Setup → **Lights** pairs and lists them.

First fixtures:

| Kind | How it is reached | Can do |
| --- | --- | --- |
| NEEWER FS230B, FS300B | Bluetooth LE, its own connection (GATT) | Power, intensity, white 2700–6500 K, dimming curves |
| NEEWER PS099S (V-mount battery) | Bluetooth LE, its own connection | Charge, volts, watts, time left (read-only) |
| Aputure MC | Bluetooth Mesh the phone provisions (one connection per network) | Power, intensity, white 3200–6500 K + green/magenta, colour, dimming curves |

**Status (#208):** pairing, the synced list, the connection manager and the screens are built. No driver is built yet, so no fixture can be controlled: a light's screen says "the controls for this model are not built yet". The protocols come in [#209](https://github.com/OpenClapper-dev/core/issues/209) (NEEWER lights), [#210](https://github.com/OpenClapper-dev/core/issues/210) (battery), [#211](https://github.com/OpenClapper-dev/core/issues/211)–[#213](https://github.com/OpenClapper-dev/core/issues/213) (mesh and Aputure).

## Kinds (`packages/vocab/src/lighting.ts`)

`FIXTURE_KINDS` lists every supported model with its transport, its driver id and its capabilities (power, intensity, white range with green/magenta, colour, dimming curves, telemetry). Hardcoded on purpose: a new model is one entry there and, when its protocol is new, one driver on the phone. Kind ids are stored with each fixture and never change. `CURVES` are the four dimming curves both makers' apps offer (linear, exponential, logarithmic, S); the sequence editor will use them as easing too.

## On the phone (`apps/mobile/src/fixtures/`, `src/ble/`)

- **`types.ts`**: `Fixture` (label, kind, Bluetooth address, mesh address once provisioned), `Command` (power, intensity, white, colour, curve, status, in normalised units), `Telemetry`, and the three seams a driver plugs into: `Link` (one open connection), `Driver` (how a family is reached: which connection serves a fixture, the pause between writes, how to open a session) and `Session` (sends commands).
- **`registry.ts`**: drivers by id (empty until #209), and `suggestKinds`, which guesses the model from a scanned name or service (NEEWER's service or name, the mesh services for Aputure). Only a guess: the person pairing confirms the model.
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

## Screens (`apps/mobile/src/screens/Lights.tsx`)

- **Lights** (Setup → Lights): every fixture with its model and sync state. Tap opens it, long press edits it, **Add light** pairs a new one.
- **Add light**: scans for 10 s (Scan again repeats). Likely fixtures come first, with the model they look like; devices already paired are greyed out. Pick one, confirm the model, name it (default: the model and a number), **Pair**.
- **Edit light**: name and model; delete (only from the phone and the server; the light itself is not changed).
- **A light**: its connection state, held open while the screen is shown, and what the model can do. The controls arrive with each driver.

## On the server

`fixtures` and `mesh_networks` ([data model](../data-model.md#tables), [API](../api.md)) belong to a workspace and are shared by its projects, like rigs. Pairing is checked strictly: the kind must be known, the address must look like one, mesh fields only on a mesh kind and only with a network of the same workspace. **Mesh keys are never sent to the server**: they stay in the phone's secure store, so a mesh light synced to a second phone cannot be controlled there until keys can be moved between phones.

## Not done

- Every driver (see Status above).
- The keyframed sequence editor (a later epic): it will hold leases as `"sequence"` and send through the same queues.
- Sequences in the background: Android stops Bluetooth work there, so a running sequence will need the screen on.
- Deleting a fixture while offline: it comes back with the next sync (the rigs behave the same).
