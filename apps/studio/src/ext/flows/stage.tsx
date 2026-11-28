// A flow's stages in the Studio (docs/features/flows.md, "The stage"; #426 feedback round 8): above the lanes, the stage
// shown (one of the flow's perspectives, picked in its bar), a drawing on dark paper made with the canvas's tools (canvas/objects.tsx), and a widget per placed light track showing what
// the track plays at the playhead. Everything a widget shows and how it is shaped comes from @openclapper/ext-flows,
// so the phone's Stage view shows the same.
import "../../canvas/canvas.css";
import "./stage.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, cx, Dialog, Icon, NumberInput, Popover, Segmented, Slider, TextInput, type IconName } from "@openclapper/design";
import type { ComponentChildren } from "preact";
import { modelOf } from "@openclapper/ext-hardware";
import {
  BEAM_MAX, BEAM_MIN, beamAngleOf, beamOpacity, beamPath, ceilingShape, STAGE_COLS, STAGE_SIDE_MAX, STAGE_SIDE_MIN, stageScale, stageSize, effectOpacity, fmtClock, glowRadius, isCeiling, poolRadius, setMount, STAGE_DRAW_COLOURS, STAGE_INK, STAGE_TRACK_COLOURS, STAGE_W, tagAt, tagWidth, widgetShape, widgetState,
  type Flow, type FlowStage, type FlowTrack, type StageLight, type StageMount, type WidgetPart,
} from "@openclapper/ext-flows";
import { eraseAt } from "../../canvas/erase";
import { Draft } from "./draft";
import { toEdit, toStore, type Obj, type P } from "../../canvas/geometry";
import { DraftView, KIND, objectFromDraft, ObjectView, STENCILS } from "../../canvas/objects";

export type StageTool = "select" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "stencil" | "eraser";
export const STAGE_TOOLS: { id: StageTool; icon: IconName; label: string; kbd: string }[] = [
  { id: "select", icon: "cursor", label: "Move", kbd: "V" }, { id: "pen", icon: "pencil", label: "Pen", kbd: "P" }, { id: "line", icon: "line-tool", label: "Line", kbd: "L" }, { id: "arrow", icon: "arrow-up-right", label: "Arrow", kbd: "A" },
  { id: "rect", icon: "square", label: "Rectangle", kbd: "R" }, { id: "ellipse", icon: "circle", label: "Ellipse", kbd: "O" }, { id: "text", icon: "text", label: "Text", kbd: "T" }, { id: "stencil", icon: "stencil", label: "Stencil", kbd: "S" }, { id: "eraser", icon: "eraser", label: "Eraser", kbd: "E" },
];
/** What is chosen on the stage: a light's widget (by its track) or a drawn object. */
/** What is chosen on the stage: a light, or one or more drawn objects (#426: several by Shift-click or a box). */
export type StageSel = { kind: "light"; track: string } | { kind: "obj"; ids: string[] } | null;
export interface StagePhoto { id: string; name: string; thumb: string; src: string }
export interface StageDrawing { tool: StageTool; colour: string; stencil: IconName; /** Moving, resizing and placing snap to the paper, the drawn objects and the lights (#426); Ctrl or ⌘ held: not this time. */ snap: boolean }

