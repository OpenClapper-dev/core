/**
 * Shot composition (GitHub issue #12): overlays and sketches.
 *
 * An **overlay** is a drawing plus a "look" (exposure, tint, …) over one photo. Its coordinates are
 * fractions of the raw photo (0..1 across the image; values outside are allowed for the black area
 * shown when the rig saw more than the phone), so any frame mode, rig or lens is only a crop or a
 * frame over the same drawing. The mode and frame it was drawn in travel along as the default
 * *presentation*. A **sketch** is the same drawing model on a blank canvas of a chosen aspect ratio
 * (floor plan, lighting diagram, …) and belongs to the shot, not to a photo.
 *
 * The dashboard edits the vector JSON and uploads a flattened render; the phone only shows renders.
 * The Worker validates with `validateDrawing` / `validatePresentation` (strict: these are
 * interactive edits, never captures).
 */
import { validateFrame, type Frame } from "./framing.ts";

/** Ten fixed colours, drawn over photos, so they never take the theme (docs/design.md). */
export const COMPOSE_PALETTE = ["#FFFFFF", "#0B0B0C", "#FF3B30", "#FF9500", "#FFD60A", "#34C759", "#00E5FF", "#0A84FF", "#FF2D95", "#8E8E93"] as const;

/** [x, y] as fractions of the canvas (the raw photo, or the sketch box). */
export type Point = [number, number];

/** Stencil names: four hand-drawn diagram glyphs, then a curated set from Lucide (ISC; issue #46). The paths live in the dashboard. */
export const STENCILS = [
  "camera", "light", "actor", "flag",
  "video", "clapperboard", "film", "still-camera", "monitor", "tv", "mic", "headphones", "speaker", "drone", "cctv",
  "bulb", "lamp", "floor-lamp", "desk-lamp", "wall-lamp", "flashlight", "strobe", "sun", "moon", "fire",
  "person", "group", "standing", "child", "footprints", "eyeline", "dog", "cat",
  "car", "car-front", "bus", "truck", "bike", "train", "plane", "ship", "sailboat", "caravan",
  "house", "building", "tower-block", "door", "door-open", "fence", "armchair", "sofa", "bed", "tent", "umbrella", "cone", "barrier", "table-setting", "cup", "glass",
  "tree", "pine", "trees", "mountain", "water", "cloud",
  "pin", "crosshair",
] as const;
export type Stencil = (typeof STENCILS)[number];
export const STENCIL_LABELS: Record<Stencil, string> = {
  camera: "Camera, top view", light: "Light", actor: "Actor", flag: "Flag",
  video: "Video camera", clapperboard: "Clapperboard", film: "Film", "still-camera": "Stills camera", monitor: "Monitor", tv: "TV", mic: "Microphone", headphones: "Headphones", speaker: "Speaker", drone: "Drone", cctv: "CCTV",
  bulb: "Bulb", lamp: "Lamp", "floor-lamp": "Floor lamp", "desk-lamp": "Desk lamp", "wall-lamp": "Wall lamp", flashlight: "Flashlight", strobe: "Strobe", sun: "Sun", moon: "Moon", fire: "Fire",
  person: "Person", group: "Group", standing: "Standing", child: "Child", footprints: "Footprints", eyeline: "Eyeline", dog: "Dog", cat: "Cat",
  car: "Car", "car-front": "Car, front", bus: "Bus", truck: "Truck", bike: "Bike", train: "Train", plane: "Plane", ship: "Ship", sailboat: "Sailboat", caravan: "Caravan",
  house: "House", building: "Building", "tower-block": "Tower block", door: "Door", "door-open": "Door, open", fence: "Fence", armchair: "Armchair", sofa: "Sofa", bed: "Bed", tent: "Tent", umbrella: "Umbrella", cone: "Traffic cone", barrier: "Barrier", "table-setting": "Table setting", cup: "Cup", glass: "Glass",
  tree: "Tree", pine: "Pine", trees: "Trees", mountain: "Mountain", water: "Water", cloud: "Cloud",
  pin: "Pin", crosshair: "Crosshair",
};
/** The stencil picker's sections, in order. */
export const STENCIL_GROUPS: readonly { label: string; stencils: readonly Stencil[] }[] = [
  { label: "Diagram", stencils: ["camera", "light", "actor", "flag"] },
  { label: "Camera & sound", stencils: ["video", "clapperboard", "film", "still-camera", "monitor", "tv", "mic", "headphones", "speaker", "drone", "cctv"] },
  { label: "Light", stencils: ["bulb", "lamp", "floor-lamp", "desk-lamp", "wall-lamp", "flashlight", "strobe", "sun", "moon", "fire"] },
  { label: "People & animals", stencils: ["person", "group", "standing", "child", "footprints", "eyeline", "dog", "cat"] },
  { label: "Vehicles", stencils: ["car", "car-front", "bus", "truck", "bike", "train", "plane", "ship", "sailboat", "caravan"] },
  { label: "Set & props", stencils: ["house", "building", "tower-block", "door", "door-open", "fence", "armchair", "sofa", "bed", "tent", "umbrella", "cone", "barrier", "table-setting", "cup", "glass"] },
  { label: "Nature & weather", stencils: ["tree", "pine", "trees", "mountain", "water", "cloud"] },
  { label: "Marks", stencils: ["pin", "crosshair"] },
];

