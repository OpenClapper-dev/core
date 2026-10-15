import { DEFAULT_VIEWFINDER_LAYOUT, validateViewfinderLayout, type VfBar, type VfOrientation, type ViewfinderLayout } from "@fielder/vocab";

/**
 * Sizes of the viewfinder's bars (issue #49), so the preview can be fitted between them before they
 * render. Portrait bars are rows stacked in one chrome block per edge (10 pad · rows with 10 gaps ·
 * 12 pad · 2 dp edge line); landscape bars are 80 dp columns side by side.
 */
export const VF_SIZES = { padStart: 10, padEnd: 12, gap: 10, line: 2, row: 56, shutter: 76, column: 80 } as const;

/** A portrait bar's height: the shutter makes it 76 dp, buttons and the lens strip 56. */
export const rowHeight = (bar: VfBar): number => (bar.items.some((i) => i.control === "shutter") ? VF_SIZES.shutter : VF_SIZES.row);

/** How much of the screen one edge's bars take (height in portrait, width in landscape). `pad` adds the cutout clearance in landscape. */
export function edgeExtent(o: VfOrientation, edge: "start" | "end", portrait: boolean, pad = 0): number {
  const bars = o.bars.filter((b) => b.edge === edge);
  if (!bars.length) return 0;
  if (!portrait) return bars.length * VF_SIZES.column + pad;
  return VF_SIZES.padStart + bars.reduce((a, b) => a + rowHeight(b), 0) + VF_SIZES.gap * (bars.length - 1) + VF_SIZES.padEnd + VF_SIZES.line;
}

/** The layout the phone uses: the chosen one when it is cached and valid, else the shipped default. */
export function resolveLayout(id: string | null, cached: readonly { id: string; layout: unknown }[]): ViewfinderLayout {
  const hit = id ? cached.find((l) => l.id === id) : undefined;
  return hit && !validateViewfinderLayout(hit.layout) ? (hit.layout as ViewfinderLayout) : DEFAULT_VIEWFINDER_LAYOUT;
}