const isLight = (t: FlowTrack) => modelOf(t.model)?.type === "light";
const trackInk = (t: FlowTrack | undefined) => (t?.color !== undefined ? STAGE_TRACK_COLOURS[t.color] : STAGE_INK.rim);
const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** A vector turned by `deg` degrees clockwise (screen axes). */
const turnBy = (v: P, deg: number): P => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
/** The canvas's rotate cursor. */
const ROTATE = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12a7 7 0 1 1 3 5.7" stroke="white" stroke-width="5"/><path d="M5 12a7 7 0 1 1 3 5.7"/><path d="M4 16l4 2l1 -4.5" stroke="white" stroke-width="5"/><path d="M4 16l4 2l1 -4.5"/></svg>')}") 12 12, crosshair`;

/**
 * The point of the paper (fractions of its width and height) under a screen point, through the view's zoom and the
 * stage's turn (#426): the paper turns and scales about its centre, which stays the centre of its box on screen.
 */
export function paperAt(el: HTMLElement, x: number, y: number): P {
  const r = el.getBoundingClientRect(), z = Number(el.dataset.zoom ?? 1);
  const v = turnBy([x - (r.left + r.width / 2), y - (r.top + r.height / 2)], -Number(el.dataset.turn ?? 0));
  return [v[0] / (el.offsetWidth * z) + 0.5, v[1] / (el.offsetHeight * z) + 0.5];
}


/** The frame clock while something on the stage moves by itself (an effect): a re-render each frame, nothing otherwise. */
function useFrames(on: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    let h = requestAnimationFrame(function f(t) { setNow(t); h = requestAnimationFrame(f); });
    return () => cancelAnimationFrame(h);
  }, [on]);
  return now;
}

/** The parts of a widget's body (aimed: facing +x; ceiling: seen from below); the face takes the light's colour (or an unlit grey). */
function Body({ shape, face, muted }: { shape: { parts: WidgetPart[] }; face: string; muted?: boolean }) {
  return <g opacity={muted ? 0.45 : 1} stroke-dasharray={muted ? "3 2" : undefined}>{shape.parts.map((p, i) => p.kind === "rect"
    ? <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={p.face ? face : STAGE_INK.body} stroke={p.face ? "none" : STAGE_INK.rim} stroke-width={1.5} />
    : <path key={i} d={p.d} fill={p.face ? face : STAGE_INK.body} stroke={STAGE_INK.rim} stroke-width={1.5} />)}</g>;
}

/** A small picture of a track's widget (the palette, the chosen panel). */
export function MiniWidget({ tr, mount }: { tr: FlowTrack; mount?: StageMount }) {
  return <svg className="fl-mini" viewBox="-34 -30 68 60" aria-hidden="true">{mount === "ceiling"
    ? <Body shape={ceilingShape(tr.model)} face={trackInk(tr)} />
    : <g transform="translate(-10 0)"><Body shape={widgetShape(tr.model)} face={trackInk(tr)} /></g>}</svg>;
}

interface WidgetsProps { /** The lights' name tags shown (the View's switch). */ tags: boolean; flow: Flow; stage: FlowStage; t: number; sel: StageSel; marked: string | null; flash: string | null; editing: boolean; onGrab: (e: PointerEvent, l: StageLight, how: "move" | "turn") => void }

/**
 * The widgets: beams (an aimed light's wedge, a ceiling light's pool) under bodies under tags, each sampled at the
 * playhead; the chosen one with a ring and, when aimed, a handle to turn it.
 */
function Widgets({ tags, flow, stage, t, sel, marked, flash, editing, onGrab }: WidgetsProps) {
  // On a larger paper the units run further, so the widgets keep their size in squares.
  const k = stageScale(stage), W = STAGE_W * k, H = W / stage.aspect;
  const placed = stage.lights.map((l) => ({ l, tr: flow.tracks.find((x) => x.id === l.track) })).filter((x): x is { l: StageLight; tr: FlowTrack } => !!x.tr);
  const states = placed.map(({ tr }) => widgetState(tr, t));
  const now = useFrames(states.some((s) => s.effect));
  const at = (l: StageLight) => [l.x * W, l.y * H] as const;
  const ring = sel?.kind === "light" ? sel.track : marked;
  return (
    <svg className="fl-widgets" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <g>{placed.map(({ l, tr }, i) => {
        const s = states[i], [x, y] = at(l), c = s.colour ?? "#ffffff", id = `w${tr.id}`;
        if (!s.on) return null;
        const fx = s.effect ? effectOpacity(s.effect.family, now) : 1;
        if (isCeiling(l)) return (
          <g key={tr.id} transform={`translate(${x} ${y})`} opacity={beamOpacity(s.level) * fx} style={{ pointerEvents: "none" }}>
            <defs><radialGradient id={`${id}p`}><stop offset="0" stop-color={c} stop-opacity=".8" /><stop offset=".4" stop-color={c} stop-opacity=".4" /><stop offset="1" stop-color={c} stop-opacity="0" /></radialGradient></defs>
            <circle r={poolRadius(ceilingShape(tr.model), s.level)} fill={`url(#${id}p)`} />
          </g>
        );
        const g = widgetShape(tr.model);
        return (
          <g key={tr.id} transform={`translate(${x} ${y}) rotate(${l.rot})`} opacity={beamOpacity(s.level) * fx} style={{ pointerEvents: "none" }}>
            <defs>
              <radialGradient id={`${id}g`}><stop offset="0" stop-color={c} stop-opacity=".95" /><stop offset=".45" stop-color={c} stop-opacity=".45" /><stop offset="1" stop-color={c} stop-opacity="0" /></radialGradient>
              <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color={c} stop-opacity=".7" /><stop offset="1" stop-color={c} stop-opacity="0" /></linearGradient>
            </defs>
            <path d={beamPath(g, s.level, l.angle)} fill={`url(#${id}b)`} />
            <circle cx={g.front} r={glowRadius(g, s.level)} fill={`url(#${id}g)`} />
          </g>
        );
      })}</g>
      <g>{placed.map(({ l, tr }, i) => {
        const s = states[i], [x, y] = at(l);
        return (
          <g key={tr.id} className={cx("fl-w", editing && "is-movable")} data-light={tr.id} transform={`translate(${x} ${y})`} onPointerDown={(e) => onGrab(e, l, "move")}>
            {isCeiling(l)
              ? <Body shape={ceilingShape(tr.model)} face={s.on ? s.colour ?? "#ffffff" : STAGE_INK.unlit} muted={s.muted} />
              : <g transform={`rotate(${l.rot})`}><Body shape={widgetShape(tr.model)} face={s.on ? s.colour ?? "#ffffff" : STAGE_INK.unlit} muted={s.muted} /></g>}
            <circle r={36} fill="transparent" />
          </g>
        );
      })}</g>
      <g>{tags && placed.map(({ l, tr }, i) => {
        const s = states[i], w = tagWidth(tr.name, s.line), [tx, ty] = tagAt(l, stage.aspect, w, k), ink = trackInk(tr);
        return (
          <g key={tr.id} className={cx("fl-w", editing && "is-movable")} transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)})`} onPointerDown={(e) => onGrab(e, l, "move")}>
            <rect x={-w / 2} y={-23} width={w} height={46} rx={6} fill={STAGE_INK.tag} stroke={ink} stroke-width={1.5} />
            <rect x={-w / 2 + 4} y={-18} width={5} height={36} rx={2} fill={ink} />
            <text x={-w / 2 + 16} y={-3} className="fl-w__name" fill={STAGE_INK.name}>{tr.name}</text>
            <text x={-w / 2 + 16} y={15} className="fl-w__line" fill={STAGE_INK.line}>{s.line}</text>
          </g>
        );
      })}</g>
      {placed.filter(({ tr }) => tr.id === ring || tr.id === flash).map(({ l, tr }) => {
        const [x, y] = at(l), a = (l.rot * Math.PI) / 180, hx = x + Math.cos(a) * 80, hy = y + Math.sin(a) * 80;
        return (
          <g key={`r${tr.id}`}>
            {tr.id === flash && <circle className="fl-w__flash" cx={x} cy={y} r={20} />}
            {tr.id === ring && <circle cx={x} cy={y} r={42} fill="none" stroke={STAGE_INK.select} stroke-width={1.5} stroke-dasharray="5 4" style={{ pointerEvents: "none" }} />}
            {tr.id === ring && sel?.kind === "light" && editing && !isCeiling(l) && <>
              <line x1={x + Math.cos(a) * 42} y1={y + Math.sin(a) * 42} x2={hx} y2={hy} stroke={STAGE_INK.select} stroke-width={1.5} stroke-dasharray="5 4" style={{ pointerEvents: "none" }} />
              <circle className="fl-w__turn" cx={hx} cy={hy} r={9} fill={STAGE_INK.paper} stroke={STAGE_INK.select} stroke-width={2} onPointerDown={(e) => onGrab(e, l, "turn")}><title>Turn (Shift: free)</title></circle>
            </>}
          </g>
        );
      })}
    </svg>
  );
}

type Act =
  | { type: "light"; track: string; start: P; orig: P; moved: boolean }
  | { type: "turn"; track: string }
  | { type: "obj"; ids: string[]; start: P; orig: Record<string, Obj>; moved: boolean }
  /** A box drawn from empty paper with Move: chooses the drawn objects it touches (Shift: adds to them). */
  | { type: "box"; start: P; end: P; add: string[] }
  | { type: "draw"; tool: "pen" | "line" | "arrow" | "rect" | "ellipse"; pts: P[] }
  | { type: "erase" }
  /** A corner of the chosen object dragged (#426): the opposite corner stays. */
  | { type: "resize"; id: string; fixed: P; rot: number }
  /** A chosen object turned by a handle outside its corner (in the paper's height units, as the canvas). */
  | { type: "rotate"; id: string; centre: P; from: number; orig: number }
  /** An end of a chosen line or arrow dragged; the other end stays. */
  | { type: "end"; id: string; which: 0 | 1; other: P };

export interface StagePaneProps {
  /** The stage shown: one of the flow's, or the empty first one before anything is on it. */
  flow: Flow; stage: FlowStage; t: number; editing: boolean;
  /** The stage picker and its menu, at the start of the bar. */
  picker: ComponentChildren;
  drawing: StageDrawing; onDrawing: (d: StageDrawing) => void;
  sel: StageSel; onSel: (s: StageSel) => void;
  /** The track chosen in the lanes (its keyframe, its label): its widget shows a ring. */
  marked: string | null;
  /** A widget to point at for a moment (Show on the stage, just placed). */
  flash: string | null;
  height: number;
  photos: readonly StagePhoto[];
  /** The lights' name tags shown (the View's "Light labels on the stage"). */
  tags: boolean;
  onChange: (fn: (s: FlowStage) => FlowStage) => void;
}

/** The stage pane: its bar (the stage picker, the canvas's tools, colours, the underlay) and the paper. */
export function StagePane(p: StagePaneProps) {
  const stage = p.stage;
  const H = STAGE_W / stage.aspect;
  const { tool, colour, stencil } = p.drawing;
  const paper = useRef<HTMLDivElement>(null);
  const act = useRef<Act | null>(null);
  const [draft, setDraft] = useState<{ tool: string; pts: P[] } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v?: number; h?: number }>({});
  const [box, setBox] = useState<[P, P] | null>(null);
  const chosenIds = p.sel?.kind === "obj" ? p.sel.ids : [];
  // The view (#426): zoom and pan for this session, like the canvas's; the turn is the stage's own and is saved.
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const fitEl = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const turn = stage.turn ?? 0;
  useEffect(() => setView({ z: 1, x: 0, y: 0 }), [stage.id]);
  const zoomAt = (to: number, cx?: number, cy?: number) => setView((v) => {
    const z = Math.min(8, Math.max(0.25, to)), r = fitEl.current?.getBoundingClientRect();
    if (!r) return { ...v, z };
    const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2), py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2), k = z / v.z;
    return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
  });
  useEffect(() => {
    const el = fitEl.current; if (!el) return;
    // Ctrl or ⌘ with the wheel (a trackpad's pinch) zooms at the pointer; the wheel alone pans.
    const wheel = (e: WheelEvent) => { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomAt(view.z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); else setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) })); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const setTurn = (deg: number) => p.onChange((st) => { const t = ((Math.round(deg) % 360) + 360) % 360, n = { ...st }; if (t) n.turn = t; else delete n.turn; return n; });
  const objs = stage.objects.map(toEdit);
  const setTool = (t: StageTool) => p.onDrawing({ ...p.drawing, tool: t });
  const lights = p.flow.tracks.filter(isLight);
  const underlay = stage.underlay ? p.photos.find((x) => x.id === stage.underlay!.photo) : undefined;
  useEffect(() => { if (!p.editing) { setDraft(null); setTyping(null); act.current = null; } }, [p.editing]);

  const at = (e: PointerEvent): P => paperAt(paper.current!, e.clientX, e.clientY);
  /** The paper's size on screen in px, zoomed (its box on screen is larger once turned). */
  const onScreen = (): P => [paper.current!.offsetWidth * view.z, paper.current!.offsetHeight * view.z];
  const capture = (e: PointerEvent) => { try { paper.current?.setPointerCapture(e.pointerId); } catch { /* no pointer */ } };
  const setObjs = (fn: (os: Obj[]) => Obj[]) => p.onChange((s) => ({ ...s, objects: fn(s.objects.map(toEdit)).map(toStore) }));
  const setLight = (track: string, fn: (l: StageLight) => StageLight) => p.onChange((s) => ({ ...s, lights: s.lights.map((l) => (l.track === track ? fn(l) : l)) }));

  /**
   * Snapping, as on the canvas: within 6 px, a moved edge, middle or point jumps onto the paper's edges and middle, the
   * edges and middles of the other drawn objects and the other lights' centres. `xs`/`ys`: the moving thing's own
   * lines; the answer is how far to shift it on each axis and the guide lines to draw.
   */
  const snapTo = (e: PointerEvent, xs: number[], ys: number[], skip: { objs?: string[]; light?: string }) => {
    if (!p.drawing.snap || e.ctrlKey || e.metaKey) { setGuides({}); return { dx: 0, dy: 0 }; }
    const [sw, sh] = onScreen();
    const boxes = objs.filter((o) => o.visible && !skip.objs?.includes(o.id));
    const lx = stage.lights.filter((l) => l.track !== skip.light);
    const tx = [0, 0.5, 1, ...boxes.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]), ...lx.map((l) => l.x)];
    const ty = [0, 0.5, 1, ...boxes.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]), ...lx.map((l) => l.y)];
    const near = (mine: number[], lines: number[], tol: number) => { let d = tol, at: number | undefined; for (const m of mine) for (const t of lines) if (Math.abs(t - m) < Math.abs(d)) { d = t - m; at = t; } return at === undefined ? { d: 0 } : { d, at }; };
    const x = near(xs, tx, 6 / sw), y = near(ys, ty, 6 / sh);
    setGuides({ v: x.at, h: y.at });
    return { dx: x.d, dy: y.d };
  };

  const grabLight = (e: PointerEvent, l: StageLight, how: "move" | "turn") => {
    if (e.button > 0 || (p.editing && tool !== "select")) return;
    e.stopPropagation();
    p.onSel({ kind: "light", track: l.track });
    if (!p.editing) return;
    capture(e);
    act.current = how === "turn" ? { type: "turn", track: l.track } : { type: "light", track: l.track, start: at(e), orig: [l.x, l.y], moved: false };
  };
  const grabObj = (e: PointerEvent, o: Obj) => {
    if (e.button > 0 || !p.editing || tool !== "select") return;
    e.stopPropagation();
    // Shift, Ctrl or ⌘: add it to what is chosen, or take it out.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = chosenIds.includes(o.id) ? chosenIds.filter((x) => x !== o.id) : [...chosenIds, o.id];
      p.onSel(next.length ? { kind: "obj", ids: next } : null);
      return;
    }
    // A chosen one drags all that are chosen; Alt drags copies of them, as on the canvas (a light is never copied).
    let group = chosenIds.includes(o.id) ? objs.filter((x) => chosenIds.includes(x.id)) : [o];
    if (e.altKey) { const copies = group.map((x) => ({ ...x, id: uid(), name: `${x.name} copy` })); setObjs((os) => [...os, ...copies]); group = copies; }
    const ids = group.map((x) => x.id);
    p.onSel({ kind: "obj", ids });
    capture(e);
    act.current = { type: "obj", ids, start: at(e), orig: Object.fromEntries(group.map((x) => [x.id, x])), moved: false };
  };
  const rub = (q: P) => {
    const h = onScreen()[1];
    setObjs((os) => eraseAt(os, q, 12 / h, stage.aspect, "partial", uid) as Obj[]);
  };
  const down = (e: PointerEvent) => {
    if (e.button > 0) return;
    if (!p.editing) { p.onSel(null); return; }
    const q = at(e);
    if (tool === "select") {
      const add = e.shiftKey ? chosenIds : [];
      if (!add.length) p.onSel(null);
      capture(e); act.current = { type: "box", start: q, end: q, add };
      return;
    }
    if (tool === "eraser") { capture(e); act.current = { type: "erase" }; rub(q); return; }
    if (tool === "text" || tool === "stencil") {
      // No focus change from this press: the text typed in place keeps it.
      e.preventDefault();
      const k = stageScale(stage), size: P = tool === "text" ? [0.22 / k, 0.06 / k] : [0.06 / k, (0.06 * stage.aspect) / k];
      const o: Obj = { id: uid(), kind: tool, name: tool === "text" ? "Text" : `Stencil: ${stencil}`, x: q[0] - size[0] / 2, y: q[1] - size[1] / 2, w: size[0], h: size[1], stroke: colour, width: 3, opacity: 1, visible: true, locked: false, ...(tool === "text" ? { text: "Text" } : { icon: stencil }) };
      setObjs((os) => [...os, o]); setTool("select"); p.onSel({ kind: "obj", ids: [o.id] }); if (tool === "text") setTyping(o.id);
      return;
    }
    capture(e);
    act.current = { type: "draw", tool, pts: [q, q] }; setDraft({ tool, pts: [q, q] });
  };
  const move = (e: PointerEvent) => {
    const a = act.current; if (!a) return;
    const q = at(e);
    if (a.type === "erase") rub(q);
    else if (a.type === "draw") { a.pts = a.tool === "pen" ? [...a.pts, q] : [a.pts[0], q]; setDraft({ tool: a.tool, pts: a.pts }); }
    else if (a.type === "light") {
      if (!a.moved && Math.hypot(q[0] - a.start[0], q[1] - a.start[1]) < 0.003) return;
      a.moved = true;
      const nx = a.orig[0] + q[0] - a.start[0], ny = a.orig[1] + q[1] - a.start[1], sn = snapTo(e, [nx], [ny], { light: a.track });
      setLight(a.track, (l) => ({ ...l, x: Number(clamp01(nx + sn.dx).toFixed(4)), y: Number(clamp01(ny + sn.dy).toFixed(4)) }));
    } else if (a.type === "turn") {
      const l = stage.lights.find((x) => x.track === a.track); if (!l) return;
      const deg = (Math.atan2((q[1] - l.y) / stage.aspect, q[0] - l.x) * 180) / Math.PI, step = e.shiftKey ? 1 : 15;
      setLight(a.track, (x) => ({ ...x, rot: ((Math.round(deg / step) * step) % 360 + 360) % 360 }));
    } else if (a.type === "resize") {
      // In the paper's height units, so a turned object keeps its angles (the canvas's way); snapping only unturned.
      if (!a.rot) { const sn = snapTo(e, [q[0]], [q[1]], { objs: [a.id] }); q[0] += sn.dx; q[1] += sn.dy; }
      const A = stage.aspect, d = turnBy([q[0] * A - a.fixed[0], q[1] - a.fixed[1]], -a.rot), w = Math.max(0.01, Math.abs(d[0])), h = Math.max(0.01, Math.abs(d[1]));
      const half = turnBy([(Math.sign(d[0]) || 1) * w / 2, (Math.sign(d[1]) || 1) * h / 2], a.rot), c: P = [a.fixed[0] + half[0], a.fixed[1] + half[1]];
      setObjs((os) => os.map((o) => (o.id === a.id ? { ...o, x: (c[0] - w / 2) / A, y: c[1] - h / 2, w: w / A, h } : o)));
    } else if (a.type === "rotate") {
      const A = stage.aspect, ang = (Math.atan2(q[1] - a.centre[1], q[0] * A - a.centre[0]) * 180) / Math.PI;
      let rot = a.orig + ang - a.from;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      rot = Number((((rot % 360) + 360) % 360).toFixed(1));
      setObjs((os) => os.map((o) => (o.id === a.id ? { ...o, rot } : o)));
    } else if (a.type === "end") {
      const sn = snapTo(e, [q[0]], [q[1]], { objs: [a.id] });
      q[0] += sn.dx; q[1] += sn.dy;
      const ends: [P, P] = a.which === 0 ? [q, a.other] : [a.other, q];
      const x = Math.min(ends[0][0], ends[1][0]), y = Math.min(ends[0][1], ends[1][1]), w = Math.abs(ends[1][0] - ends[0][0]), h = Math.abs(ends[1][1] - ends[0][1]);
      setObjs((os) => os.map((o) => (o.id === a.id ? { ...o, x, y, w: Math.max(w, 0.0005), h: Math.max(h, 0.0005), pts: ends.map((e): P => [w ? (e[0] - x) / w : 0, h ? (e[1] - y) / h : 0]) } : o)));
    } else if (a.type === "obj") {
      if (!a.moved && Math.hypot(q[0] - a.start[0], q[1] - a.start[1]) < 0.003) return;
      a.moved = true;
      // All that are chosen move together; their joint bounds snap.
      const os0 = Object.values(a.orig), bx = Math.min(...os0.map((o) => o.x)), by = Math.min(...os0.map((o) => o.y));
      const bw = Math.max(...os0.map((o) => o.x + o.w)) - bx, bh = Math.max(...os0.map((o) => o.y + o.h)) - by;
      const dx = q[0] - a.start[0], dy = q[1] - a.start[1], mx = bx + dx, my = by + dy;
      const sn = snapTo(e, [mx, mx + bw / 2, mx + bw], [my, my + bh / 2, my + bh], { objs: a.ids });
      setObjs((os) => os.map((o) => (a.orig[o.id] ? { ...o, x: a.orig[o.id].x + dx + sn.dx, y: a.orig[o.id].y + dy + sn.dy } : o)));
    } else if (a.type === "box") { a.end = q; setBox([a.start, q]); }
  };
  const up = () => {
    const a = act.current; act.current = null; setGuides({});
    if (a?.type === "box") {
      setBox(null);
      const x0 = Math.min(a.start[0], a.end[0]), x1 = Math.max(a.start[0], a.end[0]), y0 = Math.min(a.start[1], a.end[1]), y1 = Math.max(a.start[1], a.end[1]);
      if (x1 - x0 < 0.003 && y1 - y0 < 0.003) return;
      const hit = objs.filter((o) => o.visible && o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0).map((o) => o.id);
      const ids = [...a.add, ...hit.filter((id) => !a.add.includes(id))];
      p.onSel(ids.length ? { kind: "obj", ids } : null);
      return;
    }
    if (a?.type !== "draw") return;
    setDraft(null);
    const [sw, sh] = onScreen();
    const o = objectFromDraft(a.tool, a.pts, { id: uid(), pen: "pen", stroke: colour, width: 3, minStep: 2.5 / Math.max(sw, sh) });
    if (o) { setObjs((os) => [...os, o]); p.onSel({ kind: "obj", ids: [o.id] }); }
  };

  // One chosen object has handles; several show their outlines and move, recolour and delete together.
  const selObj = chosenIds.length === 1 ? objs.find((o) => o.id === chosenIds[0]) : undefined;
  const others = chosenIds.length > 1 ? objs.filter((o) => chosenIds.includes(o.id)) : [];
  // The chosen object's handles, as on the canvas (#426): corners resize it, a line's or an arrow's ends move.
  const handles = !!selObj && p.editing && tool === "select" && typing !== selObj.id;
  const isLine = !!selObj && (selObj.kind === "line" || selObj.kind === "arrow") && !!selObj.pts?.length;
  const endOf = (o: Obj, k: 0 | 1): P => { const q = o.pts![k === 0 ? 0 : o.pts!.length - 1]; return [o.x + q[0] * o.w, o.y + q[1] * o.h]; };
  const centreOf = (o: Obj): P => [(o.x + o.w / 2) * stage.aspect, o.y + o.h / 2];
  const grabCorner = (e: PointerEvent, k: number) => {
    if (e.button > 0 || !selObj) return;
    e.stopPropagation(); capture(e);
    // The opposite corner stays: in height units, turned with the object.
    const rot = selObj.rot ?? 0, c = centreOf(selObj), sx = k % 2 ? 1 : -1, sy = k >= 2 ? 1 : -1;
    const o = turnBy([(-sx * selObj.w * stage.aspect) / 2, (-sy * selObj.h) / 2], rot);
    act.current = { type: "resize", id: selObj.id, fixed: [c[0] + o[0], c[1] + o[1]], rot };
  };
  const grabRotate = (e: PointerEvent) => {
    if (e.button > 0 || !selObj) return;
    e.stopPropagation(); capture(e);
    const c = centreOf(selObj), q = at(e);
    act.current = { type: "rotate", id: selObj.id, centre: c, from: (Math.atan2(q[1] - c[1], q[0] * stage.aspect - c[0]) * 180) / Math.PI, orig: selObj.rot ?? 0 };
  };
  const grabEnd = (e: PointerEvent, k: 0 | 1) => {
    if (e.button > 0 || !selObj) return;
    e.stopPropagation(); capture(e);
    act.current = { type: "end", id: selObj.id, which: k, other: endOf(selObj, k === 0 ? 1 : 0) };
  };
  return (
    <div className="fl-st" style={{ height: `${p.height}px` }}>
      <div className="fl-st__bar">
        {p.picker}
        {STAGE_TOOLS.map((x) => <Button key={x.id} size="sm" variant={tool === x.id ? "secondary" : "quiet"} selected={tool === x.id} icon={x.icon} label={`${x.label} (${x.kbd})`} disabled={!p.editing && x.id !== "select"} onClick={() => setTool(x.id)} />)}
        {tool === "stencil" && <Popover trigger={<Button size="sm" icon={stencil} iconAfter="chevron-down">Stencil</Button>}><div className="cv-stencils">{STENCILS.map((s) => <button type="button" key={s} title={s} className={cx(stencil === s && "is-on")} onClick={() => p.onDrawing({ ...p.drawing, stencil: s })}><Icon name={s} size={20} /></button>)}</div></Popover>}
        <span className="fl-st__sep" />
        <span className="fl-st__swatches" role="radiogroup" aria-label="Drawing colour">
          {STAGE_DRAW_COLOURS.map((c) => <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={`Colour ${c}`} disabled={!p.editing} className={cx("fl-st__swatch", colour === c && "is-on")} style={{ background: c }}
            onClick={() => { p.onDrawing({ ...p.drawing, colour: c }); if (chosenIds.length) setObjs((os) => os.map((o) => (chosenIds.includes(o.id) ? { ...o, stroke: c } : o))); }} />)}
        </span>
        <span className="fl-st__sep" />
        <Button size="sm" variant={p.drawing.snap ? "secondary" : "quiet"} icon="crosshair" disabled={!p.editing} selected={p.drawing.snap} label={p.drawing.snap ? "Snap is on: to the paper, the drawing and the lights. Click to switch it off (or hold Ctrl while moving)" : "Snap is off. Click to switch it on"} onClick={() => p.onDrawing({ ...p.drawing, snap: !p.drawing.snap })} />
        <Popover maxWidth={420} trigger={<Button size="sm" variant="quiet" icon="image" iconAfter="chevron-down" disabled={!p.editing}>Underlay</Button>}>
          <div className="fl-st__under">
            {p.photos.length ? <div className="cv-photos">{p.photos.map((x) => <button type="button" key={x.id} title={x.name} className={cx(stage.underlay?.photo === x.id && "is-on")}
              onClick={() => p.onChange((s) => ({ ...s, underlay: { photo: x.id, opacity: s.underlay?.opacity ?? 0.6 } }))}><img src={x.thumb} alt="" /><span>{x.name}</span></button>)}</div>
              : <p className="fl-note">No photos in this project yet.</p>}
            {stage.underlay && <>
              <label className="hw-ctl hw-ctl--range"><small>Opacity<b>{Math.round(stage.underlay.opacity * 100)} %</b></small><Slider value={stage.underlay.opacity} min={0.1} max={1} step={0.05} onChange={(v: number) => p.onChange((s) => (s.underlay ? { ...s, underlay: { ...s.underlay, opacity: v } } : s))} aria-label="Underlay opacity" /></label>
              <Button size="sm" variant="quiet" icon="close" onClick={() => p.onChange((s) => { const n = { ...s }; delete n.underlay; return n; })}>No underlay</Button>
            </>}
            <p className="fl-note">A photo of the project under the drawing, fitted inside the paper. The canvas has no map surface, so there is no map here.</p>
          </div>
        </Popover>
        <span className="fl-st__spacer" />
        <span className="fl-st__count">{stage.lights.length} of {lights.length} lights placed</span>
      </div>
      <div className="fl-st__fit" ref={fitEl}
        onPointerDown={(e) => { if (e.button !== 1) return; e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); panning.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }; }}
        onPointerMove={(e) => { const g = panning.current; if (g) setView((v) => ({ ...v, x: g.ox + e.clientX - g.x, y: g.oy + e.clientY - g.y })); }}
        onPointerUp={() => { panning.current = null; }} onPointerCancel={() => { panning.current = null; }}>
        <div className={cx("fl-paper", `is-${p.editing ? tool : "view"}`)} ref={paper} data-zoom={view.z} data-turn={turn}
          onDblClick={() => { if (p.editing && tool === "select" && selObj?.kind === "text") setTyping(selObj.id); }}
          style={{ "--aspect": stage.aspect, "--cols": stage.cols ?? STAGE_COLS, "--fl-grid": STAGE_INK.grid, "--c": Math.abs(Math.cos((turn * Math.PI) / 180)), "--s": Math.abs(Math.sin((turn * Math.PI) / 180)), "--inv": 1 / view.z, background: STAGE_INK.paper, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z}) rotate(${turn}deg)` }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { act.current = null; setDraft(null); setGuides({}); setBox(null); }}>
          <div className="fl-paper__in">
            {stage.underlay && underlay && <img className="fl-paper__under" src={underlay.src} alt="" draggable={false} style={{ opacity: stage.underlay.opacity }} />}
            {objs.filter((o) => o.visible).map((o) => <ObjectView key={o.id} o={o} vh={H} scale={stageScale(stage)} onGrab={p.editing && tool === "select" ? (e) => grabObj(e, o) : undefined}
              editing={typing === o.id} onText={(t) => { setObjs((os) => os.map((x) => (x.id === o.id ? { ...x, text: t } : x))); setTyping(null); }} onEdit={() => { if (p.editing && tool === "select") setTyping(o.id); }} />)}
            {draft && <DraftView d={{ ...draft, pen: "pen", stroke: colour, width: 3 }} vh={H} scale={stageScale(stage)} />}
            {selObj && !(handles && isLine) && <span className="cv-sel" style={{ left: `${selObj.x * 100}%`, top: `${selObj.y * 100}%`, width: `${selObj.w * 100}%`, height: `${selObj.h * 100}%`, transform: selObj.rot ? `rotate(${selObj.rot}deg)` : undefined }}>
              {handles && !isLine && [0, 1, 2, 3].map((k) => [
                <i key={`r${k}`} className={`cv-rot cv-rot--${k}`} style={{ cursor: ROTATE }} title="Drag to turn (Shift: steps of 15°)" onPointerDown={(e) => grabRotate(e)} />,
                <i key={`h${k}`} className={`cv-handle cv-handle--${k}`} title="Drag to resize" onPointerDown={(e) => grabCorner(e, k)} />,
              ])}
            </span>}
            {handles && isLine && ([0, 1] as const).map((k) => { const q = endOf(selObj!, k); return <i key={k} className="cv-node" title="Drag to move this end" style={{ left: `${q[0] * 100}%`, top: `${q[1] * 100}%` }} onPointerDown={(e) => grabEnd(e, k)} />; })}
            {guides.v !== undefined && <span className="cv-guide cv-guide--v" style={{ left: `${guides.v * 100}%` }} />}
            {guides.h !== undefined && <span className="cv-guide cv-guide--h" style={{ top: `${guides.h * 100}%` }} />}
            {others.map((o) => <span key={o.id} className="cv-sel" style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, transform: o.rot ? `rotate(${o.rot}deg)` : undefined }} />)}
            {box && <span className="fl-box" style={{ left: `${Math.min(box[0][0], box[1][0]) * 100}%`, top: `${Math.min(box[0][1], box[1][1]) * 100}%`, width: `${Math.abs(box[1][0] - box[0][0]) * 100}%`, height: `${Math.abs(box[1][1] - box[0][1]) * 100}%` }} />}
            <Widgets tags={p.tags} flow={p.flow} stage={stage} t={p.t} sel={p.sel} marked={p.marked} flash={p.flash} editing={p.editing && tool === "select"} onGrab={grabLight} />
          </div>
          {!stage.lights.length && !stage.objects.length && <span className="fl-paper__hint">{p.editing ? "Draw a plan with the tools above; drag lights here from “Place a light”." : "Nothing on the stage yet."}</span>}
        </div>
        {/* The view (#426): turning the whole paper is the stage's own (saved, undoable); zoom is this window's. */}
        <div className="fl-st__view" onPointerDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant="quiet" icon="rotate" label="Turn the stage 15° left (Shift: 90°)" disabled={!p.editing} onClick={(e: MouseEvent) => setTurn(turn - (e.shiftKey ? 90 : 15))} />
          <button type="button" className="fl-st__now" title={turn ? "Turn the stage back to 0°" : "How far the stage is turned"} disabled={!p.editing || !turn} onClick={() => setTurn(0)}>{turn}°</button>
          <Button size="sm" variant="quiet" icon="rotate-cw" label="Turn the stage 15° right (Shift: 90°)" disabled={!p.editing} onClick={(e: MouseEvent) => setTurn(turn + (e.shiftKey ? 90 : 15))} />
          <span className="fl-st__sep" />
          <Button size="sm" variant="quiet" icon="minus" label="Zoom out (Ctrl + wheel)" onClick={() => zoomAt(view.z / 1.25)} />
          <button type="button" className="fl-st__now" title="Fit the stage into the view" onClick={() => setView({ z: 1, x: 0, y: 0 })}>{Math.round(view.z * 100)} %</button>
          <Button size="sm" variant="quiet" icon="plus" label="Zoom in (Ctrl + wheel)" onClick={() => zoomAt(view.z * 1.25)} />
        </div>
      </div>
    </div>
  );
}

