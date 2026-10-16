# Design system

Both clients follow one design system, made with Claude Design on 2026-09-28. The owner keeps the full export (component specimens, contrast tables, UI kits) outside the repo, in the gitignored `references/Design System/`. The parts the code uses are copied into the repo (see [Where it lives](#where-it-lives)).

## Themes

Both themes are high contrast, and both follow the OS by default.
- **Sun** (light): near-white page (`#F7F7F5`), white surfaces, near-black ink. For harsh daylight outdoors.
- **Set** (dark): near-black page (`#0B0B0C`), stepped grey surfaces, off-white text. No large bright areas, so it doesn't glare on a dark set.

Switching:
- **Dashboard**: the theme button in the sidebar footer cycles Auto → Sun → Set (also in ⌘K). Stored in `localStorage["theme"]`; absent means Auto. An inline script in `index.html` sets `data-theme` on `<html>` before first paint; `src/theme.ts` keeps it in sync.
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
- **Scrollbars** (dashboard, `styles.css`): a 6 px pill on a clear track, `--text-disabled`, `--border` on hover, `--accent` while dragged (Chrome's `::-webkit-scrollbar`; setting `scrollbar-color` or `scrollbar-width` anywhere switches them off). Scrolling areas keep the scrollbar's room at all times (`scrollbar-gutter: stable`; the timeline and photo strips keep a permanent clear track), so a scrollbar appearing never shifts the layout.
- **Copy**: sentence case, units spaced (`24 mm`, `±5 m`, `30 %`), `·` between facts, no emoji.

## Where it lives

| Surface | Files |
| --- | --- |
| Phone | `apps/mobile/src/ui/` is the component library, imported as `../ui` (see below). `ui/theme.tsx`: the Sun and Set palettes (from `fielder-tokens.rn.json`), `FIXED` colours for things over photos, the type scale (`type(step, weight)`: the custom font needs a family per weight, so use it instead of `fontWeight`), `RADIUS`, `SIZE`, `BORDER`, `ThemeProvider`, `useTheme()` and `makeStyles()` (a themed `StyleSheet`, built once per theme). The primitives are split by design-system group in `ui/` (`Icon`, `Button`, `IconButton`, `Chip`, `Seg`, `Toggle`, `Switch`, `Checkbox`, `ListRow`, `Input`, `Sheet`, `StateMarker`, `SeqBadge`, `PhotoTag`, `Banner`, `Empty`, `Skeleton`, `SectionLabel`); `ui/chrome.tsx` the redesign's additions (`AppHeader`, `PushScreen`, `SyncIcon`/`SyncCard`, `FieldRow`, `ActionBar`, `OfflineBanner`) and `ui/dialogs.tsx` the confirm sheets and toasts ([phone app](features/phone-app.md)). Icons come from `@expo/vector-icons/MaterialCommunityIcons`; the font from `@expo-google-fonts/atkinson-hyperlegible-next` (only the five weights used are imported, per weight). Maps in WebViews share `components/mapHtml.ts`. Control borders are 2 dp and touch targets at least 48 dp. |
| Dashboard | `apps/dashboard/src/ui/design/*.css`: tokens (`colors.css`, `typography.css`, `spacing.css`) and component classes (`f-btn`, `f-tab`, `f-seg`, `f-chip`, `f-input`, `f-combo__*`, `f-card`, `f-state`, `f-seq`, `f-tl__*`, `f-wx__*`, `f-pin`, …), copied unchanged from the export. `design/dashboard.css` holds the rework additions: app shell, sidebar, key-hint bar, toolbar, side panel, inspector sections, data table, selection bar, rule builder, menu, command palette, save status, JSON editor, stage, plan grid. `src/ui/` is the component library that renders them (see below); its own CSS additions are in `ui/design/components.css`. `design/desktop.css` is the desktop shell (epic #72, `src/wm/`): `wm-root`/`wm-area`, `wm-desktop`, `wm-window` (`__bar`, `__title`, `__content`, `.is-focused`, `--max`, `--snap-left/right`, `--min`), `wm-handle--<dir>`, `wm-snap-preview`, `wm-taskbar`, `wm-task`, `wm-launcher`; its tokens are `--desktop-bg`, `--snap-preview-bg/-border` (colors.css) and `--taskbar-h`, `--wm-radius`, `--elev-window(-focused)` (spacing.css). A focused window is marked by `--border-strong` plus the tinted bar and bolder title, never by shadow or colour alone. `.wm-window__content` is a size container: app CSS sizes against it with `cqh`/`cqw`, not `vh`. `src/styles.css` holds only page layouts and must use tokens (`--space-*`, `--control-*`, `--text-*`). Fonts and the MDI webfont are loaded in `index.html`. |

**App icon and mark** (Claude Design, "Frame in a frame"; sources in the gitignored `references/Fielder app icon design/`): four viewfinder corners (the phone) around a solid frame (the cinema camera), white on cobalt `#0040D8`. Dashboard icons in `apps/dashboard/public/icons/`; Android: `apps/mobile/assets/icon.png`, the adaptive foreground and monochrome PNGs, background colour `#0040D8` in `app.json` (shown in APK builds; Expo Go shows its own icon). Inside the apps the mark is `Mark` (dashboard `ui.tsx`, an inline SVG; phone `components/ui.tsx`, drawn with Views): corners in the text colour, the frame in the accent, so it works in Sun and Set.

## Dashboard component library

`apps/dashboard/src/ui/`, imported as `./ui`. Pages build from these instead of writing `f-*` markup, so a variant or size is changed in one place. Files follow the design system's groups:

| File | Components |
| --- | --- |
| `core.tsx` | `cx`, `Icon` (optional slot class), `Mark`, `Kbd`, `Highlight` |
| `actions.tsx` | `Button` (kind, size, icon, iconAfter, kbd hint), `IconButton` (ghost/sm by default, needs a label), `ReorderButtons` (up, down, remove), `LinkButton` |
| `forms.tsx` | `Field` (label, help, error), `Input` (sm, unit, invalid, after), `SearchInput`, `Checkbox`, `Switch`, `Select`, `Chip`, `LightChips`; `Combobox.tsx` |
| `navigation.tsx` | `Seg` |
| `data.tsx` | `ListRow`, `MenuItem`, `StateMarker`, `SeqBadge`, `ProjectTag` |
| `feedback.tsx` | `Banner`, `Empty` (a whole page), `EmptyNote` (inside a list), `Loading`, `Spinner`, `ProgressBar`, `ErrorLine`, `SaveStatus`, `toast`/`ToastHost` |
| `Markdown.tsx` | `MarkdownView` (rendered description), `MarkdownField` (textarea + formatting toolbar + Write · Preview) |
| `overlays.tsx` | `Overlay`, `Modal`, `Popover`, `confirmDialog`/`promptDialog`/`ConfirmHost` |
| `layout.tsx` | `Toolbar`, `ToolbarTitle`, `ToolbarSpacer`, `Panel`, `PanelHead`, `PanelBody`, `PanelFoot` |
| `hooks.ts` | `useOutsideClick` |

Domain pieces that draw photos (`Framed`, `FramedThumb`, `ShotCard`) stay next to the pages because they depend on the frame math in `format.ts`. The compose editor (`src/compose/`) draws over photos with the fixed `COMPOSE_PALETTE` colours; its own classes (`compose__*`, `swatch`, `f-range`, `md*`) are in `styles.css`.

## Phone component library

`apps/mobile/src/ui/`, imported as `../ui` (`./src/ui` from `App.tsx`). Screens and sheets build from these; numbers come from the tokens, not literals.

| File | Contents |
| --- | --- |
| `theme.tsx` | Palettes, `FIXED`, `FONT`, `type(step, weight)`, `num`, `SPACE`, `RADIUS`, `SIZE` (incl. `header` 64, `actionColumn` 148), `BORDER` (`control` 2, `badge` 1.5), `ThemeProvider`, `useTheme`, `makeStyles` |
| `core.tsx` | `useLayoutSize`, `Icon`, `Mark`, `SectionLabel`, `SectionHeading` (padded, between full-width rows), `Hint` |
| `actions.tsx` | `Button`, `IconButton`, `SideBySide` (two controls 8 dp apart) |
| `forms.tsx` | `Chip`, `ChipRow`, `ChipGrid`/`ChipCell`, `Input`, `Switch`, `Toggle`, `Checkbox`, `Row` |
| `navigation.tsx` | `Seg` |
| `data.tsx` | `StateMarker`, `SeqBadge`, `PhotoTag`, `ListRow` |
| `feedback.tsx` | `Banner`, `Empty`, `Skeleton`, `ErrorText`, `useRefreshControl` |
| `overlays.tsx` | `Sheet`, `SheetList` (edge-to-edge rows), `SheetSearch` |
| `dialogs.tsx` | `confirm`, `notice`, `ConfirmHost`, `toast`, `ToastHost`, `useToastOffset` |
| `chrome.tsx` | `AppHeader`, `PushScreen`, `Block`, `OfflineBanner`, `SyncIcon`, `SyncCard`, `Badge`, `FieldRow`, `ActionBar` |
| `styles.ts` | The one style sheet behind the primitives |

Some look-alikes are kept apart on purpose because they differ by a few dp or a weight: the two "LAST" tags (field row and tag editor), the header count badge and the tab badge, the option-sheet and location-sheet rows, and the full-screen headers of Tag and Gates versus `AppHeader`. Unifying them is a visual change.

To update the design system: re-export from Claude Design, copy the changed CSS over `apps/dashboard/src/ui/design/`, carry colour changes into the palettes in `apps/mobile/src/ui/theme.tsx`, and check the screens that use them.
