# Viewfinder layouts

[Issue #49](https://github.com/bubulux/fielder/issues/49). Which controls the phone's Shoot screen shows, in which bars, per orientation. Made on the dashboard, picked on the phone.

## Model (`packages/vocab/src/viewfinder.ts`)

- **Phone lenses** (`zoom`, issue #26): the phone's magnifications (0.5× 1× 3×…), shown only when the phone offers more than one; no options. The default puts it after the lens strip.

- A **layout** has a `portrait` and a `landscape` arrangement, each 1–4 **bars**. A bar sits on the preview's **start** edge (top in portrait, left in landscape) or its **end** edge (bottom / right); bars on one edge are listed in screen order (top → bottom, left → right).
- A bar holds up to 9 **items** in screen order: `shutter`, `uploads`, `seq`, `light`, `fit`, `human`, `rig` (buttons; `label: true` shows a short text under the icon) and `lens` (the lens strip: `display` list or carousel, `size` fill or fit).
- Each control at most once per orientation; the shutter exactly once (`validateViewfinderLayout`, strict, used by the Worker).
- `DEFAULT_VIEWFINDER_LAYOUT` is the arrangement from before layouts: portrait, the lens strip and the control row at the bottom; landscape, the lens column left and the control column right. It lives in code, not in the database, so it is always there to go back to.

## Dashboard (Library › Viewfinder, `ViewfinderLayouts.tsx`)

- The list: **Default** (built in, read-only: Duplicate to edit) and the saved layouts; **New layout** starts from the default.
- Head: name, **Portrait · Landscape**, the screen **Phone** (412 × 915), **Tablet** (800 × 1280) or **Custom** (width × height in px, the usable area, so notches and system bars can be left out; remembered per browser), save state, Duplicate, **Reset to default**, Delete. Changes save 600 ms after the last edit once the layout is valid (a missing shutter shows a banner and waits).
- The **preview** lays the screen out with the phone's sizes (56 dp rows, 76 dp shutter row, 80 dp columns, the 4:3 camera image fitted between the bars) and says how big the camera image gets.
- The **Bars** panel: per bar its edge, order and removal; per item its options (Label; for the lens strip List · Carousel and Fill · scroll · Fit), order and removal; "Add a control" with what the orientation does not show yet; **+ Bar** (up to 4).

## Phone

- Setup → Viewfinder → **Layout** picks one (Default, or a layout from the server). The list is cached (`viewfinderLayouts.v1`) and refreshed by every `flush()`; the choice is `settings.viewfinderLayoutId`.
- `Viewfinder.tsx` renders the bars of the current orientation; `vfLayout.ts` computes how much room each edge takes so the preview fits between them (the default keeps the old 166 dp portrait chrome and 80 dp columns; tested). A missing or invalid layout falls back to the default (`resolveLayout`).
- Lens strip **Carousel** (`LensCarousel`): previous · the value (tap: Lens sheet) · next, in the strip's order. **Fill** takes the bar's remaining length and scrolls; buttons next to it keep a fixed 56 dp cell. Without a filling strip the buttons share the bar, as before.
- In landscape the first left bar gets the cutout clearance.

## Live preview on the phone (#50)

- While the app is in the foreground, signed in and not in offline mode, the phone keeps a websocket to the Worker (`src/preview.ts`, reconnects after 2 / 5 / 15 / 30 s). The layout editor opens one too (`phonePreview.ts`); the toolbar says "Phone connected" or not.
- **Preview on phone** (editor head, needs a connected phone and a valid layout) shows the layout being edited on the phone: Shoot comes to the front with those bars, in the orientation picked in the editor (it overrides the phone's orientation setting), and follows every edit and orientation switch within ~120 ms, also after switching to another layout. **Stop phone preview** ends it.
- On the phone the buttons and the lens strip are inert (no capture, no toggles); a chip "Dashboard preview · buttons off · tap to leave" ends it from the phone. Closing the editor, or the phone going to the background, ends it too; a phone that comes back while the editor still previews gets the layout again.
- Nothing is saved: the preview is a look at the draft, the phone's own layout choice is untouched.
- Worker: `GET /api/preview/socket?role=phone|dashboard` (websocket) into the Durable Object `PreviewRoom` (`src/preview.ts`), one per signed-in user, hibernating between messages. It checks the layout with `validateViewfinderLayout` and keeps the current preview in its own storage only while a dashboard is connected.
- Test it against local data with `make mobile` + `make dashboard` ([development](../development.md)).

## Not done

