# OpenClapper guidelines

Short rules for building on the system. Values live in `tokens/tokens.json`; components in `src/<group>/`; the specimens in `apps/specimen` (`make specimen`).

## Layers
1. **Tokens.** Primitive ramps (`--grey-*`, `--cobalt-*`), then semantic roles (`--surface`, `--text`, `--accent`). Components use semantic tokens only; never a primitive or a hex value.
2. **Atoms.** One control, one job: Button, TextInput, Checkbox.
3. **Composites.** Atoms assembled into generic parts: Toolbar, Table, PropertyList, Menu.
4. **OS chrome.** Window, taskbar, launcher, desktop, file tiles, task view, boot screens.
5. **App layouts.** Browser, Viewer, Editor, Track, Settings, Table. An app picks one and fills the slots.

Each layer depends only on those above it. If a part only makes sense for one app, it stays in that app.

## Density
- Web: controls 28 px (24 small, 36 comfortable), rows and table rows 28 px (section heads 32 px), title bar 32 px, toolbar 40 px, taskbar 40 px, status bar 24 px.
- Padding: 10 px either side of a button or input label (8 px small), labels 14 px semibold. Cards and dialogs 16–24 px.
- Hit areas cover the whole control: clicking anywhere in an input, select or combobox (including its icon and chevron) focuses or opens it.
- Loading: compose `Skeleton` in the shape of the real content after about 300 ms; use a Spinner inside controls.
- Phone: every hit target at least 48 dp; main actions sit in the bottom third of the screen.
- Hierarchy comes from type and spacing. Don't put boxes inside boxes; one border per group at most.

## Contrast
- Body and label text: at least 7:1. Secondary text: at least 4.5:1. Control boundaries and focus: at least 3:1.
- `--border-divider` is decorative and never the only edge of a control.
- **Window edges.** The focused window edge (`--border-window-focused`) meets 3:1 against the desktop (5.5:1 Light, 5.9:1 Dark). The unfocused edge (`--border-window`, 1.45:1 Light, 1.80:1 Dark) is **decorative**: a window is not a control, and an unfocused window is told from the desktop by its surface fill, its title bar and `--shadow-window`. Raising it to 3:1 would make unfocused and focused windows look the same, which loses the stronger signal. Anything inside a window that the user must find (controls, fields) still has its own 3:1 edge.
- Text on a state tint (`--danger-tint`) stays `--text`; the colour goes on the border and icon.
- The contrast card (specimen app: Colors → Contrast table) computes every pair from the live tokens. Run it after any token change.

## Selection, focus and state
- **Never colour alone.** A state is colour plus an icon or label. Toned badges and banners always carry an icon.
- **Selected** = tinted fill + bold text, plus an accent bar (rows), a check (tiles, chips, options) or an outline.
- **Keyboard cursor** = 1 px selection outline, separate from selection. A row can have both.
- **Focus** = 1 px `--focus` ring plus a 4 px `--focus-ring` halo. Every interactive element has it, and it never animates.
- **Disabled** = dashed edge + `--text-disabled`. Never opacity alone.
- **Desktop and file icons:** labels wrap to two lines, then end in an ellipsis with the full name as a tooltip. A selected icon shows its label on a solid `--selection` fill with a 1 px `--selection-border` outline, in bold, and expands to four lines over its neighbours. A shortcut carries a 14 px badge at the bottom-left of the art: `--surface` fill, 1 px `--border-control`, the `shortcut` glyph (Tabler `arrow-up-right`) at 10 px.
- **Invalid** = 2 px danger edge + warning icon + error text under the field.
- **Shape:** switches are pills; chips are 6 px rectangles and fill with the accent when chosen; segmented controls and tabs are a muted track with a raised selection; buttons, inputs and menus are 6 px rectangles.
- Shortcut hints always use `Kbd`.

## Overflow
- **Property values** wrap by default: up to three lines, then an ellipsis with the full value as a tooltip; the label stays on the first line. `overflow="truncate"` keeps one line with a tooltip, for paths and file names. Numbers never truncate (an ellipsis would hide digits); a numeric value wraps at a space or middle dot. Labels wrap to two lines.
- **Table cells** do not wrap. Text columns get a width and an ellipsis with a tooltip; numeric columns are sized to their longest value.
- **Titles** (window, dialog, card, tab) truncate with an ellipsis on one line; the full title is in the tooltip and the taskbar.
- **Default window placement**: a new window opens next to the focused one if it fits without overlap, otherwise cascaded by one title bar (32 px) down and right, so every title bar stays visible. Never place a window partly off screen.

