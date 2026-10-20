/**
 * The drawing editor's core, shared by the shot view's Compose stage and the timeline's inline
 * editing (issue #31): shape history, selection, tool and style, the tool bar, the keys, and the
 * Shape and Look panel sections. The caller owns the shapes (they live in its document).
 */
import { useRef, useState } from "preact/hooks";
import { COMPOSE_PALETTE, moveShape, NEUTRAL_LOOK, STENCIL_GROUPS, STENCIL_LABELS, type Look, type Shape, type Stencil } from "@openclapper/vocab";
import { Button, Chip, cx, Icon, IconButton, Input, Kbd, Popover, SearchInput, Seg, Switch } from "@openclapper/ui";
import { STENCIL_BOX, STENCIL_PATHS, STENCIL_STROKE } from "./stencils";
import { defaultStyle, shapeId, TOOLS, WIDTHS, type Style, type TextEdit, type Tool } from "./DrawSurface";
import { bind } from "../keys";

export interface DrawingEditor {
  shapes: Shape[];
  /** Live update while dragging (no history entry). */
  preview: (shapes: Shape[]) => void;
  /** A finished change (history entry). */
  commit: (shapes: Shape[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  sel: Shape | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  style: Style;
  setStyle: (f: (s: Style) => Style) => void;
  /** A style change applies to the selected shape too. */
  setStyleAnd: (patch: Partial<Style>) => void;
  updateSel: (patch: Partial<Shape>) => void;
  removeSel: () => void;
  duplicateSel: () => void;
  nudge: (dx: number, dy: number) => false | void;
  /** Painting away parts of one shape (issue #46): its id and the brush width; null = off. */
  mask: { id: string; width: number } | null;
  setMask: (m: { id: string; width: number } | null) => void;
  textEdit: TextEdit | null;
  setTextEdit: (t: TextEdit | null) => void;
  textDone: (t: TextEdit) => void;
  /** Start over on another document: clears history, selection and the text box. */
  reset: (sketch: boolean) => void;
}

export function useDrawingEditor(shapes: Shape[], setShapes: (s: Shape[]) => void, sketch: boolean): DrawingEditor {
  const [history, setHistory] = useState<{ past: Shape[][]; future: Shape[][] }>({ past: [], future: [] });
  const [selected, setSelectedState] = useState<string | null>(null);
  const [tool, setToolState] = useState<Tool>("pen");
  const [mask, setMask] = useState<{ id: string; width: number } | null>(null);
  // Mask painting belongs to one selected shape: another selection or tool ends it.
  const setSelected = (id: string | null) => { setSelectedState(id); setMask((m) => (m && m.id === id ? m : null)); };
  const setTool = (t: Tool) => { setToolState(t); setMask(null); };
  const [style, setStyleState] = useState<Style>(() => defaultStyle(sketch));
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const cur = useRef(shapes); cur.current = shapes;

  const commit = (next: Shape[]) => {
    const before = cur.current;
    setHistory((h) => ({ past: [...h.past.slice(-99), before], future: [] }));
    setShapes(next);
  };
  const undo = () => setHistory((h) => { const prev = h.past.at(-1); if (!prev) return h; const now = cur.current; setShapes(prev); setSelected(null); return { past: h.past.slice(0, -1), future: [now, ...h.future] }; });
  const redo = () => setHistory((h) => { const next = h.future[0]; if (!next) return h; const now = cur.current; setShapes(next); setSelected(null); return { past: [...h.past, now], future: h.future.slice(1) }; });
  const sel = shapes.find((s) => s.id === selected) ?? null;
  const updateSel = (patch: Partial<Shape>) => { if (!sel) return; commit(shapes.map((s) => (s.id === sel.id ? ({ ...s, ...patch } as Shape) : s))); };
  const removeSel = () => { if (!sel) return; commit(shapes.filter((s) => s.id !== sel.id)); setSelected(null); };
  const duplicateSel = () => { if (!sel) return; const copy = moveShape({ ...sel, id: shapeId() }, 0.03, 0.03); commit([...shapes, copy]); setSelected(copy.id); };
  const nudge = (dx: number, dy: number) => { if (!sel) return false; commit(shapes.map((s) => (s.id === sel.id ? moveShape(s, dx, dy) : s))); };
  const textDone = (t: TextEdit) => {
    setTextEdit(null);
    const text = t.value.trim();
    if (t.id) { commit(text ? shapes.map((s) => (s.id === t.id ? ({ ...s, text } as Shape) : s)) : shapes.filter((s) => s.id !== t.id)); return; }
    if (!text) return;
    const s: Shape = { id: shapeId(), type: "text", at: t.at, text, size: style.textSize, color: style.color, width: 0, opacity: style.opacity };
    commit([...shapes, s]);
    setSelected(s.id);
  };
  const setStyleAnd = (patch: Partial<Style>) => {
    setStyleState((s) => ({ ...s, ...patch }));
    if (!sel) return;
    const sp: Partial<Shape> = {};
    if (patch.color !== undefined) sp.color = patch.color;
    if (patch.width !== undefined && sel.type !== "text" && sel.type !== "stencil") sp.width = patch.width;
    if (patch.opacity !== undefined) sp.opacity = patch.opacity;
    if (patch.fill !== undefined && (sel.type === "rect" || sel.type === "ellipse")) (sp as { fill?: boolean }).fill = patch.fill;
    if (patch.stencil !== undefined && sel.type === "stencil") (sp as { stencil?: Stencil }).stencil = patch.stencil;
    if (Object.keys(sp).length) updateSel(sp);
  };
  const reset = (forSketch: boolean) => {
    setHistory({ past: [], future: [] }); setSelected(null); setTextEdit(null); setMask(null);
    // Yellow reads on photos, black on the white sketch canvas.
    setStyleState((s) => ({ ...s, color: forSketch ? (s.color === "#FFD60A" ? "#0B0B0C" : s.color) : s.color === "#0B0B0C" ? "#FFD60A" : s.color }));
  };
  return {
    shapes, preview: setShapes, commit, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    selected, setSelected, sel, tool, setTool, style, setStyle: setStyleState, setStyleAnd, updateSel, removeSel, duplicateSel, nudge,
    mask, setMask, textEdit, setTextEdit, textDone, reset,
  };
}

/** The editor's keys: tools, colours, undo/redo, remove and nudge the selected shape. */
export function drawingKeys(ed: DrawingEditor, own: { save: () => void; escape: () => void }) {
  const step: Record<string, [number, number]> = { ArrowLeft: [-0.005, 0], ArrowRight: [0.005, 0], ArrowUp: [0, -0.005], ArrowDown: [0, 0.005] };
  return bind("draw", {
    ...Object.fromEntries(TOOLS.map((t) => [t.id, () => ed.setTool(t.id)])),
    // 1–9 then 0 pick the palette in order.
    colour: (e) => { const c = COMPOSE_PALETTE[(Number(e.key) + 9) % 10]; if (c) ed.setStyleAnd({ color: c }); },
    undo: () => ed.undo(),
    redo: () => ed.redo(),
    remove: () => ed.removeSel(),
    nudge: (e) => { const d = step[e.key]; if (d) ed.nudge(d[0], d[1]); },
    save: own.save,
    escape: () => { if (ed.mask) { ed.setMask(null); return; } own.escape(); },
  });
}

/** Tools, colours, stroke width, fill/stencil options and undo/redo. */
export function DrawToolbar({ ed, compact }: { ed: DrawingEditor; compact?: boolean }) {
  const { tool, style, sel } = ed;
  return (
    <>
      <Seg label="Tool" value={tool} onChange={ed.setTool} options={TOOLS.map((t) => ({ id: t.id, icon: t.icon, title: `${t.label} (${t.key})` }))} />
      <div class="swatches" role="group" aria-label="Colour">
        {COMPOSE_PALETTE.map((c, i) => <button key={c} type="button" class={cx("swatch", style.color === c && "is-sel")} style={{ background: c }} title={`Colour ${(i + 1) % 10}`} aria-pressed={style.color === c} onClick={() => ed.setStyleAnd({ color: c })}>{style.color === c && <Icon name="check" />}</button>)}
      </div>
      <Seg label="Stroke width" value={WIDTHS.find((w) => w.w === style.width)?.id ?? "m"} onChange={(id) => ed.setStyleAnd({ width: WIDTHS.find((w) => w.id === id)!.w })} options={WIDTHS.map((w) => ({ id: w.id, label: w.label, title: `Stroke ${w.label}` }))} />
      {(tool === "rect" || tool === "ellipse" || sel?.type === "rect" || sel?.type === "ellipse") && <Chip selected={style.fill} onClick={() => ed.setStyleAnd({ fill: !style.fill })}>Fill</Chip>}
      {(tool === "stencil" || sel?.type === "stencil") && <StencilPicker value={sel?.type === "stencil" ? sel.stencil : style.stencil} compact={compact} onChange={(s) => ed.setStyleAnd({ stencil: s })} />}
      {ed.mask && <span class="f-edited" title="Drag over the shape to erase parts of it; Esc or Done ends it">Painting away</span>}
      <div class="btn-row" style={{ gap: "2px" }}>
        <IconButton icon="undo" label="Undo (⌘Z)" title="Undo (⌘Z)" disabled={!ed.canUndo} onClick={ed.undo} />
        <IconButton icon="redo" label="Redo (⌘⇧Z)" title="Redo (⌘⇧Z)" disabled={!ed.canRedo} onClick={ed.redo} />
      </div>
    </>
  );
}

/** Panel section for the selected shape. */
export function ShapeSection({ ed }: { ed: DrawingEditor }) {
  const { sel } = ed;
  return (
    <div class="f-sec">
      <div class="f-sec__head"><Icon name="shape-outline" />Shape<span class="f-sec__aside">{sel ? sel.type : "none selected"}</span></div>
      {sel ? (
        <>
          <Range label="Opacity" value={sel.opacity} min={0} max={1} onChange={(v) => ed.setStyleAnd({ opacity: v })} />
          {(sel.type === "text" || sel.type === "stencil") && <Range label="Size" value={sel.size} min={0.02} max={0.4} onChange={(v) => { ed.updateSel({ size: v } as Partial<Shape>); ed.setStyle((s) => (sel.type === "text" ? { ...s, textSize: v } : { ...s, stencilSize: v })); }} />}
          {sel.type === "stencil" && <Range label="Rotation" value={sel.rotation} min={-180} max={180} step={5} onChange={(v) => ed.updateSel({ rotation: v } as Partial<Shape>)} format={(v) => `${Math.round(v)}°`} />}
          {sel.type === "text" && <Input sm value={sel.text} maxLength={200} aria-label="Text" onInput={(e) => ed.updateSel({ text: (e.target as HTMLInputElement).value } as Partial<Shape>)} />}
          <div class="f-field">
            <span class="f-field__label">Mask · erase parts of this shape only</span>
            <div class="btn-row">
              {ed.mask
                ? <><Seg label="Brush" value={MASK_WIDTHS.find((w) => w.w === ed.mask!.width)?.id ?? "m"} onChange={(id) => ed.setMask({ id: sel.id, width: MASK_WIDTHS.find((w) => w.id === id)!.w })} options={MASK_WIDTHS.map((w) => ({ id: w.id, label: w.label, title: `Brush ${w.label}` }))} />
                    <Button kind="primary" size="sm" icon="check" onClick={() => ed.setMask(null)}>Done</Button></>
                : <Button kind="secondary" size="sm" icon="eraser-variant" onClick={() => { ed.setTool("select"); ed.setMask({ id: sel.id, width: MASK_WIDTHS[1].w }); }}>Paint away</Button>}
              {!!sel.mask?.length && <Button kind="ghost" size="sm" icon="restore" onClick={() => ed.updateSel({ mask: undefined } as Partial<Shape>)}>Restore</Button>}
            </div>
            {ed.mask && <span class="meta">Drag over the shape: what you paint disappears from it (the photo shows through). Moving the shape moves the mask; resizing or rotating does not.</span>}
          </div>
          <div class="btn-row">
            <Button kind="secondary" size="sm" icon="content-duplicate" onClick={ed.duplicateSel}>Duplicate</Button>
            <Button kind="danger" size="sm" icon="delete-outline" kbd="Del" onClick={ed.removeSel}>Remove</Button>
          </div>
        </>
      ) : <span class="meta">Use the Select tool (<Kbd>V</Kbd>) and click a shape to change it. Colour and width in the bar apply to the next shape, or to the selected one.</span>}
    </div>
  );
}

/** Panel section for an overlay's look (exposure, contrast, tint, vignette…). */
export function LookSection({ look, onLook }: { look: Look; onLook: (l: Look) => void }) {
  const set = (patch: Partial<Look>) => onLook({ ...look, ...patch });
  return (
    <div class="f-sec">
      <div class="f-sec__head"><Icon name="tune-variant" />Look<span class="f-sec__aside"><button type="button" class="f-linkbtn" onClick={() => onLook({ ...NEUTRAL_LOOK })}>Reset</button></span></div>
      <Range label="Exposure" value={look.exposure} min={-3} max={3} step={0.05} onChange={(v) => set({ exposure: v })} format={(v) => `${v > 0 ? "+" : ""}${(v * 2).toFixed(1)} EV`} />
      <Range label="Contrast" value={look.contrast} min={-1} max={1} onChange={(v) => set({ contrast: v })} />
      <Range label="Saturation" value={look.saturation} min={-1} max={1} onChange={(v) => set({ saturation: v })} />
      <Switch on={look.bw} onClick={() => set({ bw: !look.bw })}>Black and white</Switch>
      <div class="f-field">
        <span class="f-field__label">Tint</span>
        <div class="swatches">
          <button type="button" class={cx("swatch swatch--none", !look.tint && "is-sel")} title="No tint" onClick={() => set({ tint: null })}>{!look.tint && <Icon name="check" />}</button>
          {COMPOSE_PALETTE.map((c) => <button key={c} type="button" class={cx("swatch", look.tint === c && "is-sel")} style={{ background: c }} title={c} onClick={() => set({ tint: c })}>{look.tint === c && <Icon name="check" />}</button>)}
        </div>
      </div>
      {look.tint && <Range label="Tint opacity" value={look.tint_opacity} min={0} max={1} onChange={(v) => set({ tint_opacity: v })} />}
      <Range label="Vignette" value={look.vignette} min={0} max={1} onChange={(v) => set({ vignette: v })} />
      <Range label="Softness" value={look.blur} min={0} max={1} onChange={(v) => set({ blur: v })} />
    </div>
  );
}

/** A labelled range slider with its value. */
export function Range({ label, value, min, max, step = 0.01, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label class="f-range">
      <span class="f-range__label">{label}<span class="num">{format ? format(value) : `${Math.round(((value - min) / (max - min)) * 100)} %`}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} onDblClick={() => onChange(min < 0 ? 0 : min)} />
    </label>
  );
}


/** Mask brush widths, as a fraction of the canvas width. */
export const MASK_WIDTHS = [{ id: "s", w: 0.015, label: "S" }, { id: "m", w: 0.035, label: "M" }, { id: "l", w: 0.07, label: "L" }];

/** A stencil glyph as a small inline SVG (picker, buttons). */
export function StencilGlyph({ name, size = 28 }: { name: Stencil; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${STENCIL_BOX} ${STENCIL_BOX}`} aria-hidden="true">
      <path d={STENCIL_PATHS[name]} fill="none" stroke="currentColor" stroke-width={STENCIL_STROKE} stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** The stencil in use, opening a searchable grid of every stencil by group (issue #46). */
export function StencilPicker({ value, compact, onChange }: { value: Stencil; compact?: boolean; onChange: (s: Stencil) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = STENCIL_GROUPS.map((g) => ({ ...g, stencils: g.stencils.filter((s) => !needle || STENCIL_LABELS[s].toLowerCase().includes(needle) || s.includes(needle)) })).filter((g) => g.stencils.length);
  const pick = (s: Stencil) => { onChange(s); setOpen(false); setQ(""); };
  return (
    <div class="menu-anchor">
      <Button kind="secondary" size="sm" iconAfter="chevron-down" aria-expanded={open} title="Stencil" onClick={() => setOpen(!open)}>
        <span class="stencil-btn"><StencilGlyph name={value} size={18} />{!compact && STENCIL_LABELS[value]}</span>
      </Button>
      {open && (
        <Popover onClose={() => setOpen(false)}>
          <div class="stencil-picker">
            <SearchInput value={q} placeholder="Search stencils" aria-label="Search stencils" autoFocus onInput={(e) => setQ((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === "Enter" && groups[0]) pick(groups[0].stencils[0]); if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} />
            {groups.length === 0 && <span class="meta">No stencil matches.</span>}
            {groups.map((g) => (
              <section key={g.label}>
                <h4 class="stencil-picker__group">{g.label}</h4>
                <div class="stencil-picker__grid">
                  {g.stencils.map((s) => (
                    <button key={s} type="button" class={cx("stencil-picker__it", s === value && "is-sel")} title={STENCIL_LABELS[s]} aria-pressed={s === value} onClick={() => pick(s)}>
                      <StencilGlyph name={s} />
                      <span>{STENCIL_LABELS[s]}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
