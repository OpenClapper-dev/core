// Drawing canvas objects on screen (docs/features/canvas.md): one object as the canvas editor shows it, a stroke or
// box being drawn, and the object a finished stroke or box becomes. Shared by the canvas editor and a flow's stage
// (docs/features/flows.md, "The stage"), which draws with the canvas's tools. The surface around them is the
// caller's: an element with `container-type: size` (widths and text sizes are fractions of it, as in the render).
import type { JSX } from "preact";
import { colorCss, cx, Icon, type IconName } from "@openclapper/design";
import { STROKE_UNIT, type Colour, type ObjKind as Kind, type PenType } from "@openclapper/model";
import { lookFilter, PENS, smooth, taper, type Obj, type P } from "./geometry";

export const KIND: Record<Kind, { label: string; icon: IconName }> = {
  pen: { label: "Pen", icon: "pencil" }, line: { label: "Line", icon: "line-tool" }, arrow: { label: "Arrow", icon: "arrow-up-right" }, rect: { label: "Rectangle", icon: "square" }, ellipse: { label: "Ellipse", icon: "circle" },
  text: { label: "Text", icon: "text" }, stencil: { label: "Stencil", icon: "stencil" }, picture: { label: "Picture", icon: "image" }, group: { label: "Group", icon: "group" },
};
export const STENCILS: IconName[] = ["camera", "video", "light-fixture", "bulb", "sun", "moon", "user", "users", "flag", "microphone", "drone", "slate", "practical", "battery", "plug", "antenna", "pin", "building", "trees", "mountain", "wind", "cloud", "umbrella", "star", "lock", "eye"];

const abs = (o: Pick<Obj, "x" | "y" | "w" | "h">, q: P): P => [o.x + q[0] * o.w, o.y + q[1] * o.h];

export interface ObjectViewProps {
  o: Obj;
  /** The surface's height in the units where its width is 1000 (1000 / aspect). */
  vh: number;
  photoSrc?: (id: string) => string;
  /** Pressed on the object (absent: it takes no pointer, as a ghost). */
  onGrab?: (e: PointerEvent) => void;
  /** A text being typed in place: its new text when typing ends (Enter, leaving it; Escape keeps the old). */
  editing?: boolean; onText?: (text: string) => void;
  /** A double click on a text: start typing. */
  onEdit?: () => void;
  /** The surface is this many times as large as the one widths are measured on (a flow stage's larger paper): strokes are drawn that much thinner. */
  scale?: number;
}

/** One object: lines in a layer the size of the surface (so arrowheads and strokes keep their shape), the rest in its box. */
export function ObjectView({ o, vh: vh1, photoSrc, onGrab, editing, onText, onEdit, scale = 1 }: ObjectViewProps) {
  const c = colorCss(o.stroke), common = { "data-obj": o.id, onPointerDown: onGrab }, W = 1000 * scale, vh = vh1 * scale;
  if (o.kind === "pen" || o.kind === "line" || o.kind === "arrow") {
    const q = (o.pts ?? []).map((x): P => { const a = abs(o, x); return [Number((a[0] * W).toFixed(1)), Number((a[1] * vh).toFixed(1))]; });
    const pen = PENS[o.pen ?? "pen"], w = o.width * STROKE_UNIT * (o.kind === "pen" ? pen.scale : 1), d = o.kind === "pen" ? smooth(q) : `M${q.map((x) => x.join(" ")).join(" L")}`;
    return (
      <svg {...common} className="cv-vec" viewBox={`0 0 ${W} ${vh}`} preserveAspectRatio="none" style={{ opacity: o.opacity * (o.kind === "pen" ? pen.opacity : 1), mixBlendMode: o.kind === "pen" && pen.blend ? (pen.blend as "screen") : undefined }}>
        {o.kind === "arrow" && <defs><marker id={`m${o.id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={c} /></marker></defs>}
        <g transform={o.rot ? `rotate(${o.rot} ${(o.x + o.w / 2) * W} ${(o.y + o.h / 2) * vh})` : undefined}>
          {o.kind === "pen" && pen.taper ? <path d={taper(q, w)} fill={c} /> : <path d={d} fill="none" stroke={c} stroke-width={w} stroke-linecap={o.kind === "pen" ? pen.cap : "round"} stroke-linejoin="round" stroke-dasharray={o.kind === "pen" && pen.dash ? pen.dash.join(" ") : undefined} marker-end={o.kind === "arrow" ? `url(#m${o.id})` : undefined} />}
          {onGrab && <path className="cv-vec__hit" d={d} fill="none" stroke="transparent" stroke-width={Math.max(18, w)} />}
        </g>
      </svg>
    );
  }
  const st: JSX.CSSProperties = { left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, opacity: o.opacity, color: c, transform: o.rot ? `rotate(${o.rot}deg)` : undefined, pointerEvents: onGrab ? undefined : "none" };
  // Widths are thousandths of the surface's width, as in the render.
  if (o.kind === "rect" || o.kind === "ellipse") return <div {...common} className={cx("cv-obj", `cv-obj--${o.kind}`)} style={{ ...st, border: `calc(${(o.width * STROKE_UNIT * 0.1) / scale}cqw) solid ${c}`, background: o.fill != null ? colorCss(o.fill) : undefined }} />;
  if (o.kind === "text") return editing
    ? <div key="edit" data-obj={o.id} className="cv-obj cv-obj--text is-editing" style={{ ...st, "--fs": o.h * 78 }} contentEditable spellcheck={false}
        ref={(el) => { if (el && document.activeElement !== el) { el.textContent = o.text ?? ""; el.focus(); const r = document.createRange(); r.selectNodeContents(el); const g = getSelection(); g?.removeAllRanges(); g?.addRange(r); } }}
        onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } else if (e.key === "Escape") { (e.currentTarget as HTMLElement).textContent = o.text ?? ""; (e.currentTarget as HTMLElement).blur(); } }}
        onBlur={(e) => onText?.((e.currentTarget as HTMLElement).innerText.replace(/\n+$/, "") || "Text")} />
    : <div key="view" {...common} className="cv-obj cv-obj--text" style={{ ...st, "--fs": o.h * 78 }} onDblClick={onEdit}>{o.text}</div>;
  if (o.kind === "stencil") return <div {...common} className="cv-obj cv-obj--stencil" style={st}><Icon name={(o.icon ?? "camera") as IconName} size={24} stroke={1.6} /></div>;
  return <div {...common} className="cv-obj cv-obj--picture" style={st}>{o.photo && photoSrc && <img src={photoSrc(o.photo)} alt="" draggable={false} style={{ filter: lookFilter(o.look) }} />}</div>;
}