## Over content
- Photos, frames and video sit on `--photo-bg` (black) in both themes.
- Anything drawn over a photo or map uses the fixed `--over-*` colours: frame lines white with a black outline, labels white on opaque black, pins white and black.
- Nothing translucent carries text over an image. The camera's control bars are opaque.
- Content never takes the theme, and theme colours never tint an image.

## Motion
- Three durations: `--dur-fast` 90 ms (hover, colour, close), `--dur` 160 ms (menus, toasts, tabs, collapse, window open), `--dur-slow` 240 ms (dialogs, maximise, snap, task view, sheets).
- `--ease` for entering and changing; `--ease-in` for leaving.
- What moves: windows (open, close, maximise, restore, snap, minimise toward the taskbar), menus and popovers (4 px drop + fade), the launcher (rise + fade), dialogs (scrim fade, scale .98→1), toasts (slide from the edge), bottom sheets (slide up), segmented and tab selection (the fill slides), collapsing sections, task view.
- What never moves: focus rings, text, photos and frames, measured geometry (timeline items, pins), anything that follows the pointer (window drag, grips, marquee). Buttons change colour only.
- Menus enter but close instantly.
- Reduced motion sets every duration to 0 ms; nothing moves except spinners.

## Charts
- Use BarChart, AreaChart, LineChart or DonutChart, usually inside a Card. Colours `--chart-1` … `--chart-5` in that order.
- Horizontal grid lines only, no axis lines, mono numbers. Every series is named in the legend and the tooltip.
- Charts do not animate on load; values are measured geometry.

## Numbers
- Property lists, numeric table columns and status bars: the sans with tabular figures (`.oc-tnum`, `font-variant-numeric: tabular-nums`). It is about 20 % narrower than Mono, so readouts fit a 260 px inspector; right alignment plus tabular figures keeps digits in columns.
- Mono (`.oc-num`): timecode, the taskbar clock, camera readouts, values that tick while you watch, keys in Kbd, codes, IDs and hashes (table column `mono`).
- Always the unit, spaced: `24 mm`, `52.5200° N`.

## Icons
- UI glyphs and app icons: **Tabler Icons**, outline only, `currentColor`. No filled variants, no second set, no emoji, no unicode as icons.
- Sizes 12, 16, 20 (web), 22–24 (phone). Stroke follows size so lines stay about 1.5 px.
- App and file icons: `AppIcon`, a Tabler glyph on a categorical tile. An extension that is off gets a dashed tile.
- To add a glyph: copy the outline markup from tabler.io/icons into `src/core/glyphs.ts` under a short semantic name, and save the SVG in `assets/icons/`.
- Film concepts Tabler lacks are drawn in-house on the same rules (24 grid, 2 px stroke, round caps and joins, outline, 2 px clear margin, 2 px corner radius on rectangles): framing, sensor-size, focal-reducer, light-fixture, camera-layout, slate, zebra, anamorphic (`assets/icons/film/`). Mapped to Tabler: thirds `grid-3x3`, aspect `aspect-ratio`, crop-wide `crop-16-9`, exposure `exposure`, histogram `chart-histogram`, focus-assist `focus-centered`, color-temp `temperature-sun`, camera-settings `camera-cog`, practical `bulb`, lens / focal length `aperture`, shot `movie`.

## Naming
- Tokens: `--<role>[-<variant>]`: `--surface-sunken`, `--text-secondary`, `--border-control`, `--accent-hover`. Sizes are `--control-h`, `--row-h`, `--m-*` (phone). Fixed over-content colours are `--over-*`; environments are `--env-*`.
- CSS classes: `oc-<component>`, `oc-<component>__<part>`, `oc-<component>--<variant>`, state `is-<state>`.
- Components: PascalCase, named after what they are, not where they are used (`PropertyList`, not `InspectorPanel`). Web and phone share names and props where the platforms allow.
- Copy: sentence case; units spaced (`24 mm`, `±5 m`); a middle dot between facts; no emoji, no exclamation marks.

## Do and don't
- **Do** use one primary button per window region. **Don't** make every action primary.
- **Do** set numbers with tabular figures and their unit. **Don't** right-align text, or left-align numbers in a column.
- **Do** show state with an icon and a word. **Don't** rely on a red or green dot.
- **Do** use quiet buttons in toolbars. **Don't** put bordered buttons in a row of ten.
- **Do** letterbox photos on black. **Don't** crop them to fill a tile or put them on a grey surface.
- **Do** use a Card for one object or one settings block. **Don't** nest cards, or give one a heavier shadow than `--shadow-card`.
- **Do** compose an app from a layout template. **Don't** write new CSS for something a component already does.
