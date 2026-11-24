// What a picture of a shot, a set or a location shows (docs/features/shots.md): a photo or a canvas, seen
// through a frame (its own, a progression's default, or the canvas's picture), as fractions of its surface.
// Pure: the stage, the strips and every thumbnail use it, so a frame looks the same everywhere.
import { frameValuesError, type CanvasBody, type CanvasFrame, type FrameValues, type PresetBody } from "@openclapper/model";
import { renderUrl, type FileRec } from "../api";
import { baseOf } from "../apps/CanvasApp";
import { rectOf } from "../canvas/geometry";
import { imageUrl } from "../media";

export type Mode = "outline" | "mask" | "crop" | "full";
export interface Rect { x: number; y: number; w: number; h: number }
/** Where the frame came from: the item's own, the progression's default, the canvas's picture, or none. */
export type Source = "own" | "default" | "picture" | "none";
export interface Seen {
  file?: FileRec;
  missing?: boolean;
  /** The surface's image and its aspect (width over height). */
  src?: string; aspect: number;
  /** The frame on the surface (fractions), its delivery's inner box (fractions of the frame), its name and colour. */
  rect?: Rect; inner?: { w: number; h: number } | null; name?: string; color?: CanvasFrame["color"];
  /** Other frames of the canvas (the two ends of a move), for Outline. */
  others?: { rect: Rect; color: CanvasFrame["color"]; name: string }[];
  source: Source;
  /** The surface has an angle of view (a photo, a canvas on a photo): a default frame can apply. */
  optics: boolean;
}
/** A reference to a picture: a file, optionally one frame of it, or a move from that frame to another. */
export interface PicRef { to: string; frame?: string; move?: { to: string; ease: boolean } }

export interface PicCtx { files: ReadonlyMap<string, FileRec>; presets: ReadonlyMap<string, PresetBody> }

const ease = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
// Sizes change on a log scale, so a zoom looks even all the way.
const glerp = (a: number, b: number, u: number) => (a > 0 && b > 0 ? Math.exp(lerp(Math.log(a), Math.log(b), u)) : lerp(a, b, u));

function frameRect(f: CanvasFrame, base: ReturnType<typeof baseOf>, presets: ReadonlyMap<string, PresetBody>) {
  const r = rectOf(f, { base, presets });
  return r ? { rect: { x: f.cx - r.w / 2, y: f.cy - r.h / 2, w: r.w, h: r.h }, inner: r.inner ? { w: r.inner.w / r.w, h: r.inner.h / r.h } : null, focal: f.focal } : null;
}

/** A default frame as a frame on the photo, centred. */
export const defaultAsFrame = (v: FrameValues): CanvasFrame => ({ ...v, id: "default", name: describeFrame(v), color: 0, cx: 0.5, cy: 0.5, visible: true });

/** A default frame in a few words: "35 mm", "2.39:1", "Super 35 · 50 mm". */
export function describeFrame(v: FrameValues, presetName?: (id: string) => string | undefined): string {
  if (v.kind === "aspect") return `${Number((v.aspect ?? 1).toFixed(2))}:1`;
  const name = v.kind === "preset" && v.preset ? presetName?.(v.preset) : undefined;
  return `${name ? `${name} · ` : ""}${v.focal ?? "?"} mm`;
}

