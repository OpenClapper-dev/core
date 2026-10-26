import type { StyleProp, ViewStyle } from "react-native";
import { rootFrame, vignetteAt, type Framing, type Vignette } from "@openclapper/vocab";
import { imageHeaders, imageUri, type Photo } from "../api";
import { isOfflineMode } from "../net";
import { offlinePhotoUri } from "../offline";
import { getRigs } from "../rigs";
import type { ViewSettings } from "../types";
import { FramedImage, type FrameFractions, type FrameMode } from "./FramedImage";

export { FRAME_MODES, FrameModeSeg, frameModeLabel, type FrameMode } from "./FramedImage";

/** The frame a photo is shown with: its root framing (issue #29, set in the Studio), else as captured. */
export function frameOf(photo: Photo): FrameFractions | null {
  const r = rootFrame({ framing: photo.framing, framings: photo.framings, root_framing_id: photo.root_framing_id });
  return r ? { width: r.width_fraction, height: r.height_fraction, x: r.x, y: r.y } : null;
}
/** As captured, centred (kept for reference). */
export function capturedFrameOf(photo: Photo): FrameFractions | null {
  const fr = photo.framing?.frame as { width_fraction?: unknown; height_fraction?: unknown } | undefined;
  if (!fr || typeof fr.width_fraction !== "number" || typeof fr.height_fraction !== "number") return null;
  return { width: fr.width_fraction, height: fr.height_fraction };
}

/** Lens vignetting (issue #266) of a rig at a focal length, from the rigs on the phone; null without one. */
export function vignetteOf(rigId: string | null | undefined, mm: number | null | undefined): Vignette | null {
  if (!rigId || !mm) return null;
  const p = getRigs().rigs.find((r) => r.id === rigId);
  return p ? vignetteAt(p.vignetting, mm) : null;
}
const framingVignette = (photo: Photo, f: Framing) => vignetteOf(f.rig_id ?? photo.preset_id, f.lens_mm);
/** What a photo's root frame shows: the root framing's rig and lens, else the capture's. */
export function photoVignette(photo: Photo): Vignette | null {
  const root = photo.root_framing_id ? photo.framings?.find((f) => f.id === photo.root_framing_id) : undefined;
  return root ? framingVignette(photo, root) : vignetteOf(photo.preset_id, photo.lens_mm);
}
/** Photo aspect ratio (w/h) as uploaded; 4:3 when unknown. */
export const imageAspect = (photo: Photo): number => (photo.width && photo.height ? photo.width / photo.height : 4 / 3);

interface Props {
  photo: Photo;
  width: number;
  settings: ViewSettings;
  mode: FrameMode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Where a photo's image comes from: the queued file or the offline copy if there is one, else the
 * authenticated image proxy. In offline mode nothing is requested (an empty source stays black).
 */
export function photoSource(photo: Photo): { uri: string; headers?: Record<string, string> } {
  const local = photo.local_uri ?? offlinePhotoUri(photo);
  if (local) return { uri: local };
  return isOfflineMode() ? { uri: "" } : { uri: imageUri(photo), headers: imageHeaders() };
}

/**
 * A photo rendered with its rig frame: the queued file or the offline copy if there is one, else
 * through the authenticated image proxy (not in offline mode: then it stays black).
 */
export function ShotFrame({ photo, width, settings, mode, style }: Props) {
  return (
    <FramedImage
      source={photoSource(photo)}
      aspect={imageAspect(photo)}
      frame={frameOf(photo)}
      vignette={photoVignette(photo)}
      width={width}
      settings={settings}
      mode={mode}
      style={style}
    />
  );
}

/** Width at which the framed photo (in this mode) fits inside maxW × maxH. */
export function fitWidth(photo: Photo, mode: FrameMode, maxW: number, maxH: number): number {
  const f = frameOf(photo);
  const aspect = mode === "fit" && f ? imageAspect(photo) * (f.width / f.height) : imageAspect(photo);
  return Math.max(40, Math.min(maxW, maxH * aspect));
}