/** The panel "Place a light": the flow's light tracks, dragged onto the paper or placed in its middle. */
export function PlacePalette({ flow, stage, editing, onPlace, onLocate }: { flow: Flow; stage: FlowStage; editing: boolean; onPlace: (track: string, at?: P) => void; onLocate: (track: string) => void }) {
  const lights = flow.tracks.filter(isLight), cams = flow.tracks.filter((t) => !isLight(t));
  const drag = (e: PointerEvent, tr: FlowTrack) => {
    if (e.button > 0 || !editing || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const ghost = document.createElement("div");
    ghost.className = "fl-ghost"; ghost.textContent = tr.name; document.body.appendChild(ghost);
    const mv = (ev: PointerEvent) => { ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; };
    const end = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", end); ghost.remove();
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(".fl-paper");
      if (!el) return;
      const q = paperAt(el, ev.clientX, ev.clientY);
      onPlace(tr.id, [clamp01(q[0]), clamp01(q[1])]);
    };
    mv(e); document.addEventListener("pointermove", mv); document.addEventListener("pointerup", end);
  };
  return (
    <ul className="fl-pal">
      {lights.map((tr) => {
        const pl = stage.lights.find((l) => l.track === tr.id), on = !!pl, m = modelOf(tr.model);
        return (
          <li key={tr.id} className={cx(on ? "is-placed" : editing && "can-drag")} onPointerDown={on ? undefined : (e) => drag(e, tr)} title={on || !editing ? undefined : "Drag onto the stage"}
            style={tr.color !== undefined ? { "--track-c": `var(--cat-${tr.color + 1})` } : undefined}>
            <span className="fl-pal__dot" /><MiniWidget tr={tr} mount={pl?.mount} />
            <span className="fl-pal__txt"><b>{tr.name}</b><small>{on ? `On ${stage.name}` : `${m ? `${m.brand} ${m.model}` : tr.model}${editing ? " · drag onto the stage" : ""}`}</small></span>
            {on ? <Button size="sm" variant="quiet" icon="crosshair" label="Show it on the stage" onClick={() => onLocate(tr.id)} /> : <Button size="sm" disabled={!editing} onClick={() => onPlace(tr.id)}>Place</Button>}
          </li>
        );
      })}
      {cams.map((tr) => <li key={tr.id} className="is-cam"><span className="fl-pal__dot" /><Icon name="video" size={18} /><span className="fl-pal__txt"><b>{tr.name}</b><small>Camera tracks don’t go on the stage</small></span></li>)}
      {!lights.length && !cams.length && <li className="fl-note">Add a light track: each light track can go on the stage once, with or without a device.</li>}
    </ul>
  );
}

