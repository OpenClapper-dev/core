import { vignetteAt, type Framing, type Presentation, type Vignette } from "@openclapper/vocab";
import type { Photo } from "./api";
import * as data from "./data";

/**
 * Lens vignetting (issue #266, vocab vignetting.ts): what a rig darkens at a focal length, looked
 * up from the loaded rigs. Drawn as a layer over the frame rect (Framed.tsx), never into pixels.
 * The radial gradient's `farthest-corner` circle has exactly the half-diagonal as radius, so the
 * stops are the stored fractions of it.
 */
export const vignetteCss = (v: Vignette) => `radial-gradient(circle farthest-corner at center, rgba(0,0,0,0) ${(v.start * 100).toFixed(1)}%, rgba(0,0,0,${v.opacity.toFixed(3)}) ${(v.end * 100).toFixed(1)}%)`;

/** The rig's vignette at `mm`; null without a rig, a focal length or an effect. */
export function vignetteOf(rigId: string | null | undefined, mm: number | null | undefined): Vignette | null {
  if (!rigId || !mm) return null;
  const p = data.getData().presets?.find((x) => x.id === rigId);
  return p ? vignetteAt(p.vignetting, mm) : null;
}
/** A saved framing's: its rig (else the photo's) at its lens. */
export const framingVignette = (photo: Photo, f: Framing) => vignetteOf(f.rig_id ?? photo.preset_id, f.lens_mm);
/** What a photo's root frame shows: the root framing's rig and lens, else the capture's. */
export function photoVignette(photo: Photo): Vignette | null {
  const root = photo.root_framing_id ? photo.framings.find((f) => f.id === photo.root_framing_id) : undefined;
  return root ? framingVignette(photo, root) : vignetteOf(photo.preset_id, photo.lens_mm);
}
/** An overlay's or clip's presentation: its framing, else the rig + lens it kept, else the photo's root. */
export function presentationVignette(photo: Photo, pres: Presentation): Vignette | null {
  const f = pres.framing_id ? photo.framings.find((x) => x.id === pres.framing_id) : undefined;
  if (f) return framingVignette(photo, f);
  if (pres.frame) return vignetteOf(pres.rig_id ?? photo.preset_id, pres.lens_mm ?? photo.lens_mm);
  return photoVignette(photo);
}
