// A flow's stages (docs/features/flows.md, "The stage"; #426 feedback round 8): drawings on dark paper, each with a
// widget per light track placed on it that shows what the track plays at the playhead. Several stages are several
// perspectives on the same tracks (a floor plan, a photo of the set, one light from another side). Part of the
// flow's body, not files of their own. Everything both editors draw comes from here, so the Studio and the phone show the same: what a widget shows
// (sampled exactly as the player samples), its shape per fixture model, its beam, and the motion of an effect.
import { canvasObjectError, type CanvasObject, type ObjKind } from "@openclapper/model";
import { effectName, modelOf, type EffectId } from "@openclapper/ext-hardware";
import { playedKeyframes, sampleTrack, type FlowTrack } from "./flow.ts";
import { lightColour } from "./look.ts";

/**
 * How a light hangs (#426): "aimed" (absent; on a stand or a wall, pointing across the floor: a beam) or "ceiling"
 * (overhead, looking down: a pool of light around it, no direction). "Aimed" rather than "wall": most such lights
 * stand on a stand.
 */
export type StageMount = "aimed" | "ceiling";
export const STAGE_MOUNTS: readonly StageMount[] = ["aimed", "ceiling"];
/**
 * Where a light track's widget stands: its centre in fractions of the paper, where it points (degrees, 0 = right,
 * clockwise) and how it hangs. A ceiling light keeps its `rot` (switched back, it points where it did) but draws none.
 */
export interface StageLight { track: string; x: number; y: number; rot: number; mount?: StageMount }
export const isCeiling = (l: Pick<StageLight, "mount">) => l.mount === "ceiling";
/** A light hung another way: aimed is the default, so it is kept as no `mount` at all; the turn is kept either way. */
export function setMount(l: StageLight, mount: StageMount): StageLight {
  const { mount: _was, ...rest } = l;
  return mount === "aimed" ? rest : { ...rest, mount };
}
/** A photo of the project under the drawing, fitted inside the paper, as the canvas's base photo lies under its drawing. */
export interface StageUnderlay { photo: string; opacity: number }
export interface FlowStage {
  /** The stage's own id in the flow (what a client keeps as the stage it shows). */
  id: string;
  name: string;
  /** The paper's width over its height. */
  aspect: number;
  /** The drawing: canvas objects (fractions of the paper), of the kinds a stage has. */
  objects: CanvasObject[];
  /** One widget per placed light track, at most one per track on this stage (a track may stand on several stages). */
  lights: StageLight[];
  underlay?: StageUnderlay | null;
  /**
   * How the whole paper is turned on screen, in degrees clockwise (#426): like a sheet turned on a desk, the drawing,
   * the lights and the underlay turn together; nothing on it changes. Absent: 0.
   */
  turn?: number;
  /**
   * The paper's width in grid squares (#426; absent: STAGE_COLS). Its height is `cols / aspect`. Widgets, their tags
   * and stroke widths have a fixed size in squares, so a larger paper is more room around the same drawing.
   */
  cols?: number;
}

/** The squares across a paper that names none; widgets and strokes are drawn at the size they have on such a paper. */
export const STAGE_COLS = 25;
/** The smallest and largest paper side in squares. */
export const STAGE_SIDE_MIN = 5, STAGE_SIDE_MAX = 200;
/** How much larger than a STAGE_COLS-wide paper this one is: widgets and strokes are drawn that much smaller on it. */
export const stageScale = (s: Pick<FlowStage, "cols">) => (s.cols ?? STAGE_COLS) / STAGE_COLS;
/** A paper's size in squares: [width, height]. */
export const stageSize = (s: Pick<FlowStage, "cols" | "aspect">): [number, number] => { const c = s.cols ?? STAGE_COLS; return [c, c / s.aspect]; };

/**
 * The stage on a paper of `cols` × `rows` squares (#426), the old paper placed at `anchor` in the new one ([0, 0]: at
 * the top left, so the room is added right and below; [0.5, 0.5]: in the middle): everything drawn and placed keeps its
 * size and its place among the rest; what a smaller paper no longer holds is cut off (a light moves to its edge).
 */