const MOUNTS: { value: StageMount; label: string; title: string }[] = [
  { value: "aimed", label: "Aimed", title: "On a stand or a wall, pointing across the floor" },
  { value: "ceiling", label: "Top-down", title: "Pointing straight down (from a ceiling, a boom or a stand): a pool of light" },
];

/** The chosen widget: its track, how it hangs and where it points, what it shows at the playhead. */
export function LightInspect({ flow, stage, track, t, editing, onLight, onShowTrack, onRemove }: { flow: Flow; stage: FlowStage; track: string; t: number; editing: boolean; onLight: (fn: (l: StageLight) => StageLight) => void; onShowTrack: () => void; onRemove: () => void }) {
  const tr = flow.tracks.find((x) => x.id === track), l = stage.lights.find((x) => x.track === track);
  if (!tr || !l) return null;
  const s = widgetState(tr, t), m = modelOf(tr.model), ceiling = isCeiling(l);
  const turn = (rot: number) => onLight((x) => ({ ...x, rot }));
  return (
    <div className="fl-inspect" style={tr.color !== undefined ? { "--track-c": `var(--cat-${tr.color + 1})` } : undefined}>
      <h3 className="fl-chosen__title"><i />{tr.name}</h3>
      <dl className="fl-kv">
        <dt>Stage</dt><dd>{stage.name}</dd>
        <dt>Model</dt><dd>{m ? `${m.brand} ${m.model}` : tr.model}</dd>
        <dt>Device</dt><dd>{tr.device ? "Assigned" : "None: the stage plays it anyway"}</dd>
        <dt>Mounted</dt><dd><Segmented label="Mounted" value={ceiling ? "ceiling" : "aimed"} disabled={!editing} options={MOUNTS} onChange={(v) => onLight((x) => setMount(x, v as StageMount))} /></dd>
        {!ceiling && <><dt>Beam</dt><dd><span className="hw-row fl-beam">
          <Slider aria-label="Beam angle" value={l.angle ?? beamAngleOf(widgetShape(tr.model))} min={BEAM_MIN} max={BEAM_MAX} step={5} disabled={!editing} onChange={(v: number) => onLight((x) => ({ ...x, angle: Math.round(v) }))} />
          <b className="fl-num">{l.angle ?? beamAngleOf(widgetShape(tr.model))}°</b>
          {editing && l.angle !== undefined && <Button size="sm" variant="quiet" title="The beam as this model draws it" onClick={() => onLight(({ angle: _a, ...x }) => x)}>As the light</Button>}
        </span></dd></>}
        {!ceiling && <><dt>Turned</dt><dd>{editing ? <span className="hw-row"><Button size="sm" variant="quiet" icon="rotate" label="Turn left 15°" onClick={() => turn((l.rot + 345) % 360)} /><b className="fl-num">{l.rot}°</b><Button size="sm" variant="quiet" icon="rotate-cw" label="Turn right 15°" onClick={() => turn((l.rot + 15) % 360)} /></span> : `${l.rot}°`}</dd></>}
      </dl>
      <small className="fl-note">At the playhead, {fmtClock(t)}</small>
      <dl className="fl-kv">
        <dt>Power</dt><dd>{s.muted ? "Muted" : s.line === "off" ? "Off" : "On"}</dd>
        <dt>Intensity</dt><dd>{Math.round(s.level * 100)} %</dd>
        <dt>Light</dt><dd><span className="fl-kv__sw" style={{ background: s.colour ?? "transparent" }} />{s.tint ?? "Not set"}</dd>
        <dt>Effect</dt><dd>{s.effect ? `${s.effect.name} (on the stage: ${s.effect.family})` : "None"}</dd>
      </dl>
      <div className="hw-row">
        <Button size="sm" variant="quiet" icon="timeline" onClick={onShowTrack}>Show track</Button>
        {editing && <Button size="sm" variant="quiet" icon="close" onClick={onRemove}>Remove from this stage</Button>}
      </div>
    </div>
  );
}

