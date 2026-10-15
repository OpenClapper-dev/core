# Viewfinder layouts

[Issue #49](https://github.com/bubulux/fielder/issues/49). Which controls the phone's Shoot screen shows, in which bars, per orientation. Made on the dashboard, picked on the phone.

## Model (`packages/vocab/src/viewfinder.ts`)

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

## Not done

- Live preview of an edited layout on the phone: [#50](https://github.com/bubulux/fielder/issues/50).
- A magnification control (multi-lens, #26) joins the item list when it exists.
