# Lights

Control film lights and read a battery from the phone, so one app drives every fixture on set and, later, keyframed sequences can drive them together (epic [#206](https://github.com/OpenClapper-dev/core/issues/206)). Setup → **Lights** pairs and lists them.

First fixtures:

| Kind | How it is reached | Can do |
| --- | --- | --- |
| NEEWER FS230B, FS300B | Bluetooth LE, its own connection (GATT) | Power, intensity, white 2700–6500 K, dimming curves; green/magenta on the FS300B |
| NEEWER PS099S (V-mount battery) | Bluetooth LE, its own connection | Charge, volts, current, watts, estimated time left (read-only) |
| Aputure MC | Bluetooth Mesh the phone provisions (one connection per network) | Power, intensity, white 3200–6500 K, colour; reports its state and its built-in battery; dimming curve; 9 built-in effects |

**Status:** pairing, the synced list and the connection manager (#208), control of the NEEWER FS230B and FS300B (#209), the PS099S battery readout (#210), and Aputure MCs over the phone's own mesh (#211–#213), with their battery (#293), effects (#291) and dimming curve (#289), are built. The MC's device-side fade (Program Continue, see below) is not used yet.

## The phone as proxy, Studio Devices (#307)

The phone keeps the Bluetooth connections and runs the drivers; the controls live in the Studio. Controlling lights on a phone is awkward, and the sequence editor (#304) will use the same path.

- **Phone, Setup → Proxy** (`screens/Proxy.tsx`, `fixtures/proxy.ts`): while this screen is open (screen kept on; Android stops Bluetooth in the background), the phone holds every paired fixture (hub holder `proxy`) and runs what the Studio sends. It reports every fixture's link, state and telemetry, at most every 200 ms, and shows read-only whether a Studio tab is attached and what it is connected to.
- **Transport**: the per-user phone room of the layout preview (`apps/worker/src/preview.ts`) relays `lights.*` messages; nothing is stored. The wire format is in `packages/vocab/src/lightProxy.ts`: `LightCommand`, `FixtureLive`, `ProxyState`, and `parseLightCommand`, which the room and the phone both apply. Expect the relay to add roughly 50–150 ms to a light's own reaction time.
- **Studio, Devices app** (`apps/studio/src/apps/DevicesApp.tsx`, `lightProxy.ts`): the integrations by brand (Aputure, NEEWER, and Hollyland as phone-only), each paired fixture with its live link and battery, and a panel with every control its kind has: power, intensity, white + G/M, colour, dimming curve, effects with their options and Lightning's strike, and the battery readout. Slider drags are thinned to one command per op every 60 ms (the last value always goes), then coalesced again by the phone's queue. After a change made here, the light's reports are ignored for 1.5 s, like on the phone.
- **Pairing from the Studio**: Devices → **Add device** asks the proxy to scan (10 s; `lights.scan`), and the phone's results show live (`lights.scan.state`). Pick one, confirm the model (the likely ones first), name it. The Studio stores the fixture through `/api/fixtures` and tells the phone to re-read the list (`lights.sync`). A NEEWER device needs nothing more: the proxy connects. An Aputure light is then provisioned by the phone (`lights.provision`, the same flow as on the phone, #212), with each step reported (`lights.provision.state`). Meanwhile the proxy lets go of every connection, because the light needs the radio to itself, and takes them back after. A light's panel offers **Pair with OpenClapper**, **Run setup again** and **Pair again** (after a reset), plus rename and delete.
- **One proxy at a time**: the phone holding the mesh keys (#303). The phone's own control and pairing screens are gone (step 3).

## Sequences (#304)

Keyframed light sequences, edited and played in the Studio (app **Sequences**, `apps/studio/src/apps/SequencesApp.tsx`) through the phone proxy. The model is in `packages/vocab/src/lightSequence.ts` (tested).

- **Tracks**: as many as wanted, each of one light type (a fixture kind: MC, FS230B, FS300B) and with a name. Assigning a real light is a separate step (the light picker on the track); a light can drive one track of a sequence, and an unassigned track does not play. The bulb button **mutes** a track: it is left out of playback and Live until unmuted (the light keeps what it last got).
- **Start keyframe**: every track has one at 0 s, drawn as a square, that cannot be moved or deleted and always sets power, intensity and white or colour, so a sequence never starts from whatever the light showed before.
- **Keyframes hold values and jump**: between two keyframes the light keeps the first one's values and jumps at the second. A keyframe sets any of power, intensity, white (K, G/M), colour (hue, saturation), effect, dimming curve; unset ones keep what came before.
- **Fade tiles**: the strip under the gap between two keyframes; a click turns it into a fade (and selects it: Jump or Fade, and the curve: Linear, Expo, Log, S). Everything that differs between the two keyframes blends over the gap with that curve (hue the short way round); white ↔ colour cannot blend and switches at the end. Stored as the later keyframe's `fadeIn`.
- **Smoothing** (lights with `caps.smoothing`, NEEWER): during playback a track switches its light to instant changes at jumps and to smooth changes inside fade tiles (`inFade`), so jumps are sharp and stepped fades are softened by the light; Live (stopped) keeps it smooth.
- **Native fades** (lights with `caps.fade`, the MC; `nativeFades`, `nativeStep`): a fade tile is played as one fade inside the light (Program → Continue) to the far keyframe's values: one `fade` command when the tile begins, nothing else to that light until it ends; over 25.5 s, chained fades. A running effect means no fade. Other lights get the fade in steps every 0.1 s; on the MC a fade tile can be set to **Steps every 0.1 s** too (`fadeStepped`, dashed tile), to compare.
- **Editing**: click a lane to add a keyframe; Shift-click adds to or removes from the selection; drag a box over the lanes to select across tracks; drag a selected keyframe to move the whole selection (0.1 s steps; start keyframes stay); Delete or Backspace deletes it, Mod+A selects all, Esc clears; **Space** plays from the playhead and, pressed again, stops and returns to where play started (as in DaVinci Resolve), **K** stops where it is (`shortcuts.ts`, scope `sequences`). Drag the ruler or the playhead's thumb to scrub. The inspector on the right keeps its width whether something is selected or not, so the lanes never shift.
- **Playback**: every 100 ms the Studio samples each assigned track and sends only what changed. Play starts at the playhead; loop restarts at 0. **Live** (on by default) sends the state at the playhead while stopped. While a sequence plays, the Devices app locks its lights (`sequencePlayback.ts`).
- **Storage**: this browser only (`apps/studio/src/sequences.ts`, localStorage, key `openclapper.sequences.v2`; v1 test data is not carried over) while the model is still changing; it moves to the Worker once it settles.

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
- The lights report their model in an info reply (an FS230B says "FS150B": same firmware), which goes to the debug log.

From NEEWER 5.8.0 (decompiled from the owner's phone; facts only, no NEEWER code in the repo; #206). The app maps `NW-20230051` (FS230B) to type 55 and `20250003` (FS300B) to type 224, both with scene class 5:

- **State readback**: the hello's query `8e 85` is answered with tag `04`: `<?> <power 1 on / 2 off> <mode>`, then for mode 1 (white) intensity, kelvin/100, G/M + 50, curve, and for mode 3 (an effect) the effect id and its fields (`parseState`). The driver moves the controls to it, and asks again after every effect change.
- **Effects** (tag `91`, `8b <id> <fields…>`, `effectFrame`): twelve, in the app's order, with their fields (intensity 0–100, kelvin/100 clamped to 2700–6500 K, G/M sent as 50 because the app hides it, speed and sparks 1–10): Flash (1: intensity, white, speed), Paparazzi (2), Defective bulb (3), White flicker (6) and White pulse (8) (intensity, white, G/M, speed), Explosion (4: + sparks), Welding (5) and TV screen (15) (intensity range, white, G/M, speed), Candle (11: + sparks), White loop (13: intensity, white range, speed), Brightness loop (14: white mode, intensity range, white, speed), Fireworks (16: intensity, white kind, speed, sparks). Defaults as the app's: white 5500 K, speed 5, sparks 5, intensity range 0–50 %, white range 3200–5600 K. There is no "effect off": a white frame ends it, as in the app. While an effect runs, an intensity change re-sends it.
- **Smooth or instant changes** (command `smooth`, `caps.smoothing`): the FS series' white frame always fades a little, whatever NEEWER's smoothing switch (tag `d3`, `00`/`01`, which the app sends before its smooth and its blinking modes) says; the short white frame of the app's Music FX fades too (owner's tests, 2026-11-08). Effects switch hard, so **instant white is a constant White loop effect** from K to K at full speed (`instantWhiteFrame`): instant on both the FS230B and the FS300B. The FS300B's Effect Picker live command was instant as well but exists only there. The White loop has no green/magenta field, so instant white on the FS300B is neutral. The driver still sends `d3` with the switch, and a White loop the light reports while instant is not shown as an effect. Devices has a Smooth/Instant switch; sequences switch it by themselves (instant at jumps, smooth inside fade tiles and while scrubbing).
- Not used yet: the FS300B's device-side "Effect Picker" (a sequence of white points uploaded into one of ten slots and played by the light), its fan (`b4`, modes) and temperature readout (`b3`), and a scheduled power on/off (`d2`).

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
- **Pair** (Studio, Devices → a light → Pair with OpenClapper, or Add device): find the light (10 s scan), provision it, store its device key *first*, then its address with the fixture, wait for it to restart as a proxy, reconnect, configure. Each step is shown; the debug log has the details.
- **Resumable**: if the configuration does not finish (out of range, the app closed), the light's panel in the Studio offers **Run setup again**, which only reconnects and configures (safe to repeat), and **Pair again** (after a reset: a fresh provisioning at a new address).
- **Addresses**: a light takes one unicast address per element (an MC has 3). Setup compares the element count from provisioning with the composition data, keeps the real one, and refuses when the light's addresses overlap another light's (`fixtures/meshAddress.ts`).
- **What an MC is made of** (composition data, company 0x0131, product 0x300b): element 0 with the configuration and health servers, generic on/off, level, power on/off and default transition time, scenes, scheduler, time, light lightness and CTL, plus a vendor model 0x03F4:0x1000; elements 1 and 2 with generic level and the CTL temperature and HSL hue/saturation servers. Not every MC is the same: one of the owner's MCs reports a single element (other firmware), so a light's element count comes from its own data, never from the model. The Telink light commands (0x26) go to the primary element (#213).
- If provisioning breaks off after the network key went out but before the light confirmed, the light may hold the keys while the phone has no device key for it: reset it and pair again.

## Key backup and one phone at a time (`fixtures/keyBackup.ts`, `fixtures/keySeal.ts`, #303)

Without the keys, a lost or reset phone (or a reinstall) means resetting every Aputure light by hand. Setup → **Key backup** on the phone:

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


### Native fade (`programFade` in `codecs/sidus.ts`, #289)

The MC fades by itself with **Program → Continue** (type `0x15`, wire `0x95`; layout from Sidus Link 2.0.42's `ProgramContinueProtocol`, checked byte for byte against a port of its packer in `sidus.test.ts`): fade in to a target (curve, up to 25.5 s in tenths), hold (1023 = for ever), fade out (curve, time), in white (K, G/M) or colour (hue, saturation). The command `{ op: "fade", ms, curve, intensity, white?, colour? }` (`caps.fade`, MC only) sends it with hold for ever and no fade-out, once (a repeat would restart the fade); without white or colour the light keeps the white the phone last set. The Studio's Devices panel has a **Native fade (test)** for an MC. Tried on an MC (owner, 2026-11-08): the fade starts from the current level, up and down, and is smooth. Sequences use it (see Sequences).
## Screens

- **Studio, Devices** (`apps/studio/src/apps/DevicesApp.tsx`): everything about the devices, see above. Controls start from what the light reports (Aputure) or what the phone last set (NEEWER), and are greyed out while the device is not connected through the proxy. A battery shows charge, voltage, current, power, whether it feeds a load and the estimated time left, every second; an Aputure light shows its built-in battery every minute.
- **Phone, Setup → Lights proxy** (`screens/Proxy.tsx`): read-only, see above. **Setup → Key backup** (`screens/KeyBackup.tsx`) shows once a mesh network exists. The phone has no control or pairing screens since #307: controlling lights on a phone is awkward.

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