interface ShapeBase {
  id: string;
  /** CSS hex colour. */
  color: string;
  /** Stroke width as a fraction of the canvas width (scales with the display and the render). */
  width: number;
  /** 0..1 */
  opacity: number;
  /**
   * Strokes that erase parts of this shape only (issue #46), in canvas fractions like the shape. Moving
   * the shape moves them; resizing or rotating does not.
   */
  mask?: MaskStroke[];
}
/** A freehand eraser stroke of a shape's mask; `width` like a shape's stroke width. */
export interface MaskStroke { width: number; points: Point[] }
export const MAX_MASK_STROKES = 200;
export type Shape =
  | (ShapeBase & { type: "path"; points: Point[] })
  | (ShapeBase & { type: "line" | "arrow" | "rect" | "ellipse"; from: Point; to: Point; fill?: boolean })
  | (ShapeBase & { type: "text"; at: Point; text: string; /** Font size as a fraction of the canvas height. */ size: number })
  | (ShapeBase & { type: "stencil"; at: Point; stencil: Stencil; /** Glyph size as a fraction of the canvas height. */ size: number; /** Degrees, clockwise. */ rotation: number });
export type ShapeType = Shape["type"];
export const SHAPE_TYPES: readonly ShapeType[] = ["path", "line", "arrow", "rect", "ellipse", "text", "stencil"];

/** Overlay look, applied under the drawing. All neutral = the photo as captured. */
export interface Look {
  /** −3..3, 0 = as captured; brightness 4^exposure, so one unit is 2 EV (±6 EV; issue #46 widened it from ±1). */
  exposure: number;
  /** −1..1 */
  contrast: number;
  /** −1..1; −1 is fully desaturated. */
  saturation: number;
  /** Black and white. */
  bw: boolean;
  /** Colour layer blended over the photo, or null. */
  tint: string | null;
  /** 0..1 */
  tint_opacity: number;
  /** 0..1 radial darkening towards the corners. */
  vignette: number;
  /** 0..1 softness. */
  blur: number;
}
export const NEUTRAL_LOOK: Look = { exposure: 0, contrast: 0, saturation: 0, bw: false, tint: null, tint_opacity: 0.3, vignette: 0, blur: 0 };
export const isNeutralLook = (l: Look) => l.exposure === 0 && l.contrast === 0 && l.saturation === 0 && !l.bw && l.tint === null && l.vignette === 0 && l.blur === 0;

export interface Drawing {
  v: 1;
  shapes: Shape[];
  /** Overlays only; null on sketches. */
  look: Look | null;
}
export const emptyDrawing = (withLook: boolean): Drawing => ({ v: 1, shapes: [], look: withLook ? { ...NEUTRAL_LOOK } : null });

/** How an overlay is shown by default: the frame mode and the rig frame it was drawn in. */
export interface Presentation {
  mode: "mask" | "frame" | "fit" | "off";
  /** Rig frame relative to the photo, with its centre (framing.ts); null = the photo's root frame. A copy, kept as fallback when `framing_id` is set. */
  frame: Frame | null;
  /** The saved framing this follows (issue #29); its edits apply here. Null or absent = as captured / the copy in `frame`. */
  framing_id?: string | null;
  /** "6K FULL · 24 mm", for display only. */
  label: string | null;
  /** The rig preset and lens the frame came from, so the editor can show the pickers again; null = as shot. */
  rig_id?: string | null;
  lens_mm?: number | null;
}
export const PRESENTATION_MODES: readonly Presentation["mode"][] = ["mask", "frame", "fit", "off"];

/** Suggested sketch kinds; the stored `kind` is free text, these are only offered first. */
export const SKETCH_KINDS = ["floor_plan", "lighting", "blocking", "storyboard"] as const;
export type SketchKind = (typeof SKETCH_KINDS)[number];
export const SKETCH_KIND_LABELS: Record<SketchKind, string> = { floor_plan: "Floor plan", lighting: "Lighting diagram", blocking: "Blocking", storyboard: "Storyboard" };
/** Display label for a stored kind: a known id's label, else the text itself. */
export const sketchKindLabel = (kind: string | null): string => (kind ? SKETCH_KIND_LABELS[kind as SketchKind] ?? kind : "");
/** Sketch canvas aspect ratios (w/h) offered in the editor. */
export const SKETCH_ASPECTS: readonly { id: string; aspect: number }[] = [{ id: "16:9", aspect: 16 / 9 }, { id: "4:3", aspect: 4 / 3 }, { id: "1:1", aspect: 1 }, { id: "3:4", aspect: 3 / 4 }];

