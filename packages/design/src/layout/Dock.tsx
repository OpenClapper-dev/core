import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";
import { ResizablePanel } from "./ResizablePanel";

export type DockZone = "left" | "right" | "bottom";
/** One place for panels: a single panel, or several as tabs. Collapsed, only its head shows. */
export interface DockGroup { tabs: string[]; active?: string; collapsed?: boolean }
/** Places beside each other (row) or above each other (col), with their shares of the room. */
export interface DockSplit { dir: "row" | "col"; kids: DockNode[]; sizes?: number[] }
export type DockNode = DockGroup | DockSplit;
/** Where every panel of a window sits: left and right of the middle, and below it. */
export type DockLayout = Partial<Record<DockZone, DockNode | null>>;
export interface DockPanel { id: string; title: string; icon?: IconName; /** The panel's own controls: a row inside the panel, under the head. The head carries only the tabs and the collapse button. */ actions?: ComponentChildren; body: ComponentChildren; /** Needs little room (a strip of tools): its place is only as big as its content, a rail at a side or beside another panel, a bar above or below one. */ slim?: boolean }
type Side = "left" | "right" | "top" | "bottom" | "center";
type Target = { zone: DockZone } | { panel: string; side: Side };

const ZONES: DockZone[] = ["left", "right", "bottom"];
const isGroup = (n: DockNode): n is DockGroup => "tabs" in n;
const groupsOf = (n: DockNode | null | undefined): DockGroup[] => (!n ? [] : isGroup(n) ? [n] : n.kids.flatMap(groupsOf));
const holds = (n: DockNode, id: string) => groupsOf(n).some((g) => g.tabs.includes(id));
const keep = (n: DockNode | null | undefined, ok: (id: string) => boolean): DockNode | null => {
  if (!n) return null;
  if (isGroup(n)) { const tabs = n.tabs.filter(ok); return tabs.length ? { ...n, tabs, active: n.active && tabs.includes(n.active) ? n.active : tabs[0] } : null; }
  const kept = n.kids.map((k, i) => [keep(k, ok), n.sizes?.[i] ?? 1] as const).filter((k): k is readonly [DockNode, number] => !!k[0]);
  return kept.length === 0 ? null : kept.length === 1 ? kept[0][0] : { ...n, kids: kept.map((k) => k[0]), sizes: kept.map((k) => k[1]) };
};
const put = (n: DockNode, target: string, id: string, side: Side): DockNode => {
  const dir = side === "left" || side === "right" ? "row" : "col", before = side === "left" || side === "top";
  if (isGroup(n)) {
    if (!n.tabs.includes(target)) return n;
    if (side === "center") return { ...n, tabs: [...n.tabs, id], active: id, collapsed: false };
    return { dir, kids: before ? [{ tabs: [id] }, n] : [n, { tabs: [id] }] };
  }
  const i = n.kids.findIndex((k) => isGroup(k) && k.tabs.includes(target));
  if (i >= 0 && side !== "center" && n.dir === dir) { const kids = [...n.kids], sizes = n.kids.map((_, k) => n.sizes?.[k] ?? 1); kids.splice(before ? i : i + 1, 0, { tabs: [id] }); sizes.splice(before ? i : i + 1, 0, sizes[i]); return { ...n, kids, sizes }; }
  return { ...n, kids: n.kids.map((k) => put(k, target, id, side)) };
};
const mapGroups = (n: DockNode | null | undefined, fn: (g: DockGroup) => DockGroup): DockNode | null => (!n ? null : isGroup(n) ? fn(n) : { ...n, kids: n.kids.map((k) => mapGroups(k, fn)!) });
const each = (l: DockLayout, fn: (n: DockNode | null | undefined) => DockNode | null): DockLayout => ({ left: fn(l.left), right: fn(l.right), bottom: fn(l.bottom) });

