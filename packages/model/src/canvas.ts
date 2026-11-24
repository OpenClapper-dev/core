/**
 * The canvas and the optics preset (docs/rewrite/05-composition.md, 02-optics.md, ux-2-canvas.md): the
 * shape of their bodies and the rules both sides run. Everything on a canvas is in fractions of its
 * surface; nothing here depends on a renderer, so the Studio, a tablet and the server share it.
 */
import type { Ref } from "./files.ts";
import type { Colour } from "./properties.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_ID = /^[a-z0-9_-]{1,40}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, min = -1e6, max = 1e6) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const colourOk = (c: unknown) => (typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 8) || (typeof c === "string" && HEX.test(c));
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;


// ---------- Optics presets ----------

export type Lenses = { kind: "primes"; primes: number[] } | { kind: "zoom"; from: number; to: number };
export interface PresetBody {
  format: [number, number];
  /** The name of the format from the generic list, or null for one typed in. */
  formatName: string | null;
  multiplier: number;
  squeeze: number;
  delivery: number | null;
  lenses: Lenses;
  /** Out of the pickers; its frames keep working. A preset in use is archived instead of deleted. */
  archived: boolean;
}

const focalOk = (f: unknown) => typeof f === "number" && Number.isInteger(f) && f >= 1 && f <= 2000;

export function presetError(b: Record<string, unknown>): string | null {
  for (const k of Object.keys(b)) if (!["format", "formatName", "multiplier", "squeeze", "delivery", "lenses", "archived"].includes(k)) return `an optics preset has no "${k}"`;
  if (!Array.isArray(b.format) || b.format.length !== 2 || !b.format.every((x) => num(x, 0.5, 200))) return "format is width and height in mm";
  if (!(b.formatName === null || text(b.formatName, 60))) return "formatName is a text or null";
  if (!num(b.multiplier, 0.2, 5)) return "multiplier is between 0.2 and 5";
  if (!num(b.squeeze, 1, 3)) return "squeeze is between 1 and 3";
  if (!(b.delivery === null || num(b.delivery, 0.2, 5))) return "delivery is an aspect ratio or null";
  if (typeof b.archived !== "boolean") return "archived is yes or no";
  const l = b.lenses;
  if (!isObj(l)) return "lenses are primes or a zoom";
  if (l.kind === "primes") {
    if (!Array.isArray(l.primes) || !l.primes.length || l.primes.length > 60 || !l.primes.every(focalOk)) return "primes are 1 to 60 focal lengths in whole mm";
    if (new Set(l.primes).size !== l.primes.length) return "a prime is listed twice";
  } else if (l.kind === "zoom") {
    if (!focalOk(l.from) || !focalOk(l.to) || (l.from as number) >= (l.to as number)) return "a zoom goes from a shorter to a longer whole mm";
  } else return "lenses are primes or a zoom";
  return null;
}

/** The focal lengths a preset offers: its primes, or every whole mm of its zoom. */
export const focalsOf = (l: Lenses): number[] => (l.kind === "primes" ? [...l.primes].sort((a, b) => a - b) : Array.from({ length: l.to - l.from + 1 }, (_, i) => l.from + i));
export const offers = (l: Lenses, focal: number) => (l.kind === "primes" ? l.primes.includes(focal) : focal >= l.from && focal <= l.to);

/**
 * What may change on a preset (02-optics.md, "additive only"): the name always; format, multiplier,
 * squeeze and delivery never; lenses may be added, and removed or narrowed only where no frame uses
 * them. `used` are the focal lengths frames of the project use with this preset.
 */
export function presetChangeError(before: PresetBody, after: PresetBody, used: readonly number[]): string | null {
  if (before.format[0] !== after.format[0] || before.format[1] !== after.format[1] || before.formatName !== after.formatName) return "a preset's format cannot change; duplicate it for another";
  if (before.multiplier !== after.multiplier || before.squeeze !== after.squeeze || before.delivery !== after.delivery) return "a preset's multiplier, squeeze and delivery cannot change; duplicate it for others";
  if (before.lenses.kind !== after.lenses.kind) return "primes cannot become a zoom or the other way round; duplicate the preset";
  const lost = used.filter((f) => !offers(after.lenses, f));
  if (lost.length) return `${[...new Set(lost)].sort((a, b) => a - b).join(", ")} mm ${lost.length === 1 ? "is" : "are"} used by frames and cannot be removed`;
  return null;
}

