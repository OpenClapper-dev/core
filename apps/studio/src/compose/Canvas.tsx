/**
 * SVG rendering of a drawing in screen pixels. Used by the editor (with a selection outline) and
 * by read-only previews. `render.ts` draws the same shapes on a 2D canvas for the flattened file.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import type { MaskStroke, Shape } from "@openclapper/vocab";
import { arrowHead, boundsPx, sizePx, strokePx, toPx, type CanvasRect } from "./geometry";
import { STENCIL_BOX, STENCIL_PATHS, STENCIL_STROKE } from "./stencils";

export const CANVAS_FONT = "'Atkinson Hyperlegible Next', system-ui, sans-serif";

/** SVG path data of a freehand stroke. */
export function pathD(points: readonly (readonly [number, number])[], c: CanvasRect): string {
  return points.map((p, i) => { const [x, y] = toPx(p as [number, number], c); return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ");
}

/** Arrow head polygon points (px) at the end of a → b. */
export function arrowPoints(ax: number, ay: number, bx: number, by: number, strokeW: number): [number, number][] {
  const len = arrowHead(strokeW);
  const ang = Math.atan2(by - ay, bx - ax);
  const spread = 0.46;
  return [[bx, by], [bx - len * Math.cos(ang - spread), by - len * Math.sin(ang - spread)], [bx - len * Math.cos(ang + spread), by - len * Math.sin(ang + spread)]];
}

/** A shape, with its mask (issue #46) when it has one; `uid` keeps mask ids unique per <svg> on the page. */
export function ShapeSvg({ s, c, uid }: { s: Shape; c: CanvasRect; uid: string }) {
  if (!s.mask?.length) return <ShapeBody s={s} c={c} />;
  const id = `m${uid}-${s.id}`;
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width="100%" height="100%">
        <rect x={-1e4} y={-1e4} width={2e4} height={2e4} fill="#fff" />
        {s.mask.map((m, i) => <MaskStrokeSvg key={i} m={m} c={c} />)}
      </mask>
      <g mask={`url(#${id})`}><ShapeBody s={s} c={c} /></g>
    </>
  );
}

function MaskStrokeSvg({ m, c }: { m: MaskStroke; c: CanvasRect }) {
  const w = strokePx(m.width, c);
  if (m.points.length === 1) { const [x, y] = toPx(m.points[0], c); return <circle cx={x} cy={y} r={w / 2} fill="#000" />; }
  return <path d={pathD(m.points, c)} stroke="#000" stroke-width={w} fill="none" stroke-linecap="round" stroke-linejoin="round" />;
}

/** Where a selected stencil's handles sit (px): the corner that resizes, the knob above that rotates. */
export function stencilHandles(s: Extract<Shape, { type: "stencil" }>, c: CanvasRect): { centre: [number, number]; corner: [number, number]; knob: [number, number] } {
  const [x, y] = toPx(s.at, c);
  const half = sizePx(s.size, c) / 2;
  const a = (s.rotation * Math.PI) / 180;
  const rot = (dx: number, dy: number): [number, number] => [x + dx * Math.cos(a) - dy * Math.sin(a), y + dx * Math.sin(a) + dy * Math.cos(a)];
  return { centre: [x, y], corner: rot(half, half), knob: rot(0, -half - 22) };
}

function ShapeBody({ s, c }: { s: Shape; c: CanvasRect }) {
  const sw = strokePx(s.width, c);
  const common = { stroke: s.color, "stroke-width": sw, fill: "none", opacity: s.opacity, "stroke-linecap": "round" as const, "stroke-linejoin": "round" as const };
  switch (s.type) {
    case "path": {
      if (s.points.length === 1) { const [x, y] = toPx(s.points[0], c); return <circle cx={x} cy={y} r={sw / 2} fill={s.color} opacity={s.opacity} />; }
      return <path d={pathD(s.points, c)} {...common} />;
    }
    case "line": { const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c); return <line x1={ax} y1={ay} x2={bx} y2={by} {...common} />; }
    case "arrow": {
      const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
      const head = arrowPoints(ax, ay, bx, by, sw);
      // The shaft stops short of the tip so the head's point stays sharp.
      const len = arrowHead(sw) * 0.6, ang = Math.atan2(by - ay, bx - ax);
      return (
        <g opacity={s.opacity}>
          <line x1={ax} y1={ay} x2={bx - len * Math.cos(ang)} y2={by - len * Math.sin(ang)} {...common} opacity={1} />
          <polygon points={head.map((p) => p.join(",")).join(" ")} fill={s.color} stroke={s.color} stroke-width={sw / 2} stroke-linejoin="round" />
        </g>
      );
    }
    case "rect": {
      const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
      return <rect x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} {...common} fill={s.fill ? s.color : "none"} />;
    }
    case "ellipse": {
      const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
      return <ellipse cx={(ax + bx) / 2} cy={(ay + by) / 2} rx={Math.abs(bx - ax) / 2} ry={Math.abs(by - ay) / 2} {...common} fill={s.fill ? s.color : "none"} />;
    }
    case "text": {
      const [x, y] = toPx(s.at, c);
      const px = sizePx(s.size, c);
      return <text x={x} y={y} fill={s.color} opacity={s.opacity} font-family={CANVAS_FONT} font-weight="700" font-size={px} paint-order="stroke" stroke={s.color === "#0B0B0C" ? "#FFFFFF" : "#0B0B0C"} stroke-width={px * 0.08} stroke-linejoin="round">{s.text}</text>;
    }
    case "stencil": {
      const [x, y] = toPx(s.at, c);
      const k = sizePx(s.size, c) / STENCIL_BOX;
      return (
        <g transform={`translate(${x} ${y}) rotate(${s.rotation}) scale(${k}) translate(${-STENCIL_BOX / 2} ${-STENCIL_BOX / 2})`} opacity={s.opacity}>
          <path d={STENCIL_PATHS[s.stencil]} fill="none" stroke={s.color} stroke-width={STENCIL_STROKE} stroke-linecap="round" stroke-linejoin="round" />
        </g>
      );
    }
  }
}