export function resizeStage(s: FlowStage, cols: number, rows: number, anchor: [number, number]): FlowStage {
  const [oc, or] = stageSize(s), dx = (cols - oc) * anchor[0], dy = (rows - or) * anchor[1];
  const fx = (x: number) => (x * oc + dx) / cols, fy = (y: number) => (y * or + dy) / rows;
  const r4 = (v: number) => Number(v.toFixed(4)), c01 = (v: number) => Math.min(1, Math.max(0, v));
  const objects = s.objects.map((o) => ({ ...o, x: fx(o.x), y: fy(o.y), w: (o.w * oc) / cols, h: (o.h * or) / rows }));
  const lights = s.lights.map((l) => ({ ...l, x: r4(c01(fx(l.x))), y: r4(c01(fy(l.y))) }));
  const n: FlowStage = { ...s, objects, lights, aspect: cols / rows };
  if (cols === STAGE_COLS) delete n.cols; else n.cols = cols;
  return n;
}

/** What the stage draws: the canvas's shapes, text and stencils; no placed photos or groups (the phone draws it read-only). */
export const STAGE_KINDS: readonly ObjKind[] = ["pen", "line", "arrow", "rect", "ellipse", "text", "stencil"];
export const STAGE_OBJECTS_MAX = 500;
export const STAGE_POINTS_MAX = 40_000;
export const STAGE_ASPECT = 16 / 9;
/** The stage's units: the paper is this wide, as many high as its aspect gives; widgets are sized in them. */
export const STAGE_W = 1000;
export const STAGES_MAX = 12;
export const STAGE_NAME_MAX = 60;
export const emptyStage = (id: string, name: string): FlowStage => ({ id, name, aspect: STAGE_ASPECT, objects: [], lights: [] });
const STAGE_ID = /^[A-Za-z0-9_-]{1,40}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isLightTrack = (t: Pick<FlowTrack, "model">) => modelOf(t.model)?.type === "light";

/** Null when a stage is valid for these tracks: its drawing within limits, each widget on a light track of the flow, once. */
export function stageError(v: unknown, tracks: readonly Pick<FlowTrack, "id" | "model">[]): string | null {
  if (!isObj(v)) return "stage is an object";
  for (const k of Object.keys(v)) if (!["id", "name", "aspect", "objects", "lights", "underlay", "turn", "cols"].includes(k)) return `a stage has no "${k}"`;
  if (typeof v.id !== "string" || !STAGE_ID.test(v.id)) return "stage.id is 1 to 40 letters, digits, - or _";
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > STAGE_NAME_MAX) return `stage.name is 1 to ${STAGE_NAME_MAX} characters`;
  if (!num(v.aspect, 0.25, 4)) return "stage.aspect is between 0.25 and 4";
  if (v.cols !== undefined && !(num(v.cols, STAGE_SIDE_MIN, STAGE_SIDE_MAX) && Number.isInteger(v.cols))) return `stage.cols is whole squares, ${STAGE_SIDE_MIN} to ${STAGE_SIDE_MAX}`;
  if (v.turn !== undefined && !(num(v.turn, 0, 359) && Number.isInteger(v.turn))) return "stage.turn is whole degrees, 0 to 359";
  if (!Array.isArray(v.objects) || v.objects.length > STAGE_OBJECTS_MAX) return `a stage has at most ${STAGE_OBJECTS_MAX} drawn objects`;
  const ids = new Set<string>(), groups = new Set<string>();
  let points = 0;
  for (const [i, o] of v.objects.entries()) {
    const e = canvasObjectError(o, ids, groups);
    if (e) return `stage.objects[${i}]: ${e}`;
    const c = o as CanvasObject;
    if (!STAGE_KINDS.includes(c.kind)) return `stage.objects[${i}]: a stage draws ${STAGE_KINDS.join(", ")}`;
    if (c.group) return `stage.objects[${i}]: a stage has no groups`;
    points += (c.pts?.length ?? 0) / 2;
  }
  if (points > STAGE_POINTS_MAX) return `a stage has at most ${STAGE_POINTS_MAX} points in all`;
  if (!Array.isArray(v.lights)) return "stage.lights must be an array";
  const placed = new Set<string>();
  for (const [i, l] of v.lights.entries()) {
    if (!isObj(l) || Object.keys(l).some((k) => !["track", "x", "y", "rot", "mount"].includes(k))) return `stage.lights[${i}] is { track, x, y, rot, mount? }`;
    const tr = tracks.find((t) => t.id === l.track);
    if (!tr) return `stage.lights[${i}] names a track that is not in the flow`;
    if (!isLightTrack(tr)) return `stage.lights[${i}]: only light tracks go on the stage`;
    if (placed.has(tr.id)) return `stage.lights[${i}]: a track has one widget`;
    placed.add(tr.id);
    if (!num(l.x, 0, 1) || !num(l.y, 0, 1)) return `stage.lights[${i}] stands on the paper (x and y 0 to 1)`;
    if (!num(l.rot, 0, 360)) return `stage.lights[${i}].rot is 0 to 360 degrees`;
    if (l.mount !== undefined && !STAGE_MOUNTS.includes(l.mount as StageMount)) return `stage.lights[${i}].mount is ${STAGE_MOUNTS.join(" or ")}`;
  }
  const u = v.underlay;
  if (u != null && (!isObj(u) || Object.keys(u).some((k) => k !== "photo" && k !== "opacity") || typeof u.photo !== "string" || !UUID.test(u.photo) || !num(u.opacity, 0.05, 1))) return "stage.underlay is a photo and an opacity";
  return null;
}