// ---------- The canvas ----------

export type PenType = "pen" | "marker" | "highlighter" | "brush" | "dashed";
export const PEN_TYPES: readonly PenType[] = ["pen", "marker", "highlighter", "brush", "dashed"];
export type ObjKind = "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "stencil" | "picture" | "group";
export const OBJ_KINDS: readonly ObjKind[] = ["pen", "line", "arrow", "rect", "ellipse", "text", "stencil", "picture", "group"];
/** Exposure (stops), contrast and saturation (−1..1): a look belongs to a photo, the base photo or a placed one. */
export interface Look { exposure: number; contrast: number; saturation: number }

/**
 * Anything on the canvas. Its place in the list is its place in the stack (last = on top). x, y, w, h
 * are fractions of the surface; a group has no shape of its own, its members name it in `group`.
 */
export interface CanvasObject {
  id: string; kind: ObjKind; name: string;
  x: number; y: number; w: number; h: number;
  /** Pen, line and arrow: points inside the box, 0..1, flat (x0, y0, x1, y1, …) to keep a body small. */
  pts?: number[];
  stroke: Colour; fill?: Colour | null; width: number; opacity: number;
  text?: string; icon?: string;
  /** A placed picture: the photo of the project it shows. */
  photo?: string;
  look?: Look;
  rot?: number; pen?: PenType;
  visible: boolean; locked: boolean; group?: string | null;
}

export type FrameKind = "preset" | "free" | "aspect";
/**
 * A frame on a canvas with a base photo: from an optics preset (the preset and one of its focal
 * lengths), free-form (it owns its values), or an aspect ratio. Position is its centre in fractions of
 * the photo; an aspect frame also has a size (fraction of the photo's width).
 */
export interface CanvasFrame {
  id: string; name: string; color: Colour; kind: FrameKind;
  preset?: string | null; focal?: number;
  format?: [number, number]; multiplier?: number; squeeze?: number; delivery?: number | null;
  aspect?: number; size?: number;
  portrait: boolean; cx: number; cy: number; visible: boolean;
}

export interface CommentReply { author: string; at: string; text: string }
export interface CanvasComment { id: string; n: number; x: number; y: number; w?: number; h?: number; author: string; at: string; text: string; replies: CommentReply[]; resolved: boolean }

export type Surface = { kind: "blank"; aspect: number; color: Colour } | { kind: "photo"; look?: Look };
export interface CanvasBody {
  surface: Surface;
  objects: CanvasObject[];
  frames: CanvasFrame[];
  /** The frame the canvas stands for (thumbnail, shot, clip), or null: the whole surface. */
  picture: string | null;
  /** Frames share one centre and move together. */
  linkCentres: boolean;
  comments: CanvasComment[];
}

export const emptyCanvas = (aspect = 16 / 9): CanvasBody => ({ surface: { kind: "blank", aspect, color: "#ffffff" }, objects: [], frames: [], picture: null, linkCentres: true, comments: [] });

const MAX_OBJECTS = 5000, MAX_POINTS = 200_000, MAX_FRAMES = 60, MAX_COMMENTS = 500;

function lookError(l: unknown): string | null {
  if (!isObj(l) || !num(l.exposure, -5, 5) || !num(l.contrast, -1, 1) || !num(l.saturation, -1, 1)) return "a look is exposure, contrast and saturation";
  return Object.keys(l).length === 3 ? null : "a look is exposure, contrast and saturation";
}

