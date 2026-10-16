/**
 * Viewfinder layouts (issue #49): which controls the phone's Shoot screen shows, in which bars, per
 * orientation. Edited on the dashboard, stored by the Worker, rendered by the phone; the shipped
 * DEFAULT_VIEWFINDER_LAYOUT is today's arrangement and can always be gone back to.
 */

export const VF_CONTROLS = ["shutter", "uploads", "seq", "light", "fit", "human", "rig", "lens", "zoom"] as const;
export type VfControl = (typeof VF_CONTROLS)[number];
export const VF_CONTROL_LABELS: Record<VfControl, string> = {
  shutter: "Shutter", uploads: "Uploads", seq: "Sequence", light: "Light", fit: "Fit", human: "Human view", rig: "Rig", lens: "Lens strip", zoom: "Phone lenses",
};
/** Short text under an icon when an item shows its label. */
export const VF_SHORT_LABELS: Record<VfControl, string> = {
  shutter: "", uploads: "Uploads", seq: "Seq", light: "Light", fit: "Fit", human: "Human", rig: "Rig", lens: "", zoom: "",
};

export interface VfItem {
  control: VfControl;
  /** Show the short label under the icon (buttons only). */
  label?: boolean;
  /** Lens strip and phone lenses: every value as a button (list) or one value between up/down (carousel). */
  display?: "list" | "carousel";
  /** Lens strip: take the bar's remaining length and scroll (fill), or only what it needs (fit). */
  size?: "fill" | "fit";
}
export interface VfBar {
  id: string;
  /** Which side of the preview: start = top (portrait) / left (landscape), end = bottom / right. */
  edge: "start" | "end";
  /** In screen order: left → right in a horizontal bar, top → bottom in a vertical one. */
  items: VfItem[];
}
/** Bars in screen order (top → bottom, or left → right); the preview sits between the start and end bars. */
export interface VfOrientation { bars: VfBar[] }
/**
 * How the Shoot screen looks (issue #68), the same in both orientations: the HUD chips, the rig frame's
 * colour and width, the blackout outside it and its tint. Missing in a stored layout = the defaults.
 */
export interface VfLook {
  hud: { project: boolean; rig: boolean; fov: boolean; gps: boolean; warnings: boolean };
  frameColor: string;
  frameWidth: number;
  blackout: boolean;
  blackoutColor: string;
}
/** Which phone lenses the phone-lenses control offers: all the device has, a picked set, or one fixed (no buttons). */
export type VfLenses = { mode: "all" } | { mode: "pick"; zooms: number[] } | { mode: "fixed"; zoom: number };
/** How controls behave (issue #68): the Human button cycles 35 → 43 → 50 → off or toggles one value; the phone lenses. */
export interface VfOptions {
  human: { mode: "cycle" | "toggle"; mm: number };
  lenses: VfLenses;
}
export interface ViewfinderLayout { v: 1; portrait: VfOrientation; landscape: VfOrientation; look?: VfLook; options?: VfOptions }

/** The rig frame's colours and the blackout tints the phone and the editor offer. */
export const VF_FRAME_COLORS: readonly { value: string; label: string }[] = [
  { value: "#FFFFFF", label: "White" }, { value: "#FFB300", label: "Amber" }, { value: "#00E676", label: "Green" },
  { value: "#00B0FF", label: "Blue" }, { value: "#FF3B30", label: "Red" }, { value: "#000000", label: "Black" },
];
export const VF_TINTS: readonly { value: string; label: string }[] = [
  { label: "Neutral 62%", value: "rgba(0, 0, 0, 0.62)" },
  { label: "Black 85%", value: "rgba(0,0,0,0.85)" },
  { label: "Red 50%", value: "rgba(255,0,0,0.5)" },
  { label: "White 50%", value: "rgba(255,255,255,0.5)" },
];
export const VF_FRAME_WIDTHS = [1, 2, 3, 4, 6] as const;
/** The Human button's cycle, FF-equivalent mm. */
export const VF_HUMAN_STEPS = [35, 43, 50] as const;

export const DEFAULT_VF_LOOK: VfLook = {
  hud: { project: true, rig: true, fov: true, gps: true, warnings: true },
  frameColor: "#FFFFFF", frameWidth: 2, blackout: false, blackoutColor: "rgba(0, 0, 0, 0.62)",
};
export const DEFAULT_VF_OPTIONS: VfOptions = { human: { mode: "cycle", mm: 50 }, lenses: { mode: "all" } };

/** The look a layout defines, with the defaults for anything a stored layout does not say. */
export const layoutLook = (l: ViewfinderLayout): VfLook => ({ ...DEFAULT_VF_LOOK, ...l.look, hud: { ...DEFAULT_VF_LOOK.hud, ...l.look?.hud } });
export const layoutOptions = (l: ViewfinderLayout): VfOptions => ({ human: { ...DEFAULT_VF_OPTIONS.human, ...l.options?.human }, lenses: l.options?.lenses ?? DEFAULT_VF_OPTIONS.lenses });
export type VfOrientationName = "portrait" | "landscape";

export const MAX_VF_BARS = 4;
export const MAX_VF_ITEMS = 9;

/**
 * The arrangement the app shipped with before layouts existed, plus the phone's lenses (issue #26:
 * 0.5× 1× 3×…) after the lens strip; they show only when the phone offers more than one.
 */
