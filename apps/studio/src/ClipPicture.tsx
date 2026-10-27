import { useEffect, useState } from "preact/hooks";
import { clipLayersOf, layersAt, type Layer } from "@openclapper/vocab";
import { fetchLayer } from "./api";
import { Composition, useShotLayers } from "./compose/stack";
import { stepBake } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { presentationFrame } from "./FramingSelect";
import type { ResolvedClip } from "./TimelineParts";
import { presentationVignette } from "./vignette";

type PhotoClip = Extract<ResolvedClip, { kind: "photo" }>;

const shapes = new Map<string, Layer>();
const key = (l: Layer) => `${l.id}:${l.updated_at ?? l.created_at}`;

/** A clip's own layers with their shapes (fetched once per version). */
export function useClipLayers(own: readonly Layer[]): Layer[] {
  const k = own.map(key).join(",");
  const [list, setList] = useState<Layer[]>(() => own.map((l) => shapes.get(key(l)) ?? l));
  useEffect(() => {
    let live = true;
    void Promise.all(own.map(async (l) => shapes.get(key(l)) ?? fetchLayer(l.id).then((full) => { shapes.set(key(l), full); return full; }).catch(() => l)))
      .then((all) => { if (live) setList(all); });
    return () => { live = false; };
  }, [k]);
  return list;
}

/**
 * A photo clip's picture (epic #275): live on the stage and in the clip panel (the step's layers
 * from the shot, then the clip's own), its step's bake in the strip (a layers glyph says it has
 * its own on top).
 */
export function ClipPicture({ c, mode, maxHeight, live }: { c: PhotoClip; mode: MaskMode; maxHeight?: string; live?: boolean }) {
  const frame = presentationFrame(c.photo, c.pres);
  if (!live) return <Framed photo={c.photo} mode={mode} frame={frame} vignette={presentationVignette(c.photo, c.pres)} src={stepBake(c.shot, c.step)?.url} maxHeight={maxHeight} />;
  return <LivePicture c={c} mode={mode} maxHeight={maxHeight} />;
}

function LivePicture({ c, mode, maxHeight }: { c: PhotoClip; mode: MaskMode; maxHeight?: string }) {
  const layers = useShotLayers(c.shot);
  const own = useClipLayers(c.ownLayers);
  return <Composition photo={c.photo} frame={presentationFrame(c.photo, c.pres)} mode={mode} layers={layersAt(layers, c.step)} extra={clipLayersOf(own, c.clip.id)} vignette={presentationVignette(c.photo, c.pres)} maxHeight={maxHeight} />;
}
