# Design brief: the OpenClapper design system, from scratch

Design track step D1 ([#338](https://github.com/OpenClapper-dev/core/issues/338)). Status: **done; superseded by the result**.

**What the design was actually made from (2026-11-13).** The owner ran the first version of this brief (commit ea22d02: high contrast, Light/Dark, three directions to choose from, own icon set) with the designer and chose direction "Graphite". A trial round with the version below (shadcn/ui look, Tabler Icons, two directions) was used only as inspiration: the owner then nudged the Graphite project toward shadcn's dense control proportions and switched it to Tabler Icons, for UI glyphs and for app and file icons alike (a Tabler glyph on a coloured tile, no own icon family). One review round followed (docs vs. tokens, overflow rules, numbers in tabular sans, outlined wordmark, eight custom film glyphs). The result keeps the cobalt accent, Atkinson Hyperlegible Next + Mono and the high-contrast floors (7:1 text, 4.5:1 secondary, 3:1 control edges). It lives in `packages/design` (step D3, [#340](https://github.com/OpenClapper-dev/core/issues/340)); its `README.md` and `GUIDELINES.md` are now the reference, not this brief.

This page is the master prompt for the designer. Everything below the line is meant to be handed over as it stands. It asks for the **foundation** only: tokens, atoms, composites, the OS chrome, the icon language and the marks. Feature screens are not part of it; they are designed later, on this foundation, one workshop at a time.

---

## 1. What you are designing

OpenClapper is an open-source tool for film productions: scouting locations, taking reference photos, planning shots, sketching, cutting rough timelines of stills, and (for some users) controlling lights on set. One person may be a director of photography, another a location scout, a gaffer or a line producer; each uses a different part of it.

Design a **complete design system from scratch** for it, in a look inspired by shadcn/ui's default styling and Tabler Icons (section 3). There is an existing system; do not evolve it. It was made when the product was a phone viewfinder with a web dashboard beside it, and it shows: thick, dashboard-like web UI. The product has since become something else.

**The product is an operating system for a film production.** Its main client, the Studio, is a desktop in the browser: windows, a taskbar, a launcher, desktop icons, virtual desktops, a filesystem with folders and a recycle bin, and applications that open files. The things users make (photos, shots, sketches, timelines, locations) are files. Features are apps. Users combine small, independent apps into their own workflow, and some apps are optional extensions that are off until enabled. The design system must make this feel like one calm, coherent operating system, and it must make building a new app cheap: an app author composes existing parts and writes almost no CSS.

## 2. Surfaces

| Surface | What it is | Conditions of use |
| --- | --- | --- |
| **Studio** | The desktop OS in the browser (Chrome only), mouse and keyboard, large screens, many windows open at once | Office and production office; long sessions; dense information |
| **Phone app** | Android (React Native), touch, one hand, portrait and landscape | Outdoors in harsh sun and on dark sets; gloves, hurry; the camera screen is the heart |
| **Admin board** | A small web app for the operator of an instance: accounts, workspaces, storage monitoring | Occasional use |
| **Home site** | The public website | Marketing and docs; uses the same tokens and marks |

The Studio is the primary surface and sets the character. The phone is a companion to it, not the other way round.

## 3. Character and visual reference

- **An operating system, not a web dashboard.** Think of the restraint and density of a good desktop environment: thin chrome, compact controls, clear hierarchy through type and spacing instead of boxes inside boxes. No oversized cards, no thick borders around everything, no hero-sized buttons in a window.
- **A tool for people who look at pictures.** The UI steps back; photos, frames and drawings are the content. Chrome is neutral so that it does not tint the judgement of an image.
- **Precise and technical where it shows numbers** (focal lengths, sensor sizes, coordinates, times): tabular figures, units, alignment.

**The look to take inspiration from is the default styling of shadcn/ui, with Tabler Icons.** That means: a neutral, near-monochrome palette; hairline 1 px borders; small, consistent radii; very restrained shadows; a quiet primary instead of a loud accent; compact, calm controls; generous but disciplined spacing; a clean sans-serif. Colour is used sparingly and means something when it appears.

This is a reference for the look only:

- **No library is used.** Not shadcn/ui, not Radix, not Tailwind, no utility classes. Everything is our own plain CSS on our own tokens, with our own component code. Do not copy shadcn's code or class names; reinterpret its visual language.
- shadcn/ui is a set of web primitives for pages and dashboards. It has no window manager, taskbar, desktop or file tiles, and no phone components. Extending its language to an operating-system shell and to a phone app is the actual design work here, and where OpenClapper gets a character of its own.

## 3a. Two directions to choose from

Before any bulk work, present **two directions**, each on one page with a small desktop specimen (a window or two, a taskbar, some file tiles, a handful of controls and icons) in Light and Dark:

| Direction | What it is |
| --- | --- |
| **A · Default** | The faithful interpretation of shadcn/ui's default look: its contrast levels, its hairline borders, its muted secondary text. |
| **B · High contrast** | The same language pushed to high contrast: body and label text at least 7:1, secondary text at least 4.5:1, every control boundary at least 3:1, stronger focus and selection, while still reading as the same family as A. |

The owner picks one (or asks for a mix) and only then does the rest get designed. Both directions share structure, spacing, shapes and icons; they differ in colour values, border strength and state emphasis. Build the tokens so that the other direction could later be offered as a contrast setting without touching a component.

## 4. Hard requirements

1. **Two themes, Light and Dark**, plus following the OS setting. Use exactly these names. Both directions come in both themes.
2. **Contrast is defined per direction** (section 3a). Direction A follows the shadcn/ui defaults, with text never below 4.5:1. Direction B meets 7:1 for body and label text, 4.5:1 for secondary text and 3:1 for every control boundary. For both, deliver a contrast table for every text/background and boundary/background pair.
3. **Never colour alone.** A state is colour plus an icon or a label; a selection is visible without colour; disabled is distinguishable by more than opacity.
4. **Content never takes the theme.** Photos sit on black; frame lines, masks and labels drawn over a photo or a map use fixed colours that work on any image; nothing translucent carries text over a photo.
5. **One token source for web and phone.** Tokens are defined once in a neutral format (JSON) and generated into CSS custom properties and a React Native object. No hand-copied values.
6. **Strict layering**, with each layer depending only on the ones below:
   - **Tokens**: primitive values, then semantic tokens (what a colour is *for*). Components use semantic tokens only.
   - **Atoms**: single-purpose controls.
   - **Composites**: assembled from atoms, still generic (a toolbar, a property list, a table).
   - **OS chrome**: window, taskbar, launcher, desktop, file tiles, menus.
   - **App layouts**: a small set of window layout templates that apps fill.

   Nothing in the system may be specific to one feature. If a part only makes sense for one app, it does not belong in the system.
7. **Desktop density on the web.** Compact by default (a control height around 28 px), with a comfortable step for touch. On the phone, touch targets of at least 48 dp and layouts usable with one hand.
8. **Keyboard first on the web.** Every control has a visible focus state; shortcut hints have a standard look; menus, lists and tables define their cursor and selection states.
9. **Motion with a system**: a few durations and easings as tokens, rules for what moves and what never moves (measured geometry such as photos and frames, anything following a pointer), and a reduced-motion mode.
10. **Type**: a clean sans-serif in the spirit of the reference (the current typeface, Atkinson Hyperlegible Next, does not have to stay). It must be freely licensed and bundled, not loaded from a third party. On the phone it is read outdoors under glare, so 1/l/I and 0/O must stay distinct. Include a monospace or tabular solution for readouts.
11. **Three environments** must be told apart at a glance: production, staging and development. Today each has its own icon background (production ultramarine `#1E3FBF`, staging clay `#B8471F`, development moss `#3B7A1A`) and staging shows a badge in the UI. Keep the idea; the colours may change. The scheme must work for app icons, favicons and an in-app marker.
12. **Copy style**: sentence case, units spaced (`24 mm`, `±5 m`), a middle dot between facts, no emoji.

## 5. Deliverables

### 5.1 Tokens

Colour (primitive ramps and semantic roles for both themes: backgrounds and surface levels, text levels, boundaries, accent, success, danger, warning, selection, focus, scrim, plus the fixed over-content colours), type scale, spacing, sizes, radii, border widths, elevation (including window shadows for focused and unfocused windows), motion, z-layers. A neutral categorical palette of at least eight colours for user-assigned things (tracks, labels, tags), usable in both themes.

### 5.2 Atoms

Button (primary, secondary, quiet, danger; with icon; icon-only), link, text input, number input with unit, password input, search input, text area, select, combobox, checkbox, radio, switch, slider, segmented control, chip (choice and removable), tag/badge, keyboard-shortcut hint, tooltip, spinner, progress bar, skeleton, avatar, divider, icon.

Each with all states: rest, hover, focus, pressed, selected, disabled, invalid, loading, where they apply.

### 5.3 Composites

Toolbar, tab bar, sidebar navigation, breadcrumb, list and list row, table (sortable, selectable, dense), tree, property list / inspector section (label–value rows, collapsible groups), form field with label, hint and error, card, empty state, banner, toast, dialog, confirm, popover, context menu, dropdown menu, command palette, resizable panel with a grip, split view, status bar, pagination or "load more", map pin and map control, a thumbnail tile for an image with badges.

On the phone, the equivalents that differ by platform: screen header, bottom tabs, bottom sheet, action bar, list row with a chevron, pull to refresh.

### 5.4 OS chrome (web)

- **Window**: title bar with icon, title, controls; focused and unfocused; maximised; snapped left and right with the grip between two snapped windows; minimised; resize affordances; a window's own toolbar and status bar.
- **Taskbar**: launcher button, pinned apps and files, running-window buttons with states, system area (project switcher, search, theme, clock, environment marker). It can sit on any screen edge.
- **Launcher**: the list or grid of apps, with a section for extensions.
- **Desktop**: icon grid, selection rectangle, drag states, drop targets, the recycle bin, wallpaper or background treatment per theme.
- **File and folder tiles** at icon, list and grid sizes; a shortcut badge; an image file showing its own picture.
- **Task view**: virtual desktops with window miniatures.
- **Sign-in and the project picker**, as the "boot" screens of the system.

### 5.5 App layout templates

Four to six window layouts that cover most apps, shown with placeholder content only: a browser (sidebar, toolbar, grid or list), a viewer with an inspector (stage and side panel), an editor with a canvas and tool rail, a horizontal track editor (lanes over time), a settings/form app, a table app. For the phone: a list screen, a detail screen, a full-screen camera with configurable control bars on two edges, a form.

### 5.6 Icons

Today all icons are a third-party icon font (Material Design Icons), and desktop app icons are the same glyphs placed in a tile. This is replaced by two families:

- **UI glyphs: Tabler Icons, used as they are.** Outline style, 24 px grid. Do not redraw them. Deliver: the stroke width and the sizes to use at each control size; the list of Tabler icon names chosen for the base set (about 120: actions, navigation, objects, states, media, files, devices, map, time, weather and daylight); and, for concepts Tabler does not have (a frame on a picture, a mask, a crop to a frame, a series of photos, a camera layout, a focal reducer and similar film-specific things), custom glyphs drawn to Tabler's construction rules so that they are indistinguishable from the set.
- **App icons and file-type icons: an own, richer family** for the desktop, the launcher and the taskbar, readable from 16 px to 64 px in both themes, clearly related to the Tabler line language but distinct from a plain UI glyph. Deliver the construction rules and these icons: media library, camera, shot, sketch, timeline, optics, locations, map, files, folder, recycle bin, settings, projects, filters, camera layouts, devices, lights, flows, and a generic "extension" icon; file types for photo, series, shot, sketch, timeline, location, filter.

### 5.7 Marks

The current mark is the "slate corner": a clapperboard cropped at the hinge, with a small glyph per client. You may keep, refine or replace it. Deliver: the mark; a wordmark; the lock-up; a variant per client (Studio, phone app, admin board, home site, the organisation avatar); for each, the three environment versions; app icon, Android adaptive icon (foreground, background, monochrome), favicon at 16 px, web app icons at 192 and 512 px including maskable, a social preview image.

### 5.8 Guidelines

Short written rules: when to use which layer; density; the contrast rules; selection, focus and state conventions; what goes over content; motion rules; icon construction; naming of tokens and components; do and don't examples.

## 6. Hand-off format

- Tokens as one JSON source, plus the generated CSS custom properties (both themes) and a React Native object.
- Each component as: a specimen page showing every variant and state in both themes, plain CSS that uses only tokens (no framework, no preprocessor, no utility classes), a reference implementation in JSX with typed props, and a short usage note.
- Web components target Preact; phone components target React Native. The two share names, props and tokens wherever the platforms allow.
- UI glyphs as a list of Tabler icon names; custom glyphs, app icons and file-type icons as individual SVG files on the stated grid, with `currentColor` where they are single-colour.
- Marks as SVG, plus the raster sizes listed above.
- One specimen "desktop" page that assembles the OS chrome with two or three placeholder windows, in both themes, as proof that the parts work together.

## 7. What exists today, for reference only

- Web components in the current system: button, icon button, link button, field, input, password input, search input, checkbox, switch, select, combobox, chip, segmented control, list row, menu item, state marker, badge, banner, empty state, loading, spinner, progress bar, error line, save status, toast, overlay, modal, popover, context menu, confirm and prompt dialogs, toolbar, resizable panel, Markdown view and field. There is no table, tabs, card, tree or menu component; apps write that markup by hand, which is one reason for this redesign.
- The Studio shell has: windows with snap and split, a taskbar on any edge, a launcher, a desktop with icons, virtual desktops, a recycle bin, a command palette.
- Current tokens: semantic colours, a 2–48 px spacing scale, control heights 28/36/44 px, radii 3/6/10/14 px, durations 90/160/240 ms.
- Things that worked and may be kept where they fit the new look: fixed colours over photos; one reserved colour for warnings. The old rules "pills choose, rectangles act" and "cobalt accent" are not requirements any more.

## 8. Out of scope

Feature screens of any app (media library, shots, timeline, camera, lights and so on). They are being redefined and will be designed on this foundation afterwards. Do not design them; where a specimen needs content, use neutral placeholders.

## 9. How to proceed

1. Present the two directions of section 3a (A · Default, B · High contrast), each on one page with a small desktop specimen in Light and Dark. Stop there and wait for the choice.
2. After a direction is chosen: tokens, atoms and the icon rules.
3. Then composites and the OS chrome, with the assembled desktop specimen.
4. Then app layout templates, the phone equivalents, the full icon sets and the marks.
5. Finally the guidelines and the hand-off package.

Ask before assuming where this brief is silent.