/** A chosen drawn object: its colour (the bar's swatches), its text, Delete. */
export function ObjectInspect({ stage, id, editing, onChange, onDelete }: { stage: FlowStage; id: string; editing: boolean; onChange: (fn: (o: Obj) => Obj) => void; onDelete: () => void }) {
  const raw = stage.objects.find((o) => o.id === id);
  if (!raw) return null;
  const o = toEdit(raw);
  return (
    <div className="fl-inspect">
      <h3 className="fl-chosen__title"><Icon name={o.kind === "stencil" && o.icon ? (o.icon as IconName) : KIND[o.kind].icon} size={16} />{KIND[o.kind].label}</h3>
      <span className="fl-st__swatches" role="radiogroup" aria-label="Colour">
        {STAGE_DRAW_COLOURS.map((c) => <button key={c} type="button" role="radio" aria-checked={o.stroke === c} aria-label={`Colour ${c}`} disabled={!editing} className={cx("fl-st__swatch", o.stroke === c && "is-on")} style={{ background: c }} onClick={() => onChange((x) => ({ ...x, stroke: c }))} />)}
      </span>
      {o.kind === "text" && <label className="hw-ctl"><small>Text</small><Draft value={o.text ?? ""} commit={(v) => { if (v.trim()) onChange((x) => ({ ...x, text: v })); }}>{(d) => <TextInput size="sm" disabled={!editing} maxLength={200} {...d} />}</Draft></label>}
      {o.kind === "stencil" && editing && <Popover trigger={<Button size="sm" icon={(o.icon ?? "camera") as IconName}>Change</Button>}><div className="cv-stencils">{STENCILS.map((s) => <button type="button" key={s} title={s} className={cx(o.icon === s && "is-on")} onClick={() => onChange((x) => ({ ...x, icon: s, name: `Stencil: ${s}` }))}><Icon name={s} size={20} /></button>)}</div></Popover>}
      {(o.kind === "text" || o.kind === "stencil") && editing && <label className="hw-ctl hw-ctl--range"><small>Size</small><Slider value={o.h} min={0.02} max={0.4} step={0.01} onChange={(v: number) => onChange((x) => { const k = v / x.h; return { ...x, w: x.w * k, h: v }; })} aria-label="Size" /></label>}
      {editing && <div className="hw-row"><Button size="sm" variant="danger" icon="trash" onClick={onDelete}>Delete</Button></div>}
      <p className="fl-note">Drawn with the canvas’s tools, kept in the flow.</p>
    </div>
  );
}

