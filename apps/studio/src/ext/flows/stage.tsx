// A flow's stages in the Studio (docs/features/flows.md, "The stage"; #426 feedback round 8): above the lanes, the stage
// shown (one of the flow's perspectives, picked in its bar), a drawing on dark paper made with the canvas's tools (canvas/objects.tsx), and a widget per placed light track showing what
// the track plays at the playhead. Everything a widget shows and how it is shaped comes from @openclapper/ext-flows,
// so the phone's Stage view shows the same.
import "../../canvas/canvas.css";
import "./stage.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, cx, Icon, Popover, Segmented, Slider, TextInput, type IconName } from "@openclapper/design";
import type { ComponentChildren } from "preact";
import { modelOf } from "@openclapper/ext-hardware";
import {
  beamOpacity, beamPath, ceilingShape, effectOpacity, fmtClock, glowRadius, isCeiling, poolRadius, setMount, STAGE_DRAW_COLOURS, STAGE_INK, STAGE_TRACK_COLOURS, STAGE_W, tagAt, tagWidth, widgetShape, widgetState,
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
export type StageSel = { kind: "light"; track: string } | { kind: "obj"; id: string } | null;
export interface StagePhoto { id: string; name: string; thumb: string; src: string }
export interface StageDrawing { tool: StageTool; colour: string; stencil: IconName }

const isLight = (t: FlowTrack) => modelOf(t.model)?.type === "light";
const trackInk = (t: FlowTrack | undefined) => (t?.color !== undefined ? STAGE_TRACK_COLOURS[t.color] : STAGE_INK.rim);
const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));


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

interface WidgetsProps { flow: Flow; stage: FlowStage; t: number; sel: StageSel; marked: string | null; flash: string | null; editing: boolean; onGrab: (e: PointerEvent, l: StageLight, how: "move" | "turn") => void }

/**
 * The widgets: beams (an aimed light's wedge, a ceiling light's pool) under bodies under tags, each sampled at the
 * playhead; the chosen one with a ring and, when aimed, a handle to turn it.
 */
