# Cameras

Control a Blackmagic Pocket Cinema Camera over Bluetooth from the Studio, through the phone proxy like the lights ([lights](lights.md#the-phone-as-proxy-studio-devices-307); issue [#318](https://github.com/OpenClapper-dev/core/issues/318)). First camera: the owner's Pocket Cinema Camera 6K (the original).

**Status:** step 1 of #318: pairing, connection, everything the camera reports, record start/stop, and a per-output test for false colour and the Display LUT. Every other control comes in step 2, shaped by what the test shows. Not tried on the camera yet.

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

Devices → the camera:
- connection and status flags, timecode, protocol version;
- record start/stop (`10.1` transport, mode 2 / 0);
- the per-output test;
- every reported parameter by name, and the raw incoming log.

The at-a-glance tile shows the timecode.

## HDMI feed: 3D LUT and false colour

On the camera, LCD and HDMI have separate switches.

- **Display LUT (`1.15`)**: `[LUT, enabled]` in every version of the protocol. It has no output field.
- **Exposure and focus tools (`4.1`**, zebra 0x1, focus assist 0x2, false colour 0x4): in v1.6.2 it gains a second value, the target outputs (LCD 0x1, HDMI 0x2, EVF 0x4, SDI 0x8/0x10). The Pocket manual (v1.5) has only the first. Which the 6K's firmware honours is undocumented.
- **The REST API**: it has per-output LUT and false colour, but no Pocket model is on its list.

The panel's test settles it on the camera:
1. Toggle false colour and the LUT on the camera's LCD and HDMI pages, and see what `4.1`/`1.15` report.
2. Write `4.1` without a target, with "HDMI only" and with "LCD only", and `1.15` on/off, and watch both screens.
