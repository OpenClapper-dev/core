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

## Running on the device (channel `flows`, `packages/ext-flows/src/protocol.ts`)

A client saves the flow and names the revision it saved (`updated_at`): `run { flow, revision, fromMs }`; the proxy phone fetches exactly that revision (asked again a few times if the server still has the previous one) and plays it on its own clock through its own connections. `stop`, `hello`. It reports `state { phase: idle | loading | playing | error, flow, name, revision, atMs, durationMs, loop, error }` on every change, every 250 ms while playing, and on `hello`.

## In the Studio (`apps/studio/src/ext/flows/`)

The app **Flows** (one window for the project's flows): the list of flows in a panel, with the chosen one's name, length, loop, Duplicate and Delete under it; the tracks in the middle; what is chosen in the other panel. The panels are the Dock's: move, size, collapse, stack as tabs. **Edit** / **Stop editing** as on a timeline; while someone else edits, it is read-only and follows their changes.

- **Tracks**: Add a track picks a light model or the camera; a track's device is picked on its label (only devices of that model, one track per device; a device that is gone shows so). The bulb **mutes** a track (left out of playback and Live); the palette sets its colour (8, or none); "…" shows the track in the panel (rename, back to the common height, remove). The grip at the left **reorders** tracks by dragging; the lower edge of a label makes that track taller or lower.
- **Keyframes**: two modes, **Select** (V, default: a click on empty lane space clears) and **Insert** (I: a click adds a keyframe); **Alt+click** adds in Select too. Shift-click adds to or removes from the selection; a box drawn over the lanes selects across tracks; dragging a selected keyframe moves the whole selection (0.1 s steps; start keyframes stay); with the intensity graph shown, dragging a light keyframe up or down also sets its intensity. Delete removes, Mod+A selects all, Esc clears. A light keyframe's panel sets power, intensity, white or colour, an effect with its options, the dimming curve (each checked: set here; unchecked: as before). A camera keyframe's panel checks the camera controls it sets (record, ISO, shutter…).
- **Fades**: a click on the strip between two keyframes makes it a fade and shows it: Jump or Fade, the curve (Linear, Expo, Log, S-curve), and on the MC whether the light runs it or it goes in steps every 0.1 s (a dashed tile).
- **Markers**: M at the playhead, Shift+M twice for a range, or in Insert mode (or with Alt) a click (point) or drag (range) in the marker strip under the ruler or a lane's top strip. They select, move and delete like keyframes; a range's edges drag; a marker's panel sets name, in, out, range or point, and scope.
- **View** (kept per browser): intensity graph, light colour, value labels, effect and power badges; keyframe size S, M, L; and a **Size** section: the timeline's width (a slider from fit to 32×, zoom out, zoom in, **Fit width**; the lanes then scroll sideways with the track labels kept in place) and one height for every track (**Fit height** to share the room). No help text under the lanes and no Marker button (#426).
- **Playing**: Space plays from the playhead and, again, stops and goes back to where play started; K stops where it is. **Live** (on by default) sends the state at the playhead while stopped, and every edit; a camera's recording is never started or stopped by Live, only by playing. While a flow plays from here, its devices are locked in Devices. A proxy that appears again gets everything sent anew.
- **Run on device** (from the start, or the button beside it from the playhead): the editor saves first and the device plays exactly that revision; meanwhile the flow is locked, its playhead follows the phone, and Play and Live are off for every flow. Stop in the banner or Space stops it.

## On the device (phone or tablet) (`apps/mobile/src/ext/flows/`)

The app **Flows** (a tab like any other while the project has the extension on):

- **The project's flows** with their length, tracks and whether they loop; **New flow** (needs a connection) opens it in the editor.
- **A flow**: its tracks (model, keyframes, device, muted), **Run on the phone** (from the start, through the phone that holds the connections), and **Edit**: the Studio's flow editor in a web view (`#/embed/flow/<id>`, the session as for the tablet canvas), the one editor for every client. It saves on its own; back closes it.
- **The run** (`run.ts`, kept from the first app's `sequenceRun.ts`): the proxy phone fetches the named revision (asked again a few times while the server still has the previous one), plays it with the shared player through its own connections, reports its state, and keeps playing when the Studio closes. A banner shows it with **Stop**, here and in the Studio. It stops when the proxy lets go of its connections: the proxy switched off, or a pairing taking the radio.

## On the server

No routes of its own: a flow is a file (`/api/files`), its lock and live room are the core's.
