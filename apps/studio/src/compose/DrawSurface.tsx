/**
 * The interactive drawing surface: a measured box with a background (the framed photo with its
 * look, or the white sketch canvas) and the SVG drawing on top. Pointer events turn the current
 * tool into shapes in canvas fractions; the parent owns the shape list and the history.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { moveShape, simplifyPoints, type MaskStroke, type Point, type Shape, type Stencil } from "@fielder/vocab";
import { DrawingSvg, stencilHandles } from "./Canvas";
import { shapeAt, sizePx, toFrac, toPx, type CanvasRect } from "./geometry";
import { shortcut } from "../shortcuts";

export type Tool = "select" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "stencil" | "eraser";
/** The tools in toolbar order; their keys come from the shortcut registry (scope "draw", action = tool id). */
export const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = ([
  { id: "select", icon: "cursor-default-outline", label: "Select / move" },
  { id: "pen", icon: "pencil-outline", label: "Freehand" },
  { id: "line", icon: "vector-line", label: "Line" },
  { id: "arrow", icon: "arrow-top-right", label: "Arrow" },
  { id: "rect", icon: "rectangle-outline", label: "Rectangle" },
  { id: "ellipse", icon: "ellipse-outline", label: "Ellipse" },
  { id: "text", icon: "format-text", label: "Text" },
  { id: "stencil", icon: "shape-outline", label: "Stencil" },
  { id: "eraser", icon: "eraser", label: "Eraser" },
] as const).map((t) => ({ ...t, key: (shortcut("draw", t.id)?.keys[0] ?? "").toUpperCase() }));

/** Defaults for new shapes. */
export interface Style { color: string; width: number; opacity: number; fill: boolean; stencil: Stencil; textSize: number; stencilSize: number }
export const WIDTHS: { id: string; w: number; label: string }[] = [{ id: "s", w: 0.003, label: "S" }, { id: "m", w: 0.006, label: "M" }, { id: "l", w: 0.012, label: "L" }];
export const defaultStyle = (sketch: boolean): Style => ({ color: sketch ? "#0B0B0C" : "#FFD60A", width: 0.006, opacity: 1, fill: false, stencil: "light", textSize: 0.05, stencilSize: 0.12 });

let seq = 0;
export const shapeId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface TextEdit { id: string | null; at: Point; value: string }

interface Props {
  shapes: Shape[];
  /** Live update while dragging (not in history). */
  onPreview: (shapes: Shape[]) => void;
  /** A finished change (history entry). */
  onCommit: (shapes: Shape[]) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tool: Tool;
  style: Style;
  /** The canvas rect for a surface of this size (the photo inside its frame layout, or the whole box). */
  canvasOf: (w: number, h: number) => CanvasRect;
  /** Surface aspect ratio (w/h) and the max height it may take. */
  aspect: number;
  maxHeight: string;
  /** Background: the framed photo (needs the measured size for the blur), or nothing for a white sketch box. */
  background: (size: { w: number; h: number }, c: CanvasRect) => ComponentChildren;
  sketch: boolean;
  textEdit: TextEdit | null;
  onTextEdit: (t: TextEdit | null) => void;
  /** Add or update a text shape from the text box. */
  onTextDone: (t: TextEdit) => void;
  /** Painting away parts of this shape (issue #46): drags add mask strokes to it instead of drawing. */
  mask?: { id: string; width: number } | null;
}

type Drag =
  | { kind: "draw"; shape: Shape } | { kind: "move"; id: string; last: Point; moved: boolean } | { kind: "erase" } | { kind: "pan-none" }
  | { kind: "mask"; id: string; stroke: MaskStroke }
  | { kind: "rotate"; id: string; centre: [number, number]; changed: boolean }
  | { kind: "resize"; id: string; centre: [number, number]; d0: number; size0: number; changed: boolean };

