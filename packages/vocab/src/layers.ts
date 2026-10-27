import { validateDrawing, validateLook, MAX_COMPOSE_NAME, MAX_DESCRIPTION, type Look, type Shape } from "./compose.ts";
import { withCentre, type Frame } from "./framing.ts";

/**
 * A shot is a composition (epic #275): an ordered stack of **layers** over its footage, shown at
 * every **step** (one frame of the sequence; a single shot has one). A layer has
 * - an explicit **order** (`position`): below the footage when negative, above it otherwise, so a
 *   plate can sit under the photo and marks over a grade;
 * - a **range**: the steps it shows on (`null` = every step, else stored step ids);
 * - a **space**: `frame` = fractions of the rig frame a step is shown with (stays put through a zoom
 *   or a pan), `photo` = fractions of one photo's pixels (only shows on that photo's steps).
 * A `drawing` layer holds shapes (compose.ts), an `adjustment` layer a look that changes everything
 * below it. Timeline clips own layers of their own (`timeline_id` + `clip_id`), drawn over the clip.
 *
 * The Studio composes the stack live and bakes one flattened image per step for the phone
 * (`bakeHash` says when a bake is stale). Both clients and the Worker share these rules.
 */

export const LAYER_KINDS = ["drawing", "adjustment"] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];
export const LAYER_SPACES = ["frame", "photo"] as const;
export type LayerSpace = (typeof LAYER_SPACES)[number];