/** A stroke or box being drawn, with what it is drawn with. */
export interface Draft { tool: string; pts: [number, number][]; pen: PenType; stroke: Colour; width: number }

/** A stroke or box as it is drawn (a comment's region dashed). */
export function DraftView({ d, vh, scale = 1 }: { d: Draft; vh: number; scale?: number }) {
  if (d.tool === "pen" || d.tool === "line" || d.tool === "arrow") return <ObjectView o={{ id: "draft", kind: d.tool, name: "", x: 0, y: 0, w: 1, h: 1, pts: d.pts, pen: d.pen, stroke: d.stroke, width: d.width, opacity: 1, visible: true, locked: false }} vh={vh} scale={scale} />;
  const [a, b] = d.pts;
  if (!a || !b) return null;
  return <div className={cx("cv-obj", d.tool === "comment" ? "cv-region" : `cv-obj--${d.tool}`)} style={{ left: `${Math.min(a[0], b[0]) * 100}%`, top: `${Math.min(a[1], b[1]) * 100}%`, width: `${Math.abs(b[0] - a[0]) * 100}%`, height: `${Math.abs(b[1] - a[1]) * 100}%`, border: d.tool === "comment" ? undefined : `calc(${(d.width * STROKE_UNIT * 0.1) / scale}cqw) solid ${colorCss(d.stroke)}`, pointerEvents: "none" }} />;
}

/**
 * The object a finished stroke or box becomes (null: a pen tap draws nothing). A click without a drag makes a shape
 * of a default size; a pen stroke keeps a point only every `minStep` (fractions of the surface), so a body stays small.
 */
export function objectFromDraft(tool: "pen" | "line" | "arrow" | "rect" | "ellipse", pts: P[], with_: { id: string; pen: PenType; stroke: Colour; width: number; minStep: number }): Obj | null {
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  let x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  if (w < 0.006 && h < 0.006) { if (tool === "pen") return null; w = 0.16; h = tool === "line" || tool === "arrow" ? 0 : 0.12; pts = [[x, y], [x + w, y + h]]; }
  const line = tool === "pen" || tool === "line" || tool === "arrow";
  if (tool === "pen" && pts.length > 2) { const all = pts; pts = all.filter((q, i) => i === 0 || i === all.length - 1 || Math.hypot(q[0] - all[i - 1][0], q[1] - all[i - 1][1]) > with_.minStep); }
  return {
    id: with_.id, kind: tool, name: KIND[tool].label, x, y, w: Math.max(w, 0.001), h: Math.max(h, 0.001),
    ...(line ? { pts: pts.map((q): P => [w ? (q[0] - x) / w : 0, h ? (q[1] - y) / h : 0]) } : {}), ...(tool === "pen" ? { pen: with_.pen } : {}),
    stroke: with_.stroke, width: with_.width, opacity: 1, visible: true, locked: false,
  };
}