export function DrawSurface(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<Drag | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height })); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (p.textEdit) { textRef.current?.focus(); textRef.current?.select(); } }, [p.textEdit?.id, p.textEdit?.at[0], p.textEdit?.at[1]]);

  const c = p.canvasOf(size.w, size.h);
  const pos = (e: PointerEvent): [number, number] => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const cursor = p.mask ? "cell" : p.tool === "select" ? "default" : p.tool === "eraser" ? "cell" : p.tool === "text" ? "text" : "crosshair";
  const withMask = (id: string, stroke: MaskStroke) => p.shapes.map((s) => (s.id === id ? { ...s, mask: [...(s.mask ?? []), stroke] } : s));

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || size.w === 0) return;
    if (p.textEdit) { p.onTextDone(p.textEdit); }
    const [x, y] = pos(e);
    const f = toFrac(x, y, c);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const st = p.style;
    if (p.mask) {
      const target = p.shapes.find((s) => s.id === p.mask!.id);
      if (!target) return;
      const stroke: MaskStroke = { width: p.mask.width, points: [f] };
      drag.current = { kind: "mask", id: target.id, stroke };
      p.onPreview(withMask(target.id, stroke));
      return;
    }
    switch (p.tool) {
      case "select": {
        // A selected stencil's handles come first: the knob rotates, the corner resizes.
        const sel = p.shapes.find((s) => s.id === p.selected);
        if (sel?.type === "stencil") {
          const h = stencilHandles(sel, c);
          const near = (q: [number, number]) => Math.hypot(q[0] - x, q[1] - y) <= 9;
          if (near(h.knob)) { drag.current = { kind: "rotate", id: sel.id, centre: h.centre, changed: false }; return; }
          if (near(h.corner)) { drag.current = { kind: "resize", id: sel.id, centre: h.centre, d0: Math.max(1, Math.hypot(h.corner[0] - h.centre[0], h.corner[1] - h.centre[1])), size0: sel.size, changed: false }; return; }
        }
        const hit = shapeAt(p.shapes, x, y, c);
        p.onSelect(hit?.id ?? null);
        drag.current = hit ? { kind: "move", id: hit.id, last: f, moved: false } : { kind: "pan-none" };
        return;
      }
      case "eraser": {
        drag.current = { kind: "erase" };
        const hit = shapeAt(p.shapes, x, y, c);
        if (hit) p.onCommit(p.shapes.filter((s) => s.id !== hit.id));
        return;
      }
      case "text": {
        const hit = shapeAt(p.shapes, x, y, c);
        if (hit?.type === "text") p.onTextEdit({ id: hit.id, at: hit.at, value: hit.text });
        else p.onTextEdit({ id: null, at: f, value: "" });
        drag.current = null;
        return;
      }
      case "stencil": {
        const s: Shape = { id: shapeId(), type: "stencil", at: f, stencil: st.stencil, size: st.stencilSize, rotation: 0, color: st.color, width: 0.004, opacity: st.opacity };
        p.onCommit([...p.shapes, s]);
        p.onSelect(s.id);
        drag.current = null;
        return;
      }
      case "pen": {
        const s: Shape = { id: shapeId(), type: "path", points: [f], color: st.color, width: st.width, opacity: st.opacity };
        drag.current = { kind: "draw", shape: s };
        p.onPreview([...p.shapes, s]);
        return;
      }
      default: {
        const s: Shape = { id: shapeId(), type: p.tool, from: f, to: f, color: st.color, width: st.width, opacity: st.opacity, ...(p.tool === "rect" || p.tool === "ellipse" ? { fill: st.fill } : {}) };
        drag.current = { kind: "draw", shape: s };
        p.onPreview([...p.shapes, s]);
      }
    }
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = pos(e);
    const f = toFrac(x, y, c);
    if (d.kind === "draw") {
      const s = d.shape;
      const next: Shape = s.type === "path" ? { ...s, points: [...s.points, f] } : s.type === "text" || s.type === "stencil" ? s : { ...s, to: e.shiftKey ? square(s.from, f, s.type === "line" || s.type === "arrow") : f };
      d.shape = next;
      p.onPreview([...p.shapes.filter((x) => x.id !== s.id), next]);
    } else if (d.kind === "mask") {
      d.stroke = { ...d.stroke, points: [...d.stroke.points, f] };
      p.onPreview(p.shapes.map((s) => (s.id === d.id ? { ...s, mask: [...(s.mask ?? []).slice(0, -1), d.stroke] } : s)));
    } else if (d.kind === "rotate") {
      let deg = (Math.atan2(y - d.centre[1], x - d.centre[0]) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      d.changed = true;
      p.onPreview(p.shapes.map((s) => (s.id === d.id && s.type === "stencil" ? { ...s, rotation: Math.round(deg) } : s)));
    } else if (d.kind === "resize") {
      const size = Math.min(1, Math.max(0.01, (d.size0 * Math.hypot(x - d.centre[0], y - d.centre[1])) / d.d0));
      d.changed = true;
      p.onPreview(p.shapes.map((s) => (s.id === d.id && s.type === "stencil" ? { ...s, size } : s)));
    } else if (d.kind === "move") {
      const dx = f[0] - d.last[0], dy = f[1] - d.last[1];
      if (!d.moved && Math.hypot(dx * c.w, dy * c.h) < 2) return;
      d.moved = true;
      d.last = f;
      p.onPreview(p.shapes.map((s) => (s.id === d.id ? moveShape(s, dx, dy) : s)));
    } else if (d.kind === "erase") {
      const hit = shapeAt(p.shapes, x, y, c);
      if (hit) p.onCommit(p.shapes.filter((s) => s.id !== hit.id));
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "draw") {
      const s = d.shape;
      if (s.type === "path") { const pts = simplifyPoints(s.points); p.onCommit([...p.shapes.filter((x) => x.id !== s.id), { ...s, points: pts }]); p.onSelect(s.id); return; }
      if (s.type !== "text" && s.type !== "stencil") {
        const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
        if (Math.hypot(bx - ax, by - ay) < 4) { p.onPreview(p.shapes.filter((x) => x.id !== s.id)); return; }
        p.onCommit(p.shapes);
        p.onSelect(s.id);
      }
    } else if (d.kind === "mask") {
      p.onCommit(p.shapes.map((s) => (s.id === d.id ? { ...s, mask: [...(s.mask ?? []).slice(0, -1), { ...d.stroke, points: simplifyPoints(d.stroke.points) }] } : s)));
    } else if ((d.kind === "move" && d.moved) || ((d.kind === "rotate" || d.kind === "resize") && d.changed)) {
      p.onCommit(p.shapes);
    }
  };

  const te = p.textEdit;
  const tePx = te ? toPx(te.at, c) : null;
  const teSize = te ? sizePx(p.style.textSize, c) : 0;
  return (
    <div ref={box} class={`compose__surface ${p.sketch ? "compose__surface--sketch" : ""}`} style={{ aspectRatio: String(p.aspect), width: `min(100%, calc(${p.maxHeight} * ${p.aspect}))` }}>
      {size.w > 0 && p.background(size, c)}
      {size.w > 0 && (
        <DrawingSvg shapes={p.shapes} c={c} width={size.w} height={size.h} selected={p.tool === "select" && !p.mask ? p.selected : null} style={{ cursor }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onDblClick={(e: MouseEvent) => { if (p.tool !== "select") return; const [x, y] = pos(e as PointerEvent); const hit = shapeAt(p.shapes, x, y, c); if (hit?.type === "text") p.onTextEdit({ id: hit.id, at: hit.at, value: hit.text }); }} />
      )}
      {te && tePx && (
        <input ref={textRef} class="compose__textbox" value={te.value} placeholder="Type, then Enter" aria-label="Text"
          style={{ left: `${tePx[0]}px`, top: `${tePx[1] - teSize}px`, fontSize: `${teSize}px`, color: p.style.color }}
          onInput={(e) => p.onTextEdit({ ...te, value: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); p.onTextDone(te); } if (e.key === "Escape") { e.stopPropagation(); p.onTextEdit(null); } }}
          onBlur={() => { if (p.textEdit) p.onTextDone(p.textEdit); }} />
      )}
    </div>
  );
}

/** Shift: a square / circle, or a line snapped to 45°. */
function square(from: Point, to: Point, line: boolean): Point {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  if (line) {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [from[0] + len * Math.cos(ang), from[1] + len * Math.sin(ang)];
  }
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return [from[0] + Math.sign(dx || 1) * d, from[1] + Math.sign(dy || 1) * d];
}

