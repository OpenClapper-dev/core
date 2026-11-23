# U5 · Phone and tablet

UX workshop [#361](https://github.com/OpenClapper-dev/core/issues/361) ([plan](ux-plan.md)). Status: **in progress** (round 1, 2026-11-23).

The one app for phones and tablets. Specified in [03](03-capture.md) and [09](09-shells.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u5>. Code: `apps/specimen/src/ux/u5/`. The app runs inside a drawn device. Fake data, no camera, no server; a reload resets everything. The bar at the very top is not part of the design: it switches between phone and tablet, how the device is held, and "First start".

The frames in the camera are drawn with the real math of [02](02-optics.md) against the angle of view of the lens in use.

## Round 1: what is in it

| Part | What to try |
| --- | --- |
| **Camera, the base** | Layout "Camera" (the chip at the top right of the picture): shutter, the phone's lenses, torch, uploads. The shutter makes one photo, which is queued and visible in Media at once |
| **Real lenses only** | The strip 13 / 24 / 120 / Macro: the phone's physical lenses, named by their focal length. No zoom steps between them |
| **Layout "Viewfinder"** | Adds the optics frame of a preset, drawn against what the lens in use sees. Below: the preset (a sheet to pick one) and its focal lengths (buttons for primes, a slider for a zoom) |
| **Controls on the frame** | In the bar: zoom to frame (the picture is enlarged so the frame fills the screen), blackout outside the frame, frame upright, reference frame (full frame at 35, 43, 50 mm, cycling) |
| **A frame wider than the lens** | Lens 120 with a 24 mm frame: a note says the frame sees more than the lens and to take a wider one |
| **A lens without a reported focal length** | Lens "Macro": no optics frame, and the control says why. The camera still works |
| **A layout of one's own** | "Scout, wide": an aspect frame and no optics. Layouts are made in the Studio ([U6](ux-plan.md)) |
| **Collection mode** | The stack button beside the shutter: choose a collection or a new one; what is shot goes into it, and a label says which one and how many. Press again to end it |
| **The frame at capture** | A photo taken with an optics frame keeps it as a fact (Media, the photo's facts) |
| **Uploads at a glance** | The cloud chip counts what is not on the server yet; it opens Setup, Uploads |
| **Media** | Collections as stacks in their colour, loose photos beside them, a badge on what is still uploading or stuck. Tap a photo: picture, name, facts, collection, bin. The download button imports from the gallery (same pipeline as a capture); the tick chooses several, to make a collection |
| **Shots** | A list with the first picture; tap for the shot's touch form: its content and its properties with the same controls as in the Studio. Sets and Locations work alike once they are tabs |
| **Tabs per device** | Setup, "Tabs on this device": switch apps on and off as tabs and order them. Setup cannot be removed. Apps of extensions are listed but need their extension. The choice is stored with the device |
| **Canvas as a tab** | Switch Canvas on (best on the tablet): the canvas tool of [U2](ux-2-canvas.md) runs inside the app, as the embedded editor of [05](05-composition.md) would |
| **Setup** | Project, account, this device (model, screen, the real lenses with what they report), tabs, offline (offline mode; keep the project on the device), uploads (the queue with states, originals on Wi-Fi only, a stuck photo with Retry and Discard) |
| **Gates** | "First start" in the top bar: sign in, or continue without an account (photos stay on the device). An app that needs a project asks for one; Setup stays reachable |
| **Tablet** | The same app in a larger frame: more columns in Media, more room for the camera and the canvas |
| **Held upright** | "Portrait" in the top bar: the camera with its bars above and below and the tab bar under it |

Limits of the prototype: the live picture is a still; uploads run on a timer; held in landscape only the camera turns (the other screens stay upright on a phone); the shot's Play and "Add to a shot" are messages.

## Open questions for the owner

1. **Leaving the camera in landscape.** Held in landscape the tab bar is a narrow rail at the right edge of the camera (icons only). In portrait it is the normal tab bar under the camera. Right, or should the camera hide the tabs and have one way out?
2. **Lens names.** The lenses are named by their focal length (13, 24, 120), not by "0.5×, 1×, 5×". Agreed?
3. **The focal lengths in the viewfinder** sit in a strip over the lower edge of the picture. For a preset with many primes the strip scrolls. Enough, or a different picker?
4. **Collection mode** asks which collection when it is switched on (a new one or an existing one). Or should it always start a new one, with no question?
5. **Media on the phone** shows collections as stacks and loose photos, newest first, with no folders. Is a folder view needed on the phone, or is that the Studio's business?
6. **Shots on the phone:** properties and content can be edited; the progression can only be played. Enough for the phone?

## Not prototyped

Capturing for a shot (deferred in [04](04-shots.md)), the live preview of a layout while it is edited in the Studio (U6), the phone link and extension apps (U6), search and filters in Media and Shots, Sets and Locations beyond the shared list and form, notifications, the tablet's own layouts for lists (a list beside its detail).

## Into the design system

Nothing yet. Candidates: the chip buttons over the camera picture, the lens strip, the focal strip, and the upload badge on a tile.