/**
 * The paper's size in squares (#426): more paper is more room around the same drawing, which keeps its size and its
 * place among the rest; where the old paper sits in the new one says on which sides the room is added or taken.
 */
export function PaperDialog({ stage, close, onApply }: { stage: FlowStage; close: () => void; onApply: (cols: number, rows: number, anchor: [number, number]) => void }) {
  const [w0, h0] = stageSize(stage);
  const [w, setW] = useState(w0), [h, setH] = useState(Math.round(h0));
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const wrong = !Number.isInteger(w) || !Number.isInteger(h) || w < STAGE_SIDE_MIN || h < STAGE_SIDE_MIN || w > STAGE_SIDE_MAX || h > STAGE_SIDE_MAX ? `Each side is ${STAGE_SIDE_MIN} to ${STAGE_SIDE_MAX} squares`
    : w / h > 4 || h / w > 4 ? "At most four times as long as wide" : null;
  const smaller = w < w0 || h < Math.round(h0);
  return (
    <Dialog fixed title="Paper size" onClose={close} footer={<><Button variant="quiet" onClick={close}>Cancel</Button><Button variant="primary" disabled={!!wrong} onClick={() => { onApply(w, h, anchor); close(); }}>Apply</Button></>}>
      <div className="fl-paperdlg">
        <div className="fl-paperdlg__sides">
          <label className="hw-ctl"><small>Width (squares)</small><NumberInput size="sm" value={w} min={STAGE_SIDE_MIN} max={STAGE_SIDE_MAX} step={1} onChange={(v: number) => setW(Math.round(v))} /></label>
          <label className="hw-ctl"><small>Height (squares)</small><NumberInput size="sm" value={h} min={STAGE_SIDE_MIN} max={STAGE_SIDE_MAX} step={1} onChange={(v: number) => setH(Math.round(v))} /></label>
        </div>
        <div className="hw-ctl"><small>The drawing sits</small>
          <span className="fl-paperdlg__anchor" role="radiogroup" aria-label="Where the drawing sits on the new paper">
            {[0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => <button key={`${ax}${ay}`} type="button" role="radio" aria-checked={anchor[0] === ax && anchor[1] === ay} aria-label={`${ay === 0 ? "top" : ay === 1 ? "bottom" : "middle"} ${ax === 0 ? "left" : ax === 1 ? "right" : "centre"}`} className={cx(anchor[0] === ax && anchor[1] === ay && "is-on")} onClick={() => setAnchor([ax, ay])} />))}
          </span>
        </div>
        <p className="fl-note">{wrong ?? `Now ${w0} × ${Math.round(h0)} squares. Everything keeps its size and place; the room is added (or taken) around it.${smaller ? " What a smaller paper no longer holds is cut off; lights move to its edge." : ""}`}</p>
      </div>
    </Dialog>
  );
}