export const MAX_SHAPES = 3000;
export const MAX_PATH_POINTS = 4000;
export const MAX_TEXT = 200;
export const MAX_COMPOSE_NAME = 80;
export const MAX_SKETCH_KIND = 40;
export const MAX_DESCRIPTION = 20_000;
const COORD_MIN = -3, COORD_MAX = 4;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const point = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && num(v[0], COORD_MIN, COORD_MAX) && num(v[1], COORD_MIN, COORD_MAX);

function validateShape(v: unknown, i: number): string | null {
  const at = `shapes[${i}]`;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return `${at} must be an object`;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== "string" || !s.id || s.id.length > 40) return `${at}.id must be a string (max 40)`;
  if (!SHAPE_TYPES.includes(s.type as ShapeType)) return `${at}.type must be one of ${SHAPE_TYPES.join(", ")}`;
  if (typeof s.color !== "string" || !HEX_RE.test(s.color)) return `${at}.color must be a #rrggbb colour`;
  if (!num(s.width, 0, 0.2)) return `${at}.width must be 0..0.2 (fraction of the canvas width)`;
  if (!num(s.opacity, 0, 1)) return `${at}.opacity must be 0..1`;
  if (s.mask !== undefined) {
    if (!Array.isArray(s.mask) || s.mask.length > MAX_MASK_STROKES) return `${at}.mask must be up to ${MAX_MASK_STROKES} strokes`;
    for (const m of s.mask as unknown[]) {
      const k = m as Record<string, unknown> | null;
      if (!k || !num(k.width, 0, 0.5) || !Array.isArray(k.points) || k.points.length === 0 || k.points.length > MAX_PATH_POINTS || !k.points.every(point)) return `${at}.mask strokes need a width (0..0.5) and 1..${MAX_PATH_POINTS} points`;
    }
  }
  switch (s.type as ShapeType) {
    case "path":
      if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > MAX_PATH_POINTS) return `${at}.points must be 1..${MAX_PATH_POINTS} points`;
      if (!s.points.every(point)) return `${at}.points must be [x, y] pairs within ${COORD_MIN}..${COORD_MAX}`;
      return null;
    case "line": case "arrow": case "rect": case "ellipse":
      if (!point(s.from) || !point(s.to)) return `${at}.from/to must be [x, y] pairs within ${COORD_MIN}..${COORD_MAX}`;
      if (s.fill !== undefined && typeof s.fill !== "boolean") return `${at}.fill must be true or false`;
      return null;
    case "text":
      if (!point(s.at)) return `${at}.at must be an [x, y] pair`;
      if (typeof s.text !== "string" || s.text.length > MAX_TEXT) return `${at}.text must be a string (max ${MAX_TEXT})`;
      if (!num(s.size, 0.005, 0.5)) return `${at}.size must be 0.005..0.5 (fraction of the canvas height)`;
      return null;
    case "stencil":
      if (!point(s.at)) return `${at}.at must be an [x, y] pair`;
      if (!STENCILS.includes(s.stencil as Stencil)) return `${at}.stencil "${String(s.stencil)}" is not a known stencil`;
      if (!num(s.size, 0.01, 1)) return `${at}.size must be 0.01..1`;
      if (!num(s.rotation, -360, 360)) return `${at}.rotation must be degrees within ±360`;
      return null;
  }
}

export function validateLook(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "look must be an object";
  const l = v as Record<string, unknown>;
  if (!num(l.exposure, -3, 3)) return "look.exposure must be −3..3";
  for (const k of ["contrast", "saturation"] as const) if (!num(l[k], -1, 1)) return `look.${k} must be −1..1`;
  if (typeof l.bw !== "boolean") return "look.bw must be true or false";
  if (l.tint !== null && (typeof l.tint !== "string" || !HEX_RE.test(l.tint))) return "look.tint must be a #rrggbb colour or null";
  for (const k of ["tint_opacity", "vignette", "blur"] as const) if (!num(l[k], 0, 1)) return `look.${k} must be 0..1`;
  return null;
}