/** Null when a flow's stages are valid for these tracks: at most STAGES_MAX, each valid, each with its own id. */
export function stagesError(v: unknown, tracks: readonly Pick<FlowTrack, "id" | "model">[]): string | null {
  if (!Array.isArray(v) || v.length > STAGES_MAX) return `stages is a list of at most ${STAGES_MAX}`;
  const ids = new Set<string>();
  for (const [i, s] of v.entries()) {
    const e = stageError(s, tracks);
    if (e) return `stages[${i}]: ${e}`;
    const id = (s as FlowStage).id;
    if (ids.has(id)) return `stages[${i}]: each stage has its own id`;
    ids.add(id);
  }
  return null;
}

/** The stage a client shows: the one it kept, else the first; null while the flow has none. */
export const stageOf = (stages: readonly FlowStage[] | undefined, id: string | null | undefined): FlowStage | null => stages?.find((s) => s.id === id) ?? stages?.[0] ?? null;
/** A new stage's name: "Stage N", the first N from the count up that is not taken. */
export function nextStageName(stages: readonly Pick<FlowStage, "name">[]): string {
  const taken = new Set(stages.map((s) => s.name));
  let n = stages.length + 1;
  while (taken.has(`Stage ${n}`)) n++;
  return `Stage ${n}`;
}
/** A copy of a stage (its drawing, underlay and placements) under a new id, named after it. */
export const copyStage = (s: FlowStage, id: string): FlowStage => ({ ...(JSON.parse(JSON.stringify(s)) as FlowStage), id, name: `${s.name} copy`.slice(0, STAGE_NAME_MAX) });

/**
 * A body of flow version 1 (one optional `stage`) brought to version 2 (`stages`, #426): the stage becomes the first
 * of the list, "Stage 1", with a fixed id so every client upgrading the same body shows the same stage.
 */
export function stagesFromV1<T extends Record<string, unknown>>(body: T): T {
  if (!("stage" in body)) return body;
  const { stage, ...rest } = body;
  return (stage && typeof stage === "object" ? { ...rest, stages: [{ ...(stage as object), id: "s1", name: "Stage 1" }] } : rest) as unknown as T;
}

