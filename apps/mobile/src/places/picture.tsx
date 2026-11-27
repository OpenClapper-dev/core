import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { aspectFrame, opticsFrame } from "@openclapper/fov-math";
import { frameOptics, frameValuesError, type CanvasBody, type CanvasFrame, type FrameValues, type PresetBody } from "@openclapper/model";
import { authHeaders, canvasImageUrl, getFile, type FileRec } from "../api";
import { imageSource } from "../media/cache";
import { FIXED, Icon, useTheme } from "../ui";

/**
 * A picture of a shot, a set or a location on the phone (docs/features/shots.md): a photo or a canvas,
 * cropped to its frame (its own, the progression's default, or the canvas's picture), as the Studio
 * shows it in Crop. A smooth move is the frame between two of a canvas's frames at `u` (0 to 1).
 */
export interface PicRef { to: string; frame?: string; move?: { to: string; ease: boolean } }
interface Rect { x: number; y: number; w: number; h: number }

// Canvas bodies are not in the library (they can be large): read once when a picture needs its frames.
const bodies = new Map<string, { at: string; body: CanvasBody | null; base: string | null }>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
function want(f: FileRec) {
  const at = f.updated_at ?? f.created_at, have = bodies.get(f.id);
  if ((have && have.at === at) || waiting.has(f.id)) return;
  waiting.add(f.id);
  getFile(f.id).then((x) => { bodies.set(f.id, { at, body: (x.body ?? null) as CanvasBody | null, base: x.refs?.find((r) => r.kind === "base")?.to ?? null }); }, () => {})
    .finally(() => { waiting.delete(f.id); for (const cb of listeners) cb(); });
}
function useBodies() { const [, tick] = useState(0); useEffect(() => { const cb = () => tick((n) => n + 1); listeners.add(cb); return () => { listeners.delete(cb); }; }, []); }

const view = (p: FileRec | undefined) => (p?.photo?.angle_of_view ? { horizontal: p.photo.angle_of_view.horizontal, vertical: p.photo.angle_of_view.vertical } : null);
const aspectOf = (p: FileRec | undefined) => (p?.photo && p.photo.height ? p.photo.width / p.photo.height : 4 / 3);

function rectOf(f: CanvasFrame, photo: FileRec | undefined, presets: ReadonlyMap<string, PresetBody>): Rect | null {
  let size: { w: number; h: number; inner: { w: number; h: number } | null } | null = null;
  if (f.kind === "aspect") size = aspectFrame(f.aspect ?? 2.39, f.size ?? 0.8, aspectOf(photo));
  else { const o = frameOptics(f, presets), v = view(photo); if (o && v) size = opticsFrame(o, v); }
  if (!size) return null;
  // What is shown is the delivery's inner box when there is one.
  const box = size.inner ?? size;
  return { x: f.cx - box.w / 2, y: f.cy - box.h / 2, w: box.w, h: box.h };
}
const asFrame = (v: FrameValues): CanvasFrame => ({ ...v, id: "default", name: "", color: 0, cx: 0.5, cy: 0.5, visible: true });
const ease = (u: number) => u * u * (3 - 2 * u);
const between = (a: Rect, b: Rect, u: number): Rect => {
  const g = (x: number, y: number) => (x > 0 && y > 0 ? Math.exp(Math.log(x) + (Math.log(y) - Math.log(x)) * u) : x + (y - x) * u);
  const w = g(a.w, b.w), h = g(a.h, b.h), cx = a.x + a.w / 2 + (b.x + b.w / 2 - a.x - a.w / 2) * u, cy = a.y + a.h / 2 + (b.y + b.h / 2 - a.y - a.h / 2) * u;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};

/** A canvas's frame ids in their order (what a zoom block runs through), from the bodies read so far; a missing body is read. */
export function useFrameIds(files: ReadonlyMap<string, FileRec>): (id: string) => string[] {
  useBodies();
  return (id) => {
    const f = files.get(id);
    if (f?.type !== "canvas") return [];
    want(f);
    return bodies.get(f.id)?.body?.frames.map((x) => x.id) ?? [];
  };
}

/** What a reference shows: the image, the surface's aspect and the frame (fractions of the surface); null when missing. */
export function useSeen(ref: PicRef | null, files: ReadonlyMap<string, FileRec>, presets: ReadonlyMap<string, PresetBody>, def: FrameValues | null, u = 0) {
  useBodies();
  const f = ref ? files.get(ref.to) : undefined;
  if (!ref || !f || f.deleted_at) return null;
  if (f.type === "photo") {
    const src = imageSource(f.id, "preview");
    const r = def && !frameValuesError(def) ? rectOf(asFrame(def), f, presets) : null;
    return { file: f, src, aspect: aspectOf(f), rect: r };
  }
  if (f.type === "canvas") {
    want(f);
    const b = bodies.get(f.id), body = b?.body, base = b?.base ? files.get(b.base) : undefined;
    const saved = f.updated_at !== f.created_at;
    const src = saved ? { uri: canvasImageUrl(f, "render"), headers: authHeaders() } : base ? imageSource(base.id, "preview") : null;
    const aspect = body?.surface.kind === "blank" ? body.surface.aspect : aspectOf(base);
    const frames = body?.frames ?? [];
    const own = frames.find((x) => x.id === ref.frame);
    let rect: Rect | null = null;
    if (own) {
      const a = rectOf(own, base, presets), end = ref.move ? frames.find((x) => x.id === ref.move!.to) : undefined, bb = end ? rectOf(end, base, presets) : null;
      rect = a && bb ? between(a, bb, ref.move!.ease ? ease(u) : u) : a;
    } else if (def && base?.photo?.angle_of_view && !frameValuesError(def)) rect = rectOf(asFrame(def), base, presets);
    else { const pic = frames.find((x) => x.id === body?.picture && x.visible); rect = pic ? rectOf(pic, base, presets) : null; }
    return { file: f, src, aspect, rect };
  }
  return { file: f, src: null, aspect: 4 / 3, rect: null };
}

/** The picture, cropped to its frame and fitted into `width` × `height` (letterboxed); beyond the photo is dark. */
export function Picture({ seen, width, height, overlay }: { seen: ReturnType<typeof useSeen>; width: number; height: number; overlay?: { uri: string; headers: Record<string, string> } | null }) {
  const { c } = useTheme();
  if (!seen) return <View style={{ width, height, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}><Icon name="alert" size={22} color={c.textDim} /></View>;
  if (!seen.src) return <View style={{ width, height, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}><Icon name="file" size={24} color={c.textDim} /></View>;
  const r = seen.rect;
  const boxAspect = r ? (r.w * seen.aspect) / r.h : seen.aspect;
  const bw = Math.min(width, height * boxAspect), bh = bw / boxAspect;
  const sw = r ? bw / r.w : bw, sh = sw / seen.aspect;
  return (
    <View style={{ width, height, alignItems: "center", justifyContent: "center", backgroundColor: FIXED.photoBg }}>
      <View style={{ width: bw, height: bh, overflow: "hidden", backgroundColor: FIXED.photoBg }}>
        <Image source={seen.src} contentFit="fill" style={{ position: "absolute", width: sw, height: sh, left: r ? -r.x * sw : 0, top: r ? -r.y * sh : 0 }} />
        {overlay && <Image source={overlay} contentFit="fill" style={{ position: "absolute", left: 0, top: 0, width: bw, height: bh }} />}
      </View>
    </View>
  );
}
