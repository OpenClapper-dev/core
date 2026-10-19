/**
 * Sequence blocks in a timeline (issue #37). A sequence (one shot, n photos) enters a cut as one
 * block: its clips stay together in photo order and move as one. Its length is either the sum of
 * the photos' own hold times ("each") or one total split across them ("total"), evenly or with
 * more time for the first and last photo ("edges"). The Worker recomputes a "total" block's clip
 * durations on every save with `splitDuration`, so the stored clips always add up.
 */

export const GROUP_MODES = ["each", "total"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];
export const GROUP_SPLITS = ["even", "edges"] as const;
export type GroupSplit = (typeof GROUP_SPLITS)[number];

export interface ClipGroup {
  id: string;
  mode: GroupMode;
  /** The block's length in mode "total" (kept in "each" too, so switching back restores it). */
  total_ms: number;
  split: GroupSplit;
  /** "edges": the first and last photo each get this many shares, the rest one. */
  edge_weight: number;
}

export const CLIP_MIN_MS = 100;
export const CLIP_MAX_MS = 3_600_000;
export const GROUP_MAX_MS = 24 * 3_600_000;
export const EDGE_WEIGHT = { min: 1, max: 3, def: 1.5 } as const;

/**
 * Split a total over n photos in 100 ms steps. Each photo gets at least 100 ms (a total too short
 * for that grows); the rounding remainder goes to the last photo, so the parts add up to the total.
 */
export function splitDuration(totalMs: number, n: number, split: GroupSplit, edgeWeight: number): number[] {
  if (n <= 0) return [];
  const units = Math.max(n, Math.round(totalMs / CLIP_MIN_MS));
  const w = split === "edges" ? Math.min(EDGE_WEIGHT.max, Math.max(EDGE_WEIGHT.min, edgeWeight)) : 1;
  const shares = Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? w : 1));
  const sum = shares.reduce((a, s) => a + s, 0);
  const out = shares.map((s) => Math.max(1, Math.floor((units * s) / sum)));
  out[n - 1] = Math.max(1, units - out.slice(0, -1).reduce((a, u) => a + u, 0));
  return out.map((u) => Math.min(CLIP_MAX_MS, u * CLIP_MIN_MS));
}

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** A block's settings as sent by the Studio; null when valid. */
export function validateGroup(v: unknown): string | null {
  if (!v || typeof v !== "object") return "must be an object";
  const g = v as Record<string, unknown>;
  if (!isUuid(g.id)) return "id must be a UUID";
  if (!GROUP_MODES.includes(g.mode as GroupMode)) return `mode must be one of ${GROUP_MODES.join(", ")}`;
  if (!GROUP_SPLITS.includes(g.split as GroupSplit)) return `split must be one of ${GROUP_SPLITS.join(", ")}`;
  if (typeof g.total_ms !== "number" || !Number.isFinite(g.total_ms) || g.total_ms < CLIP_MIN_MS || g.total_ms > GROUP_MAX_MS) return `total_ms must be ${CLIP_MIN_MS}..${GROUP_MAX_MS}`;
  if (typeof g.edge_weight !== "number" || !(g.edge_weight >= EDGE_WEIGHT.min && g.edge_weight <= EDGE_WEIGHT.max)) return `edge_weight must be ${EDGE_WEIGHT.min}..${EDGE_WEIGHT.max}`;
  return null;
}

/**
 * Whether the clips of each block sit together and show photos of one shot; null when they do.
 * `shot_id` is the clip's photo's shot (null for a placeholder).
 */
export function groupLayoutProblem(clips: { group_id: string | null; shot_id: string | null }[]): string | null {
  const seen = new Map<string, { last: number; shot: string | null }>();
  for (let i = 0; i < clips.length; i++) {
    const g = clips[i].group_id;
    if (!g) continue;
    if (!clips[i].shot_id) return `clips[${i}]: a placeholder cannot be in a sequence block`;
    const s = seen.get(g);
    if (s && s.last !== i - 1) return `clips[${i}]: the clips of a sequence block must be adjacent`;
    if (s && s.shot !== clips[i].shot_id) return `clips[${i}]: a sequence block holds photos of one shot`;
    seen.set(g, { last: i, shot: clips[i].shot_id });
  }
  return null;
}