/** A stage without a track's widget (the track removed), the same object when it had none. */
export function withoutLight(s: FlowStage, trackId: string): FlowStage {
  return s.lights.some((l) => l.track === trackId) ? { ...s, lights: s.lights.filter((l) => l.track !== trackId) } : s;
}

// ---------- What a widget shows ----------

/**
 * An effect on the stage is one of four motions (#426): a sketch of what the light does, not of how it looks. Keyed
 * by every effect id, so a new effect cannot be added without one.
 */
export type EffectFamily = "pulse" | "strobe" | "flicker" | "flash";
export const EFFECT_FAMILY: Record<EffectId, EffectFamily> = {
  pulsing: "pulse", color_chase: "pulse", nw_cct_pulse: "pulse", nw_cct_loop: "pulse", nw_intensity_loop: "pulse",
  strobe: "strobe", club_lights: "strobe", paparazzi: "strobe", cop_car: "strobe", party_lights: "strobe", nw_flash: "strobe", nw_paparazzi: "strobe",
  tv: "flicker", candle: "flicker", fire: "flicker", faulty_bulb: "flicker", welding: "flicker", nw_tv: "flicker", nw_candle: "flicker", nw_bad_bulb: "flicker", nw_cct_flicker: "flicker", nw_welding: "flicker",
  lightning: "flash", explosion: "flash", fireworks: "flash", nw_explosion: "flash", nw_fireworks: "flash",
};

export interface WidgetState {
  /** Shows light: powered, above zero and not muted. */
  on: boolean;
  /** 0..1, what the intensity is (0 when off). */
  level: number;
  /** The light's colour (white by its kelvin, or the colour), null when nothing set it. */
  colour: string | null;
  effect: { id: EffectId; name: string; family: EffectFamily } | null;
  muted: boolean;
  /** White or colour in words ("3200 K", "colour 0°"), whatever the power; null when nothing set it. */
  tint: string | null;
  /** One line of what it shows: "70 % · 3200 K", "100 % · colour 0° · Fire", "off", "muted". */
  line: string;
}

/**
 * What a light track's widget shows at `t`: sampled exactly as the player samples it (the keyframes as they play,
 * locks applied). A track without a device shows too: the stage is for prototyping before lights are assigned.
 */
export function widgetState(tr: Pick<FlowTrack, "keyframes" | "locked" | "muted">, t: number): WidgetState {
  const s = sampleTrack(playedKeyframes(tr), t);
  const muted = !!tr.muted, level = Math.min(1, Math.max(0, s.intensity ?? 0));
  const on = !muted && s.power !== false && level > 0.001;
  const fx = s.effect?.id ? { id: s.effect.id, name: effectName(s.effect.id), family: EFFECT_FAMILY[s.effect.id] ?? "flicker" } : null;
  const colour = lightColour(s);
  const tint = s.mode === "colour" ? `colour ${Math.round(s.hue ?? 0)}°` : s.kelvin !== undefined ? `${Math.round(s.kelvin / 50) * 50} K` : null;
  const line = muted ? "muted" : s.power === false ? "off" : [`${Math.round(level * 100)} %`, tint, fx?.name].filter(Boolean).join(" · ");
  return { on, level: on ? level : 0, colour, tint, effect: on ? fx : null, muted, line };
}

