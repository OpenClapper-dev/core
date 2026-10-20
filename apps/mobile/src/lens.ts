import { LENS_PRESETS_MM } from "@openclapper/fov-math";
import type { LensRange } from "./types.ts";

/** Built-in focal lengths inside the range, plus the range endpoints so a 24-70 still reaches 70. */
export function lensList(range: LensRange | null): number[] {
  if (!range) return [...LENS_PRESETS_MM];
  const inside = LENS_PRESETS_MM.filter((mm) => mm >= range.min && mm <= range.max);
  return [...new Set([range.min, ...inside, range.max])].sort((a, b) => a - b);
}

export const clampToRange = (mm: number, range: LensRange | null): number =>
  range ? Math.min(range.max, Math.max(range.min, mm)) : mm;

/** Step through the list. For a custom value, stepping goes to the nearest neighbour in the list. */
export function stepLens(list: number[], current: number, dir: -1 | 1): number {
  const i = list.indexOf(current);
  if (i >= 0) return list[Math.min(list.length - 1, Math.max(0, i + dir))];
  const next = dir > 0 ? list.find((mm) => mm > current) : [...list].reverse().find((mm) => mm < current);
  return next ?? current;
}