function objectError(o: unknown, ids: Set<string>, groups: Set<string>): string | null {
  if (!isObj(o)) return "an object is an object";
  if (typeof o.id !== "string" || !LOCAL_ID.test(o.id) || ids.has(o.id)) return "each object has its own id";
  ids.add(o.id);
  if (!(OBJ_KINDS as readonly unknown[]).includes(o.kind)) return `an object's kind is one of: ${OBJ_KINDS.join(", ")}`;
  if (o.kind === "group") groups.add(o.id);
  if (!text(o.name, 120)) return "an object's name is a text";
  if (![o.x, o.y].every((v) => num(v, -10, 10)) || ![o.w, o.h].every((v) => num(v, 0, 20))) return "an object's box is in fractions of the surface";
  if (o.pts !== undefined && !(Array.isArray(o.pts) && o.pts.length % 2 === 0 && o.pts.every((v) => num(v, -2, 3)))) return "points are pairs of fractions";
  if (!colourOk(o.stroke) || !(o.fill === undefined || o.fill === null || colourOk(o.fill))) return "a colour is 0 to 8 or #rrggbb";
  if (!num(o.width, 0, 200) || !num(o.opacity, 0, 1)) return "width and opacity are numbers";
  if (o.text !== undefined && !text(o.text, 5000)) return "a text has at most 5000 characters";
  if (o.icon !== undefined && !text(o.icon, 40)) return "a stencil names a glyph";
  if (o.kind === "picture" ? !(typeof o.photo === "string" && UUID.test(o.photo)) : o.photo !== undefined) return "a placed picture names a photo";
  if (o.look !== undefined && (o.kind !== "picture" || lookError(o.look))) return "only a placed picture has a look";
  if (o.rot !== undefined && !num(o.rot, -3600, 3600)) return "rotation is degrees";
  if (o.pen !== undefined && !(PEN_TYPES as readonly unknown[]).includes(o.pen)) return "a pen is one of the kinds of pen";
  if (typeof o.visible !== "boolean" || typeof o.locked !== "boolean") return "visible and locked are yes or no";
  if (!(o.group === undefined || o.group === null || (typeof o.group === "string" && LOCAL_ID.test(o.group)))) return "group names a group";
  return null;
}

function frameError(f: unknown, ids: Set<string>): string | null {
  if (!isObj(f)) return "a frame is an object";
  if (typeof f.id !== "string" || !LOCAL_ID.test(f.id) || ids.has(f.id)) return "each frame has its own id";
  ids.add(f.id);
  if (!text(f.name, 80) || !colourOk(f.color)) return "a frame has a name and a colour";
  if (typeof f.portrait !== "boolean" || typeof f.visible !== "boolean" || !num(f.cx, -2, 3) || !num(f.cy, -2, 3)) return "a frame has a centre, an orientation and visibility";
  if (f.kind === "preset") {
    if (!(typeof f.preset === "string" && UUID.test(f.preset)) || !focalOk(f.focal)) return "a preset frame names a preset and a focal length";
  } else if (f.kind === "free") {
    if (!Array.isArray(f.format) || f.format.length !== 2 || !f.format.every((x) => num(x, 0.5, 200))) return "a free-form frame has a format";
    if (!num(f.multiplier, 0.2, 5) || !num(f.squeeze, 1, 3) || !focalOk(f.focal) || !(f.delivery == null || num(f.delivery, 0.2, 5))) return "a free-form frame has multiplier, squeeze, focal length and delivery";
  } else if (f.kind === "aspect") {
    if (!num(f.aspect, 0.1, 10) || !num(f.size, 0.01, 1)) return "an aspect frame has an aspect and a size";
  } else return "a frame is from a preset, free-form or an aspect";
  return null;
}