/** The keyframes of a family's motion: [time 0..1 of its period, opacity], linear between them. */
const MOTION: Record<EffectFamily, { periodMs: number; steps: readonly [number, number][]; hold?: boolean }> = {
  pulse: { periodMs: 1400, steps: [[0, 1], [0.5, 0.18], [1, 1]] },
  strobe: { periodMs: 240, steps: [[0, 1], [0.5, 0], [1, 0]], hold: true },
  flicker: { periodMs: 900, steps: [[0, 1], [0.07, 0.5], [0.12, 0.95], [0.2, 0.35], [0.26, 1], [0.48, 0.7], [0.52, 1], [0.7, 0.45], [0.74, 0.9], [1, 1]] },
  flash: { periodMs: 2600, steps: [[0, 0.15], [0.04, 1], [0.08, 0.2], [0.11, 1], [0.16, 0.15], [1, 0.15]] },
};
/** How much of the beam shows at a moment (`ms`: any running clock) while an effect of this family runs. */
export function effectOpacity(family: EffectFamily, ms: number): number {
  const m = MOTION[family], x = (((ms % m.periodMs) + m.periodMs) % m.periodMs) / m.periodMs;
  for (let i = 1; i < m.steps.length; i++) {
    const [t0, v0] = m.steps[i - 1], [t1, v1] = m.steps[i];
    if (x <= t1) return m.hold ? v0 : v0 + ((v1 - v0) * (x - t0)) / (t1 - t0 || 1);
  }
  return m.steps[m.steps.length - 1][1];
}

// ---------- A widget's shape, after the fixture ----------

/** A part of a widget's body, facing +x around its centre: the housing, or the face that takes the light's colour. */
export type WidgetPart = { kind: "rect"; x: number; y: number; w: number; h: number; r: number; face: boolean } | { kind: "path"; d: string; face: boolean };
export interface WidgetShape {
  parts: WidgetPart[];
  /** Where the light leaves the body, and the half height of the face there. */
  front: number; half: number;
  /** The beam's half width at its far end and its length, from off to full (stage units). */
  spread: [number, number]; len: [number, number];
  /** The glow's radius at the face. */
  glow: [number, number];
}
/** Widgets are drawn larger than life, so they read on a paper of a whole set. */
const WS = 1.5;
const rect = (x: number, y: number, w: number, h: number, r: number, face = false, k = 1): WidgetPart => ({ kind: "rect", x: x * k, y: y * k, w: w * k, h: h * k, r: r * k, face });

/**
 * The shape of a model's widget (#426): the Aputure MC a small panel with an RGB face and a soft, wide beam; a
 * NEEWER FS a COB head with a reflector and a narrower, longer beam (the FS300B larger). Other lights: a panel.
 */
export function widgetShape(model: string): WidgetShape {
  if (model.startsWith("neewer-fs")) {
    const size = model === "neewer-fs300b" ? 1.2 : 1, k = size * WS;
    const sc = (d: string) => d.replace(/-?\d+(\.\d+)?/g, (n) => String(+(Number(n) * k).toFixed(2)));
    return {
      parts: [rect(-17, -9, 20, 18, 3, false, k), { kind: "path", d: sc("M-9 -9 L-9 -13 L-5 -13 L-5 -9 Z M-9 9 L-9 13 L-5 13 L-5 9 Z"), face: false }, { kind: "path", d: sc("M3 -7 L15 -13 L15 13 L3 7 Z"), face: false }, rect(14, -12, 3.2, 24, 1, true, k)],
      front: 17 * k, half: 13 * k, spread: [30, 50], len: [110 * size, 230 * size], glow: [16 * k, 34 * k],
    };
  }
  return { parts: [rect(-7, -11, 12, 22, 2.5, false, WS), rect(4, -9, 3.5, 18, 1, true, WS)], front: 7 * WS, half: 9 * WS, spread: [46, 60], len: [70, 150], glow: [14 * WS, 30 * WS] };
}

/** The beam at a level (0..1): a wedge from the face outwards, longer and wider the brighter, as SVG path data. */
export function beamPath(g: WidgetShape, level: number): string {
  const len = g.len[0] + (g.len[1] - g.len[0]) * level, hw = g.spread[0] + (g.spread[1] - g.spread[0]) * level, f = g.front, e = (f + len).toFixed(1);
  return `M${f} ${-g.half} L${e} ${(-hw).toFixed(1)} L${e} ${hw.toFixed(1)} L${f} ${g.half} Z`;
}
export const glowRadius = (g: WidgetShape, level: number) => g.glow[0] + (g.glow[1] - g.glow[0]) * level;
/** How strongly the light reads at a level: never quite gone while on, so a low level is still seen. */
export const beamOpacity = (level: number) => 0.3 + 0.7 * level;

