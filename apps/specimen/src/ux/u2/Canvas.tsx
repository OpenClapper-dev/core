// UX workshop U2, round 2: the canvas tool. Objects in one stack (shapes, text, stencils, pictures, groups) that are
// selected, moved, resized and layered as in a drawing program; a surface (a base photo or paper) at the bottom;
// frames on a base photo, drawn with the real frame math. A prototype on fake data: no server, no product code.
// Specified in docs/rewrite/05-composition.md and 02-optics.md.
import "./u2.css";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Button, Checkbox, DropdownMenu, EditorLayout, Icon, NumberInput, Popover, PropertyList, PropertyRow, PropertySection, Segmented, Select, Slider, StatusBar, Switch, TextArea, TextInput, Toolbar, ToolbarSpacer, ToolRail, cx,
  type IconName,
} from "@openclapper/design";
import { picture } from "../u1/pictures";
import { ColourButton, css, type Colour } from "../u1/catalogue";
import { ASPECTS, FORMATS, KIND, NO_LOOK, PHOTO, PRESETS, PRIMES, START, STENCILS, clampCentre, frameFrom, lookFilter, rectOf, type Frame, type Kind, type Look, type Obj } from "./model";

type Tool = "select" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "stencil" | "picture";
const TOOLS: { id: Tool; icon: IconName; label: string; kbd: string }[] = [
  { id: "select", icon: "cursor", label: "Move", kbd: "V" }, { id: "pen", icon: "pencil", label: "Pen", kbd: "P" }, { id: "line", icon: "line-tool", label: "Line", kbd: "L" }, { id: "arrow", icon: "arrow-up-right", label: "Arrow", kbd: "A" },
  { id: "rect", icon: "square", label: "Rectangle", kbd: "R" }, { id: "ellipse", icon: "circle", label: "Ellipse", kbd: "O" }, { id: "text", icon: "text", label: "Text", kbd: "T" }, { id: "stencil", icon: "stencil", label: "Stencil", kbd: "S" }, { id: "picture", icon: "image", label: "Place a photo", kbd: "I" },
];
type P = [number, number];
type Act =
  | { type: "move"; start: P; orig: Record<string, P> }
  | { type: "resize"; id: string; corner: number; box: [number, number, number, number] }
  | { type: "draw"; tool: Tool; pts: P[] }
  | { type: "frame"; id: string; start: P; orig: Record<string, P> };

let seq = 100;
const uid = () => `o${seq++}`;