/** The layout with a panel taken from where it was and put into a zone, next to another panel, or into its tabs. */
export function dockMove(l: DockLayout, id: string, to: Target): DockLayout {
  const out = each(l, (n) => keep(n, (x) => x !== id));
  if ("zone" in to) { const z = out[to.zone]; out[to.zone] = z ? { dir: to.zone === "bottom" ? "row" : "col", kids: [z, { tabs: [id] }] } : { tabs: [id] }; return out; }
  if (to.panel === id) return l;
  return each(out, (n) => (n ? put(n, to.panel, id, to.side) : null));
}
/** The layout with a panel brought to the front of its tabs, and its place opened unless `open` is false. */
export const dockShow = (l: DockLayout, id: string, open = true): DockLayout => each(l, (n) => mapGroups(n, (g) => (g.tabs.includes(id) ? { ...g, active: id, collapsed: open ? false : g.collapsed } : g)));
/** The layout with the place of a panel collapsed or opened. */
export const dockCollapse = (l: DockLayout, id: string, collapsed: boolean): DockLayout => each(l, (n) => mapGroups(n, (g) => (g.tabs.includes(id) ? { ...g, collapsed } : g)));
/** Whether a panel can be seen right now: in front of its tabs, in a place that is open. */
export const dockShown = (l: DockLayout, id: string) => ZONES.some((z) => groupsOf(l[z]).some((g) => !g.collapsed && (g.active && g.tabs.includes(g.active) ? g.active : g.tabs[0]) === id));

/** A layout kept in the browser under a key, so an arrangement outlives a reload. In the product it is an account preference. */
export function useDockLayout(key: string, initial: DockLayout): [DockLayout, (l: DockLayout) => void, () => void] {
  const [layout, setLayout] = useState<DockLayout>(() => { try { const s = localStorage.getItem(`oc-dock:${key}`); return s ? (JSON.parse(s) as DockLayout) : initial; } catch { return initial; } });
  const set = (l: DockLayout) => { setLayout(l); try { localStorage.setItem(`oc-dock:${key}`, JSON.stringify(l)); } catch { /* not stored: the arrangement lasts until the page is left */ } };
  return [layout, set, () => { setLayout(initial); try { localStorage.removeItem(`oc-dock:${key}`); } catch { /* nothing stored */ } }];
}

/**
 * Panels around the middle of a window that the user arranges: drag a panel's tab onto a half of another panel to sit
 * beside, above or below it, onto its middle to share it as tabs, or onto an empty edge of the window. Panels of one
 * place share it by dragging the border between them; a place collapses to its head.
 */
export interface DockProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> {
  panels: DockPanel[];
  layout: DockLayout;
  onLayoutChange: (l: DockLayout) => void;
  /** The zones to draw; the others keep their panels out of sight (while a tool takes the window, say). */
  zones?: DockZone[];
  /** Starting size of each zone in px. */
  zoneSizes?: Partial<Record<DockZone, number>>;
  /** The middle: what the panels are about. */
  children?: ComponentChildren;
}

interface Drag { id: string; x: number; y: number; to: Target | null; box: [number, number, number, number] | null; root: Element }

