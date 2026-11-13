// Every specimen card, in the export's groups. Each module default-exports a component that draws the card;
// most render their demo twice, Light and Dark side by side (<Pair>). Source: the designer's *.card.html files.
import type { ComponentType } from "preact";
import C0 from "./cards/colors/accent-and-selection";
import C1 from "./cards/colors/boundaries";
import C2 from "./cards/colors/categorical";
import C3 from "./cards/colors/contrast";
import C4 from "./cards/colors/environments";
import C5 from "./cards/colors/over-content";
import C6 from "./cards/colors/states";
import C7 from "./cards/colors/surfaces";
import C8 from "./cards/colors/text";
import C9 from "./cards/type/legibility";
import C10 from "./cards/type/mono-readouts";
import C11 from "./cards/type/numbers";
import C12 from "./cards/type/sans-scale";
import C13 from "./cards/spacing/control-sizes";
import C14 from "./cards/spacing/elevation";
import C15 from "./cards/spacing/motion";
import C16 from "./cards/spacing/radii-and-borders";
import C17 from "./cards/spacing/space-scale";
import C18 from "./cards/spacing/z-layers";
import C19 from "./cards/icons/film-glyphs";
import C20 from "./cards/icons/icon-rules";
import C21 from "./cards/icons/icons";
import C22 from "./cards/brand/brand-clients";
import C23 from "./cards/brand/brand-mark";
import C24 from "./cards/brand/brand-sizes";
import C25 from "./cards/brand/brand-social";
import C26 from "./cards/components/actions";
import C27 from "./cards/components/charts";
import C28 from "./cards/components/core";
import C29 from "./cards/components/data";
import C30 from "./cards/components/feedback";
import C31 from "./cards/components/forms";
import C32 from "./cards/components/layout";
import C33 from "./cards/components/layouts";
import C34 from "./cards/components/navigation";
import C35 from "./cards/components/os";
import C36 from "./cards/components/overlays";
import C37 from "./cards/components/phone";
import C38 from "./cards/components/skeletons";

export interface Card { id: string; group: string; name: string; subtitle: string; Component: ComponentType }