export default function U2Canvas() {
  const [objs, setObjs] = useState<Obj[]>(START);
  const [sel, setSel] = useState<string[]>([]);
  const [rootSel, setRootSel] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [stroke, setStroke] = useState<Colour>("#ff2d2d");
  const [strokeW, setStrokeW] = useState(3);
  const [stencil, setStencil] = useState<IconName>("camera");
  const [surface, setSurface] = useState<{ kind: "photo" | "blank"; colour: Colour; look: Look }>({ kind: "photo", colour: "#f4f1ea", look: NO_LOOK });
  const [frames, setFrames] = useState<Frame[]>(() => [frameFrom(PRESETS[0], 18, 0), frameFrom(PRESETS[0], 24, 1), frameFrom(PRESETS[0], 35, 2)]);
  const [selF, setSelF] = useState<string | null>(null);
  const [pic, setPic] = useState<string | null>(() => null);
  const [linked, setLinked] = useState(true);
  const [mode, setMode] = useState("outline");
  const [tab, setTab] = useState("layers");
  const [locked, setLocked] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [draft, setDraft] = useState<{ tool: Tool; pts: P[] } | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const act = useRef<Act | null>(null);

  useEffect(() => { setPic(frames[1].id); }, []);
  const photo = surface.kind === "photo";
  const byId = new Map(objs.map((o) => [o.id, o]));
  const kids = (g: string) => objs.filter((o) => o.group === g);
  const shown = (o: Obj) => o.visible && (!o.group || byId.get(o.group)?.visible !== false);
  const frozen = (o: Obj) => o.locked || (!!o.group && !!byId.get(o.group)?.locked);
  /** The box of an object; a group's is the box around its children. */
  const bounds = (o: Obj): [number, number, number, number] => { if (o.kind !== "group") return [o.x, o.y, o.w, o.h]; const k = kids(o.id); if (!k.length) return [0, 0, 0, 0]; const x = Math.min(...k.map((c) => c.x)), y = Math.min(...k.map((c) => c.y)); return [x, y, Math.max(...k.map((c) => c.x + c.w)) - x, Math.max(...k.map((c) => c.y + c.h)) - y]; };
  /** Everything a set of selected ids moves: the objects themselves and the children of selected groups. */
  const moved = (ids: string[]) => objs.filter((o) => (ids.includes(o.id) && o.kind !== "group") || (o.group && ids.includes(o.group))).filter((o) => !frozen(o));
  const patchO = (ids: string[], c: Partial<Obj>) => setObjs((os) => os.map((o) => (ids.includes(o.id) ? { ...o, ...c } : o)));
  const pick = (id: string | null, add = false) => { setRootSel(false); setSelF(null); setSel(id == null ? [] : add ? (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]) : [id]); if (id) setTab("layers"); };

  // Frames
  const shownFrames = photo ? frames.filter((f) => f.visible) : [];
  // When a frame sees more than the photo, the surface is drawn smaller so the whole frame fits; the rest is hatched.
  const scale = 1 / Math.max(1, ...shownFrames.map((f) => { const r = rectOf(f); return Math.max(r.w, r.h); }));
  const picF = photo ? frames.find((f) => f.id === pic && f.visible) : undefined;
  const place = (f: Frame, inner = false) => { const r = rectOf(f), s = inner && r.inner ? r.inner : r; return { left: `${(0.5 + (f.cx - 0.5 - s.w / 2) * scale) * 100}%`, top: `${(0.5 + (f.cy - 0.5 - s.h / 2) * scale) * 100}%`, width: `${s.w * scale * 100}%`, height: `${s.h * scale * 100}%` }; };
  const patchF = (id: string, c: Partial<Frame>) => setFrames((fs) => fs.map((f) => { if (f.id !== id) return f; const n = { ...f, ...c }, r = rectOf(n); return { ...n, cx: clampCentre(n.cx, r.w), cy: clampCentre(n.cy, r.h) }; }));
  /** Linked centres: every frame that fits on the photo shares one centre, held inside by the largest of them. */
  const centreAll = (cx: number, cy: number) => setFrames((fs) => { const fit = fs.map(rectOf).filter((r) => r.w < 1 && r.h < 1), w = Math.max(0, ...fit.map((r) => r.w)), h = Math.max(0, ...fit.map((r) => r.h)); const x = clampCentre(cx, w), y = clampCentre(cy, h); return fs.map((f) => { const r = rectOf(f); return { ...f, cx: r.w >= 1 ? 0.5 : x, cy: r.h >= 1 ? 0.5 : y }; }); });
  const cur = frames.find((f) => f.id === selF) ?? null;
  const preset = cur?.preset ? PRESETS.find((p) => p.id === cur.preset) : undefined;
  const curR = cur ? rectOf(cur) : null;

  // Crop: the view is fitted to the picture's frame; outside it nothing shows, and a delivery aspect leaves bars inside.
  const crop = mode === "crop" && picF ? (() => { const r = rectOf(picF), k = Math.min(1 / (r.w * scale), 1 / (r.h * scale)), cx = 0.5 + (picF.cx - 0.5) * scale, cy = 0.5 + (picF.cy - 0.5) * scale; return `translate(${(0.5 - cx * k) * 100}%, ${(0.5 - cy * k) * 100}%) scale(${k})`; })() : undefined;

  // Pointer work on the surface. Positions are fractions of the surface.
  const at = (e: PointerEvent): P => { const r = box.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const capture = (e: PointerEvent) => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* a synthetic event has no pointer to capture */ } };
  const down = (e: PointerEvent) => {
    if (locked) return;
    if (tool === "select") { pick(null); return; }
    capture(e);
    const p = at(e);
    if (tool === "text" || tool === "stencil" || tool === "picture") {
      const size: P = tool === "text" ? [0.26, 0.06] : tool === "stencil" ? [0.07, 0.093] : [0.3, 0.3];
      const o: Obj = { id: uid(), kind: tool, name: tool === "text" ? "Text" : tool === "stencil" ? `Stencil: ${stencil}` : "Photo 0131", x: p[0] - size[0] / 2, y: p[1] - size[1] / 2, w: size[0], h: size[1], stroke, width: strokeW, opacity: 1, visible: true, locked: false, text: tool === "text" ? "Text" : undefined, icon: tool === "stencil" ? stencil : undefined, seed: tool === "picture" ? 17 : undefined, look: tool === "picture" ? NO_LOOK : undefined };
      setObjs((os) => [...os, o]); setTool("select"); setRootSel(false); setSelF(null); setSel([o.id]); setTab("layers");
      return;
    }
    act.current = { type: "draw", tool, pts: [p, p] }; setDraft({ tool, pts: [p, p] });
  };
  const move = (e: PointerEvent) => {
    const a = act.current; if (!a) return;
    const p = at(e);
    if (a.type === "draw") { a.pts = a.tool === "pen" ? [...a.pts, p] : [a.pts[0], p]; setDraft({ tool: a.tool, pts: a.pts }); }
    else if (a.type === "move") setObjs((os) => os.map((o) => (a.orig[o.id] ? { ...o, x: a.orig[o.id][0] + p[0] - a.start[0], y: a.orig[o.id][1] + p[1] - a.start[1] } : o)));
    else if (a.type === "resize") { const [x, y, w, h] = a.box, x2 = x + w, y2 = y + h; const nx = a.corner % 2 === 0 ? Math.min(p[0], x2 - 0.01) : x, ny = a.corner < 2 ? Math.min(p[1], y2 - 0.01) : y, nx2 = a.corner % 2 === 1 ? Math.max(p[0], x + 0.01) : x2, ny2 = a.corner >= 2 ? Math.max(p[1], y + 0.01) : y2; patchO([a.id], { x: nx, y: ny, w: nx2 - nx, h: ny2 - ny }); }
    else if (a.type === "frame") { const dx = p[0] - a.start[0], dy = p[1] - a.start[1]; if (linked) centreAll(a.orig[a.id][0] + dx, a.orig[a.id][1] + dy); else patchF(a.id, { cx: a.orig[a.id][0] + dx, cy: a.orig[a.id][1] + dy }); }
  };
  const up = () => {
    const a = act.current; act.current = null;
    if (a?.type !== "draw") return;
    setDraft(null);
    const xs = a.pts.map((q) => q[0]), ys = a.pts.map((q) => q[1]);
    let x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (w < 0.006 && h < 0.006) { if (a.tool === "pen") return; w = 0.16; h = a.tool === "line" || a.tool === "arrow" ? 0 : 0.12; a.pts = [[x, y], [x + w, y + h]]; }
    const line = a.tool === "pen" || a.tool === "line" || a.tool === "arrow";
    const o: Obj = { id: uid(), kind: a.tool as Kind, name: KIND[a.tool as Kind].label, x, y, w: Math.max(w, 0.001), h: Math.max(h, 0.001), pts: line ? a.pts.map((q): P => [w ? (q[0] - x) / w : 0, h ? (q[1] - y) / h : 0]) : undefined, stroke, width: strokeW, opacity: 1, visible: true, locked: false };
    setObjs((os) => [...os, o]); setRootSel(false); setSelF(null); setSel([o.id]); setTab("layers");
  };
  const grabO = (e: PointerEvent, o: Obj) => {
    if (locked || tool !== "select") return;
    e.stopPropagation();
    const id = o.group ?? o.id, ids = e.shiftKey ? (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]) : sel.includes(id) ? sel : [id];
    setRootSel(false); setSelF(null); setSel(ids); setTab("layers");
    capture(e);
    act.current = { type: "move", start: at(e), orig: Object.fromEntries(moved(ids).map((m) => [m.id, [m.x, m.y] as P])) };
  };
  const grabF = (e: PointerEvent, f: Frame) => { if (locked || tool !== "select") return; e.stopPropagation(); setSel([]); setRootSel(false); setSelF(f.id); setTab("frames"); capture(e); act.current = { type: "frame", id: f.id, start: at(e), orig: Object.fromEntries(frames.map((x) => [x.id, [x.cx, x.cy] as P])) }; };

  // Stack operations. A block is a top-level object, or a group with its children.
  const tops = objs.filter((o) => !o.group);
  const flat = (order: Obj[]) => order.flatMap((t) => (t.kind === "group" ? [...kids(t.id), t] : [t]));
  const reorder = (id: string, to: number) => { const order = tops.filter((t) => t.id !== id), it = byId.get(id)!; order.splice(Math.max(0, Math.min(order.length, to)), 0, it); setObjs(flat(order)); };
  const step = (id: string, d: number) => reorder(id, tops.findIndex((t) => t.id === id) + d);
  const remove = (ids: string[]) => { setObjs((os) => os.filter((o) => !ids.includes(o.id) && !(o.group && ids.includes(o.group)))); setSel([]); };
  const duplicate = (ids: string[]) => { const copies: Obj[] = []; for (const o of objs) { if (ids.includes(o.id) && o.kind !== "group") copies.push({ ...o, id: uid(), name: `${o.name} copy`, x: o.x + 0.02, y: o.y + 0.02, group: undefined }); } setObjs((os) => [...os, ...copies]); setSel(copies.map((c) => c.id)); };
  const group = () => { const members = tops.filter((t) => sel.includes(t.id) && t.kind !== "group"); if (members.length < 2) return; const g: Obj = { id: uid(), kind: "group", name: "Group", x: 0, y: 0, w: 0, h: 0, stroke: 0, width: 0, opacity: 1, visible: true, locked: false }; const ids = members.map((m) => m.id), last = Math.max(...ids.map((i) => tops.findIndex((t) => t.id === i))); const order = tops.filter((t) => !ids.includes(t.id)); order.splice(last - ids.length + 1, 0, g); setObjs(order.flatMap((t) => (t.id === g.id ? [...members.map((m) => ({ ...m, group: g.id })), g] : t.kind === "group" ? [...kids(t.id), t] : [t]))); setSel([g.id]); setOpen([...open, g.id]); };
  const ungroup = (id: string) => { setObjs((os) => os.filter((o) => o.id !== id).map((o) => (o.group === id ? { ...o, group: undefined } : o))); setSel(kids(id).map((k) => k.id)); };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (locked || t.closest("input, textarea, [contenteditable], [role=combobox]")) return;
      const k = e.key.toLowerCase();
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) { e.preventDefault(); remove(sel); }
      else if ((e.metaKey || e.ctrlKey) && k === "g") { e.preventDefault(); if (e.shiftKey) { const g = sel.find((s) => byId.get(s)?.kind === "group"); if (g) ungroup(g); } else group(); }
      else if ((e.metaKey || e.ctrlKey) && k === "d" && sel.length) { e.preventDefault(); duplicate(sel); }
      else if (e.key === "Escape") { pick(null); setTool("select"); }
      else if (!e.metaKey && !e.ctrlKey && !e.altKey) { const hit = TOOLS.find((x) => x.kbd.toLowerCase() === k); if (hit) setTool(hit.id); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // Drawing one object. Lines live in a layer the size of the surface, so arrowheads and strokes keep their shape.
  const vec = (pts: P[], o: Pick<Obj, "x" | "y" | "w" | "h">) => pts.map((q) => `${((o.x + q[0] * o.w) * 1000).toFixed(1)},${((o.y + q[1] * o.h) * 750).toFixed(1)}`).join(" ");
  const draw = (o: Obj, ghost = false) => {
    const c = css(o.stroke), common = { "data-obj": o.id, onPointerDown: ghost ? undefined : (e: PointerEvent) => grabO(e, o) };
    if (o.kind === "pen" || o.kind === "line" || o.kind === "arrow") return (
      <svg key={o.id} {...common} className="u2-vec" viewBox="0 0 1000 750" preserveAspectRatio="none" style={{ opacity: o.opacity }}>
        {o.kind === "arrow" && <defs><marker id={`m${o.id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={c} /></marker></defs>}
        <polyline points={vec(o.pts ?? [], o)} fill="none" stroke={c} stroke-width={o.width * 1.3} stroke-linecap="round" stroke-linejoin="round" marker-end={o.kind === "arrow" ? `url(#m${o.id})` : undefined} />
        <polyline className="u2-vec__hit" points={vec(o.pts ?? [], o)} fill="none" stroke="transparent" stroke-width="18" />
      </svg>
    );
    const st: JSX.CSSProperties = { left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, opacity: o.opacity, color: c };
    if (o.kind === "rect" || o.kind === "ellipse") return <div key={o.id} {...common} className={cx("u2-obj", `u2-obj--${o.kind}`)} style={{ ...st, border: `${o.width}px solid ${c}`, background: o.fill != null ? css(o.fill) : undefined }} />;
    if (o.kind === "text") return <div key={o.id} {...common} className="u2-obj u2-obj--text" style={{ ...st, "--fs": o.h * 78 }}>{o.text}</div>;
    if (o.kind === "stencil") return <div key={o.id} {...common} className="u2-obj u2-obj--stencil" style={st}><Icon name={o.icon ?? "camera"} size={24} stroke={1.6} /></div>;
    return <div key={o.id} {...common} className="u2-obj u2-obj--picture" style={st}><img src={picture(o.seed ?? 17)} alt="" draggable={false} style={{ filter: lookFilter(o.look) }} /></div>;
  };
  const one = sel.length === 1 ? byId.get(sel[0]) ?? null : null;
  const marks = sel.map((s) => byId.get(s)).filter((o): o is Obj => !!o);

  // Inspector: the stack.
  const row = (o: Obj, depth = 0) => (
    <li key={o.id} className={cx("u2-row", sel.includes(o.id) && "is-current", dragRow === o.id && "is-dragging", !shown(o) && "is-hidden")} style={{ paddingLeft: 6 + depth * 18 }} draggable={depth === 0}
      onClick={(e) => pick(o.id, e.shiftKey || e.metaKey || e.ctrlKey)} onDragStart={() => setDragRow(o.id)} onDragEnd={() => setDragRow(null)} onDragOver={(e) => { if (dragRow && depth === 0) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); if (dragRow && dragRow !== o.id && depth === 0) reorder(dragRow, tops.filter((t) => t.id !== dragRow).findIndex((t) => t.id === o.id) + 1); setDragRow(null); }}>
      {o.kind === "group" ? <button type="button" className="u2-row__twist" aria-label={open.includes(o.id) ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); setOpen(open.includes(o.id) ? open.filter((x) => x !== o.id) : [...open, o.id]); }}><Icon name={open.includes(o.id) ? "chevron-down" : "chevron-right"} size={12} /></button> : <span className="u2-row__twist" />}
      <Icon name={o.kind === "stencil" && o.icon ? o.icon : KIND[o.kind].icon} />
      <span className="u2-row__name">{o.name}{o.kind === "group" && <small> · {kids(o.id).length}</small>}</span>
      <Button size="sm" variant="quiet" icon={o.locked ? "lock" : "unlock"} selected={o.locked} label={o.locked ? "Unlock" : "Lock"} onClick={(e) => { e.stopPropagation(); patchO([o.id], { locked: !o.locked }); }} />
      <Button size="sm" variant="quiet" icon={o.visible ? "eye" : "eye-off"} label={o.visible ? "Hide" : "Show"} onClick={(e) => { e.stopPropagation(); patchO([o.id], { visible: !o.visible }); }} />
    </li>
  );
  const look = (l: Look, set: (l: Look) => void) => ([["exposure", "Exposure", -2, 2], ["contrast", "Contrast", -0.6, 0.6], ["saturation", "Saturation", -1, 1]] as const).map(([k, label, min, max]) => <PropertyRow key={k} label={label}><Slider min={min} max={max} step={0.02} value={l[k]} onChange={(v) => set({ ...l, [k]: v })} /></PropertyRow>);
  const layersTab = (
    <>
      <PropertySection title={`Layers · ${objs.length}`} icon="layers">
        <div className="u2-bar">
          <Button size="sm" variant="quiet" icon="group" disabled={marks.filter((m) => !m.group && m.kind !== "group").length < 2} onClick={group}>Group</Button>
          <Button size="sm" variant="quiet" disabled={one?.kind !== "group"} onClick={() => one && ungroup(one.id)}>Ungroup</Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="quiet" icon="arrow-up" label="Bring forward" disabled={!one || !!one.group} onClick={() => one && step(one.id, 1)} />
          <Button size="sm" variant="quiet" icon="arrow-down" label="Send backward" disabled={!one || !!one.group} onClick={() => one && step(one.id, -1)} />
        </div>
        <ul className="u2-stack">
          {[...tops].reverse().flatMap((t) => [row(t), ...(t.kind === "group" && open.includes(t.id) ? [...kids(t.id)].reverse().map((k) => row(k, 1)) : [])])}
          <li className={cx("u2-row u2-row--root", rootSel && "is-current")} onClick={() => { setSel([]); setSelF(null); setRootSel(true); }}><span className="u2-row__twist" /><Icon name={photo ? "image" : "file"} /><span className="u2-row__name">{photo ? PHOTO.name : "Paper"}<small> · the surface</small></span><Icon name="lock" size={12} /></li>
        </ul>
        <p className="u2-note">Top of the list is in front. Drag a row to reorder; Shift-click to select several.</p>
      </PropertySection>
      {rootSel && (
        <PropertySection title="Surface" icon={photo ? "image" : "file"}>
          <PropertyRow label="Kind"><Segmented label="Surface" value={surface.kind} onChange={(v) => { setSurface({ ...surface, kind: v as "photo" | "blank" }); setSelF(null); }} options={[{ value: "photo", label: "Base photo" }, { value: "blank", label: "Blank" }]} /></PropertyRow>
          {photo ? <><PropertyRow label="Photo" value={PHOTO.name} /><PropertyRow label="Angle of view" value="74° × 59° · from EXIF" />{look(surface.look, (l) => setSurface({ ...surface, look: l }))}</> : <PropertyRow label="Colour"><ColourButton value={surface.colour} label="Paper colour" onChange={(c) => setSurface({ ...surface, colour: c })} /></PropertyRow>}
        </PropertySection>
      )}
      {marks.length > 0 && (
        <PropertySection title={one ? `${KIND[one.kind].label}: ${one.name}` : `${marks.length} selected`} icon={one ? KIND[one.kind].icon : "layers"}>
          {one && <PropertyRow label="Name"><TextInput size="sm" value={one.name} onInput={(e) => patchO([one.id], { name: (e.target as HTMLInputElement).value })} /></PropertyRow>}
          {one?.kind === "text" && <PropertyRow label="Text"><TextArea rows={2} value={one.text} onInput={(e) => patchO([one.id], { text: (e.target as HTMLTextAreaElement).value })} /></PropertyRow>}
          {one?.kind === "stencil" && <PropertyRow label="Stencil"><Popover trigger={<Button size="sm" icon={one.icon}>Change</Button>}><div className="u2-stencils">{STENCILS.map((s) => <button type="button" key={s} title={s} className={cx(one.icon === s && "is-on")} onClick={() => patchO([one.id], { icon: s, name: `Stencil: ${s}` })}><Icon name={s} size={20} /></button>)}</div></Popover></PropertyRow>}
          {one?.kind === "picture" && look(one.look ?? NO_LOOK, (l) => patchO([one.id], { look: l }))}
          {marks.some((m) => m.kind !== "group" && m.kind !== "picture") && <PropertyRow label={one?.kind === "text" || one?.kind === "stencil" ? "Colour" : "Stroke"}><ColourButton value={marks[0].stroke} label="Stroke colour" onChange={(c) => patchO(sel, { stroke: c })} /></PropertyRow>}
          {marks.some((m) => m.kind === "rect" || m.kind === "ellipse") && <PropertyRow label="Fill"><span className="u2-inline"><Checkbox checked={marks[0].fill != null} onChange={(c) => patchO(sel, { fill: c ? marks[0].stroke : undefined })}>Filled</Checkbox>{marks[0].fill != null && <ColourButton value={marks[0].fill} label="Fill colour" onChange={(c) => patchO(sel, { fill: c })} />}</span></PropertyRow>}
          {marks.some((m) => ["pen", "line", "arrow", "rect", "ellipse"].includes(m.kind)) && <PropertyRow label="Stroke width"><Slider min={1} max={12} step={1} value={marks[0].width} onChange={(v) => patchO(sel, { width: v })} /></PropertyRow>}
          {marks.some((m) => m.kind !== "group") && <PropertyRow label="Opacity"><Slider min={0.1} max={1} step={0.05} value={marks[0].opacity} onChange={(v) => patchO(sel, { opacity: v })} /></PropertyRow>}
          <div className="u2-bar"><Button size="sm" variant="quiet" icon="copy" onClick={() => duplicate(sel)}>Duplicate</Button><Button size="sm" variant="quiet" icon="trash" onClick={() => remove(sel)}>Delete</Button></div>
        </PropertySection>
      )}
    </>
  );

  // Inspector: frames.
  const addFrame = (id: string) => {
    const n = frames.length;
    const f: Frame = id === "free" ? { ...frameFrom(PRESETS[1], 35, n), kind: "free", preset: undefined, name: "Free-form" } : id === "aspect" ? { ...frameFrom(PRESETS[1], 35, n), kind: "aspect", preset: undefined, name: "2.39:1", delivery: undefined } : (() => { const p = PRESETS.find((x) => x.id === id)!; return frameFrom(p, p.primes?.[0] ?? p.zoom![0], n); })();
    const first = frames[0];
    setFrames([...frames, linked && first ? { ...f, cx: clampCentre(first.cx, rectOf(f).w), cy: clampCentre(first.cy, rectOf(f).h) } : f]); setSel([]); setRootSel(false); setSelF(f.id); if (!pic) setPic(f.id);
  };
  const framesTab = !photo ? <PropertySection title="Frames" icon="frame"><p className="u2-note">Frames need a base photo: a frame is what a camera sees of the picture. Select the surface in Layers to give the canvas one.</p></PropertySection> : (
    <>
      <PropertySection title={`Frames · ${frames.length}`} icon="frame">
        <ul className="u2-stack">
          {frames.map((f) => { const fr = rectOf(f); return (
            <li key={f.id} className={cx("u2-row u2-row--frame", selF === f.id && "is-current", !f.visible && "is-hidden")} onClick={() => { setSel([]); setRootSel(false); setSelF(f.id); }}>
              <i style={{ background: css(f.color) }} />
              <span className="u2-row__name">{f.name}<small>{f.kind === "preset" ? PRESETS.find((p) => p.id === f.preset)?.name : f.kind === "free" ? `Free-form · ${f.format[0]} × ${f.format[1]} mm` : "Aspect ratio"}</small></span>
              {Math.max(fr.w, fr.h) > 1 && <span title="Sees more than the photo"><Icon name="expand" size={12} /></span>}
              <Button size="sm" variant="quiet" icon="star" selected={pic === f.id} label={pic === f.id ? "The picture of this canvas" : "Make it the picture"} onClick={(e) => { e.stopPropagation(); setPic(pic === f.id ? null : f.id); }} />
              <Button size="sm" variant="quiet" icon={f.visible ? "eye" : "eye-off"} label={f.visible ? "Hide" : "Show"} onClick={(e) => { e.stopPropagation(); patchF(f.id, { visible: !f.visible }); }} />
            </li>
          ); })}
        </ul>
        <div className="u2-bar">
          <DropdownMenu size="sm" icon="plus" label="Frame" items={[{ heading: "From an optics preset" }, ...PRESETS.map((p) => ({ id: p.id, label: p.name, icon: "lens" as const })), { separator: true }, { id: "free", label: "Free-form values", icon: "sliders" }, { id: "aspect", label: "Aspect ratio only", icon: "aspect" }]} onSelect={addFrame} />
          <span style={{ flex: 1 }} />
          <Switch checked={linked} onChange={(c) => { setLinked(c); if (c) { const f = cur ?? picF ?? frames[0]; if (f) centreAll(f.cx, f.cy); } }}>Link centres</Switch>
        </div>
        <p className="u2-note">{linked ? "Linked: the frames share one centre and move together." : "Each frame is moved on its own."}</p>
      </PropertySection>
      {cur && (
        <PropertySection title={`Frame: ${cur.name}`} icon="sliders">
          <PropertyRow label="Name"><TextInput size="sm" value={cur.name} onInput={(e) => patchF(cur.id, { name: (e.target as HTMLInputElement).value })} /></PropertyRow>
          <PropertyRow label="Colour"><ColourButton value={cur.color} label="Frame colour" onChange={(c) => patchF(cur.id, { color: c })} /></PropertyRow>
          {cur.kind === "preset" && preset && (
            <>
              <PropertyRow label="Preset"><Select size="sm" value={preset.id} onChange={(v) => { const p = PRESETS.find((x) => x.id === v)!; patchF(cur.id, { preset: p.id, format: p.format, mult: p.mult, squeeze: p.squeeze, delivery: p.delivery, focal: p.primes?.[0] ?? p.zoom![0], name: `${p.primes?.[0] ?? p.zoom![0]} mm` }); }} options={PRESETS.map((p) => ({ value: p.id, label: p.name }))} /></PropertyRow>
              <PropertyRow label="Focal length">
                {preset.primes ? <span className="u2-chips">{preset.primes.map((mm) => <button type="button" key={mm} className={cx(cur.focal === mm && "is-on")} onClick={() => patchF(cur.id, { focal: mm, name: `${mm} mm` })}>{mm}</button>)}</span>
                  : <span className="u2-zoom"><Slider min={preset.zoom![0]} max={preset.zoom![1]} step={1} value={cur.focal} onChange={(mm) => patchF(cur.id, { focal: mm, name: `${mm} mm` })} /><b className="oc-num">{cur.focal} mm</b></span>}
              </PropertyRow>
              <PropertyRow label="From the preset" value={`${preset.format[0]} × ${preset.format[1]} mm${preset.squeeze > 1 ? ` · ${preset.squeeze}× squeeze` : ""}${preset.delivery ? ` · ${preset.delivery}:1` : ""}`} />
            </>
          )}
          {cur.kind === "free" && (
            <>
              <PropertyRow label="Format"><Select size="sm" value={cur.format.join("x")} onChange={(v) => { const [w, h] = v.split("x").map(Number); patchF(cur.id, { format: [w, h] }); }} options={FORMATS.map(([n, w, h]) => ({ value: `${w}x${h}`, label: n }))} /></PropertyRow>
              <PropertyRow label="Focal length"><NumberInput size="sm" value={cur.focal} unit="mm" min={4} max={600} step={1} onChange={(mm) => patchF(cur.id, { focal: Math.round(mm), name: cur.name === `${cur.focal} mm` || cur.name === "Free-form" ? `${Math.round(mm)} mm` : cur.name })} /></PropertyRow>
              <PropertyRow label="Stops"><span className="u2-chips u2-chips--wrap">{PRIMES.map((mm) => <button type="button" key={mm} className={cx(cur.focal === mm && "is-on")} onClick={() => patchF(cur.id, { focal: mm })}>{mm}</button>)}</span></PropertyRow>
              <PropertyRow label="Multiplier"><NumberInput size="sm" value={cur.mult} step={0.01} min={0.5} max={2} onChange={(m) => patchF(cur.id, { mult: m })} /></PropertyRow>
              <PropertyRow label="Squeeze"><Select size="sm" value={String(cur.squeeze)} onChange={(v) => patchF(cur.id, { squeeze: Number(v) })} options={[1, 1.25, 1.33, 1.5, 1.6, 1.8, 2].map((s) => ({ value: String(s), label: s === 1 ? "Spherical" : `${s}×` }))} /></PropertyRow>
              <PropertyRow label="Delivery"><Select size="sm" value={cur.delivery ? String(cur.delivery) : ""} onChange={(v) => patchF(cur.id, { delivery: v ? Number(v) : undefined })} options={[{ value: "", label: "As the camera sees" }, ...ASPECTS.map(([n, a]) => ({ value: String(a), label: n }))]} /></PropertyRow>
            </>
          )}
          {cur.kind === "aspect" && (
            <>
              <PropertyRow label="Aspect"><Select size="sm" value={String(cur.aspect)} onChange={(v) => patchF(cur.id, { aspect: Number(v), name: ASPECTS.find(([, a]) => String(a) === v)![0] })} options={ASPECTS.map(([n, a]) => ({ value: String(a), label: n }))} /></PropertyRow>
              <PropertyRow label="Size"><Slider min={0.2} max={1} step={0.01} value={cur.size} onChange={(s) => patchF(cur.id, { size: s })} /></PropertyRow>
            </>
          )}
          {cur.kind !== "aspect" && <PropertyRow label="Orientation"><Segmented label="Orientation" value={cur.portrait ? "p" : "l"} onChange={(v) => patchF(cur.id, { portrait: v === "p" })} options={[{ value: "l", label: "Landscape" }, { value: "p", label: "Portrait" }]} /></PropertyRow>}
          {curR?.hfov && <PropertyRow label="Sees" value={`${curR.hfov.toFixed(0)}° × ${curR.vfov!.toFixed(0)}° · like ${curR.ffeq!.toFixed(0)} mm on full frame`} />}
          <div className="u2-bar">{cur.kind === "free" && <Button size="sm" variant="quiet" icon="plus">Create a preset from it</Button>}<span style={{ flex: 1 }} /><Button size="sm" variant="quiet" icon="trash" onClick={() => { setFrames(frames.filter((f) => f.id !== cur.id)); setSelF(null); if (pic === cur.id) setPic(null); }}>Remove</Button></div>
        </PropertySection>
      )}
    </>
  );

  const selBox = one && !frozen(one) ? bounds(one) : null;
  const drawing = tool !== "select";
  return (
    <div className="u2" data-theme={theme}>
      <header className="u2-proto">
        <strong>U2</strong><span className="u2-proto__note">prototype · Canvas</span>
        <span style={{ flex: 1 }} />
        <label><Checkbox checked={locked} onChange={setLocked}>Someone else is editing</Checkbox></label>
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      <div className="u2-work">
        <EditorLayout className={cx("u2-editor", locked && "is-locked")} inspectorWidth={340} {...(locked ? { inert: true } : {})}
          toolbar={<Toolbar>
            <strong className="u2-title">Canvas 02</strong>
            <Button size="sm" variant="quiet" icon="undo" label="Undo" /><Button size="sm" variant="quiet" icon="redo" label="Redo" />
            {drawing && <span className="u2-toolopts"><span className="oc-meta">{TOOLS.find((t) => t.id === tool)!.label}</span>
              {tool !== "picture" && <ColourButton value={stroke} label="Colour" onChange={setStroke} />}
              {["pen", "line", "arrow", "rect", "ellipse"].includes(tool) && <span className="u2-zoom" style={{ width: 150 }}><Slider min={1} max={12} step={1} value={strokeW} onChange={setStrokeW} /><b className="oc-num">{strokeW} px</b></span>}
              {tool === "stencil" && <Popover trigger={<Button size="sm" icon={stencil} iconAfter="chevron-down">Stencil</Button>}><div className="u2-stencils">{STENCILS.map((s) => <button type="button" key={s} title={s} className={cx(stencil === s && "is-on")} onClick={() => setStencil(s)}><Icon name={s} size={20} /></button>)}</div></Popover>}
              {(tool === "text" || tool === "stencil" || tool === "picture") && <span className="oc-meta">click on the canvas to place it</span>}
            </span>}
            <ToolbarSpacer />
            {photo && <Segmented label="View mode" value={mode} onChange={setMode} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} />}
          </Toolbar>}
          toolRail={<ToolRail value={tool} onChange={(t) => setTool(t as Tool)} tools={[TOOLS[0], { separator: true }, ...TOOLS.slice(1, 6), { separator: true }, ...TOOLS.slice(6)]} />}
          canvas={
            <div className="u2-fit">
              <div className={cx("u2-stage", `u2-stage--${photo ? mode : "blank"}`, drawing && "is-drawing", scale < 1 && "is-beyond")}>
                <div className="u2-world" style={{ transform: crop, transformOrigin: "0 0" }}>
                  <div ref={box} className="u2-surface" style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, background: photo ? undefined : css(surface.colour) }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
                    {photo && <img className="u2-photo" src={picture(PHOTO.seed)} alt="" draggable={false} style={{ filter: lookFilter(surface.look) }} />}
                    {objs.filter((o) => o.kind !== "group" && shown(o)).map((o) => draw(o))}
                    {draft && draft.tool !== "pen" && draft.tool !== "line" && draft.tool !== "arrow" && (() => { const [a, b] = draft.pts; return <div className={cx("u2-obj", `u2-obj--${draft.tool}`)} style={{ left: `${Math.min(a[0], b[0]) * 100}%`, top: `${Math.min(a[1], b[1]) * 100}%`, width: `${Math.abs(b[0] - a[0]) * 100}%`, height: `${Math.abs(b[1] - a[1]) * 100}%`, border: `${strokeW}px solid ${css(stroke)}`, pointerEvents: "none" }} />; })()}
                    {draft && (draft.tool === "pen" || draft.tool === "line" || draft.tool === "arrow") && draw({ id: "draft", kind: draft.tool as Kind, name: "", x: 0, y: 0, w: 1, h: 1, pts: draft.pts, stroke, width: strokeW, opacity: 1, visible: true, locked: false }, true)}
                    {tool === "select" && marks.filter((m) => m !== one || !selBox).map((m) => { const [x, y, w, h] = bounds(m); return <span key={m.id} className="u2-sel" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />; })}
                    {tool === "select" && one && selBox && (
                      <span className="u2-sel" style={{ left: `${selBox[0] * 100}%`, top: `${selBox[1] * 100}%`, width: `${selBox[2] * 100}%`, height: `${selBox[3] * 100}%` }}>
                        {one.kind !== "group" && [0, 1, 2, 3].map((c) => <i key={c} className={`u2-handle u2-handle--${c}`} onPointerDown={(e) => { e.stopPropagation(); capture(e); act.current = { type: "resize", id: one.id, corner: c, box: [one.x, one.y, one.w, one.h] }; }} onPointerMove={move} onPointerUp={up} />)}
                      </span>
                    )}
                  </div>
                  {photo && (mode === "mask" || mode === "crop") && picF && <span className={cx("u2-mask", mode === "crop" && "u2-mask--solid")} style={place(picF, true)} />}
                  {photo && mode !== "full" && mode !== "crop" && shownFrames.filter((f) => mode === "outline" || f.id === pic || f.id === selF).map((f) => { const fr = rectOf(f); return (
                    <div key={f.id} className={cx("u2-frame", selF === f.id && "is-current", pic === f.id && "is-picture", Math.max(fr.w, fr.h) > 1 && "is-beyond", drawing && "is-passive")} style={{ ...place(f), "--c": css(f.color) }} onPointerDown={(e) => grabF(e, f)} onPointerMove={move} onPointerUp={up}>
                      <span className="u2-frame__label">{pic === f.id && <Icon name="star" size={12} />}{f.name}</span>
                      {fr.inner && <span className="u2-frame__inner" style={{ width: `${(fr.inner.w / fr.w) * 100}%`, height: `${(fr.inner.h / fr.h) * 100}%` }}><span>{f.delivery}:1</span></span>}
                    </div>
                  ); })}
                </div>
              </div>
            </div>
          }
          inspector={<div className="u2-inspector"><div className="u2-tabs"><Segmented label="Inspector" value={tab} onChange={setTab} options={[{ value: "layers", label: "Layers", icon: "layers" }, { value: "frames", label: `Frames${photo ? ` · ${frames.length}` : ""}`, icon: "frame" }]} /></div><PropertyList>{tab === "layers" ? layersTab : framesTab}</PropertyList></div>}
          statusBar={<StatusBar>{objs.filter((o) => o.kind !== "group").length} objects{photo && <> · {frames.length} frames{picF && <> · the picture is <strong>{picF.name}</strong></>}{scale < 1 && <> · a frame sees more than the photo: the hatched area is beyond it</>}</>}{mode === "crop" && picF && <> · Crop: fitted to the picture's frame{rectOf(picF).inner ? ", bars for the delivery aspect" : ""}</>}{cur && curR?.hfov && <> · <strong>{cur.name}</strong> covers {Math.min(100, curR.w * 100).toFixed(0)} % of the photo's width</>}</StatusBar>} />
        {locked && (
          <div className="u2-lock" role="alertdialog" aria-label="Someone else is editing">
            <div className="u2-lock__card">
              <span className="u2-lock__icon"><Icon name="lock" size={20} /></span>
              <strong>Ben is editing this canvas</strong>
              <p>Only one person can edit a canvas at a time. You see it as it was last saved. It opens for you when Ben leaves it.</p>
              <div className="u2-bar"><Button size="sm" onClick={() => setLocked(false)}>Check again</Button><Button size="sm" variant="quiet">Open a copy to edit</Button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
