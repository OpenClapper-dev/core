# Viewfinder layouts

[Issue #49](https://github.com/OpenClapper-dev/core/issues/49). Which controls the phone's Shoot screen shows, in which bars, per orientation. Made in the Studio, picked on the phone.

## Model (`packages/vocab/src/viewfinder.ts`)

- **Look** (`look`, issue #68; the same in both orientations): HUD chips, the rig frame's colour and width, blackout and its tint (`VF_FRAME_COLORS`, `VF_TINTS`, shared with the phone). **Options** (`options`): the Human button (cycle 35 → 43 → 50 or toggle one value) and the phone lenses (`all`, `pick` a set, `fixed` one). A stored layout without them gets `DEFAULT_VF_LOOK` / `DEFAULT_VF_OPTIONS` (`layoutLook`, `layoutOptions`); `validateViewfinderLayout` checks them when present.
- **Phone lenses** (`zoom`, issue #26): the phone's magnifications (0.5× 1× 3×…), shown only when the phone offers more than one; List or Carousel. The default puts it after the lens strip.
- A **layout** has a `portrait` and a `landscape` arrangement, each 1–4 **bars**. A bar sits on the preview's **start** edge (top in portrait, left in landscape) or its **end** edge (bottom / right); bars on one edge are listed in screen order (top → bottom, left → right).
- A bar holds up to 9 **items** in screen order: `shutter`, `uploads`, `seq`, `light`, `fit`, `human`, `rig` (buttons; `label: true` shows a short text under the icon) and `lens` (the lens strip: `display` list or carousel, `size` fill or fit).
- Each control at most once per orientation; the shutter exactly once (`validateViewfinderLayout`, strict, used by the Worker).
- `DEFAULT_VIEWFINDER_LAYOUT` is the arrangement from before layouts: portrait, the lens strip and the control row at the bottom; landscape, the lens column left and the control column right. It lives in code, not in the database, so it is always there to go back to.

## Studio (Library › Viewfinder, `ViewfinderLayouts.tsx`)

- The list: **Default** (built in, read-only: Duplicate to edit) and the saved layouts; **New layout** starts from the default.
- Toolbar: the phone link as a pill: grey "No phone connected" / "Offline", amber "<model> connected", green "Previewing on <model>".
- Head: name, **Portrait · Landscape**, the **Device** the layout is designed for (saved with the layout; the Default's is remembered per browser; menu: Read out again…, Rename…, Delete device…; with no device yet, **Add device specs**), save state, Duplicate, **Reset to default**, Delete. Changes save 600 ms after the last edit once the layout is valid (a missing shutter shows a banner and waits).
- The **preview** uses the device's Shoot screen in that orientation (a banner says when it is a generic size, or turned from the other orientation because that one was not read out yet) and its phone lenses, and lays the screen out with the phone's sizes (56 dp rows, 76 dp shutter row, 80 dp columns, the 4:3 camera image fitted between the bars) and says how big the camera image gets.
- **Look** and **Controls** under the bars: the look and the options above (phone lenses picked from the device's stops, typical ones without a device). The preview draws a sample frame in the look, with the blackout and the HUD chips.
- The **Bars** panel: per bar its edge and removal; per item its options (Label; for the lens strip List · Carousel and Fill · scroll · Fit; for the phone lenses List · Carousel) and removal; "Add a control" with what the orientation does not show yet; **+ Bar** (up to 4).
- **Drag and drop** (issue #68, `vfDnd.ts`, tested): drag a control within or between bars, in the panel or **directly on the preview**; drag a bar by its head to reorder the bars; drag a control that is not shown yet from the chips under the bars. An accent line marks where it lands; a full bar (9) takes nothing more. Dropping elsewhere changes nothing.

## Phone

- Setup → Viewfinder → **Layout** picks one (Default, or a layout from the server). Its look and options can be changed there too (`layouts.ts`: `editLayout` writes the cache and queues the change itself, not the resulting layout, in `pendingLayouts.v2` (#198; HUD chips one by one, several edits merged, `layoutPatch.ts`). `flushLayouts` runs first in every flush: it reads the server's current layout, applies the change on top and PUTs that, so the Studio's bars and any Look field the phone did not touch survive. The pulled list shows the server's layouts with unsent changes applied. A 4xx, or a layout deleted in the Studio meanwhile, drops the edit and logs it). The Default is read-only there too: **Make a copy**. The screens read the phone's settings with the layout's look merged in (`withLook`, `ViewSettings`). The list is cached (`viewfinderLayouts.v1`) and refreshed by every `flush()` and, on its own (`refreshLayouts`, #197), when a Studio preview ends, when Setup → Viewfinder opens and when the app comes back to the front, so a Look saved in the Studio shows without a restart; the choice is `settings.viewfinderLayoutId`.
- `Viewfinder.tsx` renders the bars of the current orientation; `vfLayout.ts` computes how much room each edge takes so the preview fits between them (the default keeps the old 166 dp portrait chrome and 80 dp columns; tested). A missing or invalid layout falls back to the default (`resolveLayout`).
- Lens strip **Carousel** (`LensCarousel`): previous · the value (tap: Lens sheet) · next, in the strip's order. **Fill** takes the bar's remaining length and scrolls; buttons next to it keep a fixed 56 dp cell. Without a filling strip the buttons share the bar, as before.
- In landscape the first left bar gets the cutout clearance.

## Device specs (#68)

- A device is a phone read out over the preview socket: **Add device specs** (`DeviceSpecs.tsx`) asks the connected phone (`readout`) and shows what it sends: model, the Shoot screen per orientation (dp, measured whenever Shoot lays out, `device.ts` on the phone), the phone lenses (stops and zoom range) and the main lens's 35 mm equivalent. Turning the phone on Shoot fills in the other orientation live. Name it, save.
- The record's id is the phone's own, so with every flush the phone keeps it current (calibration, sizes, lenses; `syncDevice`). The phone never creates the record. Setup → Phone calibration says the name it has in the Studio.
- The calibration stays editable only on the phone; the device record carries a copy.

## Live preview on the phone (#50)

- While the app is in the foreground, signed in and not in offline mode, the phone keeps a websocket to the Worker (`src/preview.ts`, reconnects after 2 / 5 / 15 / 30 s). The layout editor opens one too (`phonePreview.ts`); the toolbar says "Phone connected" or not.
- **Preview on phone** (editor head, needs a connected phone and a valid layout) shows the layout being edited on the phone: Shoot comes to the front with those bars, in the orientation picked in the editor (it overrides the phone's orientation setting), and follows every edit and orientation switch within ~120 ms, also after switching to another layout. **Stop phone preview** ends it.
- On the phone the buttons and the lens strip are inert (no capture, no toggles); a chip "Studio preview · buttons off · tap to leave" ends it from the phone. Closing the editor, or the phone going to the background, ends it too; a phone that comes back while the editor still previews gets the layout again.
- Nothing is saved: the preview is a look at the draft, the phone's own layout choice is untouched.
- Worker: `GET /api/preview/socket?role=phone|studio` (websocket) into the Durable Object `PreviewRoom` (`src/preview.ts`), one per signed-in user, hibernating between messages. It checks the layout with `validateViewfinderLayout` and keeps the current preview in its own storage only while a Studio is connected.
- Test it against local data with `make mobile` + `make studio` ([development](../development.md)).

## Not done

