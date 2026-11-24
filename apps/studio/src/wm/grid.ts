/**
 * The desktop's icon grid: icons sit in whole cells, never on top of each other. A cell is a column
 * and a row; its pixel spot is pad + index × cell size. Pure, so it is tested on its own.
 */
export interface Cell { c: number; r: number }
export interface Grid { w: number; h: number; pad: number; cols: number; rows: number }
export const cellKey = (c: Cell) => `${c.c}:${c.r}`;
/** The cell a pixel spot falls in (its nearest one), never negative. */
export const cellAt = (g: Grid, x: number, y: number): Cell => ({ c: Math.max(0, Math.round((x - g.pad) / g.w)), r: Math.max(0, Math.round((y - g.pad) / g.h)) });
export const cellSpot = (g: Grid, c: Cell) => ({ x: g.pad + c.c * g.w, y: g.pad + c.r * g.h });

/**
 * The free cell nearest to `want` (by distance, then column-major), inside the grid when there is
 * room; a full grid continues in new columns to the right, like a desktop does.
 */
export function nearestFreeCell(taken: ReadonlySet<string>, want: Cell, cols: number, rows: number): Cell {
  const C = Math.max(1, cols), R = Math.max(1, rows);
  const w = { c: Math.min(Math.max(0, want.c), C - 1), r: Math.min(Math.max(0, want.r), R - 1) };
  let best: Cell | null = null, bestD = Infinity;
  for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) {
    if (taken.has(cellKey({ c, r }))) continue;
    const d = (c - w.c) ** 2 + (r - w.r) ** 2;
    if (d < bestD) { best = { c, r }; bestD = d; }
  }
  if (best) return best;
  for (let c = C; ; c++) for (let r = 0; r < R; r++) if (!taken.has(cellKey({ c, r }))) return { c, r };
}

/**
 * Every icon in a cell of its own: the saved cell where it is free and on screen, else the free
 * cell nearest to where it wants to be (`want`, default the top left). Earlier ids win a clash.
 */
export function layOut(ids: readonly string[], saved: Readonly<Record<string, Cell>>, g: Grid, want: (id: string) => Cell | undefined = () => undefined): Map<string, Cell> {
  const out = new Map<string, Cell>();
  const taken = new Set<string>();
  const inside = (c: Cell) => c.c < g.cols && c.r < g.rows;
  const later: string[] = [];
  for (const id of ids) {
    const s = saved[id];
    if (s && inside(s) && !taken.has(cellKey(s))) { out.set(id, s); taken.add(cellKey(s)); } else later.push(id);
  }
  for (const id of later) {
    const c = nearestFreeCell(taken, saved[id] ?? want(id) ?? { c: 0, r: 0 }, g.cols, g.rows);
    out.set(id, c);
    taken.add(cellKey(c));
  }
  return out;
}