export interface Layer {
  id: string;
  shot_id: string;
  kind: LayerKind;
  name: string;
  description: string | null;
  /** Stack order: < 0 below the footage, >= 0 above it; higher is on top. */
  position: number;
  visible: boolean;
  locked: boolean;
  /** 0..1, the whole layer. */
  opacity: number;
  space: LayerSpace;
  /** The photo a `photo`-space layer belongs to; null in frame space. */
  photo_id: string | null;
  /** Stored step ids the layer shows on; null = every step. Ignored for clip-owned layers. */
  range: string[] | null;
  /** Adjustment layers: exposure, contrast, saturation, black and white, tint, vignette, softness. */
  look: Look | null;
  /** Drawing layers; only present when fetched with shapes (shots embed layers without them). */
  shapes?: Shape[];
  /** A timeline clip's own layer (both set), else a layer of the shot. */
  timeline_id: string | null;
  clip_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export const MAX_LAYERS = 50;
export const MAX_LAYER_POSITION = 1000;

/** What a PUT carries. */
export interface LayerInput {
  shot_id: string; kind: LayerKind; name: string; description?: string | null; position: number; visible: boolean; locked: boolean; opacity: number;
  space: LayerSpace; photo_id?: string | null; range?: string[] | null; shapes?: Shape[] | null; look?: Look | null;
  timeline_id?: string | null; clip_id?: string | null;
}

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Structural check of a layer body (interactive edits: strict). Null = fine. */
export function validateLayerInput(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "layer must be an object";
  const l = v as Record<string, unknown>;
  if (!isUuid(l.shot_id)) return "shot_id must be a UUID";
  if (!LAYER_KINDS.includes(l.kind as LayerKind)) return `kind must be one of ${LAYER_KINDS.join(", ")}`;
  if (typeof l.name !== "string" || !l.name.trim() || l.name.length > MAX_COMPOSE_NAME) return `name must be 1..${MAX_COMPOSE_NAME} characters`;
  if (l.description != null && (typeof l.description !== "string" || l.description.length > MAX_DESCRIPTION)) return `description must be a string (max ${MAX_DESCRIPTION})`;
  if (!Number.isInteger(l.position) || !num(l.position, -MAX_LAYER_POSITION, MAX_LAYER_POSITION)) return `position must be a whole number within ±${MAX_LAYER_POSITION}`;
  if (typeof l.visible !== "boolean" || typeof l.locked !== "boolean") return "visible and locked must be true or false";
  if (!num(l.opacity, 0, 1)) return "opacity must be 0..1";
  if (!LAYER_SPACES.includes(l.space as LayerSpace)) return `space must be one of ${LAYER_SPACES.join(", ")}`;
  if (l.space === "photo" ? !isUuid(l.photo_id) : l.photo_id != null) return "photo_id is required in photo space and absent in frame space";
  if (l.range != null) {
    if (!Array.isArray(l.range) || l.range.length > 500 || !l.range.every(isUuid)) return "range must be null or up to 500 step ids";
    if (new Set(l.range).size !== l.range.length) return "range lists a step twice";
  }
  if (l.kind === "drawing") {
    if (l.look != null) return "a drawing layer has no look";
    const err = validateDrawing({ v: 1, shapes: l.shapes ?? [], look: null }, false);
    if (err) return err;
  } else {
    if (l.shapes != null && (!Array.isArray(l.shapes) || l.shapes.length)) return "an adjustment layer has no shapes";
    const err = validateLook(l.look);
    if (err) return err;
  }
  if ((l.timeline_id == null) !== (l.clip_id == null)) return "timeline_id and clip_id go together";
  if (l.timeline_id != null && (!isUuid(l.timeline_id) || !isUuid(l.clip_id))) return "timeline_id and clip_id must be UUIDs";
  return null;
}

/** Stack order: position, then creation, then id (stable for equal positions). */
export const byPosition = <L extends Pick<Layer, "position" | "created_at" | "id">>(a: L, b: L) =>
  a.position - b.position || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The step a layer is checked against: its key and its photo. */
export interface StepRef { id: string; stored: boolean; photo: { id: string } }

/** True when a shot layer shows on this step (visible, in range, on the step's photo in photo space). */
export function layerOnStep(l: Pick<Layer, "visible" | "range" | "space" | "photo_id" | "timeline_id">, step: StepRef): boolean {
  if (!l.visible || l.timeline_id) return false;
  if (l.space === "photo" && l.photo_id !== step.photo.id) return false;
  if (l.range === null) return true;
  return step.stored && l.range.includes(step.id);
}

/** The shot's layers a step shows, bottom to top. */
export const layersAt = <L extends Layer>(layers: readonly L[], step: StepRef): L[] => layers.filter((l) => layerOnStep(l, step)).sort(byPosition);

/** A clip's own layers, bottom to top (clips show their step's layers under these). */
export const clipLayersOf = <L extends Layer>(layers: readonly L[], clipId: string): L[] => layers.filter((l) => l.clip_id === clipId && l.visible).sort(byPosition);

/**
 * Whether a shot's bakes wait for approval: its project bakes approved shots only (a project setting,
 * to spare the Studio's work and storage on shots that never make it) and it is not approved. Bakes
 * already made stay; the phone shows them while they are fresh.
 */
export const bakeWaits = (s: { state: string; bake_approved_only?: boolean }): boolean => !!s.bake_approved_only && s.state !== "approved";

/** The key a step's bake is stored under: the stored step's id, or the photo's id for a shot without stored steps. */
export const bakeKey = (step: StepRef): string => (step.stored ? step.id : step.photo.id);

/** FNV-1a, 64 bits as two 32-bit halves (no crypto needed: this only tells versions apart). */
function fnv64(s: string): string {
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
    b = (b + (a >>> 7)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * What a step's bake depends on: the photo, the frame it is shown with and every layer it shows
 * (id, version, order). Equal hashes = the bake is fresh. Null when the step shows no layers: then
 * nothing needs baking and the photo is the picture.
 */
export function bakeHash(step: StepRef & { frame: Frame | null }, layers: readonly Pick<Layer, "id" | "updated_at" | "created_at" | "position" | "visible" | "range" | "space" | "photo_id" | "timeline_id">[]): string | null {
  const on = layers.filter((l) => layerOnStep(l, step)).sort(byPosition);
  if (!on.length) return null;
  const f = step.frame ? withCentre(step.frame) : null;
  const frame = f ? [f.width_fraction, f.height_fraction, f.x, f.y].map((n) => n.toFixed(4)).join(",") : "none";
  return fnv64(["bake.v1", step.photo.id, frame, ...on.map((l) => `${l.id}:${l.updated_at ?? l.created_at}:${l.position}`)].join("|"));
}

/** A stored bake as shots embed it. */
export interface StepBake { step_key: string; hash: string; url: string }

/** The bake to show for a step: only when its hash matches what the step shows now. */
export function freshBake(bakes: readonly StepBake[] | undefined, step: StepRef, hash: string | null): StepBake | null {
  if (!hash) return null;
  const b = bakes?.find((x) => x.step_key === bakeKey(step));
  return b && b.hash === hash ? b : null;
}
