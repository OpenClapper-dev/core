# U5 · Phone and tablet

UX workshop [#361](https://github.com/OpenClapper-dev/core/issues/361) ([plan](ux-plan.md)). Status: **in progress** (round 2, 2026-11-23).

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

## Round 2 (2026-11-23)

From the owner's reaction to round 1. The prototype starts held upright now.

| Change | What to try |
| --- | --- |
| **One tab bar for every app** | The camera is an app like the others: the tab bar is always there and looks the same. Held upright it is under the screen; held in landscape it is at the right edge. "Held" in the top bar turns the whole app, not only the camera |
| **The camera is built from sections** | A layout fills three sections: the **control row**, the **lens rail** and a **strip over the picture**. The built-in default follows today's app. Upright: the lens rail is a row above the control row, above the tabs. Landscape: the control row stands at the right beside the tabs, the lens rail at the far left |
| **Control row** | Uploads (with the count), collection mode, shutter, reference frame, torch, optics preset |
| **Lens rail** | The phone's real lenses, then the focal lengths of a preset with primes as buttons to click through |
| **A zoom gets a slider** | A preset with a zoom lens shows a slider over the lower edge of the picture instead of buttons |
| **Strip over the picture** | Layout, the folder for the next photos, and at the right Fit (was "zoom to frame"), blackout and frame upright |
| **Buttons that show their state** | Every camera button is outlined when off and filled in the accent colour when on: lenses, focal lengths, collection mode, torch, the toggles. This is the design system's camera button now; the torch has a flashlight icon |
| **Lens names** | Setup, Camera: as the phone calls them (0.5×, 1×, 5×; the default) or by focal length (13, 24, 120) |
| **Collection mode is a switch** | On starts a new collection named by the pattern ("Collection 3"), off ends it; no question. Setup, Camera offers to be asked for a name when a collection starts or when it ends |
| **A folder for the next photos** | The folder button in the strip: the top level of the project (the default), an existing folder, or a new one. It stays until changed |
| **Media: all photos or folders** | A switch at the top: every photo of the project, or its folders with the photos at the top level below them |
| **Collections as in the Studio** | The header button shows collections as stacks or spread out. Spread, each photo carries its collection's mark; Setup, Appearance chooses bar below, bar left, dot or frame, the same preference as in the Studio |

## Decided so far

2026-11-23, by the owner:

- **One tab bar for all apps,** the camera included. It turns with the device: under the screen upright, at the right edge in landscape.
- **A camera layout fills generic sections** (control row, lens rail, strip over the picture) with controls; the built-in defaults follow today's app. Editing layouts is [U6](ux-plan.md).
- **Focal lengths:** buttons for a preset's primes, a slider for a zoom.
- **Lens names are a preference:** the phone's own names by default, focal lengths as the alternative.
- **Collection mode is a switch** that starts and ends a collection named by the pattern. Asking for a name at the start or at the end is a preference.
- **New photos go to the top level of the project** unless a folder is set for the next photos, which can be changed or switched off at any time.
- **Media on the phone** shows all photos or the folders, and collections stacked or spread with the Studio's marks.
- **Shots on the phone:** properties and content are edited, the progression is played. More can follow once the app is in use.
- **The canvas on phone and tablet is the Studio's editor in a web view,** to be tried as built here.
- **The phone and tablet app is not a second-class client:** what the Studio shows and lets a person set should be there too, in a touch form.
- **Camera controls show their state by a filled colour,** not by an outline alone.

## Not prototyped

Capturing for a shot (deferred in [04](04-shots.md)), the live preview of a layout while it is edited in the Studio (U6), the phone link and extension apps (U6), search and filters in Media and Shots, Sets and Locations beyond the shared list and form, notifications, the tablet's own layouts for lists (a list beside its detail).

## Into the design system

| Part | What |
| --- | --- |
| `BottomTabs` | `side`: the same tabs stacked along the edge of a screen held in landscape |
| `CameraButton` | Outlined when off, filled in the accent colour when on; with text it is a pill (a lens, a focal length, a count) |
| Icons | A flashlight (own drawing) |

Candidates: the upload badge on a tile and the collection marks, which the Studio's file browser needs as well.
