# Cameras

Control a Blackmagic Pocket Cinema Camera over Bluetooth from the Studio, through the phone proxy like the lights ([lights](lights.md#the-phone-as-proxy-studio-devices-307); issue [#318](https://github.com/OpenClapper-dev/core/issues/318)). First camera: the owner's Pocket Cinema Camera 6K (the original).

**Status:** pairing, connection and readback work on the owner's Pocket 6K (2026-11-08), and so does false colour per output. Step 2 adds every control; it is not tried on the camera yet.

## Protocol (`packages/vocab/src/cameraControl.ts`)

Blackmagic's own documents: "Blackmagic Camera Control" (Aug 2025, SDI camera control protocol v1.6.2, Bluetooth pp. 109–110) and the Pocket Cinema Camera manual's developer section (protocol v1.5).

- **Blackmagic Camera Service** `291D567A-6D75-11E6-8B77-86F30CA893D3`:
  - Outgoing Camera Control (`5DD3465F-…`, write);
  - Incoming Camera Control (`B864E140-…`, indications: every parameter the camera reports);
  - Timecode (`6D8F2110-…`, BCD `HH:MM:SS:FF`);
  - Camera Status (`7FE8691D-…`: flags power on, connected, paired, versions verified, initial payload, ready; writing `01`/`00` powers the camera on/off);
  - Device Name (`FFAC0C52-…`) and Protocol Version (`8F1FD018-…`).

  All but the last two are encrypted.
- **Messages**: the SDI camera control format.
  - Header: destination (255 = broadcast), length, command 0, reserved.
  - Then category, parameter, data type, operation (assign / offset-toggle), data, padded to 32 bits.
  - Data types: void/bool, int8–64, UTF-8, fixed16 (signed 5.11).
  - Several messages may come in one indication. `encodeCcu`/`decodeCcu` match the documentation's examples byte for byte.
- **Parameters**: `CCU_PARAMS` names every documented one: lens, video, audio, output, display, tally, reference, configuration, colour correction, media/transport, PTZ, metadata.

## Pairing and connection (`apps/mobile/src/fixtures/drivers/bmdCamera.ts`)

1. On the camera: Setup → Bluetooth on.
2. In the Studio: Devices → Add device. The phone's scan matches the camera by its service (or a "Pocket Cinema" name). Add it as a Blackmagic Pocket Cinema Camera 6K.
3. The proxy connects. It reads the protocol version, writes the device name "OpenClapper" (shown in the camera's Bluetooth menu), then writes "power on" to Camera Status. That first encrypted write starts bonding: **the camera shows a 6-digit PIN, and Android asks for it in its pairing dialog on the proxy phone**. Once per camera; afterwards the phone reconnects with the stored bond.
4. The driver follows Incoming, Timecode and Status. It reports the camera's state (every parameter as last reported, timecode, status flags, the last 40 incoming messages) at most every 250 ms.

Commands are `ccu` messages (a `LightCommand` op, validated by `parseLightCommand`: known data type, values in range). They are written with response and coalesce per parameter in the Studio's thinning and the phone's queue.

## In the Studio (`apps/studio/src/apps/CameraPanel.tsx`)

Devices → the camera: connection, status flags, timecode, then every control, set from what the camera reports where it reports it:

- **Record / still**: `10.1` transport (mode 2 = record, 0 = preview), `10.3`. The banner says "Recording" from the camera's report.
- **Exposure**: ISO `1.14`, shutter angle `1.11` (×100) or speed `1.12` (1/x), auto exposure mode `1.10`.
- **White balance**: K and tint `1.2`, auto `1.3` and restore `1.4`.
- **Lens** (electronic lenses): iris `0.3`, focus `0.0`, zoom `0.8` (normalised 0..1), autofocus `0.1`, auto iris `0.5`, OIS `0.6`.
- **Image and codec**: dynamic range `1.7`, sharpening `1.8`, codec `10.0` (Blackmagic RAW Q0/Q1/Q3/Q5/3:1/5:1/8:1/12:1, ProRes HQ/422/LT/Proxy). The recording format `1.9` is shown.
- **Monitoring per output** (LCD, HDMI):
  - zebra, focus assist and false colour: `4.1` with the target value, which the 6K honours;
  - status overlay and frame guides: `3.0`, also with a target.

  The camera does not report `4.1`/`3.0`, so the ticks are what the Studio set. Also here: zebra and peaking level, focus assist method and colour, frame guide style/opacity/safe area/grid `3.3`, display brightness, colour bars (30 s).
- **Colour correction**: lift, gamma, gain, offset (RGB + luma), contrast, hue/saturation, luma mix, reset (group 8).
- **Audio**: input type, input levels, headphone and speaker levels, phantom power (group 2).
- **Slate**: scene, take, reel, shot tag, INT/EXT, day/night, good take, camera id, operator, director, project (group 12).
- **Tally brightness**.

Below: every reported parameter by name, and the raw incoming log. The at-a-glance tile shows the timecode.

## HDMI feed: 3D LUT and false colour

On the camera, LCD and HDMI have separate switches.

- **Display LUT (`1.15`)**: `[LUT, enabled]` in every version of the protocol. It has no output field.
- **Exposure and focus tools (`4.1`**, zebra 0x1, focus assist 0x2, false colour 0x4): in v1.6.2 it gains a second value, the target outputs (LCD 0x1, HDMI 0x2, EVF 0x4, SDI 0x8/0x10). The Pocket manual (v1.5) has only the first. Which the 6K's firmware honours is undocumented.
- **The REST API**: it has per-output LUT and false colour, but no Pocket model is on its list.

Tried on the owner's 6K (2026-11-08):
- **False colour per output works**: `4.1` with the target `HDMI` or `LCD` changes only that output. The camera does not report `4.1`.
- **The Display LUT does not**: the camera reports `1.15` (`[3, 0]` / `[3, 1]`, the LCD's LUT switched on the camera) but ignored a plain write. The panel offers the remaining attempts: a target value like `4.1`'s, the toggle operation, and the write with the reported LUT. If none works, the Pocket takes no LUT over Bluetooth.
