/**
 * Camera layouts (docs/rewrite/03-capture.md, ux-6-devices.md): which controls the phone's camera shows and
 * where, per orientation, with its look and options. A layout is a set of free bars, each at an edge (top,
 * bottom, left, right), stacked where several share one, each with its controls in order and a distribution;
 * any bar can lie over the picture. Readouts are controls like the others. A control that is not placed is
 * off, so a layout is also the capture profile. Two layouts are built in (Camera, Viewfinder); the others are
 * files of the account home.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const LOCAL_ID = /^[a-z0-9_-]{1,40}$/i;
const COLOUR = /^(#[0-9a-f]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/i;

/** What a control is (with the design system's glyph that draws it): a button (may carry its label), a strip of values (all at once or stepped), the shutter, or a readout on the picture. */
type ControlKind = "button" | "strip" | "shutter" | "readout";
/** One control of the catalogue; `extension`: brought by an extension, placeable and shown only while the project has it on. */
export interface ControlDef { label: string; icon: string; short?: string; kind: ControlKind; extension?: string }
const CORE_CONTROLS = {
  shutter: { label: "Shutter", icon: "camera", kind: "shutter" },
  lenses: { label: "Phone lenses", icon: "lens", kind: "strip" },
  frame: { label: "Frame", icon: "frame", short: "Frame", kind: "button" },
  focal: { label: "Focal lengths", icon: "focus", kind: "strip" },
  fit: { label: "Zoom to frame", icon: "expand", short: "Fit", kind: "button" },
  blackout: { label: "Blackout", icon: "contrast", short: "Black", kind: "button" },
  upright: { label: "Frame upright", icon: "rotate", short: "Upright", kind: "button" },
  reference: { label: "Reference frame", icon: "user", short: "Ref", kind: "button" },
  collection: { label: "Collection mode", icon: "layers", short: "Collect", kind: "button" },
  folder: { label: "Folder for new photos", icon: "folder", short: "Folder", kind: "button" },
  torch: { label: "Torch", icon: "flashlight", short: "Torch", kind: "button" },
  uploads: { label: "Uploads", icon: "cloud-upload", short: "Uploads", kind: "button" },
  last: { label: "Last photo", icon: "image", short: "Last", kind: "button" },
  layout: { label: "Layout", icon: "camera-layout", short: "Layout", kind: "button" },
  "read-project": { label: "Project", icon: "slate", kind: "readout" },
  "read-lens": { label: "Lens in use", icon: "lens", kind: "readout" },
  "read-frame": { label: "Preset and focal length", icon: "frame", kind: "readout" },
  "read-fov": { label: "Angle of view", icon: "crosshair", kind: "readout" },
  "read-collection": { label: "Collection", icon: "layers", kind: "readout" },
  "read-folder": { label: "Folder", icon: "folder", kind: "readout" },
  "read-warnings": { label: "Warnings", icon: "warning", kind: "readout" },
} as const satisfies Record<string, ControlDef>;
/** Every control a layout can place: the core's, and those extensions registered (08-extensions.md, "Camera controls"). */
export const CONTROLS: Record<string, ControlDef> = { ...CORE_CONTROLS };
export type ControlId = string;
export const controlIds = (): ControlId[] => Object.keys(CONTROLS);
/** Adds a control an extension brings; it stays valid in a layout while the extension is off (and is not shown then). */
export function registerCameraControl(id: string, def: ControlDef & { extension: string }) {
  if (CORE_CONTROLS[id as keyof typeof CORE_CONTROLS]) throw new Error(`camera control "${id}" is the core's`);
  if (!LOCAL_ID.test(id)) throw new Error(`camera control "${id}": letters, digits, hyphens`);
  CONTROLS[id] = def;
}
/** Whether a control shows with these extensions on. */
export const controlOn = (id: ControlId, on: readonly string[]) => { const c = CONTROLS[id]; return !!c && (!c.extension || on.includes(c.extension)); };

export type Edge = "top" | "bottom" | "left" | "right";
export type Distribution = "start" | "center" | "end" | "between" | "around";
export interface LayoutItem {
  control: ControlId;
  /** A button shows its short label under the icon. */
  label?: boolean;
  /** A strip shows all its values, or one at a time with back and on buttons. */
  display?: "list" | "stepped";
  /** A strip of the phone's lenses takes the bar's remaining length (and scrolls), or only its own. */
  size?: "fill" | "fit";
}
export interface Bar { id: string; name: string; edge: Edge; over: boolean; distribution: Distribution; items: LayoutItem[] }
export interface Arrangement { bars: Bar[] }
export interface LayoutLook {
  frameColor: string;
  frameWidth: number;
  /** The blackout's tint and strength; whether it is on is the Blackout control's state (on at the start when \`blackoutOn\`). */
  blackoutColor: string;
  blackoutOn: boolean;
}
export interface LayoutOptions {
  /** The reference frame (full frame at a focal length): steps through 35, 43, 50 mm and off, or switches one of them. */
  reference: { mode: "cycle" | "toggle"; mm: number };
  /** Which of the phone's real lenses are offered: all, the main one, or those picked (by the lens's id on the device). */
  lenses: { mode: "all" | "main" | "pick"; pick: string[] };
  /** Lens names: as set for the account, or fixed for this layout. */
  lensNames: "account" | "phone" | "focal";
}
export interface LayoutBody {
  portrait: Arrangement;
  landscape: Arrangement;
  look: LayoutLook;
  options: LayoutOptions;
  /** The device the layout is designed for (the editor previews at its size); null: any. */
  device: string | null;
}

