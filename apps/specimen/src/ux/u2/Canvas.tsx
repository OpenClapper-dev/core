// UX workshop U2, round 7: the canvas tool. Objects in one stack (shapes, text, stencils, pictures, groups) that are
// selected, moved, resized and layered as in a drawing program; a surface (a base photo or paper) at the bottom;
// frames on a base photo, drawn with the real frame math. A prototype on fake data: no server, no product code.
// Specified in docs/rewrite/05-composition.md and 02-optics.md.
import "./u2.css";
import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Button, Checkbox, DropdownMenu, EditorLayout, Icon, NumberInput, Popover, PropertyList, PropertyRow, PropertySection, Segmented, Select, Slider, StatusBar, Switch, TextArea, TextInput, Toolbar, ToolbarSpacer, ToolRail, cx, dockShow, useDockLayout,
  type IconName,
} from "@openclapper/design";
import { picture } from "../u1/pictures";
import { ColourButton, css, type Colour } from "../u1/catalogue";
import { ASPECTS, COMMENTS, FORMATS, KIND, NO_LOOK, PENS, PHOTO, PRESETS as SEED, PRIMES, START, STENCILS, clampCentre, frameFrom, lookFilter, rectOf, type Comment, type Frame, type Kind, type Look, type Obj, type PenType, type Preset } from "./model";
import PresetFlow, { type Draft } from "./PresetFlow";

type Tool = "select" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "stencil" | "picture" | "comment";
const TOOLS: { id: Tool; icon: IconName; label: string; kbd: string }[] = [
  { id: "select", icon: "cursor", label: "Move", kbd: "V" }, { id: "pen", icon: "pencil", label: "Pen", kbd: "P" }, { id: "line", icon: "line-tool", label: "Line", kbd: "L" }, { id: "arrow", icon: "arrow-up-right", label: "Arrow", kbd: "A" },
  { id: "rect", icon: "square", label: "Rectangle", kbd: "R" }, { id: "ellipse", icon: "circle", label: "Ellipse", kbd: "O" }, { id: "text", icon: "text", label: "Text", kbd: "T" }, { id: "stencil", icon: "stencil", label: "Stencil", kbd: "S" }, { id: "picture", icon: "image", label: "Place a photo", kbd: "I" }, { id: "comment", icon: "comment", label: "Comment: click a point, or drag a region", kbd: "C" },
];
type P = [number, number];
type Act =
  | { type: "move"; start: P; orig: Record<string, P>; box: [number, number, number, number] }
  | { type: "pan"; x: number; y: number; ox: number; oy: number }
  | { type: "pin"; id: string; start: P; orig: P; moved: boolean }
  | { type: "resize"; id: string; rot: number; fixed: P }
  | { type: "rotate"; id: string; centre: P; from: number; orig: number }
  | { type: "end"; id: string; which: 0 | 1; other: P }
  | { type: "draw"; tool: Tool; pts: P[] }
  | { type: "frame"; id: string; start: P; orig: Record<string, P> };

