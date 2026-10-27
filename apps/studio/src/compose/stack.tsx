/**
 * The composition on screen (epic #275): a step's photo with the layer stack composed live. An
 * adjustment layer is an element with `backdrop-filter` (what is below it gets the look), a drawing
 * layer an SVG in its space: the photo (fractions of the raw image) or the frame (fractions of the
 * rig frame the step is shown with). The bake (render.ts `renderStep`) draws the same stack into
 * pixels for the phone. Shapes are not in the shot payload: `useShotLayers` fetches them.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { lookFilter, type Layer } from "@openclapper/vocab";
import { fetchShotLayers, type Photo, type Shot } from "../api";
import { frameLayout, frameOf, imageAspect, type FrameGeometry, type PctRect } from "../format";
import { Framed, type MaskMode } from "../Framed";
import { DrawingSvg } from "./Canvas";
import type { CanvasRect } from "./geometry";
import { BLUR_FRACTION, vignetteCss } from "./render";

const FULL: PctRect = { left: 0, top: 0, width: 100, height: 100 };

/** Where the photo and the frame sit in a Framed box (% of the box); the frame is null in Raw (frame-space layers hide there). */
export function stackAreas(photo: Photo, mode: MaskMode, frame: FrameGeometry | null): { img: PctRect; frame: PctRect | null; aspect: number } {
  const photoAspect = imageAspect(photo);
  const l = frame && mode !== "off" ? frameLayout(frame, mode, photoAspect) : null;
  if (!l) return { img: FULL, frame: frame ? null : FULL, aspect: photoAspect };
  return { img: l.img, frame: l.frame ?? FULL, aspect: l.aspect ?? photoAspect };
}

/** A layer's area in px of a box `w × h`; null when it does not show in this mode. */
export function layerRect(l: Pick<Layer, "space">, areas: { img: PctRect; frame: PctRect | null }, w: number, h: number): CanvasRect | null {
  const r = l.space === "photo" ? areas.img : areas.frame;
  return r ? { x: (r.left / 100) * w, y: (r.top / 100) * h, w: (r.width / 100) * w, h: (r.height / 100) * h } : null;
}

/** Measures the box it fills and renders its children at that size. */
function Measured({ children }: { children: (w: number, h: number) => ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height })); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} class="stack-fill">{size.w > 0 && children(size.w, size.h)}</div>;
}

/** One layer, live, in a box of `w × h` px. */
export function LayerView({ layer, areas, w, h }: { layer: Layer; areas: { img: PctRect; frame: PctRect | null }; w: number; h: number }) {
  const c = layerRect(layer, areas, w, h);
  if (!c) return null;
  const box = { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` };
  if (layer.kind === "adjustment") {
    const look = layer.look;
    if (!look) return null;
    const filter = lookFilter(look, c.w * BLUR_FRACTION);
    return (
      <div class="stack-adj" style={{ ...box, opacity: layer.opacity, backdropFilter: filter === "none" ? undefined : filter }}>
        {look.tint && look.tint_opacity > 0 && <div class="stack-adj__part" style={{ background: look.tint, opacity: look.tint_opacity }} />}
        {look.vignette > 0 && <div class="stack-adj__part" style={{ background: vignetteCss(look.vignette) }} />}
      </div>
    );
  }
  // A frame-space drawing is cut at the frame; a photo-space one may run into the area beyond the photo.
  const clip = layer.space === "frame" ? `inset(${c.y}px ${w - c.x - c.w}px ${h - c.y - c.h}px ${c.x}px)` : undefined;
  return <DrawingSvg shapes={layer.shapes ?? []} c={c} width={w} height={h} style={{ opacity: layer.opacity, clipPath: clip, pointerEvents: "none" }} />;
}

/** Layers in a Framed box: positioned against the box the slot fills. */
export function LayerStack({ layers, areas }: { layers: readonly Layer[]; areas: { img: PctRect; frame: PctRect | null } }) {
  if (!layers.length) return null;
  return <Measured>{(w, h) => layers.map((l) => <LayerView key={l.id} layer={l} areas={areas} w={w} h={h} />)}</Measured>;
}

/**
 * A photo with layers composed live (bottom to top): those with `position < 0` under the photo,
 * the rest over it; `extra` (a clip's own layers) on top of everything.
 */
export function Composition({ photo, frame, mode, layers, extra, maxHeight, className, vignette, children }: {
  photo: Photo; frame: FrameGeometry | null; mode: MaskMode; layers: readonly Layer[]; extra?: readonly Layer[]; maxHeight?: string; className?: string;
  vignette?: Parameters<typeof Framed>[0]["vignette"]; children?: ComponentChildren;
}) {
  const f = frame ?? frameOf(photo);
  const areas = stackAreas(photo, mode, f);
  const below = layers.filter((l) => l.position < 0);
  const above = [...layers.filter((l) => l.position >= 0), ...(extra ?? [])];
  return (
    <Framed photo={photo} frame={f} mode={mode} maxHeight={maxHeight} className={className} vignette={vignette}
      below={<LayerStack layers={below} areas={areas} />} above={<LayerStack layers={above} areas={areas} />}>
      {children}
    </Framed>
  );
}

// ---------- the shot's layers with their shapes ----------

const cache = new Map<string, { key: string; layers: Layer[] }>();
const versionKey = (s: Shot) => s.layers.map((l) => `${l.id}:${l.updated_at ?? l.created_at}`).join(",");

/** The shot's layers with shapes (fetched once per version of the list); `[]` while loading or without layers. */
export function useShotLayers(shot: Shot | null): Layer[] {
  const key = shot ? versionKey(shot) : "";
  const hit = shot ? cache.get(shot.id) : undefined;
  const [layers, setLayers] = useState<Layer[]>(hit && hit.key === key ? hit.layers : []);
  useEffect(() => {
    if (!shot || !shot.layers.length) { setLayers([]); return; }
    const c = cache.get(shot.id);
    if (c && c.key === key) { setLayers(c.layers); return; }
    let live = true;
    void loadShotLayers(shot).then((l) => { if (live) setLayers(l); }).catch(() => {});
    return () => { live = false; };
  }, [shot?.id, key]);
  return layers;
}

/** The shot's layers with shapes, from the cache when its version list is unchanged. */
export async function loadShotLayers(shot: Shot): Promise<Layer[]> {
  const key = versionKey(shot);
  const c = cache.get(shot.id);
  if (c && c.key === key) return c.layers;
  if (!shot.layers.length) return [];
  const layers = await fetchShotLayers(shot.id);
  // The fetched list may be newer than the shot we were handed; key it by what came back.
  cache.set(shot.id, { key: layers.map((l) => `${l.id}:${l.updated_at ?? l.created_at}`).join(","), layers });
  return layers;
}

/** Forget a shot's cached layers (after an edit the editor knows better). */
export const primeShotLayers = (shotId: string, layers: Layer[]) => cache.set(shotId, { key: layers.map((l) => `${l.id}:${l.updated_at ?? l.created_at}`).join(","), layers });