export const MAX_LAYOUT_BARS = 12;
export const MAX_BAR_ITEMS = 24;
export const FRAME_COLOURS: readonly [string, string][] = [["White", "#ffffff"], ["Amber", "#ffb300"], ["Green", "#00e676"], ["Blue", "#00b0ff"], ["Red", "#ff3b30"], ["Black", "#000000"]];
export const FRAME_WIDTHS = [1, 2, 3, 4, 6] as const;
export const BLACKOUT_TINTS: readonly [string, string][] = [["Neutral", "rgba(0, 0, 0, 0.62)"], ["Black", "rgba(0, 0, 0, 0.85)"], ["Red", "rgba(120, 0, 0, 0.5)"], ["White", "rgba(255, 255, 255, 0.5)"]];
export const REFERENCE_STEPS = [35, 43, 50] as const;
export const DEFAULT_LOOK: LayoutLook = { frameColor: "#ffffff", frameWidth: 2, blackoutColor: "rgba(0, 0, 0, 0.62)", blackoutOn: false };
export const DEFAULT_OPTIONS: LayoutOptions = { reference: { mode: "cycle", mm: 50 }, lenses: { mode: "all", pick: [] }, lensNames: "account" };

const item = (control: ControlId, more: Partial<LayoutItem> = {}): LayoutItem => ({ control, ...more });
const bar = (id: string, name: string, edge: Edge, items: LayoutItem[], more: Partial<Bar> = {}): Bar => ({ id, name, edge, over: false, distribution: "between", items, ...more });
const READOUTS: LayoutItem[] = [item("read-project"), item("read-lens"), item("read-frame"), item("read-fov"), item("read-collection"), item("read-warnings")];

/** The built-in layouts, read-only (duplicated to change). Their ids are not file ids. */
export const BUILTIN_LAYOUTS: Record<"camera" | "viewfinder", { name: string; body: LayoutBody }> = {
  camera: {
    name: "Camera",
    body: {
      portrait: { bars: [
        bar("readouts", "Readouts", "top", [item("read-project"), item("read-lens"), item("read-collection"), item("read-warnings")], { over: true, distribution: "start" }),
        bar("lenses", "Lenses", "bottom", [item("lenses", { display: "list", size: "fit" })], { distribution: "center" }),
        bar("controls", "Controls", "bottom", [item("uploads"), item("collection"), item("shutter"), item("torch"), item("last")]),
      ] },
      landscape: { bars: [
        bar("readouts", "Readouts", "top", [item("read-project"), item("read-lens"), item("read-collection"), item("read-warnings")], { over: true, distribution: "start" }),
        bar("lenses", "Lenses", "left", [item("lenses", { display: "list", size: "fit" })], { distribution: "center" }),
        bar("controls", "Controls", "right", [item("last"), item("torch"), item("shutter"), item("collection"), item("uploads")]),
      ] },
      look: DEFAULT_LOOK, options: DEFAULT_OPTIONS, device: null,
    },
  },
  viewfinder: {
    name: "Viewfinder",
    body: {
      portrait: { bars: [
        bar("readouts", "Readouts", "top", READOUTS, { over: true, distribution: "start" }),
        bar("frame", "Frame", "bottom", [item("layout"), item("folder"), item("fit"), item("blackout"), item("upright")], { over: true, distribution: "end" }),
        bar("lenses", "Lenses", "bottom", [item("lenses", { display: "list", size: "fit" }), item("focal", { display: "list" })]),
        bar("controls", "Controls", "bottom", [item("uploads"), item("collection"), item("shutter"), item("reference"), item("torch"), item("frame")]),
      ] },
      landscape: { bars: [
        bar("readouts", "Readouts", "top", READOUTS, { over: true, distribution: "start" }),
        bar("frame", "Frame", "bottom", [item("layout"), item("folder"), item("fit"), item("blackout"), item("upright")], { over: true, distribution: "end" }),
        bar("lenses", "Lenses", "left", [item("lenses", { display: "list", size: "fit" }), item("focal", { display: "list" })]),
        bar("controls", "Controls", "right", [item("frame"), item("torch"), item("reference"), item("shutter"), item("collection"), item("uploads")]),
      ] },
      look: DEFAULT_LOOK, options: DEFAULT_OPTIONS, device: null,
    },
  },
};
export type BuiltinLayout = keyof typeof BUILTIN_LAYOUTS;
export const isBuiltinLayout = (id: unknown): id is BuiltinLayout => id === "camera" || id === "viewfinder";

