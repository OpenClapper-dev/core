import type { Presentation } from "./compose.ts";
import { referencedFrame, rootFrame, withCentre, type Frame, type Framing } from "./framing.ts";

/**
 * Steps (issue #266): a sequence as a progression. A step shows one of the shot's photos,
 * optionally through a saved framing (a zoom step) and optionally as one of its overlays (a light
 * step). A shot without stored steps shows its photos as steps, so every strip, scrub, badge and
 * timeline block iterates `stepsOf(shot)` and never `photos` directly. Photos stay the unit for
 * capture, the cover, positions and the per-photo stages.
 */

export interface ShotStep {
  id: string;
  shot_id: string;
  ordinal: number;
  photo_id: string;
  framing_id: string | null;
  overlay_id: string | null;
}

/** What the Studio sends: the whole list, in order. */
export interface StepInput { id: string; photo_id: string; framing_id?: string | null; overlay_id?: string | null }

export const MAX_STEPS = 500;

/** The part of a photo a step needs; the phone's and the Studio's photo types both fit. */
export interface StepPhoto { id: string; framing: Record<string, unknown> | null; framings?: readonly Framing[]; root_framing_id?: string | null }
/** The part of a shot overlay a step needs. */
export interface StepOverlay { id: string; photo_id: string; presentation: unknown; render_url: string | null }

export interface ResolvedStep<P extends StepPhoto, O extends StepOverlay> {
  /** The step's id, or `photo:<id>` for a step derived from a photo. */
  id: string;
  photo: P;
  framing: Framing | null;
  overlay: O | null;
  /** The frame the step is shown with (see `stepFrame`); null for photos without a frame (uploads, drawings). */
  frame: Required<Frame> | null;
  /** False when the shot has no stored steps and this one stands for a photo. */
  stored: boolean;
}

/**
 * The frame a step is shown with: its framing, else the frame its overlay was drawn for (the
 * overlay's presentation framing, or the copy kept when that was deleted), else the photo's root.
 */
export function stepFrame(photo: StepPhoto, framing: Framing | null, overlay: StepOverlay | null): Required<Frame> | null {
  if (framing) return withCentre(framing.frame);
  if (overlay && overlay.presentation && typeof overlay.presentation === "object") {
    const p = overlay.presentation as Presentation;
    const f = referencedFrame(photo, { framing_id: p.framing_id, frame: p.frame ?? null });
    if (f) return f;
  }
  return rootFrame(photo);
}

/**
 * The steps a shot shows, in order. Without stored steps (or when none of them resolves to a
 * photo) the photos are the steps. A framing or overlay id that no longer resolves reads as null,
 * so a stale payload never breaks a view; the server clears those references on delete anyway.
 */
export function stepsOf<P extends StepPhoto, O extends StepOverlay>(shot: { photos: readonly P[]; overlays?: readonly O[]; steps?: readonly ShotStep[] | null }): ResolvedStep<P, O>[] {
  const fromPhotos = () => shot.photos.map((photo) => ({ id: `photo:${photo.id}`, photo, framing: null, overlay: null, frame: rootFrame(photo), stored: false }));
  if (!shot.steps?.length) return fromPhotos();
  const out: ResolvedStep<P, O>[] = [];
  for (const s of [...shot.steps].sort((a, b) => a.ordinal - b.ordinal)) {
    const photo = shot.photos.find((p) => p.id === s.photo_id);
    if (!photo) continue;
    const framing = (s.framing_id && photo.framings?.find((f) => f.id === s.framing_id)) || null;
    const overlay = (s.overlay_id && shot.overlays?.find((o) => o.id === s.overlay_id && o.photo_id === photo.id)) || null;
    out.push({ id: s.id, photo, framing, overlay, frame: stepFrame(photo, framing, overlay), stored: true });
  }
  return out.length ? out : fromPhotos();
}

/** What makes two steps the same picture (a photo may repeat in a progression). */
export const stepKey = (s: { photo: { id: string }; framing: { id: string } | null; overlay: { id: string } | null }) => `${s.photo.id}|${s.framing?.id ?? ""}|${s.overlay?.id ?? ""}`;

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Structural check of a PUT body's list (interactive, strict). Null = fine. */
export function validateStepInput(v: unknown): string | null {
  if (!Array.isArray(v)) return "steps must be an array";
  if (v.length > MAX_STEPS) return `at most ${MAX_STEPS} steps`;
  const ids = new Set<string>();
  for (let i = 0; i < v.length; i++) {
    const s = v[i] as Record<string, unknown> | null;
    if (typeof s !== "object" || s === null || Array.isArray(s)) return `steps[${i}] must be an object`;
    if (!isUuid(s.id)) return `steps[${i}].id must be a UUID`;
    if (ids.has(s.id as string)) return `steps[${i}].id repeats`;
    ids.add(s.id as string);
    if (!isUuid(s.photo_id)) return `steps[${i}].photo_id must be a UUID`;
    for (const k of ["framing_id", "overlay_id"] as const) if (s[k] != null && !isUuid(s[k])) return `steps[${i}].${k} must be a UUID or null`;
  }
  return null;
}

/**
 * Membership check, pure so it is testable: every step on a photo of the shot, every framing a
 * framing of that photo, every overlay a shot overlay of that photo (a timeline clip's own
 * overlay is never a step: shots never show those).
 */
export function stepsProblem(
  steps: readonly StepInput[],
  have: { photos: ReadonlySet<string>; framingPhoto: ReadonlyMap<string, string>; overlayPhoto: ReadonlyMap<string, { photo_id: string; clip_owned: boolean }> },
): string | null {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!have.photos.has(s.photo_id)) return `steps[${i}]: the photo is not one of the shot's photos`;
    if (s.framing_id && have.framingPhoto.get(s.framing_id) !== s.photo_id) return `steps[${i}]: the framing is not a framing of that photo`;
    if (s.overlay_id) {
      const o = have.overlayPhoto.get(s.overlay_id);
      if (!o || o.photo_id !== s.photo_id) return `steps[${i}]: the overlay is not an overlay of that photo`;
      if (o.clip_owned) return `steps[${i}]: the overlay belongs to a timeline clip`;
    }
  }
  return null;
}
