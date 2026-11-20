// UX workshop U2, round 1: the canvas tool. A base photo with frames (from an optics preset, free-form, or an aspect
// ratio), drawn with the real frame math; drawing on top; a look; the edit lock. A prototype on fake data: no server,
// no product code. Specified in docs/rewrite/05-composition.md and 02-optics.md.
import "./u2.css";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Banner, Button, Checkbox, DropdownMenu, EditorLayout, Icon, NumberInput, PropertyList, PropertyRow, PropertySection, Segmented, Select, Slider, StatusBar, TextInput, Toolbar, ToolbarSpacer, ToolRail, cx,
} from "@openclapper/design";
import { picture } from "../u1/pictures";

interface Preset { id: string; name: string; format: [number, number]; mult: number; squeeze: number; delivery?: number; primes?: number[]; zoom?: [number, number] }
const PRESETS: Preset[] = [
  { id: "p6k", name: "Pocket 6K · Sigma 18–35", format: [23.1, 12.99], mult: 1, squeeze: 1, delivery: 2.39, zoom: [18, 35] },
  { id: "ff", name: "Full frame primes", format: [36, 24], mult: 1, squeeze: 1, primes: [24, 35, 50, 85] },
  { id: "ana", name: "Super 35 4-perf · 2× anamorphic", format: [24.89, 18.66], mult: 1, squeeze: 2, delivery: 2.39, primes: [40, 50, 75] },
];
const PRIMES = [12, 14, 16, 18, 20, 21, 24, 25, 27, 28, 32, 35, 40, 50, 65, 75, 85, 90, 100, 135];
const FORMATS: [string, number, number][] = [["Full frame (135)", 36, 24], ["Super 35, 3-perf", 24.89, 14], ["Super 35, 4-perf", 24.89, 18.66], ["Micro Four Thirds", 17.3, 13], ["APS-C", 23.5, 15.6], ["IMAX, 15-perf", 70.41, 52.63]];
const ASPECTS: [string, number][] = [["2.39:1", 2.39], ["1.85:1", 1.85], ["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1]];
const INK = ["#ffffff", "#000000", "#ff2d2d", "#ffb000", "#19c37d", "#2f7df6", "#b46cff", "#00e5ff"];

/** The base photo: 4:3, taken at a 24 mm equivalent. Half-angle tangents follow from the full-frame diagonal (workshop 02). */
const PHOTO = { name: "Photo 0102", seed: 12, eq: 24, aspect: 4 / 3, tanH: 34.616 / (2 * 24), tanV: 25.962 / (2 * 24) };

interface Frame { id: string; name: string; color: number; kind: "preset" | "free" | "aspect"; preset?: string; format: [number, number]; mult: number; squeeze: number; focal: number; delivery?: number; aspect: number; size: number; portrait: boolean; cx: number; cy: number; visible: boolean }
type Shape = { id: string; tool: "pen" | "line" | "arrow" | "rect" | "ellipse"; color: string; pts: [number, number][] };
interface Look { exposure: number; contrast: number; saturation: number }

const frameFrom = (p: Preset, focal: number, n: number): Frame => ({ id: `f${Date.now()}${n}`, name: `${focal} mm`, color: (n % 8) + 1, kind: "preset", preset: p.id, format: p.format, mult: p.mult, squeeze: p.squeeze, focal, delivery: p.delivery, aspect: 2.39, size: 0.8, portrait: false, cx: 0.5, cy: 0.5, visible: true });

/** A frame's rectangle as fractions of the photo: what the optics see against what the photo sees, per axis. */
function rectOf(f: Frame): { w: number; h: number; inner?: { w: number; h: number }; hfov?: number; vfov?: number; ffeq?: number } {
  if (f.kind === "aspect") { const w = f.size, h = (f.size * PHOTO.aspect) / f.aspect; return h > 1 ? { w: w / h, h: 1 } : { w, h }; }
  const eff = f.focal * f.mult;
  let tw = (f.format[0] * f.squeeze) / (2 * eff), th = f.format[1] / (2 * eff);
  if (f.portrait) [tw, th] = [th, tw];
  const w = tw / PHOTO.tanH, h = th / PHOTO.tanV;
  const out = { w, h, hfov: (2 * Math.atan(tw) * 180) / Math.PI, vfov: (2 * Math.atan(th) * 180) / Math.PI, ffeq: 43.27 / (2 * Math.hypot(tw, th)) } as ReturnType<typeof rectOf>;
  if (f.delivery) { const a = (w * PHOTO.aspect) / h; out.inner = f.delivery > a ? { w, h: (h * a) / f.delivery } : { w: (w * f.delivery) / a, h }; }
  return out;
}
const clampCentre = (c: number, size: number) => (size >= 1 ? 0.5 : Math.min(1 - size / 2, Math.max(size / 2, c)));

export default function U2Canvas() {
  const [doc, setDoc] = useState<"photo" | "blank">("photo");
  const [tool, setTool] = useState("select");
  const [frames, setFrames] = useState<Frame[]>(() => [frameFrom(PRESETS[0], 18, 0), frameFrom(PRESETS[0], 24, 1), frameFrom(PRESETS[0], 35, 2)]);
  const [sel, setSel] = useState<string | null>(null);
  const [pic, setPic] = useState<string | null>(null);
  const [mode, setMode] = useState("outline");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [ink, setInk] = useState(INK[2]);
  const [look, setLook] = useState<Look>({ exposure: 0, contrast: 0, saturation: 0 });
  const [layers, setLayers] = useState({ drawing: true, look: true });
  const [locked, setLocked] = useState(false);
  const [theme, setTheme] = useState("dark");
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; cx: number; cy: number } | null>(null);
  const draw = useRef<string | null>(null);

  useEffect(() => { if (!pic && frames.length) setPic(frames[1]?.id ?? frames[0].id); }, []);
  const photo = doc === "photo";
  const cur = frames.find((f) => f.id === sel) ?? null;
  const patch = (id: string, c: Partial<Frame>) => setFrames((fs) => fs.map((f) => { if (f.id !== id) return f; const n = { ...f, ...c }; const r = rectOf(n); return { ...n, cx: clampCentre(n.cx, r.w), cy: clampCentre(n.cy, r.h) }; }));
  const shownFrames = photo ? frames.filter((f) => f.visible) : [];
  // When a frame sees more than the photo, the photo is drawn smaller so the whole frame fits; the rest is hatched.
  const scale = 1 / Math.max(1, ...shownFrames.map((f) => { const r = rectOf(f); return Math.max(r.w, r.h); }));
  const picture_ = photo ? frames.find((f) => f.id === pic && f.visible) : undefined;
  const box = (f: Frame, inner = false) => { const r = rectOf(f), s = inner && r.inner ? r.inner : r; return { left: `${(0.5 + (f.cx - 0.5 - s.w / 2) * scale) * 100}%`, top: `${(0.5 + (f.cy - 0.5 - s.h / 2) * scale) * 100}%`, width: `${s.w * scale * 100}%`, height: `${s.h * scale * 100}%` }; };

  // Stage coordinates (0..1 of the photo) from a pointer event.
  const at = (e: PointerEvent): [number, number] => { const r = stage.current!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width - 0.5) / scale + 0.5, ((e.clientY - r.top) / r.height - 0.5) / scale + 0.5]; };
  const down = (e: PointerEvent) => {
    if (locked || tool === "select") { if (tool === "select") setSel(null); return; }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const id = `s${Date.now()}`; draw.current = id;
    setShapes((s) => [...s, { id, tool: tool as Shape["tool"], color: ink, pts: [at(e), at(e)] }]);
  };
  const move = (e: PointerEvent) => {
    if (drag.current) { const d = drag.current, r = stage.current!.getBoundingClientRect(); patch(d.id, { cx: d.cx + (e.clientX - d.x) / (r.width * scale), cy: d.cy + (e.clientY - d.y) / (r.height * scale) }); return; }
    if (!draw.current) return;
    const p = at(e);
    setShapes((s) => s.map((x) => (x.id !== draw.current ? x : x.tool === "pen" ? { ...x, pts: [...x.pts, p] } : { ...x, pts: [x.pts[0], p] })));
  };
  const up = () => { drag.current = null; draw.current = null; };
  const grab = (e: PointerEvent, f: Frame) => { if (locked || tool !== "select") return; e.stopPropagation(); setSel(f.id); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { id: f.id, x: e.clientX, y: e.clientY, cx: f.cx, cy: f.cy }; };

  const add = (id: string) => {
    const n = frames.length;
    const f: Frame = id === "free" ? { ...frameFrom(PRESETS[1], 35, n), kind: "free", preset: undefined, name: "Free-form" } : id === "aspect" ? { ...frameFrom(PRESETS[1], 35, n), kind: "aspect", preset: undefined, name: "2.39:1", delivery: undefined } : (() => { const p = PRESETS.find((x) => x.id === id)!; return frameFrom(p, p.primes?.[0] ?? p.zoom![0], n); })();
    setFrames([...frames, f]); setSel(f.id); if (!pic) setPic(f.id);
  };
  const preset = cur?.preset ? PRESETS.find((p) => p.id === cur.preset) : undefined;
  const r = cur ? rectOf(cur) : null;
  const filter = layers.look ? `brightness(${Math.pow(2, look.exposure).toFixed(3)}) contrast(${(1 + look.contrast).toFixed(2)}) saturate(${(1 + look.saturation).toFixed(2)})` : undefined;
  const svgPt = (p: [number, number]) => `${(p[0] * 1000).toFixed(1)},${(p[1] * 750).toFixed(1)}`;

  const inspector = (
    <PropertyList>
      <PropertySection title="Surface" icon="image">
        <PropertyRow label="Kind"><Segmented label="Surface" value={doc} onChange={(v) => { setDoc(v as "photo" | "blank"); setSel(null); }} options={[{ value: "photo", label: "Base photo" }, { value: "blank", label: "Blank" }]} /></PropertyRow>
        {photo ? <><PropertyRow label="Photo" value={PHOTO.name} /><PropertyRow label="Angle of view" value="74° × 59°" numeric /><PropertyRow label="From" value="EXIF, 24 mm equivalent" /></> : <PropertyRow label="Format" value="4:3, white" />}
      </PropertySection>
      <PropertySection title={`Frames · ${frames.length}`} icon="frame">
        {!photo ? <p className="u2-note">Frames need a base photo: a frame is what a camera sees of the picture.</p> : (
          <>
            <ul className="u2-frames">
              {frames.map((f) => { const fr = rectOf(f); return (
                <li key={f.id} className={cx(sel === f.id && "is-current")} onClick={() => setSel(f.id)}>
                  <i style={{ background: `var(--cat-${f.color})` }} />
                  <span className="u2-frames__name">{f.name}{f.kind === "preset" && <small>{PRESETS.find((p) => p.id === f.preset)?.name}</small>}{f.kind === "free" && <small>Free-form · {f.format[0]} × {f.format[1]} mm</small>}{f.kind === "aspect" && <small>Aspect ratio</small>}</span>
                  {Math.max(fr.w, fr.h) > 1 && <span title="Sees more than the photo"><Icon name="expand" size={12} /></span>}
                  <Button size="sm" variant="quiet" icon="star" selected={pic === f.id} label={pic === f.id ? "The picture of this canvas" : "Make it the picture"} onClick={(e) => { e.stopPropagation(); setPic(pic === f.id ? null : f.id); }} />
                  <Button size="sm" variant="quiet" icon={f.visible ? "eye" : "eye-off"} label={f.visible ? "Hide" : "Show"} onClick={(e) => { e.stopPropagation(); patch(f.id, { visible: !f.visible }); }} />
                </li>
              ); })}
            </ul>
            <DropdownMenu size="sm" icon="plus" label="Frame" items={[{ heading: "From an optics preset" }, ...PRESETS.map((p) => ({ id: p.id, label: p.name, icon: "lens" as const })), { separator: true }, { id: "free", label: "Free-form values", icon: "sliders" }, { id: "aspect", label: "Aspect ratio only", icon: "aspect" }]} onSelect={add} />
          </>
        )}
      </PropertySection>
      {photo && cur && (
        <PropertySection title={`Frame: ${cur.name}`} icon="sliders">
          <PropertyRow label="Name"><TextInput size="sm" value={cur.name} onInput={(e) => patch(cur.id, { name: (e.target as HTMLInputElement).value })} /></PropertyRow>
          <PropertyRow label="Colour"><span className="u2-dots">{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <button type="button" key={n} aria-label={`Colour ${n}`} className={cx(cur.color === n && "is-on")} style={{ background: `var(--cat-${n})` }} onClick={() => patch(cur.id, { color: n })} />)}</span></PropertyRow>
          {cur.kind === "preset" && preset && (
            <>
              <PropertyRow label="Preset"><Select size="sm" value={preset.id} onChange={(v) => { const p = PRESETS.find((x) => x.id === v)!; patch(cur.id, { preset: p.id, format: p.format, mult: p.mult, squeeze: p.squeeze, delivery: p.delivery, focal: p.primes?.[0] ?? p.zoom![0], name: `${p.primes?.[0] ?? p.zoom![0]} mm` }); }} options={PRESETS.map((p) => ({ value: p.id, label: p.name }))} /></PropertyRow>
              <PropertyRow label="Focal length">
                {preset.primes ? <span className="u2-chips">{preset.primes.map((mm) => <button type="button" key={mm} className={cx(cur.focal === mm && "is-on")} onClick={() => patch(cur.id, { focal: mm, name: `${mm} mm` })}>{mm}</button>)}</span>
                  : <span className="u2-zoom"><Slider min={preset.zoom![0]} max={preset.zoom![1]} step={1} value={cur.focal} onChange={(mm) => patch(cur.id, { focal: mm, name: `${mm} mm` })} /><b className="oc-num">{cur.focal} mm</b></span>}
              </PropertyRow>
              <PropertyRow label="From the preset" value={`${preset.format[0]} × ${preset.format[1]} mm${preset.squeeze > 1 ? ` · ${preset.squeeze}× squeeze` : ""}${preset.delivery ? ` · ${preset.delivery}:1` : ""}`} />
            </>
          )}
          {cur.kind === "free" && (
            <>
              <PropertyRow label="Format"><Select size="sm" value={cur.format.join("x")} onChange={(v) => { const [w, h] = v.split("x").map(Number); patch(cur.id, { format: [w, h] }); }} options={FORMATS.map(([n, w, h]) => ({ value: `${w}x${h}`, label: n }))} /></PropertyRow>
              <PropertyRow label="Focal length"><NumberInput size="sm" value={cur.focal} unit="mm" min={4} max={600} step={1} onChange={(mm) => patch(cur.id, { focal: Math.round(mm), name: cur.name === `${cur.focal} mm` || cur.name === "Free-form" ? `${Math.round(mm)} mm` : cur.name })} /></PropertyRow>
              <PropertyRow label="Stops"><span className="u2-chips u2-chips--wrap">{PRIMES.map((mm) => <button type="button" key={mm} className={cx(cur.focal === mm && "is-on")} onClick={() => patch(cur.id, { focal: mm })}>{mm}</button>)}</span></PropertyRow>
              <PropertyRow label="Multiplier"><NumberInput size="sm" value={cur.mult} step={0.01} min={0.5} max={2} onChange={(m) => patch(cur.id, { mult: m })} /></PropertyRow>
              <PropertyRow label="Squeeze"><Select size="sm" value={String(cur.squeeze)} onChange={(v) => patch(cur.id, { squeeze: Number(v) })} options={[1, 1.25, 1.33, 1.5, 1.6, 1.8, 2].map((s) => ({ value: String(s), label: s === 1 ? "Spherical" : `${s}×` }))} /></PropertyRow>
              <PropertyRow label="Delivery"><Select size="sm" value={cur.delivery ? String(cur.delivery) : ""} onChange={(v) => patch(cur.id, { delivery: v ? Number(v) : undefined })} options={[{ value: "", label: "As the camera sees" }, ...ASPECTS.map(([n, a]) => ({ value: String(a), label: n }))]} /></PropertyRow>
              <Button size="sm" variant="quiet" icon="plus">Create a preset from this frame</Button>
            </>
          )}
          {cur.kind === "aspect" && (
            <>
              <PropertyRow label="Aspect"><Select size="sm" value={String(cur.aspect)} onChange={(v) => patch(cur.id, { aspect: Number(v), name: ASPECTS.find(([, a]) => String(a) === v)![0] })} options={ASPECTS.map(([n, a]) => ({ value: String(a), label: n }))} /></PropertyRow>
              <PropertyRow label="Size"><Slider min={0.2} max={1} step={0.01} value={cur.size} onChange={(s) => patch(cur.id, { size: s })} /></PropertyRow>
            </>
          )}
          {cur.kind !== "aspect" && <PropertyRow label="Orientation"><Segmented label="Orientation" value={cur.portrait ? "p" : "l"} onChange={(v) => patch(cur.id, { portrait: v === "p" })} options={[{ value: "l", label: "Landscape" }, { value: "p", label: "Portrait" }]} /></PropertyRow>}
          {r?.hfov && <PropertyRow label="Sees" value={`${r.hfov.toFixed(0)}° × ${r.vfov!.toFixed(0)}° · like ${r.ffeq!.toFixed(0)} mm on full frame`} />}
          <Button size="sm" variant="quiet" icon="trash" onClick={() => { setFrames(frames.filter((f) => f.id !== cur.id)); setSel(null); if (pic === cur.id) setPic(null); }}>Remove the frame</Button>
        </PropertySection>
      )}
      <PropertySection title="Layers" icon="layers">
        <div className="u2-layer"><Checkbox checked={layers.drawing} onChange={(c) => setLayers({ ...layers, drawing: c })}>Drawing</Checkbox><span className="oc-meta">{shapes.length} shapes</span>{shapes.length > 0 && <Button size="sm" variant="quiet" icon="undo" label="Undo the last shape" onClick={() => setShapes(shapes.slice(0, -1))} />}</div>
        <div className="u2-layer"><Checkbox checked={layers.look} onChange={(c) => setLayers({ ...layers, look: c })}>Look</Checkbox><span className="oc-meta">adjustment</span></div>
        {([["exposure", "Exposure", -2, 2], ["contrast", "Contrast", -0.6, 0.6], ["saturation", "Saturation", -1, 1]] as const).map(([k, label, min, max]) => <PropertyRow key={k} label={label}><Slider min={min} max={max} step={0.02} value={look[k]} onChange={(v) => setLook({ ...look, [k]: v })} /></PropertyRow>)}
      </PropertySection>
    </PropertyList>
  );

  return (
    <div className="u2" data-theme={theme}>
      <header className="u2-proto">
        <strong>U2</strong><span className="u2-proto__note">prototype · Canvas</span>
        <span style={{ flex: 1 }} />
        <label><Checkbox checked={locked} onChange={setLocked}>Someone else is editing</Checkbox></label>
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      {locked && <Banner tone="warning" icon="lock" title="Ben is editing this canvas">You see it as it was last saved, read-only. It opens for you when Ben leaves it.</Banner>}
      <EditorLayout className="u2-editor" inspectorWidth={340}
        toolbar={<Toolbar>
          <strong className="u2-title">Canvas 02</strong>
          <Button size="sm" variant="quiet" icon="undo" label="Undo" disabled={locked} /><Button size="sm" variant="quiet" icon="redo" label="Redo" disabled={locked} />
          <ToolbarSpacer />
          {tool !== "select" && <span className="u2-dots">{INK.map((c) => <button type="button" key={c} aria-label={`Ink ${c}`} className={cx(ink === c && "is-on")} style={{ background: c }} onClick={() => setInk(c)} />)}</span>}
          {photo && <Segmented label="View mode" value={mode} onChange={setMode} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} />}
        </Toolbar>}
        toolRail={<ToolRail value={tool} onChange={(t) => !locked && setTool(t)} tools={[{ id: "select", icon: "crosshair", label: "Select and move", kbd: "V" }, { separator: true }, { id: "pen", icon: "brush", label: "Pen", kbd: "P" }, { id: "line", icon: "minus", label: "Line", kbd: "L" }, { id: "arrow", icon: "arrow-right", label: "Arrow", kbd: "A" }, { id: "rect", icon: "frame", label: "Rectangle", kbd: "R" }, { id: "ellipse", icon: "focus", label: "Ellipse", kbd: "O" }]} />}
        canvas={
          <div className="u2-fit">
            <div ref={stage} className={cx("u2-stage", `u2-stage--${photo ? mode : "blank"}`, tool !== "select" && "is-drawing", scale < 1 && "is-beyond")} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
              {photo ? <img className="u2-photo" src={picture(PHOTO.seed)} alt="" draggable={false} style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, filter, clipPath: mode === "crop" && picture_ ? (() => { const s = rectOf(picture_).inner ?? rectOf(picture_); const l = (picture_.cx - s.w / 2) * 100, t = (picture_.cy - s.h / 2) * 100; return `inset(${Math.max(0, t)}% ${Math.max(0, 100 - l - s.w * 100)}% ${Math.max(0, 100 - t - s.h * 100)}% ${Math.max(0, l)}%)`; })() : undefined }} /> : <div className="u2-paper" />}
              {photo && mode === "mask" && picture_ && <span className="u2-mask" style={box(picture_, true)} />}
              {layers.drawing && <svg className="u2-ink" viewBox="0 0 1000 750" preserveAspectRatio="none" style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}>
                <defs>{INK.map((c) => <marker key={c} id={`u2a${c.slice(1)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={c} /></marker>)}</defs>
                {shapes.map((s) => { const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]]; const st = { stroke: s.color, "stroke-width": 4, fill: "none", "stroke-linecap": "round" as const, "stroke-linejoin": "round" as const };
                  return s.tool === "pen" ? <polyline key={s.id} points={s.pts.map(svgPt).join(" ")} {...st} /> : s.tool === "rect" ? <rect key={s.id} x={Math.min(a[0], b[0]) * 1000} y={Math.min(a[1], b[1]) * 750} width={Math.abs(b[0] - a[0]) * 1000} height={Math.abs(b[1] - a[1]) * 750} {...st} /> : s.tool === "ellipse" ? <ellipse key={s.id} cx={((a[0] + b[0]) / 2) * 1000} cy={((a[1] + b[1]) / 2) * 750} rx={(Math.abs(b[0] - a[0]) / 2) * 1000} ry={(Math.abs(b[1] - a[1]) / 2) * 750} {...st} /> : <line key={s.id} x1={a[0] * 1000} y1={a[1] * 750} x2={b[0] * 1000} y2={b[1] * 750} marker-end={s.tool === "arrow" ? `url(#u2a${s.color.slice(1)})` : undefined} {...st} />; })}
              </svg>}
              {mode !== "full" && shownFrames.filter((f) => mode === "outline" || f.id === pic || f.id === sel).map((f) => { const fr = rectOf(f); return (
                <div key={f.id} className={cx("u2-frame", sel === f.id && "is-current", pic === f.id && "is-picture", Math.max(fr.w, fr.h) > 1 && "is-beyond")} style={{ ...box(f), "--c": `var(--cat-${f.color})` }} onPointerDown={(e) => grab(e, f)}>
                  <span className="u2-frame__label">{pic === f.id && <Icon name="star" size={12} />}{f.name}</span>
                  {fr.inner && <span className="u2-frame__inner" style={{ width: `${(fr.inner.w / fr.w) * 100}%`, height: `${(fr.inner.h / fr.h) * 100}%` }}><span>{f.delivery}:1</span></span>}
                </div>
              ); })}
            </div>
          </div>
        }
        inspector={inspector}
        statusBar={<StatusBar>{photo ? <>{frames.length} frames{picture_ && <> · the picture is <strong>{picture_.name}</strong></>}{scale < 1 && <> · a frame sees more than the photo: the hatched area is beyond it</>}</> : <>Blank canvas</>}{cur && r?.hfov && <> · <strong>{cur.name}</strong> covers {Math.min(100, r.w * 100).toFixed(0)} % of the photo's width</>}</StatusBar>} />
    </div>
  );
}