export const DEFAULT_VIEWFINDER_LAYOUT: ViewfinderLayout = {
  v: 1,
  look: DEFAULT_VF_LOOK,
  options: DEFAULT_VF_OPTIONS,
  portrait: {
    bars: [
      { id: "lens", edge: "end", items: [{ control: "lens", display: "list", size: "fill" }, { control: "zoom" }] },
      { id: "controls", edge: "end", items: ["uploads", "seq", "light", "shutter", "fit", "human", "rig"].map((c) => ({ control: c as VfControl })) },
    ],
  },
  landscape: {
    bars: [
      { id: "lens", edge: "start", items: [{ control: "lens", display: "list", size: "fill" }, { control: "zoom" }] },
      { id: "controls", edge: "end", items: ["rig", "human", "fit", "shutter", "light", "seq", "uploads"].map((c) => ({ control: c as VfControl })) },
    ],
  },
};

/** Controls a layout's orientation does not place yet (for "Add a control"). */
export const unplaced = (o: VfOrientation): VfControl[] => VF_CONTROLS.filter((c) => !o.bars.some((b) => b.items.some((i) => i.control === c)));

/** Strict check of a layout (interactive edits only; the phone falls back to the default on anything odd). */
export function validateViewfinderLayout(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return "layout must be an object";
  const l = v as Record<string, unknown>;
  if (l.v !== 1) return "layout.v must be 1";
  for (const name of ["portrait", "landscape"] as const) {
    const o = l[name] as { bars?: unknown } | undefined;
    if (!o || !Array.isArray(o.bars) || o.bars.length === 0 || o.bars.length > MAX_VF_BARS) return `${name}: 1..${MAX_VF_BARS} bars`;
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const [bi, raw] of (o.bars as unknown[]).entries()) {
      const b = raw as Record<string, unknown> | null;
      const at = `${name}.bars[${bi}]`;
      if (!b || typeof b.id !== "string" || !b.id || b.id.length > 40 || ids.has(b.id)) return `${at}.id must be a unique string`;
      ids.add(b.id);
      if (b.edge !== "start" && b.edge !== "end") return `${at}.edge must be start or end`;
      if (!Array.isArray(b.items) || b.items.length > MAX_VF_ITEMS) return `${at}.items: up to ${MAX_VF_ITEMS}`;
      for (const [ii, rawItem] of (b.items as unknown[]).entries()) {
        const it = rawItem as Record<string, unknown> | null;
        const iat = `${at}.items[${ii}]`;
        if (!it || !VF_CONTROLS.includes(it.control as VfControl)) return `${iat}.control is not a viewfinder control`;
        if (seen.has(it.control as string)) return `${name}: ${String(it.control)} is placed twice`;
        seen.add(it.control as string);
        if (it.label !== undefined && typeof it.label !== "boolean") return `${iat}.label must be true or false`;
        if (it.display !== undefined && it.display !== "list" && it.display !== "carousel") return `${iat}.display must be list or carousel`;
        if (it.size !== undefined && it.size !== "fill" && it.size !== "fit") return `${iat}.size must be fill or fit`;
      }
    }
    if (!seen.has("shutter")) return `${name}: the shutter must be placed`;
  }
  return checkLook(l.look) ?? checkOptions(l.options);
}

const isColor = (c: unknown) => typeof c === "string" && /^(#[0-9a-f]{6}|rgba?\([\d\s.,]+\))$/i.test(c);
const zoomOk = (z: unknown) => typeof z === "number" && z > 0 && z <= 1000;

function checkLook(v: unknown): string | null {
  if (v === undefined) return null;
  const k = v as Record<string, unknown> | null;
  if (!k || typeof k !== "object") return "look must be an object";
  const hud = k.hud as Record<string, unknown> | undefined;
  if (!hud || !["project", "rig", "fov", "gps", "warnings"].every((x) => typeof hud[x] === "boolean")) return "look.hud needs project, rig, fov, gps and warnings as true/false";
  if (!isColor(k.frameColor)) return "look.frameColor must be #RRGGBB or rgba(…)";
  if (typeof k.frameWidth !== "number" || !(k.frameWidth >= 1 && k.frameWidth <= 12)) return "look.frameWidth must be 1..12";
  if (typeof k.blackout !== "boolean") return "look.blackout must be true or false";
  if (!isColor(k.blackoutColor)) return "look.blackoutColor must be #RRGGBB or rgba(…)";
  return null;
}

function checkOptions(v: unknown): string | null {
  if (v === undefined) return null;
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return "options must be an object";
  const h = o.human as Record<string, unknown> | undefined;
  if (!h || (h.mode !== "cycle" && h.mode !== "toggle") || typeof h.mm !== "number" || !(h.mm >= 10 && h.mm <= 200)) return "options.human needs mode cycle|toggle and mm 10..200";
  const l = o.lenses as Record<string, unknown> | undefined;
  if (!l || typeof l !== "object") return "options.lenses must be an object";
  if (l.mode === "all") return null;
  if (l.mode === "pick") return Array.isArray(l.zooms) && l.zooms.length <= 12 && l.zooms.every(zoomOk) ? null : "options.lenses.zooms must be up to 12 zooms";
  if (l.mode === "fixed") return zoomOk(l.zoom) ? null : "options.lenses.zoom must be a zoom";
  return "options.lenses.mode must be all, pick or fixed";
}
