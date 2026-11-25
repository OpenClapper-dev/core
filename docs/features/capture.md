# Capture on the phone

> **Rebuilt in step B3 ([#375](https://github.com/OpenClapper-dev/core/issues/375)).** Specification: [03 capture](../rewrite/03-capture.md), [U5 phone](../rewrite/ux-5-phone.md). Camera layouts, the optics frame, collection mode and the folder for new photos come with step B8. The first app's viewfinder is at tag v0.16.0.

The phone takes photos. A capture is one photo: queued at once, visible in Media, uploaded in the background. Only a project is needed to shoot.

## Camera (`apps/mobile/src/apps/Camera.tsx`)

- `react-native-vision-camera` 5.2.3: photo output `HIGHEST_4_3` (the sensor's largest 4:3 picture), JPEG quality 1, quality prioritised over speed (#426), preview drawn whole (`contain`) on black, the camera released while another tab is in front or the app is in the background.
- **Real lenses only** ([phone app](phone-app.md#this-device-srcdevicets-srclensests)): a lens is opened as the logical camera at the lens's zoom, or as a camera of its own. No digital zoom, so every photo is the full picture of one real lens and its EXIF describes it. A phone with one lens shows no lens rail.
- **Lens names**: as the phone calls them (0.5×, 1×, 5×), or by the reported full-frame focal length (Setup, Camera; the account's preference).
- **Built-in layout**: held upright, the lens rail above the control row; in landscape the control row stands at the right (beside the tab bar), the lens rail at the far left. Control row: uploads (count, red when something is stuck; opens Setup, Uploads), the last photo (opens it in Media), the shutter, the torch (filled when on). A strip over the picture names the project and the lens in use.
- Camera buttons are black with a white outline and a white icon when off, so they read over any picture, and filled in the accent colour when on (#426). Their size (with the shutter and the last-photo thumbnail) is chosen per device in Setup › Camera: small (40 dp), medium (48), large (60), kept in this device's settings (`cameraButtons`).

## What a capture produces (`src/media/pipeline.ts`)

| Step | What |
| --- | --- |
| Shutter | The camera's JPEG, kept untouched as the original in the queue folder (`dataDir("queue")`) |
| EXIF | Read with `@openclapper/model` `readExif`, the same reader as the Studio; the upright size from the delivered size and the orientation |
| Preview, thumbnail | Made with `expo-image-manipulator`: about 2048 px (JPEG 0.86) and about 400 px (0.8), upright |
| Facts | `origin: capture`, taken now, the readout (make and model from EXIF, the lens used as "1× · 24 mm"), the device's file id |
| Name | None: the server names the photo by the project's naming pattern when it arrives ("Photo 0001"; [properties](properties.md#naming-patterns)); until then the phone shows "New photo". An import keeps its file name |

The angle of view is computed by the server from the EXIF ([api](../api.md#photos-photosts)).

**Import** (Media, the download button) runs the same pipeline on pictures picked with `expo-document-picker` (JPEG, PNG, WebP, HEIC): the original copied untouched, its time from EXIF (else the file's), no device, its readout from EXIF, its name from the file name. Imported inside a collection or folder, the photos go there. Whether a picker hands over the camera's unmodified file depends on where it is picked from (Files keeps it; a gallery app may not).

## Upload queue (`src/media/queue.ts`, rules in `steps.ts`, tested)

One photo per entry, persisted with its three files on the phone.

- Steps, each idempotent on the server: what is known (`PUT /api/photos/:id`), thumbnail, preview, original (`PUT /api/photos/:id/<part>`, streamed from disk by the native uploader).
- The original follows thumbnail and preview at once, on any network (#426: no Wi-Fi-only option); it is stored untouched, at full size.
- A network error stops the run until the next sync (sync retries every 20 s while the server cannot be reached). A refused step counts; the third parks the photo as **stuck** with the server's error, as does a file gone from the phone. A stuck photo is retried or discarded by hand (Media's photo page, Setup, Uploads). Nothing is deleted for a rejection.
- Photos of a project made on the phone wait until the project is on the server; a project that turned out to exist under another id takes them along.
- Once the original is stored, the phone deletes its copy and keeps thumbnail and preview in the image cache (`src/media/cache.ts`).
- While a photo waits, its name and place can be changed; they are sent with it.
- Offline mode sends nothing; photos wait.