/** Null when a canvas body and its references are valid. A base photo is the one "base" reference; each placed picture one "placed" reference. */
export function canvasError(b: Record<string, unknown>, refs: readonly Ref[] | null): string | null {
  for (const k of Object.keys(b)) if (!["surface", "objects", "frames", "picture", "linkCentres", "comments"].includes(k)) return `a canvas has no "${k}"`;
  const s = b.surface;
  if (!isObj(s)) return "surface is blank or a photo";
  if (s.kind === "blank") {
    if (!num(s.aspect, 0.1, 10) || !colourOk(s.color) || Object.keys(s).length !== 3) return "a blank surface has an aspect and a colour";
  } else if (s.kind === "photo") {
    if (s.look !== undefined && lookError(s.look)) return lookError(s.look);
  } else return "surface is blank or a photo";
  if (!Array.isArray(b.objects) || b.objects.length > MAX_OBJECTS) return `at most ${MAX_OBJECTS} objects`;
  const ids = new Set<string>(), groups = new Set<string>();
  let points = 0;
  for (const o of b.objects) { const e = objectError(o, ids, groups); if (e) return e; points += ((o as CanvasObject).pts?.length ?? 0) / 2; }
  if (points > MAX_POINTS) return `at most ${MAX_POINTS} points in all`;
  for (const o of b.objects as CanvasObject[]) if (o.group && !groups.has(o.group)) return "an object names a group that is not there";
  if (!Array.isArray(b.frames) || b.frames.length > MAX_FRAMES) return `at most ${MAX_FRAMES} frames`;
  if (b.frames.length && s.kind !== "photo") return "only a canvas with a base photo has frames";
  const fids = new Set<string>();
  for (const f of b.frames) { const e = frameError(f, fids); if (e) return e; }
  if (!(b.picture === null || (typeof b.picture === "string" && fids.has(b.picture)))) return "the picture is one of the frames, or none";
  if (typeof b.linkCentres !== "boolean") return "linkCentres is yes or no";
  if (!Array.isArray(b.comments) || b.comments.length > MAX_COMMENTS) return `at most ${MAX_COMMENTS} comments`;
  for (const c of b.comments) {
    if (!isObj(c) || typeof c.id !== "string" || !LOCAL_ID.test(c.id) || !Number.isInteger(c.n) || !num(c.x, -1, 2) || !num(c.y, -1, 2)) return "a comment has an id, a number and a place";
    if ((c.w !== undefined && !num(c.w, 0, 3)) || (c.h !== undefined && !num(c.h, 0, 3))) return "a comment's region is in fractions";
    if (!text(c.author, 60) || !text(c.at, 40) || !text(c.text, 5000) || typeof c.resolved !== "boolean") return "a comment has an author, a time, a text and whether it is resolved";
    if (!Array.isArray(c.replies) || c.replies.length > 200 || !c.replies.every((r) => isObj(r) && text(r.author, 60) && text(r.at, 40) && text(r.text, 5000))) return "replies have an author, a time and a text";
  }
  if (refs) {
    const base = refs.filter((r) => r.kind === "base");
    if (s.kind === "photo" ? base.length !== 1 : base.length !== 0) return s.kind === "photo" ? "a canvas on a photo keeps one base reference" : "a blank canvas has no base photo";
    const placed = refs.filter((r) => r.kind === "placed").map((r) => r.to).sort();
    const pictures = (b.objects as CanvasObject[]).filter((o) => o.kind === "picture").map((o) => o.photo!.toLowerCase()).sort();
    if (placed.join() !== pictures.join()) return "each placed picture keeps one placed reference";
  }
  return null;
}

/** The references a canvas body implies: its base photo (given) and one per placed picture. */
export const canvasRefs = (b: CanvasBody, base: string | null): Ref[] => [
  ...(base ? [{ kind: "base" as const, to: base }] : []),
  ...b.objects.filter((o) => o.kind === "picture" && o.photo).map((o) => ({ kind: "placed" as const, to: o.photo!, data: { object: o.id } })),
];

/** A copy's body: placed pictures that were copied along point at the copies. */
export function remapCanvas(b: Record<string, unknown>, ids: ReadonlyMap<string, string>): Record<string, unknown> {
  const objects = (b.objects as CanvasObject[] | undefined)?.map((o) => (o.photo && ids.has(o.photo) ? { ...o, photo: ids.get(o.photo)! } : o));
  return objects ? { ...b, objects } : b;
}

/** Which focal lengths of which presets a canvas's frames use (the server keeps them in `frames`). */
export const framesUsing = (b: CanvasBody) => b.frames.filter((f) => f.kind === "preset" && f.preset && f.focal).map((f) => ({ frame: f.id, preset: f.preset!, focal: f.focal! }));