/** All shapes of a drawing; `selected` gets a dashed outline. The <svg> itself is positioned by the caller. */
export function DrawingSvg({ shapes, c, width, height, selected, children, ...rest }: { shapes: readonly Shape[]; c: CanvasRect; width: number; height: number; selected?: string | null; children?: ComponentChildren } & Record<string, unknown>) {
  const uid = useId();
  const sel = selected ? shapes.find((s) => s.id === selected) : null;
  const b = sel && sel.type !== "stencil" ? boundsPx(sel, c) : null;
  const h = sel?.type === "stencil" ? stencilHandles(sel, c) : null;
  const half = sel?.type === "stencil" ? sizePx(sel.size, c) / 2 : 0;
  return (
    <svg class="compose__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...rest}>
      {shapes.map((s) => <ShapeSvg key={s.id} s={s} c={c} uid={uid} />)}
      {b && <rect class="compose__sel" x={b.x} y={b.y} width={b.w} height={b.h} />}
      {h && sel?.type === "stencil" && (
        <g>
          <rect class="compose__sel" x={-half} y={-half} width={half * 2} height={half * 2} transform={`translate(${h.centre[0]} ${h.centre[1]}) rotate(${sel.rotation})`} />
          <line class="compose__sel" x1={h.centre[0]} y1={h.centre[1]} x2={h.knob[0]} y2={h.knob[1]} />
          <circle class="compose__handle" cx={h.knob[0]} cy={h.knob[1]} r={6}><title>Drag to rotate (Shift: 15° steps)</title></circle>
          <rect class="compose__handle" x={h.corner[0] - 5} y={h.corner[1] - 5} width={10} height={10}><title>Drag to resize</title></rect>
        </g>
      )}
      {children}
    </svg>
  );
}
