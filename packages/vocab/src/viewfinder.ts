/**
 * Viewfinder layouts (issue #49): which controls the phone's Shoot screen shows, in which bars, per
 * orientation. Edited on the dashboard, stored by the Worker, rendered by the phone; the shipped
 * DEFAULT_VIEWFINDER_LAYOUT is today's arrangement and can always be gone back to.
 */

export const VF_CONTROLS = ["shutter", "uploads", "seq", "light", "fit", "human", "rig", "lens"] as const;
export type VfControl = (typeof VF_CONTROLS)[number];
export const VF_CONTROL_LABELS: Record<VfControl, string> = {
  shutter: "Shutter", uploads: "Uploads", seq: "Sequence", light: "Light", fit: "Fit", human: "Human view", rig: "Rig", lens: "Lens strip",
};
/** Short text under an icon when an item shows its label. */
export const VF_SHORT_LABELS: Record<VfControl, string> = {
  shutter: "", uploads: "Uploads", seq: "Seq", light: "Light", fit: "Fit", human: "Human", rig: "Rig", lens: "",
};

export interface VfItem {
  control: VfControl;
  /** Show the short label under the icon (buttons only). */
  label?: boolean;
  /** Lens strip: every value as a button (list) or one value between up/down (carousel). */
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
export interface ViewfinderLayout { v: 1; portrait: VfOrientation; landscape: VfOrientation }
export type VfOrientationName = "portrait" | "landscape";

export const MAX_VF_BARS = 4;
export const MAX_VF_ITEMS = 9;

/** The arrangement the app shipped with before layouts existed. */
export const DEFAULT_VIEWFINDER_LAYOUT: ViewfinderLayout = {
  v: 1,
  portrait: {
    bars: [
      { id: "lens", edge: "end", items: [{ control: "lens", display: "list", size: "fill" }] },
      { id: "controls", edge: "end", items: ["uploads", "seq", "light", "shutter", "fit", "human", "rig"].map((c) => ({ control: c as VfControl })) },
    ],
  },
  landscape: {
    bars: [
      { id: "lens", edge: "start", items: [{ control: "lens", display: "list", size: "fill" }] },
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
  return null;
}