export const CARDS: Card[] = [
  { id: "accent-and-selection", group: "Colors", name: "Accent and selection", subtitle: "Cobalt: accent, its steps, selection and focus", Component: C0 },
  { id: "boundaries", group: "Colors", name: "Boundaries", subtitle: "Control edge 3:1, divider decorative, window edges", Component: C1 },
  { id: "categorical", group: "Colors", name: "Categorical", subtitle: "Eight user-assignable colours for tracks, labels, tags", Component: C2 },
  { id: "contrast", group: "Colors", name: "Contrast table", subtitle: "Every text and boundary pair, computed live from the tokens; decorative edges listed without a minimum", Component: C3 },
  { id: "environments", group: "Colors", name: "Environments", subtitle: "Production, staging, development: icon ground and in-app marker", Component: C4 },
  { id: "over-content", group: "Colors", name: "Over content", subtitle: "Fixed colours over photos and maps; identical in both themes", Component: C5 },
  { id: "states", group: "Colors", name: "States", subtitle: "Success, warning, danger: always with an icon or label", Component: C6 },
  { id: "surfaces", group: "Colors", name: "Surfaces", subtitle: "Desktop, window, sunken, raised, bar, hover, pressed, field", Component: C7 },
  { id: "text", group: "Colors", name: "Text", subtitle: "Three levels plus inverse and on-accent", Component: C8 },
  { id: "legibility", group: "Type", name: "Legibility", subtitle: "1 l I and 0 O stay distinct in both families", Component: C9 },
  { id: "mono-readouts", group: "Type", name: "Mono readouts", subtitle: "Atkinson Hyperlegible Mono · tabular figures, spaced units", Component: C10 },
  { id: "numbers", group: "Type", name: "Numbers: mono vs tabular sans", subtitle: "Same readouts in Atkinson Mono and in the sans with tabular-nums, with measured widths; recommendation per context", Component: C11 },
  { id: "sans-scale", group: "Type", name: "Sans scale", subtitle: "Atkinson Hyperlegible Next · 11 to 32 px", Component: C12 },
  { id: "control-sizes", group: "Spacing", name: "Control sizes", subtitle: "Compact by default; lg for touch on the web, 48 dp on the phone", Component: C13 },
  { id: "elevation", group: "Spacing", name: "Elevation", subtitle: "Window (unfocused, focused), menu, toast", Component: C14 },
  { id: "motion", group: "Spacing", name: "Motion", subtitle: "Three durations, two easings; zeroed under reduced motion", Component: C15 },
  { id: "radii-and-borders", group: "Spacing", name: "Radii and borders", subtitle: "Rectangles act (3, 4, 6 px), pills choose", Component: C16 },
  { id: "space-scale", group: "Spacing", name: "Space scale", subtitle: "2 to 48 px", Component: C17 },
  { id: "z-layers", group: "Spacing", name: "Z-layers", subtitle: "One stack for the whole OS", Component: C18 },
  { id: "film-glyphs", group: "Icons", name: "Film glyphs", subtitle: "Film concepts: which Tabler icon covers each, and the custom glyphs drawn to Tabler rules where none fits", Component: C19 },
  { id: "icon-rules", group: "Icons", name: "Construction rules", subtitle: "How to draw a glyph so it matches the set", Component: C20 },
  { id: "icons", group: "Icons", name: "UI glyphs", subtitle: "Tabler Icons outline · 182 bundled · currentColor", Component: C21 },
  { id: "brand-clients", group: "Brand", name: "Clients × environments", subtitle: "One glyph per client · environment by colour · home uses the plain mark", Component: C22 },
  { id: "brand-mark", group: "Brand", name: "Mark", subtitle: "Slate corner, refined · Light and Dark grounds", Component: C23 },
  { id: "brand-sizes", group: "Brand", name: "Icon sizes", subtitle: "512 to 16 px; glyph drops below 48 px; maskable and Android adaptive", Component: C24 },
  { id: "brand-social", group: "Brand", name: "Social preview", subtitle: "1200 × 630 · favicons at real size", Component: C25 },
  { id: "actions", group: "Components", name: "Actions", subtitle: "Button (secondary, primary, quiet, danger; icon; icon-only) and link", Component: C26 },
  { id: "charts", group: "Components", name: "Charts", subtitle: "Bar (grouped, stacked), area, line, donut · hover for tooltips", Component: C27 },
  { id: "core", group: "Components", name: "Core", subtitle: "Icon, badge, keyboard hint, avatar, divider", Component: C28 },
  { id: "data", group: "Components", name: "Data", subtitle: "List and rows, table (sortable, selectable), thumbnail tile, empty state, map pin and control", Component: C29 },
  { id: "feedback", group: "Components", name: "Feedback", subtitle: "Tooltip, spinner, progress bar, skeleton", Component: C30 },
  { id: "forms", group: "Components", name: "Forms", subtitle: "Inputs, select, combobox, checkbox, radio, switch, slider, segmented, chip", Component: C31 },
  { id: "layout", group: "Components", name: "Layout", subtitle: "Toolbar, status bar, split view with grip, card, property list, form field", Component: C32 },
  { id: "layouts", group: "Components", name: "App layouts", subtitle: "Six window templates; full size and both themes in App layouts", Component: C33 },
  { id: "navigation", group: "Components", name: "Navigation", subtitle: "Tab bar, sidebar navigation, breadcrumb, tree, pagination, load more", Component: C34 },
  { id: "os", group: "Components", name: "OS chrome", subtitle: "Window, taskbar, launcher, file tiles, environment marker, app icon", Component: C35 },
  { id: "overlays", group: "Components", name: "Overlays", subtitle: "Menus, popover, dialog, confirm, command palette, banner, toast", Component: C36 },
  { id: "phone", group: "Components", name: "Phone", subtitle: "Screen header, bottom tabs, action bar, sheet, list row, camera bars", Component: C37 },
  { id: "skeletons", group: "Components", name: "Skeletons", subtitle: "Loading primitives and how they compose: rows, table, tiles, card, inspector", Component: C38 },
];