function Widgets({ flow, stage, t, sel, marked, flash, editing, onGrab }: WidgetsProps) {
  const H = STAGE_W / stage.aspect;
  const placed = stage.lights.map((l) => ({ l, tr: flow.tracks.find((x) => x.id === l.track) })).filter((x): x is { l: StageLight; tr: FlowTrack } => !!x.tr);
  const states = placed.map(({ tr }) => widgetState(tr, t));
  const now = useFrames(states.some((s) => s.effect));
  const at = (l: StageLight) => [l.x * STAGE_W, l.y * H] as const;
  const ring = sel?.kind === "light" ? sel.track : marked;
  return (
    <svg className="fl-widgets" viewBox={`0 0 ${STAGE_W} ${H}`} preserveAspectRatio="none">
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
            <path d={beamPath(g, s.level)} fill={`url(#${id}b)`} />
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
      <g>{placed.map(({ l, tr }, i) => {
        const s = states[i], w = tagWidth(tr.name, s.line), [tx, ty] = tagAt(l, stage.aspect, w), ink = trackInk(tr);
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
  | { type: "obj"; id: string; start: P; orig: Obj; moved: boolean }
  | { type: "draw"; tool: "pen" | "line" | "arrow" | "rect" | "ellipse"; pts: P[] }
  | { type: "erase" }
  /** A corner of the chosen object dragged (#426): the opposite corner stays. */
  | { type: "resize"; id: string; fixed: P }
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
  const objs = stage.objects.map(toEdit);
  const setTool = (t: StageTool) => p.onDrawing({ ...p.drawing, tool: t });
  const lights = p.flow.tracks.filter(isLight);
  const underlay = stage.underlay ? p.photos.find((x) => x.id === stage.underlay!.photo) : undefined;
  useEffect(() => { if (!p.editing) { setDraft(null); setTyping(null); act.current = null; } }, [p.editing]);

  const at = (e: PointerEvent): P => { const r = paper.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const capture = (e: PointerEvent) => { try { paper.current?.setPointerCapture(e.pointerId); } catch { /* no pointer */ } };
  const setObjs = (fn: (os: Obj[]) => Obj[]) => p.onChange((s) => ({ ...s, objects: fn(s.objects.map(toEdit)).map(toStore) }));
  const setLight = (track: string, fn: (l: StageLight) => StageLight) => p.onChange((s) => ({ ...s, lights: s.lights.map((l) => (l.track === track ? fn(l) : l)) }));

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
    // Alt: drag a copy, as on the canvas; the original stays where it is. (A light is one per track: never copied.)
    const target: Obj = e.altKey ? { ...o, id: uid(), name: `${o.name} copy` } : o;
    if (target !== o) setObjs((os) => [...os, target]);
    p.onSel({ kind: "obj", id: target.id });
    capture(e);
    act.current = { type: "obj", id: target.id, start: at(e), orig: target, moved: false };
  };
  const rub = (q: P) => {
    const h = paper.current!.getBoundingClientRect().height;
    setObjs((os) => eraseAt(os, q, 12 / h, stage.aspect, "partial", uid) as Obj[]);
  };
  const down = (e: PointerEvent) => {
    if (e.button > 0) return;
    if (!p.editing || tool === "select") { p.onSel(null); return; }
    const q = at(e);
    if (tool === "eraser") { capture(e); act.current = { type: "erase" }; rub(q); return; }
    if (tool === "text" || tool === "stencil") {
      // No focus change from this press: the text typed in place keeps it.
      e.preventDefault();
      const size: P = tool === "text" ? [0.22, 0.06] : [0.06, 0.06 * stage.aspect];
      const o: Obj = { id: uid(), kind: tool, name: tool === "text" ? "Text" : `Stencil: ${stencil}`, x: q[0] - size[0] / 2, y: q[1] - size[1] / 2, w: size[0], h: size[1], stroke: colour, width: 3, opacity: 1, visible: true, locked: false, ...(tool === "text" ? { text: "Text" } : { icon: stencil }) };
      setObjs((os) => [...os, o]); setTool("select"); p.onSel({ kind: "obj", id: o.id }); if (tool === "text") setTyping(o.id);
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
      setLight(a.track, (l) => ({ ...l, x: Number(clamp01(a.orig[0] + q[0] - a.start[0]).toFixed(4)), y: Number(clamp01(a.orig[1] + q[1] - a.start[1]).toFixed(4)) }));
    } else if (a.type === "turn") {
      const l = stage.lights.find((x) => x.track === a.track); if (!l) return;
      const deg = (Math.atan2((q[1] - l.y) / stage.aspect, q[0] - l.x) * 180) / Math.PI, step = e.shiftKey ? 1 : 15;
      setLight(a.track, (x) => ({ ...x, rot: ((Math.round(deg / step) * step) % 360 + 360) % 360 }));
    } else if (a.type === "resize") {
      const x = Math.min(a.fixed[0], q[0]), y = Math.min(a.fixed[1], q[1]), w = Math.max(0.01, Math.abs(q[0] - a.fixed[0])), h = Math.max(0.01, Math.abs(q[1] - a.fixed[1]));
      setObjs((os) => os.map((o) => (o.id === a.id ? { ...o, x, y, w, h } : o)));
    } else if (a.type === "end") {
      const ends: [P, P] = a.which === 0 ? [q, a.other] : [a.other, q];
      const x = Math.min(ends[0][0], ends[1][0]), y = Math.min(ends[0][1], ends[1][1]), w = Math.abs(ends[1][0] - ends[0][0]), h = Math.abs(ends[1][1] - ends[0][1]);
      setObjs((os) => os.map((o) => (o.id === a.id ? { ...o, x, y, w: Math.max(w, 0.0005), h: Math.max(h, 0.0005), pts: ends.map((e): P => [w ? (e[0] - x) / w : 0, h ? (e[1] - y) / h : 0]) } : o)));
    } else if (a.type === "obj") {
      if (!a.moved && Math.hypot(q[0] - a.start[0], q[1] - a.start[1]) < 0.003) return;
      a.moved = true;
      const dx = q[0] - a.start[0], dy = q[1] - a.start[1];
      setObjs((os) => os.map((o) => (o.id === a.id ? { ...o, x: a.orig.x + dx, y: a.orig.y + dy } : o)));
    }
  };
  const up = () => {
    const a = act.current; act.current = null;
    if (a?.type !== "draw") return;
    setDraft(null);
    const r = paper.current!.getBoundingClientRect();
    const o = objectFromDraft(a.tool, a.pts, { id: uid(), pen: "pen", stroke: colour, width: 3, minStep: 2.5 / Math.max(r.width, r.height) });
    if (o) { setObjs((os) => [...os, o]); p.onSel({ kind: "obj", id: o.id }); }
  };

  const selObj = p.sel?.kind === "obj" ? objs.find((o) => o.id === (p.sel as { id: string }).id) : undefined;
  // The chosen object's handles, as on the canvas (#426): corners resize it, a line's or an arrow's ends move.
  const handles = !!selObj && p.editing && tool === "select" && typing !== selObj.id;
  const isLine = !!selObj && (selObj.kind === "line" || selObj.kind === "arrow") && !!selObj.pts?.length;
  const endOf = (o: Obj, k: 0 | 1): P => { const q = o.pts![k === 0 ? 0 : o.pts!.length - 1]; return [o.x + q[0] * o.w, o.y + q[1] * o.h]; };
  const grabCorner = (e: PointerEvent, k: number) => {
    if (e.button > 0 || !selObj) return;
    e.stopPropagation(); capture(e);
    act.current = { type: "resize", id: selObj.id, fixed: [k % 2 ? selObj.x : selObj.x + selObj.w, k >= 2 ? selObj.y : selObj.y + selObj.h] };
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
            onClick={() => { p.onDrawing({ ...p.drawing, colour: c }); if (selObj) setObjs((os) => os.map((o) => (o.id === selObj.id ? { ...o, stroke: c } : o))); }} />)}
        </span>
        <span className="fl-st__sep" />
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
      <div className="fl-st__fit">
        <div className={cx("fl-paper", `is-${p.editing ? tool : "view"}`)} ref={paper} style={{ "--aspect": stage.aspect, "--fl-grid": STAGE_INK.grid, background: STAGE_INK.paper }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { act.current = null; setDraft(null); }}>
          <div className="fl-paper__in">
            {stage.underlay && underlay && <img className="fl-paper__under" src={underlay.src} alt="" draggable={false} style={{ opacity: stage.underlay.opacity }} />}
            {objs.filter((o) => o.visible).map((o) => <ObjectView key={o.id} o={o} vh={H} onGrab={p.editing && tool === "select" ? (e) => grabObj(e, o) : undefined}
              editing={typing === o.id} onText={(t) => { setObjs((os) => os.map((x) => (x.id === o.id ? { ...x, text: t } : x))); setTyping(null); }} onEdit={() => { if (p.editing && tool === "select") setTyping(o.id); }} />)}
            {draft && <DraftView d={{ ...draft, pen: "pen", stroke: colour, width: 3 }} vh={H} />}
            {selObj && !(handles && isLine) && <span className="cv-sel" style={{ left: `${selObj.x * 100}%`, top: `${selObj.y * 100}%`, width: `${selObj.w * 100}%`, height: `${selObj.h * 100}%`, transform: selObj.rot ? `rotate(${selObj.rot}deg)` : undefined }}>
              {handles && !isLine && [0, 1, 2, 3].map((k) => <i key={k} className={`cv-handle cv-handle--${k}`} title="Drag to resize" onPointerDown={(e) => grabCorner(e, k)} />)}
            </span>}
            {handles && isLine && ([0, 1] as const).map((k) => { const q = endOf(selObj!, k); return <i key={k} className="cv-node" title="Drag to move this end" style={{ left: `${q[0] * 100}%`, top: `${q[1] * 100}%` }} onPointerDown={(e) => grabEnd(e, k)} />; })}
            <Widgets flow={p.flow} stage={stage} t={p.t} sel={p.sel} marked={p.marked} flash={p.flash} editing={p.editing && tool === "select"} onGrab={grabLight} />
          </div>
          {!stage.lights.length && !stage.objects.length && <span className="fl-paper__hint">{p.editing ? "Draw a plan with the tools above; drag lights here from “Place a light”." : "Nothing on the stage yet."}</span>}
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
      const r = el.getBoundingClientRect();
      onPlace(tr.id, [clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height)]);
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

/** A light placed on the paper: where it was dropped (or the middle), facing into the stage. */
export function placeLight(s: FlowStage, track: string, at?: P): FlowStage {
  if (s.lights.some((l) => l.track === track)) return s;
  const [x, y] = at ?? [0.5, 0.5];
  return { ...s, lights: [...s.lights, { track, x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), rot: x > 0.6 ? 180 : 0 }] };
}