/** What a reference shows. `def` is the progression's default frame (only for its items); `u` how far a move is (0 to 1). */
export function see(ref: PicRef, ctx: PicCtx, def: FrameValues | null = null, u = 0): Seen {
  const file = ctx.files.get(ref.to);
  if (!file || file.deleted_at) return { file, missing: true, aspect: 4 / 3, source: "none", optics: false };
  if (file.type === "photo") {
    const base = baseOf(file);
    const src = file.photo?.stored.preview ? imageUrl(file.id, "preview") : file.photo?.stored.thumbnail ? imageUrl(file.id, "thumbnail") : undefined;
    const out: Seen = { file, src, aspect: base?.aspect ?? 4 / 3, source: "none", optics: !!base?.view };
    if (def && !frameValuesError(def)) {
      const r = frameRect(defaultAsFrame(def), base, ctx.presets);
      if (r) return { ...out, ...r, name: describeFrame(def), color: 0, source: "default" };
    }
    return out;
  }
  if (file.type === "canvas") {
    const body = file.body as unknown as CanvasBody | undefined;
    const baseId = file.refs?.find((r) => r.kind === "base")?.to;
    const base = body?.surface.kind === "photo" ? baseOf(baseId ? ctx.files.get(baseId) : undefined) : null;
    const saved = file.updated_at && file.updated_at !== file.created_at;
    const aspect = body?.surface.kind === "blank" ? body.surface.aspect : base?.aspect ?? 4 / 3;
    const out: Seen = { file, src: saved ? renderUrl(file, "render") : base?.src, aspect, source: "none", optics: !!base?.view };
    const frames = body?.frames ?? [];
    const own = frames.find((f) => f.id === ref.frame);
    if (own) {
      const a = frameRect(own, base, ctx.presets);
      const end = ref.move ? frames.find((f) => f.id === ref.move!.to) : undefined;
      const b = end ? frameRect(end, base, ctx.presets) : null;
      if (a && b) {
        const k = ref.move!.ease ? ease(Math.max(0, Math.min(1, u))) : Math.max(0, Math.min(1, u));
        const w = glerp(a.rect.w, b.rect.w, k), h = glerp(a.rect.h, b.rect.h, k);
        const cx = lerp(a.rect.x + a.rect.w / 2, b.rect.x + b.rect.w / 2, k), cy = lerp(a.rect.y + a.rect.h / 2, b.rect.y + b.rect.h / 2, k);
        const focal = a.focal && b.focal ? Math.round(glerp(a.focal, b.focal, k)) : undefined;
        return { ...out, rect: { x: cx - w / 2, y: cy - h / 2, w, h }, inner: a.inner, name: focal ? `${focal} mm` : own.name, color: own.color, source: "own", others: [{ rect: a.rect, color: own.color, name: own.name }, { rect: b.rect, color: end!.color, name: end!.name }] };
      }
      if (a) return { ...out, ...a, name: own.name, color: own.color, source: "own" };
    }
    if (def && base?.view && !frameValuesError(def)) {
      const r = frameRect(defaultAsFrame(def), base, ctx.presets);
      if (r) return { ...out, ...r, name: describeFrame(def), color: 0, source: "default" };
    }
    const pic = frames.find((f) => f.id === body?.picture && f.visible);
    const r = pic ? frameRect(pic, base, ctx.presets) : null;
    return r ? { ...out, ...r, name: pic!.name, color: pic!.color, source: "picture" } : out;
  }
  return { file, aspect: 4 / 3, source: "none", optics: false };
}

/** The frame sees more than the surface shows: the area beyond is hatched. */
export const beyond = (s: Seen) => !!s.rect && (s.rect.x < -0.001 || s.rect.y < -0.001 || s.rect.x + s.rect.w > 1.001 || s.rect.y + s.rect.h > 1.001);

/** A photo seen through a frame that is not stored yet (the generator's preview); `others` are drawn in Outline. */
export function seeFrame(photo: FileRec, f: CanvasFrame, presets: ReadonlyMap<string, PresetBody>, others: readonly CanvasFrame[] = []): Seen {
  const base = baseOf(photo);
  const src = photo.photo?.stored.preview ? imageUrl(photo.id, "preview") : undefined;
  const r = frameRect(f, base, presets);
  const out: Seen = { file: photo, src, aspect: base?.aspect ?? 4 / 3, source: "own", optics: !!base?.view };
  if (!r) return out;
  const rest = others.map((o) => ({ o, r: frameRect(o, base, presets) })).filter((x) => x.r).map((x) => ({ rect: x.r!.rect, color: x.o.color, name: x.o.name }));
  return { ...out, ...r, name: f.name, color: f.color, others: rest };
}

/** Between two frames of one photo: centre straight, size on a log scale; `u` from 0 to 1. */
export function seeBetween(photo: FileRec, a: CanvasFrame, b: CanvasFrame, presets: ReadonlyMap<string, PresetBody>, u: number, eased: boolean): Seen {
  const sa = seeFrame(photo, a, presets), sb = seeFrame(photo, b, presets);
  if (!sa.rect || !sb.rect) return sa;
  const k = eased ? ease(u) : u, w = glerp(sa.rect.w, sb.rect.w, k), h = glerp(sa.rect.h, sb.rect.h, k);
  const cx = lerp(sa.rect.x + sa.rect.w / 2, sb.rect.x + sb.rect.w / 2, k), cy = lerp(sa.rect.y + sa.rect.h / 2, sb.rect.y + sb.rect.h / 2, k);
  const focal = a.focal && b.focal ? Math.round(glerp(a.focal, b.focal, k)) : undefined;
  return { ...sa, rect: { x: cx - w / 2, y: cy - h / 2, w, h }, name: focal ? `${focal} mm` : a.name };
}