export function Dock({ panels, layout, onLayoutChange, zones = ZONES, zoneSizes, children, className, ...rest }: DockProps) {
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const byId = new Map(panels.map((p) => [p.id, p]));
  const shown = (z: DockZone) => (zones.includes(z) ? keep(layout[z], (id) => byId.has(id)) : null);
  const slimOf = (g: DockGroup) => g.tabs.every((t) => byId.get(t)?.slim);
  const patch = (id: string, c: Partial<DockGroup>) => onLayoutChange(each(layout, (n) => mapGroups(n, (g) => (g.tabs.includes(id) ? { ...g, ...c } : g))));

  const start = (id: string) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, themed = e.currentTarget.closest("[data-theme]") ?? document.body;
    dragged.current = false;
    const move = (m: PointerEvent) => {
      if (!dragged.current && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
      dragged.current = true;
      const el = document.elementFromPoint(m.clientX, m.clientY), edge = el?.closest<HTMLElement>("[data-dock-zone]"), group = el?.closest<HTMLElement>("[data-dock-group]");
      let to: Target | null = null, box: Drag["box"] = null;
      if (edge && edge.closest(".oc-dock") === root.current) { const r = edge.getBoundingClientRect(); to = { zone: edge.dataset.dockZone as DockZone }; box = [r.left, r.top, r.width, r.height]; }
      else if (group && group.closest(".oc-dock") === root.current) {
        // The panel it lands next to: any tab of that place but the dragged one.
        const other = group.dataset.dockGroup!.split(" ").find((t) => t !== id);
        if (other) {
          const r = group.getBoundingClientRect(), x = (m.clientX - r.left) / r.width, y = (m.clientY - r.top) / r.height, onHead = !!el?.closest(".oc-dock__head");
          const side: Side = onHead || (x > 0.25 && x < 0.75 && y > 0.25 && y < 0.75) ? "center" : ([["left", x], ["right", 1 - x], ["top", y], ["bottom", 1 - y]] as [Side, number][]).sort((a, b) => a[1] - b[1])[0][0];
          to = { panel: other, side };
          box = side === "center" ? [r.left, r.top, r.width, r.height] : side === "left" ? [r.left, r.top, r.width / 2, r.height] : side === "right" ? [r.left + r.width / 2, r.top, r.width / 2, r.height] : side === "top" ? [r.left, r.top, r.width, r.height / 2] : [r.left, r.top + r.height / 2, r.width, r.height / 2];
        }
      }
      const d = { id, x: m.clientX, y: m.clientY, to, box, root: themed };
      live.current = d; setDrag(d);
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); const d = live.current; live.current = null; setDrag(null); if (d?.to) onLayoutChange(dockMove(layout, d.id, d.to)); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  /** Dragging the border between two places of a split moves room from one to the other. */
  const share = (a: DockNode, b: DockNode, dir: "row" | "col") => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    e.preventDefault();
    const bar = e.currentTarget, prev = bar.previousElementSibling!.getBoundingClientRect(), next = bar.nextElementSibling!.getBoundingClientRect();
    const pa = dir === "row" ? prev.width : prev.height, pb = dir === "row" ? next.width : next.height, s0 = dir === "row" ? e.clientX : e.clientY;
    const ida = groupsOf(a)[0].tabs[0], idb = groupsOf(b)[0].tabs[0];
    const move = (m: PointerEvent) => {
      const na = Math.max(64, Math.min(pa + pb - 64, pa + (dir === "row" ? m.clientX : m.clientY) - s0));
      const set = (n: DockNode | null | undefined): DockNode | null => {
        if (!n || isGroup(n)) return n ?? null;
        const i = n.kids.findIndex((k) => holds(k, ida)), j = n.kids.findIndex((k) => holds(k, idb));
        if (i < 0 || j < 0 || i === j) return { ...n, kids: n.kids.map((k) => set(k)!) };
        const sizes = n.kids.map((_, k) => n.sizes?.[k] ?? 1), sum = sizes[i] + sizes[j];
        sizes[i] = (sum * na) / (pa + pb); sizes[j] = sum - sizes[i];
        return { ...n, sizes };
      };
      onLayoutChange(each(layout, set));
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };

  const draw = (n: DockNode, zone: DockZone, all: boolean, parent?: "row" | "col", size?: number): JSX.Element => {
    if (!isGroup(n)) {
      return (
        <div key={groupsOf(n)[0].tabs[0] + n.dir} className={cx("oc-dock__split", `oc-dock__split--${n.dir}`)} style={size != null ? { flex: `${size} 1 0px` } : undefined}>
          {n.kids.flatMap((k, i) => {
            const prev = n.kids[i - 1], folded = (x: DockNode) => isGroup(x) && (!!x.collapsed || slimOf(x));
            return [i > 0 && !folded(prev) && !folded(k) && <i key={`bar${i}`} role="separator" aria-orientation={n.dir === "row" ? "vertical" : "horizontal"} className={cx("oc-dock__bar", `oc-dock__bar--${n.dir}`)} title="Drag to share the room" onPointerDown={share(prev, k, n.dir)} />, draw(k, zone, all, n.dir, n.sizes?.[i] ?? 1)];
          })}
        </div>
      );
    }
    const active = n.active && n.tabs.includes(n.active) ? n.active : n.tabs[0], panel = byId.get(active)!;
    // A collapsed place and a slim one take the same shape: a rail where they stand beside something, a bar where they lie above or below.
    const slim = slimOf(n), fixed = !!n.collapsed || slim, rail = fixed && (all ? zone !== "bottom" : parent === "row");
    return (
      <section key={n.tabs[0]} data-dock-group={n.tabs.join(" ")} className={cx("oc-dock__group", n.collapsed && "is-collapsed", slim && "is-slim", rail && "is-rail", slim && !rail && "is-bar")} style={{ flex: fixed ? "none" : `${size ?? 1} 1 0px` }}>
        <header className="oc-dock__head">
          <span className={cx("oc-dock__tabs", n.tabs.length > 1 && "is-many")} role="tablist">
            {n.tabs.map((t) => { const p = byId.get(t)!; return <button key={t} type="button" role="tab" aria-selected={t === active} className="oc-dock__tab" title={n.collapsed ? `Open ${p.title}` : "Drag to put this panel elsewhere"} onPointerDown={start(t)} onClick={() => { if (!dragged.current) patch(t, { active: t, collapsed: false }); }}>{p.icon && <Icon name={p.icon} />}<span>{p.title}</span></button>; })}
          </span>
          {!n.collapsed && <button type="button" className="oc-dock__fold" aria-label={`Collapse ${panel.title}`} title="Collapse" onClick={() => patch(active, { collapsed: true })}><Icon name="minus" size={12} /></button>}
        </header>
        {!n.collapsed && panel.actions != null && <div className="oc-dock__actions">{panel.actions}</div>}
        {!n.collapsed && <div className="oc-dock__body">{panel.body}</div>}
      </section>
    );
  };
  const zoneEl = (z: DockZone) => {
    const node = shown(z);
    if (!node) return null;
    const all = groupsOf(node).every((g) => g.collapsed || slimOf(g));
    return <ResizablePanel key={z} side={z} defaultSize={zoneSizes?.[z] ?? (z === "bottom" ? 240 : z === "right" ? 320 : 260)} min={z === "bottom" ? 96 : 200} max={z === "bottom" ? 640 : 720} className={cx("oc-dock__zone", `oc-dock__zone--${z}`, all && "is-min")}>{draw(node, z, all)}</ResizablePanel>;
  };
  /** While a panel is dragged, an empty zone shows where it is. */
  const edge = (z: DockZone) => zones.includes(z) && !shown(z) && <div key={z} data-dock-zone={z} className={cx("oc-dock__edge", `oc-dock__edge--${z}`)}><Icon name="plus" size={12} />{z === "bottom" ? "Below" : z === "left" ? "Left" : "Right"}</div>;
  return (
    <div ref={root} className={cx("oc-dock", className)} {...rest}>
      {zoneEl("left")}
      <div className="oc-dock__mid"><div className="oc-dock__center">{children}</div>{zoneEl("bottom")}{drag && edge("bottom")}</div>
      {zoneEl("right")}
      {drag && (["left", "right"] as DockZone[]).map(edge)}
      {drag && createPortal(<>{drag.box && <div className="oc-dock__drop" style={{ left: drag.box[0], top: drag.box[1], width: drag.box[2], height: drag.box[3] }}>{drag.to && "side" in drag.to && drag.to.side === "center" && <span>As a tab</span>}</div>}<div className="oc-dock__ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>{byId.get(drag.id)?.icon && <Icon name={byId.get(drag.id)!.icon!} />}{byId.get(drag.id)?.title}</div></>, drag.root)}
    </div>
  );
}