/** Several drawn objects chosen: their colour together, Delete. */
export function ObjectsInspect({ stage, ids, editing, onChange, onDelete }: { stage: FlowStage; ids: string[]; editing: boolean; onChange: (fn: (o: Obj) => Obj) => void; onDelete: () => void }) {
  const os = stage.objects.filter((o) => ids.includes(o.id)).map(toEdit);
  const one = os.every((o) => o.stroke === os[0]?.stroke) ? os[0]?.stroke : undefined;
  return (
    <div className="fl-inspect">
      <h3 className="fl-chosen__title"><Icon name="layers" size={16} />{os.length} drawn objects</h3>
      <span className="fl-st__swatches" role="radiogroup" aria-label="Colour">
        {STAGE_DRAW_COLOURS.map((c) => <button key={c} type="button" role="radio" aria-checked={one === c} aria-label={`Colour ${c}`} disabled={!editing} className={cx("fl-st__swatch", one === c && "is-on")} style={{ background: c }} onClick={() => onChange((x) => ({ ...x, stroke: c }))} />)}
      </span>
      {editing && <div className="hw-row"><Button size="sm" variant="danger" icon="trash" onClick={onDelete}>Delete {os.length}</Button></div>}
      <p className="fl-note">Drag one of them to move them all, Alt to drag copies. Shift-click adds or takes one out; a box drawn from empty paper chooses what it touches.</p>
    </div>
  );
}

/** A light placed on the paper: where it was dropped (or the middle), facing into the stage. */
export function placeLight(s: FlowStage, track: string, at?: P): FlowStage {
  if (s.lights.some((l) => l.track === track)) return s;
  const [x, y] = at ?? [0.5, 0.5];
  return { ...s, lights: [...s.lights, { track, x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), rot: x > 0.6 ? 180 : 0 }] };
}
