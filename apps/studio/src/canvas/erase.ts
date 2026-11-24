// The canvas's eraser (docs/features/canvas.md): along the path the eraser is dragged, either the parts of
// pen strokes under it go (the stroke splits into pieces) and anything else it touches goes whole, or
// every object it touches goes whole. The drawing stays vectors: nothing is masked. Pure, for tests.

type P = [number, number];
/** What the eraser reads of an object: its box (fractions of the surface), points inside the box, kind, state. */
export interface Erasable { id: string; kind: string; x: number; y: number; w: number; h: number; pts?: P[]; visible: boolean; locked: boolean; group?: string | null }
export type EraseMode = "partial" | "whole";

/** Squared distance from p to the segment a–b, in a space where both axes have the same unit. */
function segDist2(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/**
 * Erases at one point of the eraser's path. `aspect` is the surface's width over its height (so the
 * eraser is round on screen); `r` its radius as a fraction of the surface's height. Returns the new list,
 * or the same one when nothing was touched. Locked, hidden and grouped objects are left alone.
 */
export function eraseAt<T extends Erasable>(objs: readonly T[], at: P, r: number, aspect: number, mode: EraseMode, newId: () => string): readonly T[] {
  const sp = (q: P): P => [q[0] * aspect, q[1]];
  const c = sp(at), r2 = r * r;
  const abs = (o: T, q: P): P => sp([o.x + q[0] * o.w, o.y + q[1] * o.h]);
  let changed = false;
  const out: T[] = [];
  for (const o of objs) {
    if (o.kind === "group" || !o.visible || o.locked || o.group) { out.push(o); continue; }
    if ((o.kind === "pen" || o.kind === "line" || o.kind === "arrow") && o.pts && o.pts.length) {
      const pts = o.pts.map((q) => abs(o, q));
      const hit = pts.length === 1 ? segDist2(c, pts[0], pts[0]) <= r2 : pts.some((q, i) => i > 0 && segDist2(c, pts[i - 1], q) <= r2);
      if (!hit) { out.push(o); continue; }
      changed = true;
      if (mode === "whole" || o.kind !== "pen") continue;
      // A pen stroke loses the points under the eraser and splits where they were.
      const runs: P[][] = [];
      let run: P[] = [];
      for (const q of o.pts) {
        const a = abs(o, q), d = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2;
        if (d <= r2) { if (run.length) runs.push(run); run = []; } else run.push([o.x + q[0] * o.w, o.y + q[1] * o.h]);
      }
      if (run.length) runs.push(run);
      runs.filter((p) => p.length >= 2).forEach((p, i) => {
        const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
        const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
        out.push({ ...o, id: i === 0 ? o.id : newId(), x, y, w: Math.max(w, 0.0005), h: Math.max(h, 0.0005), pts: p.map((q): P => [w ? (q[0] - x) / w : 0, h ? (q[1] - y) / h : 0]) });
      });
      continue;
    }
    // Shapes, text, stencils, pictures: touched where the eraser reaches their box.
    const [l, t] = sp([o.x, o.y]), [rgt, b] = sp([o.x + o.w, o.y + o.h]);
    const nx = Math.max(l, Math.min(c[0], rgt)), ny = Math.max(t, Math.min(c[1], b));
    if ((nx - c[0]) ** 2 + (ny - c[1]) ** 2 <= r2) { changed = true; continue; }
    out.push(o);
  }
  return changed ? out : objs;
}
