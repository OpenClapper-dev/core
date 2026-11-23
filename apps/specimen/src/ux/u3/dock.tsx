// Panels that can be put elsewhere in a window: beside the stage at the left or right, or below it, and next to or
// above and below each other. A panel is dragged by the grip in its head and dropped onto a half of another panel
// or onto an empty edge of the window. Pointer-based, with a ghost of our own. The arrangement is a personal preference.
import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { Icon } from "@openclapper/design";

/** A place holds one panel, or panels beside each other (row) or above each other (col), nested as needed. */
export type Node = string | { dir: "row" | "col"; kids: Node[] };
export type Zone = "left" | "right" | "bottom";
export type Layout = Record<Zone, Node | null>;
type Side = "left" | "right" | "top" | "bottom";
type Target = { zone: Zone } | { panel: string; side: Side };
const ZONES: Zone[] = ["left", "right", "bottom"];

export const without = (n: Node | null, id: string): Node | null => {
  if (n == null || typeof n === "string") return n === id ? null : n;
  const kids = n.kids.map((k) => without(k, id)).filter((k): k is Node => k != null);
  return kids.length === 0 ? null : kids.length === 1 ? kids[0] : { ...n, kids };
};
const insert = (n: Node, target: string, id: string, side: Side): Node => {
  const dir = side === "left" || side === "right" ? "row" : "col", before = side === "left" || side === "top";
  if (typeof n === "string") return n === target ? { dir, kids: before ? [id, n] : [n, id] } : n;
  const i = n.kids.indexOf(target);
  if (i >= 0 && n.dir === dir) { const kids = [...n.kids]; kids.splice(before ? i : i + 1, 0, id); return { ...n, kids }; }
  return { ...n, kids: n.kids.map((k) => insert(k, target, id, side)) };
};
/** The layout with panel `id` taken from where it was and put at the target. */
export function dock(l: Layout, id: string, to: Target): Layout {
  if ("panel" in to && to.panel === id) return l;
  const out: Layout = { left: without(l.left, id), right: without(l.right, id), bottom: without(l.bottom, id) };
  if ("zone" in to) out[to.zone] = out[to.zone] == null ? id : { dir: to.zone === "bottom" ? "row" : "col", kids: [out[to.zone]!, id] };
  else for (const z of ZONES) if (out[z]) out[z] = insert(out[z]!, to.panel, id, to.side);
  return out;
}
export const holds = (n: Node | null, id: string): boolean => (n == null ? false : typeof n === "string" ? n === id : n.kids.some((k) => holds(k, id)));

interface Drag { id: string; x: number; y: number; to: Target | null; box: [number, number, number, number] | null; root: Element }

export function useDock(layout: Layout, onChange: (l: Layout) => void, titles: Record<string, string>) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const start = (id: string) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, root = e.currentTarget.closest("[data-theme]") ?? document.body;
    let on = false;
    const move = (m: PointerEvent) => {
      if (!on && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
      on = true;
      const el = document.elementFromPoint(m.clientX, m.clientY), edge = el?.closest<HTMLElement>("[data-dockzone]"), panel = el?.closest<HTMLElement>("[data-panel]");
      let to: Target | null = null, box: Drag["box"] = null;
      if (edge) { const r = edge.getBoundingClientRect(); to = { zone: edge.dataset.dockzone as Zone }; box = [r.left, r.top, r.width, r.height]; }
      else if (panel && panel.dataset.panel !== id) {
        const r = panel.getBoundingClientRect(), x = (m.clientX - r.left) / r.width, y = (m.clientY - r.top) / r.height;
        const side = ([["left", x], ["right", 1 - x], ["top", y], ["bottom", 1 - y]] as [Side, number][]).sort((a, b) => a[1] - b[1])[0][0];
        to = { panel: panel.dataset.panel!, side };
        box = side === "left" ? [r.left, r.top, r.width / 2, r.height] : side === "right" ? [r.left + r.width / 2, r.top, r.width / 2, r.height] : side === "top" ? [r.left, r.top, r.width, r.height / 2] : [r.left, r.top + r.height / 2, r.width, r.height / 2];
      }
      const d = { id, x: m.clientX, y: m.clientY, to, box, root };
      live.current = d; setDrag(d);
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); const d = live.current; live.current = null; setDrag(null); if (d?.to) onChange(dock(layout, d.id, d.to)); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  /** The grip a panel's head carries. */
  const grip = (id: string) => <i className="u3-grab" role="button" aria-label={`Move the ${titles[id]} panel`} title="Drag to put this panel elsewhere" onPointerDown={start(id)}><Icon name="grip" size={12} /></i>;
  /** While a panel is dragged: the half it would take, and a label at the pointer. */
  const overlay = drag && createPortal(<>{drag.box && <div className="u3-dockbox" style={{ left: drag.box[0], top: drag.box[1], width: drag.box[2], height: drag.box[3] }} />}<div className="u3-dockghost" style={{ left: drag.x + 12, top: drag.y + 12 }}><Icon name="grip" size={12} />{titles[drag.id]}</div></>, drag.root);
  return { grip, overlay, dragging: drag?.id ?? null };
}

/** Draws a place: a panel, or its panels beside or above each other. */
export function Place({ node, render }: { node: Node; render: (id: string) => ComponentChildren }): JSX.Element {
  if (typeof node === "string") return <section className="u3-panel" data-panel={node}>{render(node)}</section>;
  return <div className={`u3-split u3-split--${node.dir}`}>{node.kids.map((k, i) => <Place key={typeof k === "string" ? k : i} node={k} render={render} />)}</div>;
}
