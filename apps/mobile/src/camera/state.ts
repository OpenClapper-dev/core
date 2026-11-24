import { randomUUID } from "expo-crypto";
import { aspectFrame, opticsFrame, photoAov } from "@openclapper/fov-math";
import type { CaptureFrame, PresetBody } from "@openclapper/model";
import { canCall, putFile } from "../api";
import { loadLibrary } from "../media/library";
import { persisted } from "../store";
import { toast } from "../ui";

/**
 * What the camera keeps between photos (docs/features/camera-layouts.md): the frame chosen per project (an optics
 * preset of the project with a focal length, free-form values, an aspect ratio, or none), the switches on the
 * frame (zoom to frame, blackout, upright, the reference frame), collection mode and the folder for new photos.
 */
export type FrameChoice =
  | { kind: "preset"; preset: string; focal: number }
  | { kind: "free"; format: [number, number]; multiplier: number; squeeze: number; delivery: number | null; focal: number }
  | { kind: "aspect"; aspect: number };

export const frames = persisted<Record<string, FrameChoice | null>>("cameraFrame.v1", {});
export const toggles = persisted<{ fit: boolean; blackout: boolean | null; upright: boolean; reference: number | null }>("cameraToggles.v1", { fit: false, blackout: null, upright: false, reference: null });
export const collecting = persisted<{ project: string; id: string; name: string; count: number } | null>("collectionMode.v1", null);
export const nextFolder = persisted<Record<string, string | null>>("nextFolder.v1", {});

/** The live picture's angle of view, from what the camera reports for the lens in use (its 35 mm equivalent); null without a report. */
export function liveView(focal35: number | null | undefined, upright: boolean): { horizontal: number; vertical: number } | null {
  if (!focal35) return null;
  const a = photoAov({ FocalLengthIn35mmFilm: focal35 }, upright ? 3 : 4, upright ? 4 : 3);
  return a ? { horizontal: a.horizontal, vertical: a.vertical } : null;
}

/** The optics of a frame choice, for the math (a preset's factors with the chosen focal length). */
export function opticsOf(f: FrameChoice, presets: ReadonlyMap<string, PresetBody>, portrait: boolean) {
  if (f.kind === "aspect") return null;
  if (f.kind === "free") return { format: f.format, multiplier: f.multiplier, squeeze: f.squeeze, delivery: f.delivery, focal: f.focal, portrait };
  const p = presets.get(f.preset);
  return p ? { format: p.format, multiplier: p.multiplier, squeeze: p.squeeze, delivery: p.delivery, focal: f.focal, portrait } : null;
}

/** The frame on the picture as fractions of it (w, h; the delivery's inner box), or null (no frame, or no angle of view for an optics frame). */
export function frameBox(f: FrameChoice | null, presets: ReadonlyMap<string, PresetBody>, view: { horizontal: number; vertical: number } | null, picAspect: number, upright: boolean) {
  if (!f) return null;
  if (f.kind === "aspect") return aspectFrame(f.aspect, Math.min(1, f.aspect / picAspect), picAspect);
  const o = opticsOf(f, presets, upright);
  return o && view ? opticsFrame(o, view) : null;
}

/** The frame as a fact of the photo: for a preset its factors copied and its name, so the photo reads the same later. */
export function captureFact(f: FrameChoice | null, presets: ReadonlyMap<string, PresetBody>, presetNames: ReadonlyMap<string, string>, upright: boolean, picAspect: number): CaptureFrame | null {
  if (!f) return null;
  if (f.kind === "aspect") return { kind: "aspect", aspect: f.aspect, size: Math.round(Math.min(1, f.aspect / picAspect) * 1000) / 1000, portrait: false };
  if (f.kind === "free") return { kind: "free", format: f.format, multiplier: f.multiplier, squeeze: f.squeeze, delivery: f.delivery, focal: f.focal, portrait: upright };
  const p = presets.get(f.preset);
  if (!p) return null;
  return { kind: "preset", preset: f.preset, focal: f.focal, portrait: upright, format: p.format, multiplier: p.multiplier, squeeze: p.squeeze, delivery: p.delivery, presetName: presetNames.get(f.preset) };
}

/** Collection mode on: a new collection (named by the project's pattern) where new photos go; it needs a connection. */
export async function startCollection(project: string, folder: string | null, name?: string): Promise<void> {
  if (!canCall()) { toast("Collection mode needs a connection to start", "danger"); return; }
  try {
    const id = randomUUID();
    const f = await putFile(id, { type: "collection", project_id: project, container: folder, ...(name ? { name } : {}), body: { color: 1 + Math.floor(Math.random() * 8), order: "time" } });
    collecting.set({ project, id, name: f.name, count: 0 });
    void loadLibrary();
  } catch (e) { toast(`No collection: ${(e as Error).message}`, "danger"); }
}
/** Collection mode off: the collection stays as it is (renamed when the person was asked for a name at the end). */
export async function endCollection(name?: string): Promise<void> {
  const c = collecting.get();
  collecting.set(null);
  if (c && name && name.trim() && canCall()) {
    try { await putFile(c.id, { type: "collection", project_id: c.project, name: name.trim().slice(0, 120) }); void loadLibrary(); } catch { /* the pattern's name stays */ }
  }
}