// Rotation and rotated resizing are worked out in a space where both axes have the same unit (the surface is 4:3).
const toPx = (q: P): P => [q[0] * 4, q[1] * 3], toFr = (q: P): P => [q[0] / 4, q[1] / 3];
const turn = (v: P, deg: number): P => { const r = (deg * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r); return [v[0] * c - v[1] * n, v[0] * n + v[1] * c]; };
/** A stroke through its points with rounded corners: straight to the middle of each segment, curved around each point. */
const smooth = (q: P[]) => (q.length < 3 ? `M${q.map((x) => x.join(" ")).join(" L")}` : `M${q[0].join(" ")}` + q.slice(1, -1).map((x, i) => ` Q${x.join(" ")} ${((x[0] + q[i + 2][0]) / 2).toFixed(1)} ${((x[1] + q[i + 2][1]) / 2).toFixed(1)}`).join("") + ` L${q[q.length - 1].join(" ")}`);
/** A brush stroke as a filled shape: thin at both ends, full width in the middle. */
const taper = (q: P[], width: number) => { if (q.length < 2) return ""; const left: P[] = [], right: P[] = []; q.forEach((x, i) => { const a = q[Math.max(0, i - 1)], b = q[Math.min(q.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n: P = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], w = (width / 2) * (0.15 + 0.85 * Math.sin((Math.PI * i) / (q.length - 1))); left.push([x[0] + n[0] * w, x[1] + n[1] * w]); right.push([x[0] - n[0] * w, x[1] - n[1] * w]); }); return `M${[...left, ...right.reverse()].map((x) => `${x[0].toFixed(1)} ${x[1].toFixed(1)}`).join(" L")}Z`; };
const ROTATE = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12a7 7 0 1 1 3 5.7" stroke="white" stroke-width="5"/><path d="M5 12a7 7 0 1 1 3 5.7"/><path d="M4 16l4 2l1 -4.5" stroke="white" stroke-width="5"/><path d="M4 16l4 2l1 -4.5"/></svg>')}") 12 12, crosshair`;

let seq = 100;
const uid = () => `o${seq++}`;

/** Another app (the shot window, the timeline) can mount the editor in place: it gives the file’s name and its own theme, and the prototype bar is left out. */
export interface CanvasHost { title: string; theme: string; blank?: boolean; empty?: boolean }

export default function U2Canvas({ host }: { host?: CanvasHost } = {}) {
  const [objs, setObjs] = useState<Obj[]>(host?.empty ? [] : START);
  const [sel, setSel] = useState<string[]>([]);
  const [rootSel, setRootSel] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [stroke, setStroke] = useState<Colour>("#ff2d2d");
  const [strokeW, setStrokeW] = useState(3);
  const [stencil, setStencil] = useState<IconName>("camera");
  const [penType, setPenType] = useState<PenType>("pen");
  const [editing, setEditing] = useState<string | null>(null);
  const [surface, setSurface] = useState<{ kind: "photo" | "blank"; colour: Colour; look: Look }>({ kind: host?.blank ? "blank" : "photo", colour: "#f4f1ea", look: NO_LOOK });
  const [presets, setPresets] = useState<Preset[]>(SEED);
  /** The preset being made: its starting values, or null when the dialog is closed. */
  const [making, setMaking] = useState<Partial<Draft> | null>(null);
  const [frames, setFrames] = useState<Frame[]>(() => [frameFrom(SEED[0], 18, 0), frameFrom(SEED[0], 24, 1), frameFrom(SEED[0], 35, 2)]);
  const [selF, setSelF] = useState<string | null>(null);
  const [pic, setPic] = useState<string | null>(() => null);
  const [linked, setLinked] = useState(true);
  const [mode, setMode] = useState("outline");
  // The inspector's three parts are panels the user arranges: tabs of one place to start with.
  const [panels, setPanels] = useDockLayout(host ? "u2-hosted-2" : "u2-2", { left: { tabs: ["tools"] }, right: { tabs: ["layers", "frames", "comments"] } });
  const setTab = (id: string) => setPanels(dockShow(panels, id, false));
  const [locked, setLocked] = useState(false);
  const [own, setTheme] = useState("dark"), theme = host?.theme ?? own;
  const [draft, setDraft] = useState<{ tool: Tool; pts: P[] } | null>(null);
  // The view: how far the canvas is zoomed and where it is pushed to. It changes what is seen, never the canvas.
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [guides, setGuides] = useState<{ v?: number; h?: number }>({});
  const [snap, setSnap] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  /** Which comment is getting a new place or region drawn for it. */
  const [redraw, setRedraw] = useState<string | null>(null);
  // Reordering the layer list by dragging: the row follows the pointer as a lifted copy, the others make room.
  const [sort, setSort] = useState<{ id: string; from: number; to: number; h: number; x: number; w: number; y: number; grab: number; mids: number[]; tops: number[]; hs: number[]; drop?: boolean } | null>(null);
  const sortStart = useRef<{ id: string; y: number } | null>(null);
  const justSorted = useRef(false);
  const [compare, setCompare] = useState(false);
  const [sideA, setSideA] = useState<string | null>(null);
  const [sideB, setSideB] = useState<string | null>(null);
  const fit = useRef<HTMLDivElement>(null);
  const space = useRef(false);
  // Comments are not objects: they are not part of the picture and have no place in the stack.
  const [comments, setComments] = useState<Comment[]>(COMMENTS);
  const [selC, setSelC] = useState<string | null>(null);
  const [showC, setShowC] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [compose, setCompose] = useState<{ x: number; y: number; w?: number; h?: number } | null>(null);
  const [words, setWords] = useState("");
  const [reply, setReply] = useState("");
  const post = () => { if (!compose || !words.trim()) return; const c: Comment = { id: uid(), n: Math.max(0, ...comments.map((x) => x.n)) + 1, ...compose, author: "Ada", at: "Just now", text: words.trim(), replies: [], resolved: false }; setComments([...comments, c]); setCompose(null); setWords(""); setSelC(c.id); setTool("select"); setTab("comments"); setShowC(true); };
  // The composer takes the keyboard as soon as it opens, so the first key typed is the comment, not a tool shortcut.
  useEffect(() => { if (compose) document.querySelector<HTMLTextAreaElement>(".u2-thread textarea")?.focus(); }, [compose]);
  const openC = (id: string | null) => { setSelC(id); setReply(""); setCompose(null); if (id) { setSel([]); setSelF(null); setRootSel(false); setTab("comments"); } };
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
  const preset = cur?.preset ? presets.find((p) => p.id === cur.preset) : undefined;
  const curR = cur ? rectOf(cur) : null;

  // Crop: the view is fitted to the picture's frame; outside it nothing shows, and a delivery aspect leaves bars inside.
  const fitTo = (f: Frame) => { const r = rectOf(f), k = Math.min(1 / (r.w * scale), 1 / (r.h * scale)), cx = 0.5 + (f.cx - 0.5) * scale, cy = 0.5 + (f.cy - 0.5) * scale; return `translate(${(0.5 - cx * k) * 100}%, ${(0.5 - cy * k) * 100}%) scale(${k})`; };
  const crop = mode === "crop" && picF ? fitTo(picF) : undefined;
  // Zooming keeps the point under the pointer where it is.
  const zoomAt = (to: number, cx?: number, cy?: number) => setView((v) => { const z = Math.min(8, Math.max(0.25, to)), r = fit.current?.getBoundingClientRect(); if (!r) return { ...v, z }; const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2), py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2), k = z / v.z; return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }; });
  useEffect(() => {
    const el = fit.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomAt(view.z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); else setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) })); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  // Pointer work on the surface. Positions are fractions of the surface.
  const at = (e: PointerEvent): P => { const r = box.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const capture = (e: PointerEvent) => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* a synthetic event has no pointer to capture */ } };
  const down = (e: PointerEvent) => {
    if (locked) return;
    if (tool === "select") {
      // Nothing was hit on the way here, so no object is under the pointer. A frame is taken by its edge: objects on
      // or inside a frame always win, and a frame never has to be aimed at through them.
      const p = at(e), r = box.current!.getBoundingClientRect(), tx = 7 / r.width, ty = 7 / r.height;
      const f = photo && mode !== "full" && mode !== "crop" ? [...shownFrames].reverse().find((x) => { if (mode === "mask" && x.id !== pic && x.id !== selF) return false; const q = rectOf(x), l = x.cx - q.w / 2, t = x.cy - q.h / 2, inX = p[0] > l - tx && p[0] < l + q.w + tx, inY = p[1] > t - ty && p[1] < t + q.h + ty; return inX && inY && (Math.abs(p[0] - l) < tx || Math.abs(p[0] - l - q.w) < tx || Math.abs(p[1] - t) < ty || Math.abs(p[1] - t - q.h) < ty); }) : undefined;
      setSelC(null);
      if (f) grabF(e, f); else pick(null);
      return;
    }
    capture(e);
    const p = at(e);
    if (tool === "text" || tool === "stencil" || tool === "picture") {
      const size: P = tool === "text" ? [0.26, 0.06] : tool === "stencil" ? [0.07, 0.093] : [0.3, 0.3];
      const o: Obj = { id: uid(), kind: tool, name: tool === "text" ? "Text" : tool === "stencil" ? `Stencil: ${stencil}` : "Photo 0131", x: p[0] - size[0] / 2, y: p[1] - size[1] / 2, w: size[0], h: size[1], stroke, width: strokeW, opacity: 1, visible: true, locked: false, text: tool === "text" ? "Text" : undefined, icon: tool === "stencil" ? stencil : undefined, seed: tool === "picture" ? 17 : undefined, look: tool === "picture" ? NO_LOOK : undefined };
      setObjs((os) => [...os, o]); setTool("select"); setRootSel(false); setSelF(null); setSel([o.id]); setTab("layers"); if (tool === "text") setEditing(o.id);
      return;
    }
    act.current = { type: "draw", tool, pts: [p, p] }; setDraft({ tool, pts: [p, p] });
  };
  const move = (e: PointerEvent) => {
    const a = act.current; if (!a) return;
    const p = at(e);
    if (a.type === "draw") { a.pts = a.tool === "pen" ? [...a.pts, p] : [a.pts[0], p]; setDraft({ tool: a.tool, pts: a.pts }); }
    else if (a.type === "move") {
      // Snapping: the moved box's edges and middle are drawn to the surface's, to other objects' and to the frames',
      // when they come within a few pixels. Ctrl or Cmd held: no snapping.
      let dx = p[0] - a.start[0], dy = p[1] - a.start[1]; const g: { v?: number; h?: number } = {};
      if (snap && !e.ctrlKey && !e.metaKey) {
        const r = box.current!.getBoundingClientRect(), tx = 6 / r.width, ty = 6 / r.height, [bx, by, bw, bh] = a.box;
        const others = objs.filter((o) => !a.orig[o.id] && o.kind !== "group" && shown(o)).map((o): [number, number, number, number] => [o.x, o.y, o.w, o.h]).concat(shownFrames.map((f): [number, number, number, number] => { const q = rectOf(f); return [f.cx - q.w / 2, f.cy - q.h / 2, q.w, q.h]; }));
        const xs = [0, 0.5, 1, ...others.flatMap((o) => [o[0], o[0] + o[2] / 2, o[0] + o[2]])], ys = [0, 0.5, 1, ...others.flatMap((o) => [o[1], o[1] + o[3] / 2, o[1] + o[3]])];
        let best = tx; for (const m of [bx, bx + bw / 2, bx + bw]) for (const t of xs) { const d = t - (m + dx); if (Math.abs(d) < Math.abs(best)) { best = d; g.v = t; } } if (g.v != null) dx += best;
        best = ty; for (const m of [by, by + bh / 2, by + bh]) for (const t of ys) { const d = t - (m + dy); if (Math.abs(d) < Math.abs(best)) { best = d; g.h = t; } } if (g.h != null) dy += best;
      }
      setGuides(g);
      setObjs((os) => os.map((o) => (a.orig[o.id] ? { ...o, x: a.orig[o.id][0] + dx, y: a.orig[o.id][1] + dy } : o)));
    }
    else if (a.type === "pin") { const dx = p[0] - a.start[0], dy = p[1] - a.start[1]; if (Math.abs(dx) + Math.abs(dy) > 0.004) a.moved = true; if (a.moved) setComments((cs) => cs.map((c) => (c.id === a.id ? { ...c, x: a.orig[0] + dx, y: a.orig[1] + dy } : c))); }
    else if (a.type === "pan") setView((v) => ({ ...v, x: a.ox + e.clientX - a.x, y: a.oy + e.clientY - a.y }));
    else if (a.type === "resize") {
      // The corner opposite the dragged one stays where it is, also when the object is rotated.
      const q = toPx(p), d = turn([q[0] - a.fixed[0], q[1] - a.fixed[1]], -a.rot), w = Math.max(0.04, Math.abs(d[0])), h = Math.max(0.04, Math.abs(d[1]));
      const half = turn([(Math.sign(d[0]) || 1) * w / 2, (Math.sign(d[1]) || 1) * h / 2], a.rot), c: P = [a.fixed[0] + half[0], a.fixed[1] + half[1]], tl = toFr([c[0] - w / 2, c[1] - h / 2]);
      patchO([a.id], { x: tl[0], y: tl[1], w: w / 4, h: h / 3 });
    }
    else if (a.type === "rotate") { const q = toPx(p), ang = (Math.atan2(q[1] - a.centre[1], q[0] - a.centre[0]) * 180) / Math.PI; let rot = a.orig + ang - a.from; if (e.shiftKey) rot = Math.round(rot / 15) * 15; patchO([a.id], { rot: ((rot % 360) + 360) % 360 }); }
    else if (a.type === "end") { const ends: [P, P] = a.which === 0 ? [p, a.other] : [a.other, p], x = Math.min(ends[0][0], ends[1][0]), y = Math.min(ends[0][1], ends[1][1]), w = Math.abs(ends[1][0] - ends[0][0]), h = Math.abs(ends[1][1] - ends[0][1]); patchO([a.id], { x, y, w: Math.max(w, 0.0005), h: Math.max(h, 0.0005), pts: ends.map((q): P => [w ? (q[0] - x) / w : 0, h ? (q[1] - y) / h : 0]) }); }
    else if (a.type === "frame") {
      // A frame's centre snaps to the middle of the photo.
      const r = box.current!.getBoundingClientRect(); let cx = a.orig[a.id][0] + p[0] - a.start[0], cy = a.orig[a.id][1] + p[1] - a.start[1]; const g: { v?: number; h?: number } = {};
      if (snap && !e.ctrlKey && !e.metaKey) { if (Math.abs(cx - 0.5) < 6 / r.width) { cx = 0.5; g.v = 0.5; } if (Math.abs(cy - 0.5) < 6 / r.height) { cy = 0.5; g.h = 0.5; } }
      setGuides(g);
      if (linked) centreAll(cx, cy); else patchF(a.id, { cx, cy });
    }
  };
  const up = () => {
    const a = act.current; act.current = null; setGuides({});
    if (a?.type !== "draw") return;
    setDraft(null);
    const xs = a.pts.map((q) => q[0]), ys = a.pts.map((q) => q[1]);
    let x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (a.tool === "comment" && redraw) { const point = w < 0.02 && h < 0.02; setComments((cs) => cs.map((c) => (c.id === redraw ? { ...c, x: point ? a.pts[0][0] : x, y: point ? a.pts[0][1] : y, w: point ? undefined : w, h: point ? undefined : h } : c))); setSelC(redraw); setRedraw(null); setTool("select"); return; }
    if (a.tool === "comment") { setWords(""); setSelC(null); setCompose(w < 0.02 && h < 0.02 ? { x: a.pts[0][0], y: a.pts[0][1] } : { x, y, w, h }); return; }
    if (w < 0.006 && h < 0.006) { if (a.tool === "pen") return; w = 0.16; h = a.tool === "line" || a.tool === "arrow" ? 0 : 0.12; a.pts = [[x, y], [x + w, y + h]]; }
    const line = a.tool === "pen" || a.tool === "line" || a.tool === "arrow";
    const o: Obj = { id: uid(), kind: a.tool as Kind, name: KIND[a.tool as Kind].label, x, y, w: Math.max(w, 0.001), h: Math.max(h, 0.001), pts: line ? a.pts.map((q): P => [w ? (q[0] - x) / w : 0, h ? (q[1] - y) / h : 0]) : undefined, pen: a.tool === "pen" ? penType : undefined, stroke, width: strokeW, opacity: 1, visible: true, locked: false };
    setObjs((os) => [...os, o]); setRootSel(false); setSelF(null); setSel([o.id]); setTab("layers");
  };
  const grabO = (e: PointerEvent, o: Obj) => {
    if (locked || tool !== "select") return;
    e.stopPropagation();
    if (editing === o.id) return;
    const id = o.group ?? o.id; let ids = e.shiftKey ? (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]) : sel.includes(id) ? sel : [id];
    let mv = moved(ids);
    if (e.altKey && mv.length) {
      // Alt held: what is dragged is a copy; the original stays where it is. A group is copied with what is in it.
      const names: Record<string, string> = {}, copies: Obj[] = [];
      for (const src of objs) { if (!ids.includes(src.id) && !(src.group && ids.includes(src.group))) continue; names[src.id] = uid(); }
      for (const src of objs) { if (names[src.id]) copies.push({ ...src, id: names[src.id], name: src.group && names[src.group] ? src.name : `${src.name} copy`, group: src.group && names[src.group] ? names[src.group] : src.kind === "group" ? undefined : src.group && !ids.includes(src.id) ? src.group : undefined }); }
      setObjs((os) => [...os, ...copies]);
      ids = copies.filter((c) => !c.group).map((c) => c.id); mv = copies.filter((c) => c.kind !== "group");
      setOpen((op) => [...op, ...copies.filter((c) => c.kind === "group").map((c) => c.id)]);
    }
    setRootSel(false); setSelF(null); setSel(ids); setTab("layers");
    capture(e);
    const x0 = Math.min(...mv.map((m) => m.x)), y0 = Math.min(...mv.map((m) => m.y));
    act.current = { type: "move", start: at(e), orig: Object.fromEntries(mv.map((m) => [m.id, [m.x, m.y] as P])), box: mv.length ? [x0, y0, Math.max(...mv.map((m) => m.x + m.w)) - x0, Math.max(...mv.map((m) => m.y + m.h)) - y0] : [0, 0, 0, 0] };
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
      else if (e.key === " ") { e.preventDefault(); space.current = true; fit.current?.classList.add("is-hand"); }
      else if (k === "0" || (e.shiftKey && k === "1") || k === "!") { e.preventDefault(); setView({ z: 1, x: 0, y: 0 }); }
      else if (k === "+" || k === "=") zoomAt(view.z * 1.25); else if (k === "-") zoomAt(view.z / 1.25);
      else if (e.key === "Escape") { pick(null); setTool("select"); setRedraw(null); setSelC(null); setCompose(null); }
      else if (e.key === "Enter" && sel.length === 1 && byId.get(sel[0])?.kind === "text") { e.preventDefault(); setEditing(sel[0]); }
      else if (!e.metaKey && !e.ctrlKey && !e.altKey) { const hit = TOOLS.find((x) => x.kbd.toLowerCase() === k); if (hit) setTool(hit.id); }
    };
    const keyup = (e: KeyboardEvent) => { if (e.key === " ") { space.current = false; fit.current?.classList.remove("is-hand"); } };
    window.addEventListener("keydown", key); window.addEventListener("keyup", keyup);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keyup", keyup); };
  });

  // Drawing one object. Lines live in a layer the size of the surface, so arrowheads and strokes keep their shape.
  const abs = (o: Pick<Obj, "x" | "y" | "w" | "h">, q: P): P => [o.x + q[0] * o.w, o.y + q[1] * o.h];
  const draw = (o: Obj, ghost = false) => {
    const c = css(o.stroke), common = { "data-obj": o.id, onPointerDown: ghost ? undefined : (e: PointerEvent) => grabO(e, o) };
    if (o.kind === "pen" || o.kind === "line" || o.kind === "arrow") {
      const q = (o.pts ?? []).map((x): P => { const a = abs(o, x); return [Number((a[0] * 1000).toFixed(1)), Number((a[1] * 750).toFixed(1))]; });
      const pen = PENS[o.pen ?? "pen"], w = o.width * 1.3 * (o.kind === "pen" ? pen.scale : 1), d = o.kind === "pen" ? smooth(q) : `M${q.map((x) => x.join(" ")).join(" L")}`;
      return (
        <svg key={o.id} {...common} className="u2-vec" viewBox="0 0 1000 750" preserveAspectRatio="none" style={{ opacity: o.opacity * (o.kind === "pen" ? pen.opacity : 1), mixBlendMode: o.kind === "pen" && pen.blend ? (pen.blend as "screen") : undefined }}>
          {o.kind === "arrow" && <defs><marker id={`m${o.id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={c} /></marker></defs>}
          <g transform={o.rot ? `rotate(${o.rot} ${(o.x + o.w / 2) * 1000} ${(o.y + o.h / 2) * 750})` : undefined}>
            {o.kind === "pen" && pen.taper ? <path d={taper(q, w)} fill={c} /> : <path d={d} fill="none" stroke={c} stroke-width={w} stroke-linecap={o.kind === "pen" ? pen.cap : "round"} stroke-linejoin="round" stroke-dasharray={o.kind === "pen" ? pen.dash : undefined} marker-end={o.kind === "arrow" ? `url(#m${o.id})` : undefined} />}
            <path className="u2-vec__hit" d={d} fill="none" stroke="transparent" stroke-width={Math.max(18, w)} />
          </g>
        </svg>
      );
    }
    const st: JSX.CSSProperties = { left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, opacity: o.opacity, color: c, transform: o.rot ? `rotate(${o.rot}deg)` : undefined };
    if (o.kind === "rect" || o.kind === "ellipse") return <div key={o.id} {...common} className={cx("u2-obj", `u2-obj--${o.kind}`)} style={{ ...st, border: `${o.width}px solid ${c}`, background: o.fill != null ? css(o.fill) : undefined }} />;
    if (o.kind === "text") return editing === o.id
      ? <div key={`${o.id}-edit`} data-obj={o.id} className="u2-obj u2-obj--text is-editing" style={{ ...st, "--fs": o.h * 78 }} contentEditable spellcheck={false}
          ref={(el) => { if (el && document.activeElement !== el) { el.textContent = o.text ?? ""; el.focus(); const r = document.createRange(); r.selectNodeContents(el); const g = getSelection(); g?.removeAllRanges(); g?.addRange(r); } }}
          onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } else if (e.key === "Escape") { (e.currentTarget as HTMLElement).textContent = o.text ?? ""; (e.currentTarget as HTMLElement).blur(); } }}
          onBlur={(e) => { const t = (e.currentTarget as HTMLElement).innerText.replace(/\n+$/, ""); patchO([o.id], { text: t || "Text" }); setEditing(null); }} />
      : <div key={o.id} {...common} className="u2-obj u2-obj--text" style={{ ...st, "--fs": o.h * 78 }} onDblClick={() => !locked && tool === "select" && !frozen(o) && setEditing(o.id)}>{o.text}</div>;
    if (o.kind === "stencil") return <div key={o.id} {...common} className="u2-obj u2-obj--stencil" style={st}><Icon name={o.icon ?? "camera"} size={24} stroke={1.6} /></div>;
    return <div key={o.id} {...common} className="u2-obj u2-obj--picture" style={st}><img src={picture(o.seed ?? 17)} alt="" draggable={false} style={{ filter: lookFilter(o.look) }} /></div>;
  };
  const one = sel.length === 1 ? byId.get(sel[0]) ?? null : null;
  const marks = sel.map((s) => byId.get(s)).filter((o): o is Obj => !!o);

  // Inspector: the stack.
  const order = [...tops].reverse();
  const row = (o: Obj, depth = 0) => (
    <div key={o.id} className={cx("u2-row", sel.includes(o.id) && "is-current", !shown(o) && "is-hidden")} style={{ paddingLeft: 6 + depth * 18 }}
      onClick={(e) => { if (justSorted.current) { justSorted.current = false; return; } pick(o.id, e.shiftKey || e.metaKey || e.ctrlKey); }}>
      {o.kind === "group" ? <button type="button" className="u2-row__twist" aria-label={open.includes(o.id) ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); setOpen(open.includes(o.id) ? open.filter((x) => x !== o.id) : [...open, o.id]); }}><Icon name={open.includes(o.id) ? "chevron-down" : "chevron-right"} size={12} /></button> : <span className="u2-row__twist" />}
      <Icon name={o.kind === "stencil" && o.icon ? o.icon : KIND[o.kind].icon} />
      <span className="u2-row__name">{o.name}{o.kind === "group" && <small> · {kids(o.id).length}</small>}</span>
      <Button size="sm" variant="quiet" icon={o.locked ? "lock" : "unlock"} selected={o.locked} label={o.locked ? "Unlock" : "Lock"} onClick={(e) => { e.stopPropagation(); patchO([o.id], { locked: !o.locked }); }} />
      <Button size="sm" variant="quiet" icon={o.visible ? "eye" : "eye-off"} label={o.visible ? "Hide" : "Show"} onClick={(e) => { e.stopPropagation(); patchO([o.id], { visible: !o.visible }); }} />
    </div>
  );
  /** One entry of the list: an object, or a group with the objects in it. It is what is dragged. */
  const blockOf = (t: Obj) => <>{row(t)}{t.kind === "group" && open.includes(t.id) && [...kids(t.id)].reverse().map((k) => row(k, 1))}</>;
  const sortDown = (e: PointerEvent, t: Obj) => { if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return; sortStart.current = { id: t.id, y: e.clientY }; capture(e); };
  const sortMove = (e: PointerEvent) => {
    const st = sortStart.current; if (!st) return;
    if (!sort) {
      if (Math.abs(e.clientY - st.y) < 4) return;
      const els = [...(e.currentTarget as HTMLElement).parentElement!.querySelectorAll<HTMLElement>(":scope > .u2-block")], rects = els.map((el) => el.getBoundingClientRect()), from = order.findIndex((t) => t.id === st.id), r = rects[from];
      setSort({ id: st.id, from, to: from, h: r.height, x: r.left, w: r.width, y: e.clientY, grab: st.y - r.top, mids: rects.map((q) => q.top + q.height / 2), tops: rects.map((q) => q.top), hs: rects.map((q) => q.height) });
      return;
    }
    // Where it would land: the number of other entries whose middle lies above the middle of the lifted one.
    const mid = e.clientY - sort.grab + sort.h / 2, to = sort.mids.filter((m, i) => i !== sort.from && m < mid).length;
    setSort({ ...sort, y: e.clientY, to });
  };
  const sortUp = () => {
    sortStart.current = null;
    if (!sort) return;
    justSorted.current = true;
    const { id, from, to } = sort;
    // Let the lifted row glide into its place, then make the new order real.
    setSort({ ...sort, drop: true });
    setTimeout(() => { if (to !== from) reorder(id, order.length - 1 - to); setSort(null); }, 170);
  };
  /** How far an entry moves aside while another is dragged past it. */
  const shift = (i: number) => (!sort || i === sort.from ? 0 : i > sort.from && i - 1 < sort.to ? -sort.h : i < sort.from && i >= sort.to ? sort.h : 0);
  // Where the lifted entry comes to rest: below the entry it ends up after, or at the top of the one it ends up before.
  const landing = sort ? (sort.to > sort.from ? sort.tops[sort.to] + sort.hs[sort.to] - sort.h : sort.tops[sort.to]) : 0;
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
        <div className={cx("u2-stack", sort && "is-sorting")}>
          {order.map((t, i) => <div key={t.id} className={cx("u2-block", sort?.id === t.id && "is-lifted")} style={{ transform: shift(i) ? `translateY(${shift(i)}px)` : undefined }} onPointerDown={(e) => sortDown(e, t)} onPointerMove={sortMove} onPointerUp={sortUp} onPointerCancel={sortUp}>{blockOf(t)}</div>)}
          {sort && root.current && createPortal(<div className={cx("u2-ghost", sort.drop && "is-dropping")} style={{ left: sort.x, width: sort.w, top: sort.drop ? landing : sort.y - sort.grab }}>{blockOf(byId.get(sort.id)!)}</div>, root.current)}
          <div className={cx("u2-row u2-row--root", rootSel && "is-current")} onClick={() => { setSel([]); setSelF(null); setRootSel(true); }}><span className="u2-row__twist" /><Icon name={photo ? "image" : "file"} /><span className="u2-row__name">{photo ? PHOTO.name : "Paper"}<small> · the surface</small></span><Icon name="lock" size={12} /></div>
        </div>
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
          {one?.kind === "pen" && <PropertyRow label="Pen"><Select size="sm" value={one.pen ?? "pen"} onChange={(v) => patchO([one.id], { pen: v as PenType })} options={Object.entries(PENS).map(([k, v]) => ({ value: k, label: v.label }))} /></PropertyRow>}
          {one && one.kind !== "group" && one.kind !== "line" && one.kind !== "arrow" && <PropertyRow label="Rotation"><NumberInput size="sm" value={Math.round(one.rot ?? 0)} unit="°" step={15} min={0} max={359} onChange={(v) => patchO([one.id], { rot: ((v % 360) + 360) % 360 })} /></PropertyRow>}
          {marks.some((m) => ["pen", "line", "arrow", "rect", "ellipse"].includes(m.kind)) && <PropertyRow label="Stroke width"><Slider min={1} max={12} step={1} value={marks[0].width} onChange={(v) => patchO(sel, { width: v })} /></PropertyRow>}
          {marks.some((m) => m.kind !== "group") && <PropertyRow label="Opacity"><Slider min={0.1} max={1} step={0.05} value={marks[0].opacity} onChange={(v) => patchO(sel, { opacity: v })} /></PropertyRow>}
          <div className="u2-bar"><Button size="sm" variant="quiet" icon="copy" onClick={() => duplicate(sel)}>Duplicate</Button><Button size="sm" variant="quiet" icon="trash" onClick={() => remove(sel)}>Delete</Button></div>
        </PropertySection>
      )}
    </>
  );

  // Inspector: frames.
  const addFrame = (id: string) => {
    if (id === "new") { setMaking({}); return; }
    const n = frames.length;
    const f: Frame = id === "free" ? { ...frameFrom(presets[1], 35, n), kind: "free", preset: undefined, name: "Free-form" } : id === "aspect" ? { ...frameFrom(presets[1], 35, n), kind: "aspect", preset: undefined, name: "2.39:1", delivery: undefined } : (() => { const p = presets.find((x) => x.id === id)!; return frameFrom(p, p.primes?.[0] ?? p.zoom![0], n); })();
    const first = frames[0];
    setFrames([...frames, linked && first ? { ...f, cx: clampCentre(first.cx, rectOf(f).w), cy: clampCentre(first.cy, rectOf(f).h) } : f]); setSel([]); setRootSel(false); setSelF(f.id); if (!pic) setPic(f.id);
  };
  const framesTab = !photo ? <PropertySection title="Frames" icon="frame"><p className="u2-note">Frames need a base photo: a frame is what a camera sees of the picture. Select the surface in Layers to give the canvas one.</p></PropertySection> : (
    <>
      <PropertySection title={`Frames · ${frames.length}`} icon="frame">
        <ul className="u2-stack">
          {frames.map((f) => { const fr = rectOf(f); return (
            <li key={f.id} className={cx("u2-row u2-row--frame", selF === f.id && "is-current", pic === f.id && "is-picture", !f.visible && "is-hidden")} onClick={() => { setSel([]); setRootSel(false); setSelF(f.id); }}>
              <i style={{ background: css(f.color) }} />
              <span className="u2-row__name">{f.name}<small>{f.kind === "preset" ? presets.find((p) => p.id === f.preset)?.name : f.kind === "free" ? `Free-form · ${f.format[0]} × ${f.format[1]} mm` : "Aspect ratio"}</small></span>
              {Math.max(fr.w, fr.h) > 1 && <span title="Sees more than the photo"><Icon name="expand" size={12} /></span>}
              {pic === f.id ? <button type="button" className="u2-picture" title="The picture of this canvas; click to take it away" onClick={(e) => { e.stopPropagation(); setPic(null); }}><Icon name="crop" size={12} /> Picture</button> : <Button size="sm" variant="quiet" icon="crop" label="Make it the picture of this canvas" onClick={(e) => { e.stopPropagation(); setPic(f.id); }} />}
              <Button size="sm" variant="quiet" icon={f.visible ? "eye" : "eye-off"} label={f.visible ? "Hide" : "Show"} onClick={(e) => { e.stopPropagation(); patchF(f.id, { visible: !f.visible }); }} />
            </li>
          ); })}
        </ul>
        <div className="u2-bar">
          <DropdownMenu size="sm" icon="plus" label="Frame" items={[{ heading: "From an optics preset" }, ...presets.map((p) => ({ id: p.id, label: p.name, icon: "lens" as const })), { separator: true }, { id: "free", label: "Free-form values", icon: "sliders" }, { id: "aspect", label: "Aspect ratio only", icon: "aspect" }, { separator: true }, { id: "new", label: "New optics preset…", icon: "plus" }]} onSelect={addFrame} />
          <span style={{ flex: 1 }} />
          <Switch checked={linked} onChange={(c) => { setLinked(c); if (c) { const f = cur ?? picF ?? frames[0]; if (f) centreAll(f.cx, f.cy); } }}>Link centres</Switch>
        </div>
        <p className="u2-note">{linked ? "Linked: the frames share one centre and move together." : "Each frame is moved on its own."} The frame marked <strong>Picture</strong> is what this canvas stands for: in Mask and Crop, in thumbnails, in a shot.</p>
      </PropertySection>
      {cur && (
        <PropertySection title={`Frame: ${cur.name}`} icon="sliders">
          <PropertyRow label="Name"><TextInput size="sm" value={cur.name} onInput={(e) => patchF(cur.id, { name: (e.target as HTMLInputElement).value })} /></PropertyRow>
          <PropertyRow label="Colour"><ColourButton value={cur.color} label="Frame colour" onChange={(c) => patchF(cur.id, { color: c })} /></PropertyRow>
          {cur.kind === "preset" && preset && (
            <>
              <PropertyRow label="Preset"><Select size="sm" value={preset.id} onChange={(v) => { const p = presets.find((x) => x.id === v)!; patchF(cur.id, { preset: p.id, format: p.format, mult: p.mult, squeeze: p.squeeze, delivery: p.delivery, focal: p.primes?.[0] ?? p.zoom![0], name: `${p.primes?.[0] ?? p.zoom![0]} mm` }); }} options={presets.map((p) => ({ value: p.id, label: p.name }))} /></PropertyRow>
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
          <div className="u2-bar">{cur.kind === "free" && <Button size="sm" variant="quiet" icon="plus" onClick={() => setMaking({ format: cur.format, mult: cur.mult, squeeze: cur.squeeze, delivery: cur.delivery, lenses: "primes", primes: [cur.focal] })}>Create a preset from it</Button>}<span style={{ flex: 1 }} /><Button size="sm" variant="quiet" icon="trash" onClick={() => { setFrames(frames.filter((f) => f.id !== cur.id)); setSelF(null); if (pic === cur.id) setPic(null); }}>Remove</Button></div>
        </PropertySection>
      )}
    </>
  );

  // Inspector: comments, to read them with or without the canvas.
  const listed = comments.filter((c) => !c.resolved || showDone);
  const commentsTab = (
    <PropertySection title={`Comments · ${comments.filter((c) => !c.resolved).length} open`} icon="comment">
      <div className="u2-bar u2-bar--wrap"><Switch checked={showC} onChange={setShowC}>Show on the canvas</Switch><span style={{ flex: 1 }} /><Checkbox checked={showDone} onChange={setShowDone}>Resolved too</Checkbox></div>
      {!listed.length ? <p className="u2-note">No comments. Take the Comment tool (C), then click a point or drag a region.</p> : (
        <ul className="u2-comments">
          {listed.map((c) => (
            <li key={c.id} className={cx(selC === c.id && "is-current", c.resolved && "is-done")} onClick={() => openC(selC === c.id ? null : c.id)}>
              <span className={cx("u2-pin u2-pin--list", c.resolved && "is-done")}>{c.resolved ? <Icon name="check" size={12} /> : c.n}</span>
              <div><span className="u2-msg__who"><strong>{c.author}</strong><small>{c.at}{c.w != null && " · a region"}</small></span><p>{c.text}</p>{c.replies.length > 0 && <small>{c.replies.length} {c.replies.length === 1 ? "reply" : "replies"}</small>}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="u2-bar"><Button size="sm" icon="comment" onClick={() => { setTool("comment"); setShowC(true); }}>New comment</Button></div>
    </PropertySection>
  );

  const selBox = one && !frozen(one) ? bounds(one) : null;
  const drawing = tool !== "select";
  return (
    <div ref={root} className={cx("u2", host && "u2--hosted")} data-theme={theme}>
      <header className="u2-proto" hidden={!!host}>
        <strong>U2</strong><span className="u2-proto__note">prototype · Canvas</span>
        <span style={{ flex: 1 }} />
        <label><Checkbox checked={locked} onChange={setLocked}>Someone else is editing</Checkbox></label>
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      <div className="u2-work">
        <EditorLayout className={cx("u2-editor", locked && "is-locked")} dock={{ layout: panels, onLayoutChange: setPanels, zoneSizes: { right: 340, left: 320, bottom: 260 }, panels: [
          { id: "tools", title: "Tools", icon: "brush", slim: true, body: <ToolRail value={tool} onChange={(t) => setTool(t as Tool)} tools={[TOOLS[0], { separator: true }, ...TOOLS.slice(1, 6), { separator: true }, ...TOOLS.slice(6, 9), { separator: true }, TOOLS[9]]} /> },
          { id: "layers", title: "Layers", icon: "layers", body: <PropertyList className="u2-inspector">{layersTab}</PropertyList> },
          { id: "frames", title: `Frames${photo ? ` · ${frames.length}` : ""}`, icon: "frame", body: <PropertyList className="u2-inspector">{framesTab}</PropertyList> },
          { id: "comments", title: `Comments · ${comments.filter((c) => !c.resolved).length}`, icon: "comment", body: <PropertyList className="u2-inspector">{commentsTab}</PropertyList> },
        ] }} {...(locked ? { inert: true } : {})}
          toolbar={<Toolbar>
            <strong className="u2-title">{host?.title ?? "Canvas 02"}</strong>
            <Button size="sm" variant="quiet" icon="undo" label="Undo" /><Button size="sm" variant="quiet" icon="redo" label="Redo" />
            {drawing && <span className="u2-toolopts"><span className="oc-meta">{TOOLS.find((t) => t.id === tool)!.label}</span>
              {tool === "pen" && <Segmented label="Pen" value={penType} onChange={(v) => setPenType(v as PenType)} options={Object.entries(PENS).map(([k, v]) => ({ value: k, label: v.label }))} />}
              {tool !== "picture" && tool !== "comment" && <ColourButton value={stroke} label="Colour" onChange={setStroke} />}
              {["pen", "line", "arrow", "rect", "ellipse"].includes(tool) && <span className="u2-zoom" style={{ width: 150 }}><Slider min={1} max={12} step={1} value={strokeW} onChange={setStrokeW} /><b className="oc-num">{strokeW} px</b></span>}
              {tool === "stencil" && <Popover trigger={<Button size="sm" icon={stencil} iconAfter="chevron-down">Stencil</Button>}><div className="u2-stencils">{STENCILS.map((s) => <button type="button" key={s} title={s} className={cx(stencil === s && "is-on")} onClick={() => setStencil(s)}><Icon name={s} size={20} /></button>)}</div></Popover>}
              {(tool === "text" || tool === "stencil" || tool === "picture") && <span className="oc-meta">click on the canvas to place it</span>}
              {tool === "comment" && <span className="oc-meta">{redraw ? "click a point or drag a region: the comment moves there" : "click a point, or drag a region to comment on"}</span>}
            </span>}
            <ToolbarSpacer />
            <span className="u2-zoomer"><Button size="sm" variant="quiet" icon="minus" label="Zoom out (−)" onClick={() => zoomAt(view.z / 1.25)} /><button type="button" className="u2-zoomer__now" title="Fit the canvas into the view (0)" onClick={() => setView({ z: 1, x: 0, y: 0 })}>{Math.round(view.z * 100)} %</button><Button size="sm" variant="quiet" icon="plus" label="Zoom in (+)" onClick={() => zoomAt(view.z * 1.25)} /></span>
            <Button size="sm" variant="quiet" icon="crosshair" selected={snap} title={snap ? "Snapping is on: moved objects hold on to edges and middles. Click to switch it off (or hold Ctrl while moving)" : "Snapping is off. Click to switch it on"} onClick={() => setSnap(!snap)}>Snap</Button>
            {photo && frames.length > 1 && <Button size="sm" variant="quiet" icon="columns" selected={compare} onClick={() => { setCompare(!compare); pick(null); setSelC(null); if (!compare && mode === "full") setMode("crop"); }}>Compare</Button>}
            <Button size="sm" variant="quiet" icon="comment" selected={showC} aria-label={showC ? "Hide comments on the canvas" : "Show comments on the canvas"} title={showC ? "Hide comments on the canvas" : "Show comments on the canvas"} onClick={() => setShowC(!showC)}>{comments.filter((c) => !c.resolved).length || ""}</Button>
            {photo && <span className={cx(compare && "u2-nofull")} title={compare ? "Full has no frame, so it is not offered while comparing" : undefined}><Segmented label="View mode" value={compare && mode === "full" ? "crop" : mode} onChange={setMode} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} /></span>}
          </Toolbar>}
          canvas={
            compare && photo ? (
              <div className="u2-compare">
                {([[sideA ?? pic ?? frames[0]?.id, setSideA, "A"], [sideB ?? frames.find((f) => f.id !== (sideA ?? pic ?? frames[0]?.id))?.id, setSideB, "B"]] as const).map(([id, set, tag]) => { const f = frames.find((x) => x.id === id); return (
                  <section key={tag} className="u2-pane">
                    <header><b>{tag}</b><Select size="sm" value={id ?? ""} onChange={(v) => set(v)} options={frames.map((x) => ({ value: x.id, label: `${x.name} · ${x.kind === "preset" ? presets.find((q) => q.id === x.preset)?.name : x.kind === "free" ? "free-form" : "aspect"}` }))} />{f && rectOf(f).hfov && <span className="oc-meta">{rectOf(f).hfov!.toFixed(0)}° × {rectOf(f).vfov!.toFixed(0)}°</span>}</header>
                    <div className="u2-fit"><div className={cx("u2-stage", `u2-stage--${mode === "full" ? "crop" : mode}`, scale < 1 && mode !== "crop" && mode !== "full" && "is-beyond")}><div className="u2-world" style={{ transform: f && (mode === "crop" || mode === "full") ? fitTo(f) : undefined, transformOrigin: "0 0" }}>
                      <div className="u2-surface" style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}><img className="u2-photo" src={picture(PHOTO.seed)} alt="" draggable={false} style={{ filter: lookFilter(surface.look) }} />{objs.filter((o) => o.kind !== "group" && shown(o)).map((o) => draw({ ...o, id: `${tag}${o.id}` }, true))}</div>
                      {f && mode !== "outline" && <span className={cx("u2-mask", (mode === "crop" || mode === "full") && "u2-mask--solid")} style={place(f, true)} />}
                      {f && (mode === "outline" || mode === "mask") && (() => { const fr = rectOf(f); return <div className={cx("u2-frame", "is-picture", Math.max(fr.w, fr.h) > 1 && "is-beyond")} style={{ ...place(f), "--c": css(f.color) }}><span className="u2-frame__label">{f.name}</span>{fr.inner && <span className="u2-frame__inner" style={{ width: `${(fr.inner.w / fr.w) * 100}%`, height: `${(fr.inner.h / fr.h) * 100}%` }}><span>{f.delivery}:1</span></span>}</div>; })()}
                    </div></div></div>
                  </section>
                ); })}
              </div>
            ) :
            <div ref={fit} className="u2-fit" onPointerDownCapture={(e) => { if (space.current || e.button === 1) { e.stopPropagation(); e.preventDefault(); capture(e); act.current = { type: "pan", x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }; } }} onPointerMove={(e) => { if (act.current?.type === "pan") move(e); }} onPointerUp={() => { if (act.current?.type === "pan") up(); }}>
              <div className={cx("u2-stage", `u2-stage--${photo ? mode : "blank"}`, drawing && "is-drawing", scale < 1 && "is-beyond")} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, "--inv": 1 / view.z }}>
                <div className="u2-world" style={{ transform: crop, transformOrigin: "0 0" }}>
                  <div ref={box} className="u2-surface" style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, background: photo ? undefined : css(surface.colour) }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
                    {photo && <img className="u2-photo" src={picture(PHOTO.seed)} alt="" draggable={false} style={{ filter: lookFilter(surface.look) }} />}
                    {objs.filter((o) => o.kind !== "group" && shown(o)).map((o) => draw(o))}
                    {draft && draft.tool !== "pen" && draft.tool !== "line" && draft.tool !== "arrow" && (() => { const [a, b] = draft.pts; return <div className={cx("u2-obj", draft.tool === "comment" ? "u2-region" : `u2-obj--${draft.tool}`)} style={{ left: `${Math.min(a[0], b[0]) * 100}%`, top: `${Math.min(a[1], b[1]) * 100}%`, width: `${Math.abs(b[0] - a[0]) * 100}%`, height: `${Math.abs(b[1] - a[1]) * 100}%`, border: draft.tool === "comment" ? undefined : `${strokeW}px solid ${css(stroke)}`, pointerEvents: "none" }} />; })()}
                    {draft && (draft.tool === "pen" || draft.tool === "line" || draft.tool === "arrow") && draw({ id: "draft", kind: draft.tool as Kind, name: "", x: 0, y: 0, w: 1, h: 1, pts: draft.pts, pen: penType, stroke, width: strokeW, opacity: 1, visible: true, locked: false }, true)}
                  </div>
                  {photo && (mode === "mask" || mode === "crop") && picF && <span className={cx("u2-mask", mode === "crop" && "u2-mask--solid")} style={place(picF, true)} />}
                  {photo && mode !== "full" && mode !== "crop" && shownFrames.filter((f) => mode === "outline" || f.id === pic || f.id === selF).map((f) => { const fr = rectOf(f); return (
                    <div key={f.id} className={cx("u2-frame", selF === f.id && "is-current", pic === f.id && "is-picture", Math.max(fr.w, fr.h) > 1 && "is-beyond", drawing && "is-passive")} style={{ ...place(f), "--c": css(f.color) }} onPointerDown={(e) => grabF(e, f)} onPointerMove={move} onPointerUp={up}>
                      <span className="u2-frame__label">{f.name}{pic === f.id && <b><Icon name="crop" size={12} />Picture</b>}</span>
                      {fr.inner && <span className="u2-frame__inner" style={{ width: `${(fr.inner.w / fr.w) * 100}%`, height: `${(fr.inner.h / fr.h) * 100}%` }}><span>{f.delivery}:1</span></span>}
                    </div>
                  ); })}
                  {/* Selection handles sit above the frames, so a handle that lies on a frame's edge still takes the pointer. */}
                  <div className="u2-surface u2-surface--ui" style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}>
                    {guides.v != null && <span className="u2-guide u2-guide--v" style={{ left: `${guides.v * 100}%` }} />}
                    {guides.h != null && <span className="u2-guide u2-guide--h" style={{ top: `${guides.h * 100}%` }} />}
                    {showC && comments.filter((c) => !c.resolved || showDone || c.id === selC).map((c) => { const on = selC === c.id, px = c.x + (c.w ?? 0), flip = px > 0.62; return [
                      on && c.w != null && <span key={`${c.id}r`} className="u2-region" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${(c.h ?? 0) * 100}%` }} />,
                      <button type="button" key={c.id} className={cx("u2-pin", on && "is-current", c.resolved && "is-done")} style={{ left: `${px * 100}%`, top: `${c.y * 100}%` }} title={`${c.author}: ${c.text} (drag to move)`} onPointerMove={move}
                        onPointerDown={(e) => { e.stopPropagation(); if (locked) return; capture(e); act.current = { type: "pin", id: c.id, start: at(e), orig: [c.x, c.y], moved: false }; }}
                        onPointerUp={() => { const a = act.current; up(); if (a?.type === "pin" && !a.moved) openC(on ? null : c.id); }}>{c.resolved ? <Icon name="check" size={12} /> : c.n}</button>,
                      on && (
                        <div key={`${c.id}t`} className={cx("u2-thread", flip && "is-left")} style={{ left: `${px * 100}%`, top: `${c.y * 100}%` }} onPointerDown={(e) => e.stopPropagation()}>
                          {[c, ...c.replies].map((m, i) => <div key={i} className="u2-msg"><span className="u2-msg__who"><i>{m.author[0]}</i><strong>{m.author}</strong><small>{m.at}</small></span><p>{m.text}</p></div>)}
                          <TextArea rows={2} value={reply} placeholder="Reply…" onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && reply.trim()) { e.preventDefault(); setComments(comments.map((x) => (x.id === c.id ? { ...x, replies: [...x.replies, { author: "Ada", at: "Just now", text: reply.trim() }] } : x))); setReply(""); } }} />
                          <div className="u2-bar"><Button size="sm" variant="quiet" icon="crop" title="Give the comment a new point or region: click or drag on the canvas" onClick={() => { setRedraw(c.id); setSelC(null); setTool("comment"); }}>{c.w != null ? "Redraw region" : "Set a region"}</Button><Button size="sm" variant="quiet" icon="check" onClick={() => { setComments(comments.map((x) => (x.id === c.id ? { ...x, resolved: !x.resolved } : x))); if (!c.resolved) setSelC(null); }}>{c.resolved ? "Reopen" : "Resolve"}</Button><span style={{ flex: 1 }} /><Button size="sm" variant="quiet" icon="trash" label="Delete the comment" onClick={() => { setComments(comments.filter((x) => x.id !== c.id)); setSelC(null); }} /></div>
                        </div>
                      ),
                    ]; })}
                    {compose && [
                      compose.w != null && <span key="r" className="u2-region" style={{ left: `${compose.x * 100}%`, top: `${compose.y * 100}%`, width: `${compose.w * 100}%`, height: `${(compose.h ?? 0) * 100}%` }} />,
                      <span key="p" className="u2-pin is-current" style={{ left: `${(compose.x + (compose.w ?? 0)) * 100}%`, top: `${compose.y * 100}%` }}><Icon name="plus" size={12} /></span>,
                      <div key="c" className={cx("u2-thread", compose.x + (compose.w ?? 0) > 0.62 && "is-left")} style={{ left: `${(compose.x + (compose.w ?? 0)) * 100}%`, top: `${compose.y * 100}%` }} onPointerDown={(e) => e.stopPropagation()}>
                        <TextArea rows={3} value={words} placeholder={compose.w != null ? "Comment on this region…" : "Comment on this point…"} onInput={(e) => setWords((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); } else if (e.key === "Escape") setCompose(null); }} />
                        <div className="u2-bar"><Button size="sm" variant="quiet" onClick={() => setCompose(null)}>Cancel</Button><span style={{ flex: 1 }} /><Button size="sm" variant="primary" disabled={!words.trim()} onClick={post}>Comment</Button></div>
                      </div>,
                    ]}
                    {tool === "select" && marks.filter((m) => m !== one || !selBox).map((m) => { const [x, y, w, h] = bounds(m); return <span key={m.id} className="u2-sel" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, transform: m.rot ? `rotate(${m.rot}deg)` : undefined }} />; })}
                    {tool === "select" && one && selBox && !editing && (one.kind === "line" || one.kind === "arrow") && one.pts && [0, 1].map((k) => { const q = abs(one, one.pts![k === 0 ? 0 : one.pts!.length - 1]); return (
                      <i key={k} className="u2-node" style={{ left: `${q[0] * 100}%`, top: `${q[1] * 100}%` }} onPointerMove={move} onPointerUp={up}
                        onPointerDown={(e) => { e.stopPropagation(); capture(e); act.current = { type: "end", id: one.id, which: k as 0 | 1, other: abs(one, one.pts![k === 0 ? one.pts!.length - 1 : 0]) }; }} />
                    ); })}
                    {tool === "select" && one && selBox && !editing && one.kind !== "line" && one.kind !== "arrow" && (
                      <span className="u2-sel" style={{ left: `${selBox[0] * 100}%`, top: `${selBox[1] * 100}%`, width: `${selBox[2] * 100}%`, height: `${selBox[3] * 100}%`, transform: one.rot ? `rotate(${one.rot}deg)` : undefined }}>
                        {one.kind !== "group" && [0, 1, 2, 3].map((k) => { const sx = k % 2 ? 1 : -1, sy = k >= 2 ? 1 : -1, rot = one.rot ?? 0, c = toPx([one.x + one.w / 2, one.y + one.h / 2]), half = (x: number, y: number) => turn([(x * one.w * 4) / 2, (y * one.h * 3) / 2], rot); return [
                          <i key={`r${k}`} className={`u2-rot u2-rot--${k}`} style={{ cursor: ROTATE }} title="Rotate (Shift: steps of 15°)" onPointerMove={move} onPointerUp={up}
                            onPointerDown={(e) => { e.stopPropagation(); capture(e); const q = toPx(at(e)); act.current = { type: "rotate", id: one.id, centre: c, from: (Math.atan2(q[1] - c[1], q[0] - c[0]) * 180) / Math.PI, orig: rot }; }} />,
                          <i key={`h${k}`} className={`u2-handle u2-handle--${k}`} onPointerMove={move} onPointerUp={up}
                            onPointerDown={(e) => { e.stopPropagation(); capture(e); const o = half(-sx, -sy); act.current = { type: "resize", id: one.id, rot, fixed: [c[0] + o[0], c[1] + o[1]] }; }} />,
                        ]; })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          }
          statusBar={<StatusBar>{objs.filter((o) => o.kind !== "group").length} objects{photo && <> · {frames.length} frames{picF && <> · the picture is <strong>{picF.name}</strong></>}{scale < 1 && <> · a frame sees more than the photo: the hatched area is beyond it</>}</>}{compare && <> · Compare: two frames side by side, to look at, not to edit</>}{mode === "crop" && picF && <> · Crop: fitted to the picture's frame{rectOf(picF).inner ? ", bars for the delivery aspect" : ""}</>}{cur && curR?.hfov && <> · <strong>{cur.name}</strong> covers {Math.min(100, curR.w * 100).toFixed(0)} % of the photo's width</>}</StatusBar>} />
        {making && <PresetFlow start={making} onClose={() => setMaking(null)} onCreate={(pr) => {
          // The new preset is there at once: a free-form frame it was made from now belongs to it, otherwise a first frame is added.
          setPresets([...presets, pr]); setMaking(null);
          const first = pr.primes?.[0] ?? pr.zoom![0];
          if (cur?.kind === "free" && making.format) setFrames(frames.map((f) => (f.id === cur.id ? { ...f, kind: "preset", preset: pr.id, format: pr.format, mult: pr.mult, squeeze: pr.squeeze, delivery: pr.delivery, focal: pr.primes?.includes(f.focal) ? f.focal : first, name: `${pr.primes?.includes(f.focal) ? f.focal : first} mm` } : f)));
          else { const f = frameFrom(pr, first, frames.length), o = frames[0]; setFrames([...frames, linked && o ? { ...f, cx: clampCentre(o.cx, rectOf(f).w), cy: clampCentre(o.cy, rectOf(f).h) } : f]); setSel([]); setRootSel(false); setSelF(f.id); setTab("frames"); }
        }} />}
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
