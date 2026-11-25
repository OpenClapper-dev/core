# Flows

The Flows extension ([extensions](extensions.md)), rebuild step B10 ([#382](https://github.com/OpenClapper-dev/core/issues/382)); it needs [Hardware](hardware.md). The model is [08 · Extensions](../rewrite/08-extensions.md) ("The Flows extension"), the design [U6](../rewrite/ux-6-devices.md). A **flow** is a timed programme that drives what devices expose: the first app's light sequences ([lights](lights.md), "Sequences"), carried over whole, and grown to cameras.

## A flow (`packages/ext-flows/src/flow.ts`)

A **file of a project** (type `flow`), edited by one person at a time like a timeline (the edit lock; the others watch it live or every 5 s, per the project's setting). Its body: `{ durationMs, loop, tracks, markers }`; its name is the file's.

| Part | Meaning |
| --- | --- |
| Track | `{ id, name, model, device, muted?, color?, keyframes }`: of one catalogue model (a light: Aputure MC, NEEWER FS230B, FS300B; or the Blackmagic camera), driving one device of the account once assigned (an unassigned track does not play), one of 8 colours |
| Start keyframe | Every track has one at 0 that cannot be moved or deleted. A light's sets power, intensity and white or colour; a camera's stops recording. A flow never starts from what a device happened to do |
| Light keyframe | Holds any of power, intensity, white (K, G/M), colour (hue, saturation), an effect with its options, the dimming curve; unset ones keep what came before. Between two keyframes the light keeps the first's values and jumps at the second, unless the second has a **fade in** (a curve: linear, exp, log, S): then everything that differs blends over the gap (hue the short way; white ↔ colour switches at the end). `fadeStepped`: on a light that fades by itself, send the fade in 0.1 s steps instead |
| Camera keyframe | `controls`: values of the camera's catalogue controls that hold a value (record, ISO, shutter, white balance, the lens, the image, audio, slate, monitoring levels…), by control id. They jump; no fades |
| Marker | A named point or range, across the flow or on one track; playback ignores them |

Limits: up to 1 hour, 64 tracks, 2,000 keyframes, 200 markers. Checked on every save (`flowError`).

## Playing (`packages/ext-flows/src/player.ts`)

One player for the Studio and the phone, so a flow plays the same wherever it runs: every 100 ms it samples each assigned, unmuted track and sends only what changed. A light that fades by itself (the MC) gets one native fade per fade tile (chained over 25.5 s); a running effect means no fade. A light with switchable smoothing (NEEWER) jumps at keyframes and smooths inside fades. A camera track sends a control when its held value changes. Loop restarts at 0 and sends everything again.

## Running on the phone (channel `flows`, `packages/ext-flows/src/protocol.ts`)

A client saves the flow and names the revision it saved (`updated_at`): `run { flow, revision, fromMs }`; the proxy phone fetches exactly that revision (asked again a few times if the server still has the previous one) and plays it on its own clock through its own connections. `stop`, `hello`. It reports `state { phase: idle | loading | playing | error, flow, name, revision, atMs, durationMs, loop, error }` on every change, every 250 ms while playing, and on `hello`.

## On the server

No routes of its own: a flow is a file (`/api/files`), its lock and live room are the core's.