/** The controls an arrangement does not place yet (with `on`: only those of the core and of these extensions). */
export const unplaced = (a: Arrangement, on?: readonly string[]): ControlId[] => controlIds().filter((c) => (!on || controlOn(c, on)) && !a.bars.some((b) => b.items.some((i) => i.control === c)));

function arrangementError(a: unknown, where: string): string | null {
  if (!isObj(a) || !Array.isArray(a.bars) || Object.keys(a).length !== 1) return `${where}: a list of bars`;
  if (a.bars.length > MAX_LAYOUT_BARS) return `${where}: at most ${MAX_LAYOUT_BARS} bars`;
  const ids = new Set<string>(), seen = new Set<string>();
  for (const b of a.bars) {
    if (!isObj(b)) return `${where}: a bar is an object`;
    for (const k of Object.keys(b)) if (!["id", "name", "edge", "over", "distribution", "items"].includes(k)) return `${where}: a bar has no "${k}"`;
    if (typeof b.id !== "string" || !LOCAL_ID.test(b.id) || ids.has(b.id)) return `${where}: each bar has its own id`;
    ids.add(b.id);
    if (typeof b.name !== "string" || b.name.length > 40) return `${where}: a bar's name is at most 40 characters`;
    if (!["top", "bottom", "left", "right"].includes(b.edge as string)) return `${where}: a bar stands at the top, bottom, left or right`;
    if (typeof b.over !== "boolean") return `${where}: a bar lies over the picture or not`;
    if (!["start", "center", "end", "between", "around"].includes(b.distribution as string)) return `${where}: a bar's distribution is start, center, end, between or around`;
    if (!Array.isArray(b.items) || b.items.length > MAX_BAR_ITEMS) return `${where}: a bar holds at most ${MAX_BAR_ITEMS} controls`;
    for (const it of b.items) {
      if (!isObj(it) || typeof it.control !== "string" || !(it.control in CONTROLS)) return `${where}: a control is one of ${controlIds().join(", ")}`;
      for (const k of Object.keys(it)) if (!["control", "label", "display", "size"].includes(k)) return `${where}: a control has no "${k}"`;
      if (seen.has(it.control)) return `${where}: ${CONTROLS[it.control as ControlId].label} is placed twice`;
      seen.add(it.control);
      const kind = CONTROLS[it.control as ControlId].kind;
      if (it.label !== undefined && (typeof it.label !== "boolean" || kind !== "button")) return `${where}: only a button carries a label`;
      if (it.display !== undefined && (!["list", "stepped"].includes(it.display as string) || kind !== "strip")) return `${where}: only a strip is shown as a list or stepped`;
      if (it.size !== undefined && (!["fill", "fit"].includes(it.size as string) || it.control !== "lenses")) return `${where}: only the phone lenses fill their bar or fit`;
    }
  }
  if (!seen.has("shutter")) return `${where}: the shutter is needed`;
  return null;
}

/** Null when a camera layout's body is valid. */
export function layoutError(b: Record<string, unknown>): string | null {
  for (const k of Object.keys(b)) if (!["portrait", "landscape", "look", "options", "device"].includes(k)) return `a camera layout has no "${k}"`;
  const e = arrangementError(b.portrait, "upright") ?? arrangementError(b.landscape, "landscape");
  if (e) return e;
  const l = b.look;
  if (!isObj(l) || Object.keys(l).length !== 4) return "the look has a frame colour and width and a blackout's tint and start";
  if (typeof l.frameColor !== "string" || !COLOUR.test(l.frameColor) || typeof l.blackoutColor !== "string" || !COLOUR.test(l.blackoutColor)) return "colours are #rrggbb or rgba()";
  if (typeof l.frameWidth !== "number" || !Number.isInteger(l.frameWidth) || l.frameWidth < 1 || l.frameWidth > 12) return "the frame is 1 to 12 wide";
  if (typeof l.blackoutOn !== "boolean") return "the blackout starts on or off";
  const o = b.options;
  if (!isObj(o) || Object.keys(o).length !== 3) return "the options are the reference frame, the lenses and their names";
  const r = o.reference;
  if (!isObj(r) || !["cycle", "toggle"].includes(r.mode as string) || typeof r.mm !== "number" || r.mm < 10 || r.mm > 200 || Object.keys(r).length !== 2) return "the reference frame cycles or toggles a focal length of 10 to 200 mm";
  const ln = o.lenses;
  if (!isObj(ln) || !["all", "main", "pick"].includes(ln.mode as string) || !Array.isArray(ln.pick) || ln.pick.length > 16 || !ln.pick.every((x) => typeof x === "string" && x.length <= 60) || Object.keys(ln).length !== 2) return "the lenses are all, the main one, or those picked";
  if (!["account", "phone", "focal"].includes(o.lensNames as string)) return "lens names follow the account, or are the phone's or the focal lengths";
  if (!(b.device === null || (typeof b.device === "string" && /^[0-9a-f-]{36}$/i.test(b.device)))) return "the device is a device's id, or none";
  return null;
}

/** A copy of a built-in (or any) layout's body to start a new one from. */
export const copyLayout = (b: LayoutBody): LayoutBody => JSON.parse(JSON.stringify(b)) as LayoutBody;
