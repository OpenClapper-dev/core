# Design system

Both clients follow one design system, made with Claude Design on 2026-09-28. The owner keeps the full export (component specimens, contrast tables, UI kits) outside the repo, in the gitignored `references/Design System/`. The parts the code uses are copied into the repo (see [Where it lives](#where-it-lives)).

## Themes

Both themes are high contrast, and both follow the OS by default.
- **Sun** (light): near-white page (`#F7F7F5`), white surfaces, near-black ink. For harsh daylight outdoors.
- **Set** (dark): near-black page (`#0B0B0C`), stepped grey surfaces, off-white text. No large bright areas, so it doesn't glare on a dark set.

Switching:
- **Studio and admin board**: the theme button (the Studio's taskbar, also in ⌘K and Settings; the admin board's header) cycles Auto → Sun → Set. Stored in `localStorage["theme"]`; absent means Auto. An inline script in each `index.html` sets `data-theme` on `<html>` before first paint; `theme.ts` in `@openclapper/ui` keeps it in sync (OS changes, the `theme-color` meta). A change crossfades the whole page (a View Transition over `--dur-slow`, #167), except under reduced motion and at page load.
- **Phone**: `settings.theme` (`"auto" | "sun" | "set"`), set on the Setup hub (Auto · Sun · Set), the only theme control; the camera screen has no theme button. Auto uses `useColorScheme()` (`app.json` has `userInterfaceStyle: "automatic"`).

## Rules

- **Contrast**:
  - body and label text ≥ 7:1
  - dim text ≥ 4.5:1
  - every control border ≥ 3:1
  - `--border-subtle` is only for decorative dividers, never the only affordance
  The ratios are listed in the export (`guidelines/contrast.md`). Re-check a pair if you change a value.
- **Never colour alone.**
  - Selected = accent fill + bold + a check icon, or an accent bar on rows.
  - A state = colour + icon + label; icon-only on thumbnails, then it carries a title.
  - A disabled control is dashed.
- **Pills choose, rectangles act.** Tabs, segmented switches and chips are pills. Action buttons are rounded rectangles.
- **Photos never take the theme**: black letterbox, neutral mask (`rgba(0,0,0,.62)`), white frame line with a black outline, dashed when the rig sees more than the photo. Anything over a photo is opaque (black badges, solid chrome), never translucent text.
- **Semantic tokens only.** Use `--bg`, `--surface`, `--text`, `--text-dim`, `--border`, `--accent`, `--ok`, `--danger`, `--warn`, `--phase-*` and so on; never a hex value in a component. The only fixed colours are those drawn over photos or maps: photo black, frame white/black, the human-view cyan, recording red, and map pins.
- **Accent is cobalt.** Amber (`--warn`) means only "warning / unreviewed".
- **Icons**: Material Design Icons, with the same names on both clients. Shared names (review states, light phases) are `STATE_ICONS` and `PHASE_ICONS` in `packages/vocab`.
- **Font**: Atkinson Hyperlegible Next, chosen for legibility under glare (1/l/I and 0/O are distinct). Readouts use tabular figures (`.num`).
- **Scrollbars** (Studio, `styles.css`): a 6 px pill on a clear track, `--text-disabled`, `--border` on hover, `--accent` while dragged (Chrome's `::-webkit-scrollbar`; setting `scrollbar-color` or `scrollbar-width` anywhere switches them off). Scrolling areas keep the scrollbar's room at all times (`scrollbar-gutter: stable`; the timeline and photo strips keep a permanent clear track), so a scrollbar appearing never shifts the layout.
- **Copy**: sentence case, units spaced (`24 mm`, `±5 m`, `30 %`), `·` between facts, no emoji.

## Motion

Epic [#156](https://github.com/OpenClapper-dev/core/issues/156). Web only (the phone has its own platform animations). Everything that moves is in `packages/ui/src/design/motion.css`, imported last of the package's CSS so it overrides the transitions of the files copied from the design export, which stay as exported (the switch knob now slides with a transform instead of `left`, #158).

**Tokens** (`spacing.css`, `motion.css`): `--dur-fast` 90 ms, `--dur` 160 ms, `--dur-slow` 240 ms, `--ease` (enter and state changes), `--ease-in` (exits).

**Tiers**:
- `--dur-fast`: hover, active, colour, border, shadow.
- `--dur`: menus, lists, toasts, the switch knob, chips, section collapse.
- `--dur-slow`: modals, the command palette, windows, the task view, the workspace switch, the theme crossfade.

**Mechanisms**:

| Shape of change | Mechanism |
| --- | --- |
| An element mounts (`{open && <X/>}`) | `@starting-style` + `transition` on opacity, translate, scale. Pure CSS. |
| A state is a class on a kept element (`--min`, `--away`, `is-collapsed`, `is-focused`) | `transition-behavior: allow-discrete` with `display` in the transition list. |
| An element unmounts and needs an exit | `<Presence show>` (keeps the last render, adds `is-leaving`, unmounts on `transitionend`). Only for modal-like overlays. |
| A whole-page change (workspace switch, theme) | `withViewTransition(fn)` from `@openclapper/ui` (`motion.ts`). |

**Rules**:
- Menus, popovers, context menus and Select/Combobox lists enter but never exit: native desktops close menus at once, and an exit would keep stale handlers and `[data-overlay]` (which pauses shortcuts) alive.
- Select, Combobox and Popover lists hang below their anchor unless the list does not fit there and there is more room above (`useDropDirection` in `hooks.ts`, #196); either way they are capped to the room on that side and scroll. Room is measured inside the nearest ancestor that clips vertically (a window, a panel), else the window. A list that opened upward slides up out of its anchor with its own animation (`f-drop-up`).
- Use the `translate` and `scale` properties, not `transform`, where code measures the element (`getBoundingClientRect`) or writes `transform` itself.
- **Never moves**: focus rings, the press `translateY(1px)`, text, photos, frames and masks (their geometry is measured), anything a gesture writes per frame (window drag and resize, the split grip, icon drag, the panel grip), scroll positions, the list cursor `is-hi`. While a window gesture runs, `body.wm-gesture` switches transitions off.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the duration tokens are zeroed, not `transition: none`, so meaningful keyframes (spinner, skeleton) keep running. JS-driven motion asks `reducedMotion()`; `withViewTransition` then just runs the change.
- Switched content (a tab, a layout) fades in with the `f-fade` class plus a `key` that changes with it. A collapsible section keeps its body mounted in `.f-sec__body` (a 1fr ↔ 0fr grid row) so it folds open and shut.
- Not used: native `<dialog>` and the `popover` attribute (the top layer would put modals above the toasts and the task view).

## Where it lives

| Surface | Files |
| --- | --- |
| Phone | `apps/mobile/src/ui/` is the component library, imported as `../ui` (see below). `ui/theme.tsx`: the Sun and Set palettes (from `openclapper-tokens.rn.json`), `FIXED` colours for things over photos, the type scale (`type(step, weight)`: the custom font needs a family per weight, so use it instead of `fontWeight`), `RADIUS`, `SIZE`, `BORDER`, `ThemeProvider`, `useTheme()` and `makeStyles()` (a themed `StyleSheet`, built once per theme). The primitives are split by design-system group in `ui/` (`Icon`, `Button`, `IconButton`, `Chip`, `Seg`, `Toggle`, `Switch`, `Checkbox`, `ListRow`, `Input`, `PasswordInput`, `Sheet`, `StateMarker`, `SeqBadge`, `PhotoTag`, `Banner`, `Empty`, `Skeleton`, `SectionLabel`); `ui/chrome.tsx` the redesign's additions (`AppHeader`, `PushScreen`, `SyncIcon`/`SyncCard`, `FieldRow`, `ActionBar`, `OfflineBanner`) and `ui/dialogs.tsx` the confirm sheets and toasts ([phone app](features/phone-app.md)). Icons come from `@expo/vector-icons/MaterialCommunityIcons`; the font from `@expo-google-fonts/atkinson-hyperlegible-next` (only the five weights used are imported, per weight). Maps in WebViews share `components/mapHtml.ts`. Control borders are 2 dp and touch targets at least 48 dp. |
| Web (`packages/ui`, `@openclapper/ui`) | `packages/ui/src/design/*.css`: tokens (`colors.css`, `typography.css`, `spacing.css`) and component classes (`f-btn`, `f-tab`, `f-seg`, `f-chip`, `f-input`, `f-combo__*`, `f-card`, `f-state`, `f-seq`, `f-tl__*`, `f-wx__*`, `f-pin`, …), copied unchanged from the export. `design/studio.css` holds the rework additions: page body, toolbar, side panel, inspector sections, data table, selection bar, rule builder, menu, command palette, save status, JSON editor, stage, plan grid. `packages/ui/src/` is the component library that renders them (see below); its own CSS additions, and the utilities `meta`, `num`, `mono`, `grow`, `ellipsis`, are in `design/components.css`. Any import from `@openclapper/ui` brings all of it in this order. |
| Studio | `apps/studio/src/openclapper.css`: the photo classes (`f-framed`, …). `src/wm/desktop.css` is the desktop shell (epic #72, `src/wm/`): `wm-root`/`wm-area`, `wm-desktop`, `wm-window` (`__bar`, `__title`, `__content`, `.is-focused`, `--max`, `--snap-left/right`, `--min`), `wm-handle--<dir>`, `wm-snap-preview`, `wm-taskbar`, `wm-task`, `wm-launcher`; its tokens are `--desktop-bg`, `--snap-preview-bg/-border` (colors.css) and `--taskbar-h`, `--wm-radius`, `--elev-window(-focused)` (spacing.css). A focused window is marked by `--border-strong` plus the tinted bar and bolder title, never by shadow or colour alone. `.wm-window__content` is a size container: app CSS sizes against it with `cqh`/`cqw`, not `vh`. `src/styles.css` holds only page layouts and must use tokens (`--space-*`, `--control-*`, `--text-*`). `main.tsx` imports `@openclapper/ui`, then `openclapper.css`, `wm/desktop.css`, `styles.css`. |
| Admin board | `apps/admin/ui/src/admin.css`: the board's layouts only, on the same tokens. |

**Head contract** (both web `index.html`, kept in step by hand because it must run before the first paint, which a module cannot): the inline theme script, `<meta name="theme-color">` (its target), `color-scheme`, and the font and MDI `<link>` tags.

**App icon and mark** (the family from #170, redesigned with the OpenClapper slate motif in 2026-10; sources and geometry in the gitignored `references/OpenClapper icon design/`, `icons.json` there holds the exact paths). One family, three surfaces: two diagonal slate stripes (ink) with a different glyph in the channel between them (accent):
- **Phone**: a portrait phone with a lens cut-out.
- **Studio**: three staggered tracks (timeline / schedule).
- **Admin**: a keyhole.

Each exists in two colourways, white on the background: **production** cobalt `#0040D8`, **development** signal green `#2E7D00` (5.2:1 against white; clear of approve green, recording red and warn amber), so a dev build or dev server is never mistaken for the real one.

| Surface | Files | Which set |
| --- | --- | --- |
| Studio | `apps/studio/public/icons/{prod,dev}/`: `favicon.svg` (pixel-snapped 16-unit), `icon-192/512.png`, `icon-maskable-512.png`, `manifest.webmanifest` | `index.html` links `/icons/%VITE_ICON_SET%/…`; `vite.config.ts` sets `dev` for the dev server, `prod` for builds |
| Admin | `apps/admin/ui/public/icons/{prod,dev}/`, the same files | the same switch in `apps/admin/vite.config.ts` |
| Phone | `apps/mobile/assets/icons/{prod,dev}/`: `app-icon-1024.png`, `android-adaptive-foreground-1024.png`, `android-adaptive-monochrome-1024.png` | `app.json` names the prod set and background; `APP_VARIANT=development` (`app.config.ts`) switches to the dev set and green (APK and dev builds; Expo Go shows its own icon) |

Inside the apps the mark is `Mark`: web `core.tsx` in `@openclapper/ui` (an inline SVG; `surface="studio"`, the default, or `"admin"`), phone `src/ui/core.tsx` (rotated Views, clipped; the lens is a background-colour dot since Views cannot punch holes). Stripes in the text colour, the glyph in the accent, so it works in Sun and Set; the in-app mark has no dev colourway (the accent stays cobalt).

## Web component library

`packages/ui/src/`, imported as `@openclapper/ui` by the Studio and the admin board (a workspace package without a build step, like `@openclapper/vocab`; it declares `@openclapper/vocab` and preact itself). Pages build from these instead of writing `f-*` markup, so a variant or size is changed in one place. Files follow the design system's groups:

| File | Components |
| --- | --- |
| `core.tsx` | `cx`, `Icon` (optional slot class), `Mark`, `Kbd`, `Highlight`, `Img` (an image that fades in once loaded; use it for photos and thumbnails) |
| `actions.tsx` | `Button` (kind, size, icon, iconAfter, kbd hint), `IconButton` (ghost/sm by default, needs a label), `ReorderButtons` (up, down, remove), `LinkButton` |
| `forms.tsx` | `Field` (label, help, error), `Input` (sm, unit, invalid, after), `PasswordInput` (an eye button beside it shows the password), `SearchInput`, `Checkbox`, `Switch`, `Select`, `Chip`, `LightChips`; `Combobox.tsx` |
| `navigation.tsx` | `Seg` |
| `data.tsx` | `ListRow`, `MenuItem`, `StateMarker`, `SeqBadge`, `ProjectTag` |
| `feedback.tsx` | `Banner`, `Empty` (a whole page), `EmptyNote` (inside a list), `Loading`, `Spinner`, `ProgressBar`, `ErrorLine`, `SaveStatus`, `toast`/`ToastHost` |
| `Markdown.tsx` | `MarkdownView` (rendered description), `MarkdownField` (textarea + formatting toolbar + Write · Preview) |
| `overlays.tsx` | `Overlay`, `Modal`, `Popover`, `confirmDialog`/`promptDialog`/`ConfirmHost`; `Overlay` focuses the first `autofocus` field itself (Chrome ignores the attribute on inserted elements while something has focus) |
| `Presence.tsx` | `Presence`: keeps a modal-like overlay mounted while it fades out ([Motion](#motion)) |
| `layout.tsx` | `Toolbar`, `ToolbarTitle`, `ToolbarSpacer`, `Panel`, `PanelHead`, `PanelBody`, `PanelFoot` |
| `hooks.ts` | `useOutsideClick` |
| `theme.ts` | `useTheme`, `getTheme`, `setTheme`, and the theme button's `THEME_CYCLE`, `THEME_LABEL`, `THEME_ICON` |
| `motion.ts` | `reducedMotion()`, `withViewTransition(fn)` (see [Motion](#motion)) |

Domain pieces that draw photos (`Framed`, `FramedThumb`, `ShotCard`) stay next to the pages because they depend on the frame math in `format.ts`. The compose editor (`src/compose/`) draws over photos with the fixed `COMPOSE_PALETTE` colours; its own classes (`compose__*`, `swatch`, `f-range`, `md*`) are in `styles.css`.

## Phone component library

`apps/mobile/src/ui/`, imported as `../ui` (`./src/ui` from `App.tsx`). Screens and sheets build from these; numbers come from the tokens, not literals.

| File | Contents |
| --- | --- |
| `theme.tsx` | Palettes, `FIXED`, `FONT`, `type(step, weight)`, `num`, `SPACE`, `RADIUS`, `SIZE` (incl. `header` 64, `actionColumn` 148), `BORDER` (`control` 2, `badge` 1.5), `ThemeProvider`, `useTheme`, `makeStyles` |
| `core.tsx` | `useLayoutSize`, `Icon`, `Mark`, `SectionLabel`, `SectionHeading` (padded, between full-width rows), `Hint` |
| `actions.tsx` | `Button`, `IconButton`, `SideBySide` (two controls 8 dp apart) |
| `forms.tsx` | `Chip`, `ChipRow`, `ChipGrid`/`ChipCell`, `Input`, `PasswordInput` (an eye button beside it shows the password), `Switch`, `Toggle`, `Checkbox`, `Row` |
| `navigation.tsx` | `Seg` |
| `data.tsx` | `StateMarker`, `SeqBadge`, `PhotoTag`, `ListRow` |
| `feedback.tsx` | `Banner`, `Empty`, `Skeleton`, `ErrorText`, `useRefreshControl` |
| `overlays.tsx` | `Sheet`, `SheetList` (edge-to-edge rows), `SheetSearch` |
| `dialogs.tsx` | `confirm`, `notice`, `ConfirmHost`, `toast`, `ToastHost`, `useToastOffset` |
| `chrome.tsx` | `AppHeader`, `PushScreen`, `Block`, `OfflineBanner`, `SyncIcon`, `SyncCard`, `Badge`, `FieldRow`, `ActionBar` |
| `styles.ts` | The one style sheet behind the primitives |

Some look-alikes are kept apart on purpose because they differ by a few dp or a weight: the two "LAST" tags (field row and tag editor), the header count badge and the tab badge, the option-sheet and location-sheet rows, and the full-screen headers of Tag and Gates versus `AppHeader`. Unifying them is a visual change.

To update the design system: re-export from Claude Design, copy the changed CSS over `packages/ui/src/design/`, carry colour changes into the palettes in `apps/mobile/src/ui/theme.tsx`, and check the screens that use them.

## Desktop v2 tokens (epic #90)

Defined for Sun and Set in `packages/ui/src/design/colors.css`: `--marquee-bg` / `--marquee-border` (the desktop's rubber band, the accent at low alpha and full), `--taskview-text` (text on the task view's scrim, which is near-black in both themes), `--split-grip` (the side-by-side grip's thumb, `--border-strong`). The recycle bin's drop highlight uses `--danger-tint` and `--danger`.
