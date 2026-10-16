import { MAX_VF_ITEMS, type VfControl, type VfItem, type VfOrientation } from "@fielder/vocab";

/**
 * Drag and drop in the layout editor (issue #68), the same in the bars panel and on the preview.
 * The moves are pure so they are tested; the components only work out where a drop lands.
 */

/** What is being dragged: a placed control, a control not placed yet (from "Add a control"), or a bar. */
export type VfDrag = { kind: "item"; control: VfControl } | { kind: "new"; item: VfItem } | { kind: "bar"; barId: string };
/** Where it would land: before `index` in a bar's items, or before bar `index` in the orientation. */
export type VfDrop = { kind: "item"; barId: string; index: number } | { kind: "bar"; index: number };

export const VF_DRAG_TYPE = "application/x-fielder-vf";

/** Apply a drop; returns the orientation unchanged when the drop makes no sense (full bar, dropping a bar into itself…). */
export function applyDrop(o: VfOrientation, drag: VfDrag, drop: VfDrop): VfOrientation {
  if (drag.kind === "bar") {
    if (drop.kind !== "bar") return o;
    const from = o.bars.findIndex((b) => b.id === drag.barId);
    if (from < 0) return o;
    const bars = [...o.bars];
    const [b] = bars.splice(from, 1);
    bars.splice(drop.index > from ? drop.index - 1 : drop.index, 0, b);
    return { bars };
  }
  if (drop.kind !== "item") return o;
  const target = o.bars.find((b) => b.id === drop.barId);
  if (!target) return o;
  let item: VfItem;
  let index = drop.index;
  let bars = o.bars;
  if (drag.kind === "new") {
    if (o.bars.some((b) => b.items.some((i) => i.control === drag.item.control))) return o;
    item = drag.item;
  } else {
    const src = o.bars.find((b) => b.items.some((i) => i.control === drag.control));
    if (!src) return o;
    const at = src.items.findIndex((i) => i.control === drag.control);
    item = src.items[at];
    if (src.id === target.id && at < index) index -= 1; // removing it first shifts the rest left
    bars = bars.map((b) => (b.id === src.id ? { ...b, items: b.items.filter((i) => i.control !== drag.control) } : b));
  }
  const dest = bars.find((b) => b.id === target.id)!;
  if (dest.items.length >= MAX_VF_ITEMS) return o;
  const items = [...dest.items];
  items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
  return { bars: bars.map((b) => (b.id === target.id ? { ...b, items } : b)) };
}

/**
 * The insert position for a pointer at `pos` (x in a row, y in a column) among children whose
 * leading/trailing edges are given: before the first child whose middle is past the pointer.
 */
export function insertIndex(pos: number, boxes: { start: number; end: number }[]): number {
  const i = boxes.findIndex((b) => pos < (b.start + b.end) / 2);
  return i < 0 ? boxes.length : i;
}