/** Structural check of a drawing. `withLook`: an overlay must carry a look, a sketch must not. */
export function validateDrawing(v: unknown, withLook: boolean): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "drawing must be an object";
  const d = v as Record<string, unknown>;
  if (d.v !== 1) return "drawing.v must be 1";
  if (!Array.isArray(d.shapes)) return "drawing.shapes must be an array";
  if (d.shapes.length > MAX_SHAPES) return `drawing has too many shapes (max ${MAX_SHAPES})`;
  const ids = new Set<string>();
  for (let i = 0; i < d.shapes.length; i++) {
    const err = validateShape(d.shapes[i], i);
    if (err) return err;
    const id = (d.shapes[i] as Shape).id;
    if (ids.has(id)) return `shapes[${i}].id is used twice`;
    ids.add(id);
  }
  if (withLook) { if (d.look === null || d.look === undefined) return "an overlay needs a look"; return validateLook(d.look); }
  if (d.look !== null && d.look !== undefined) return "a sketch has no look";
  return null;
}

export function validatePresentation(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "presentation must be an object";
  const p = v as Record<string, unknown>;
  if (!PRESENTATION_MODES.includes(p.mode as Presentation["mode"])) return `presentation.mode must be one of ${PRESENTATION_MODES.join(", ")}`;
  if (p.frame !== null && p.frame !== undefined) {
    const err = validateFrame(p.frame, "presentation.frame");
    if (err) return err;
  }
  if (p.framing_id !== null && p.framing_id !== undefined && (typeof p.framing_id !== "string" || p.framing_id.length > 40)) return "presentation.framing_id must be a string or null";
  if (p.label !== null && p.label !== undefined && (typeof p.label !== "string" || p.label.length > 80)) return "presentation.label must be a string (max 80) or null";
  if (p.rig_id !== null && p.rig_id !== undefined && (typeof p.rig_id !== "string" || p.rig_id.length > 40)) return "presentation.rig_id must be a string or null";
  if (p.lens_mm !== null && p.lens_mm !== undefined && !num(p.lens_mm, 1, 2000)) return "presentation.lens_mm must be 1..2000 or null";
  return null;
}

/** Axis-aligned bounds of a shape in canvas fractions (text and stencils use their anchor plus size). */
export function shapeBounds(s: Shape, aspect: number): { x0: number; y0: number; x1: number; y1: number } {
  switch (s.type) {
    case "path": {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of s.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x0, y0, x1, y1 };
    }
    case "line": case "arrow": case "rect": case "ellipse":
      return { x0: Math.min(s.from[0], s.to[0]), y0: Math.min(s.from[1], s.to[1]), x1: Math.max(s.from[0], s.to[0]), y1: Math.max(s.from[1], s.to[1]) };
    case "text": {
      // Roughly 0.55 em per character; good enough for selection and hit testing.
      const w = s.size * 0.55 * Math.max(1, s.text.length) / aspect;
      return { x0: s.at[0], y0: s.at[1] - s.size, x1: s.at[0] + w, y1: s.at[1] + s.size * 0.25 };
    }
    case "stencil": {
      const h = s.size / 2, w = s.size / 2 / aspect;
      return { x0: s.at[0] - w, y0: s.at[1] - h, x1: s.at[0] + w, y1: s.at[1] + h };
    }
  }
}

/** The shape moved by (dx, dy) canvas fractions. */
export function moveShape(s: Shape, dx: number, dy: number): Shape {
  const mv = (p: Point): Point => [p[0] + dx, p[1] + dy];
  const m = s.mask ? { mask: s.mask.map((k) => ({ ...k, points: k.points.map(mv) })) } : {};
  switch (s.type) {
    case "path": return { ...s, ...m, points: s.points.map(mv) };
    case "line": case "arrow": case "rect": case "ellipse": return { ...s, ...m, from: mv(s.from), to: mv(s.to) };
    case "text": case "stencil": return { ...s, ...m, at: mv(s.at) };
  }
}

/**
 * Drop points that add nothing visible: closer than `tolerance` (canvas fraction) to the last kept
 * point. Keeps freehand strokes small enough for D1 without changing their look.
 */
export function simplifyPoints(points: Point[], tolerance = 0.002): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [lx, ly] = out[out.length - 1];
    const [x, y] = points[i];
    if (Math.hypot(x - lx, y - ly) >= tolerance) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** The CSS `filter` string for a look (brightness, contrast, saturate, grayscale, blur in px). */
export function lookFilter(l: Look, blurPx: number): string {
  const parts: string[] = [];
  if (l.exposure !== 0) parts.push(`brightness(${(4 ** l.exposure).toFixed(4)})`);
  if (l.contrast !== 0) parts.push(`contrast(${(1 + l.contrast).toFixed(3)})`);
  if (l.saturation !== 0) parts.push(`saturate(${(l.saturation >= 0 ? 1 + l.saturation * 2 : 1 + l.saturation).toFixed(3)})`);
  if (l.bw) parts.push("grayscale(1)");
  if (l.blur > 0) parts.push(`blur(${(l.blur * blurPx).toFixed(2)}px)`);
  return parts.join(" ") || "none";
}