/** A ceiling light's widget, seen from below around its centre: the lamp's body and how far its pool of light reaches. */
export interface CeilingShape {
  parts: WidgetPart[];
  /** The body's radius (the pool starts under it). */
  r: number;
  /** The pool's radius on the floor, from off to full (stage units). */
  pool: [number, number];
}
const circle = (r: number) => `M${-r} 0 A${r} ${r} 0 1 0 ${r} 0 A${r} ${r} 0 1 0 ${-r} 0 Z`;
/**
 * The shape of a model's widget hung from the ceiling (#426): the MC a small square panel, its face down; a NEEWER
 * FS a round COB head inside its reflector (the FS300B larger, with a larger pool); each pool sized after its beam.
 */
export function ceilingShape(model: string): CeilingShape {
  if (model.startsWith("neewer-fs")) {
    const size = model === "neewer-fs300b" ? 1.2 : 1, r = 15 * size * WS;
    return { parts: [{ kind: "path", d: circle(r), face: false }, { kind: "path", d: circle(r * 0.72), face: false }, { kind: "path", d: circle(r * 0.42), face: true }], r, pool: [60 * size, 150 * size] };
  }
  return { parts: [rect(-11, -11, 22, 22, 3, false, WS), rect(-8, -8, 16, 16, 1.5, true, WS)], r: 11 * WS, pool: [50, 110] };
}
/** The pool's radius at a level (0..1): wider the brighter, never smaller than the body. */
export const poolRadius = (g: CeilingShape, level: number) => Math.max(g.r, g.pool[0] + (g.pool[1] - g.pool[0]) * level);

/** A name tag's width (stage units) for its two lines: the name (18 units bold), what it shows (14 units mono). */
export const tagWidth = (name: string, line: string) => Math.max(name.length * 10, line.length * 8.6) + 28;
/**
 * Where a widget's name tag of width `w` is centred (stage units), kept on the paper: an aimed light's behind it,
 * away from its beam; a ceiling light has no behind, so its tag sits under the body (above it at the paper's foot).
 */
export function tagAt(l: StageLight, aspect: number, w: number, scale = 1): [number, number] {
  // On a paper `scale` times as large (stageScale) the units run to STAGE_W × scale, the tag keeping its size.
  const W = STAGE_W * scale, H = W / aspect, half = Math.min(W / 2, w / 2 + 4);
  const keepX = (x: number) => Math.min(W - half, Math.max(half, x)), keepY = (y: number) => Math.min(H - 26, Math.max(26, y));
  if (isCeiling(l)) {
    const y = l.y * H, below = y + 56;
    return [keepX(l.x * W), keepY(below + 26 <= H ? below : y - 56)];
  }
  const a = (l.rot * Math.PI) / 180;
  return [keepX(l.x * W - Math.cos(a) * 62), keepY(l.y * H - Math.sin(a) * 58)];
}

/** The stage colours of the 8 track colours: the paper is dark in both themes (like a photo), so the dark theme's (Set) values. */
export const STAGE_TRACK_COLOURS = ["#F08A5D", "#E0B050", "#9CCB5A", "#4FC9BB", "#5BB8F0", "#9A9BFF", "#E580EE", "#FF7F9E"] as const;
/** The paper, its grid, a widget's housing and an unlit face: content colours, fixed in both themes. */
export const STAGE_INK = { paper: "#15171b", grid: "rgba(255,255,255,0.05)", body: "#2b2d31", rim: "#a7a9ae", unlit: "#3a3c40", tag: "rgba(8,9,11,0.86)", name: "#f4f4f2", line: "#c5c5c1", select: "#82A4FF" } as const;
/** The colours the stage's tools offer: they read on the dark paper. */
export const STAGE_DRAW_COLOURS = ["#ECECEA", "#8C8C8E", "#FF5A4F", "#4FD1E0", "#F2B33D", "#9CCB5A"] as const;
