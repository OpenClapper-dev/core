/**
 * Shot view → stage **Compose** (epic #275): the shot as a composition. The foot holds the steps
 * (the time axis: reorder, add, zoom sequence, reset, extract) and the sketches; the stage shows the
 * selected step with the layer stack composed live, and draws on the selected drawing layer; the
 * panel lists the stack top to bottom with the footage in it, and the selected layer's settings
 * (order, opacity, anchoring, the steps it shows on, its look or shapes). Everything saves on its
 * own: steps 600 ms and layers 900 ms after the last change, sketches 1.2 s; leaving sends the rest.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { emptyDrawing, layersAt, SKETCH_ASPECTS, SKETCH_KIND_LABELS, SKETCH_KINDS, stepsOf, type Drawing, type Layer, type Shape, type StepInput } from "@openclapper/vocab";
import { deleteSketch, fetchShotLayers, fetchSketch, putSketch, putSteps, type Photo, type Preset, type Shot } from "../api";
import { steps as stepsOfShot, type Step } from "../format";
import { StepFramed, type MaskMode } from "../Framed";
import { FromTimelines } from "../FromTimelines";
import { bind, useKeys } from "../keys";
import { ZoomSequenceDialog } from "../ZoomSequenceDialog";
import { Button, Combobox, confirmDialog, cx, Empty, Icon, IconButton, Input, Kbd, MarkdownField, SaveStatus, Seg, Select, Spinner, toast, ToolbarSpacer, type SaveState } from "@openclapper/ui";
import { DrawSurface } from "./DrawSurface";
import { DrawToolbar, drawingKeys, ShapeSection, useDrawingEditor } from "./editor";
import { FOOTAGE, LayerList, LayerProps, useLayerDocs, type LayerDocs } from "./layers";
import { renderSketch } from "./render";
import { Composition, layerRect, primeShotLayers, stackAreas } from "./stack";

interface Props {
  shot: Shot; presets: Preset[]; mode: MaskMode;
  /** The step to start on (the Photo stage's). */
  initialStep: number;
  onUpdated: (s: Shot) => void;
  /** The step on stage changed: its photo is the inspector's. */
  onStep: (i: number, photo: Photo) => void;
  onBack: () => void;
  onExtract: (step: Step) => void;
}

// ---------- the steps: a draft list, autosaved whole ----------

const asInput = (s: Step): StepInput => ({ id: crypto.randomUUID(), photo_id: s.photo.id, framing_id: s.framing?.id ?? null });
const fromShot = (shot: Shot): StepInput[] => (shot.steps.length
  ? [...shot.steps].sort((a, b) => a.ordinal - b.ordinal).map((s) => ({ id: s.id, photo_id: s.photo_id, framing_id: s.framing_id }))
  : stepsOfShot(shot).map(asInput));

function useStepsDraft(shot: Shot, onUpdated: (s: Shot) => void) {
  const [draft, setDraft] = useState<StepInput[]>(() => fromShot(shot));
  const [stored, setStored] = useState(shot.steps.length > 0);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ draft, shot }); latest.current = { draft, shot };
  useEffect(() => { setDraft(fromShot(shot)); setStored(shot.steps.length > 0); setSave("idle"); }, [shot.id]);
  // The steps the stage works on: the draft once stored (or being stored), else the photos.
  const resolved: Step[] = useMemo(() => (stored
    ? stepsOf({ ...shot, steps: draft.map((d, i) => ({ id: d.id, shot_id: shot.id, ordinal: i, photo_id: d.photo_id, framing_id: d.framing_id ?? null })) }).filter((s) => s.stored)
    : stepsOfShot(shot)), [shot, draft, stored]);

  const send = (list: StepInput[]) => {
    timer.current = null;
    setSave("saving");
    return (inflight.current = putSteps(latest.current.shot.id, list).then((s) => { onUpdated(s); setSave(timer.current ? "dirty" : "saved"); })
      .catch((e: Error) => { setSave("error"); toast(`Steps not saved: ${e.message}`, "danger"); throw e; }));
  };
  const change = (list: StepInput[]) => {
    setDraft(list); setStored(true); setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(list).catch(() => {}), 600);
  };
  /** Pending steps go out now (a layer range may name them). */
  const flush = async () => { if (timer.current) { clearTimeout(timer.current); await send(latest.current.draft); } else await inflight.current; };
  /** The steps as stored rows: a shot without them stores its photos as steps first. */
  const ensureStored = async (): Promise<StepInput[]> => {
    if (!stored || !latest.current.shot.steps.length) { const list = latest.current.draft; setStored(true); setDraft(list); await send(list); return list; }
    await flush();
    return latest.current.draft;
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void putSteps(latest.current.shot.id, latest.current.draft).then(onUpdated).catch(() => {}); } }, []);
  const reset = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSave("saving");
    try { const s = await putSteps(shot.id, []); onUpdated(s); setDraft(fromShot(s)); setStored(false); setSave("saved"); } catch (e) { setSave("error"); toast(`Reset failed: ${(e as Error).message}`, "danger"); }
  };
  return { draft, resolved, stored, save, change, flush, ensureStored, reset, retry: () => void send(latest.current.draft).catch(() => {}) };
}

// ---------- the stage ----------

type Sel = { kind: "layer"; id: string } | { kind: "footage" } | { kind: "sketch"; id: string };

export function ComposeStage({ shot, presets, mode, initialStep, onUpdated, onStep, onBack, onExtract }: Props) {
  const st = useStepsDraft(shot, onUpdated);
  const [at, setAt] = useState(Math.max(0, Math.min(initialStep, st.resolved.length - 1)));
  const [sel, setSel] = useState<Sel>({ kind: "footage" });
  const [zoom, setZoom] = useState(false);
  const [drop, setDrop] = useState<{ i: number; after: boolean } | null>(null);
  const dragging = useRef<number | null>(null);
  const i = Math.min(at, Math.max(0, st.resolved.length - 1));
  const cur = st.resolved[i] ?? null;
  useEffect(() => { if (cur) onStep(i, cur.photo); }, [cur?.id, i]);

  const docs = useLayerDocs({
    load: () => fetchShotLayers(shot.id), deps: [shot.id],
    beforeSave: st.flush,
    onSaved: (r) => { onUpdated(r.shot); },
    onDeleted: (id, s) => { onUpdated(s); if (sel.kind === "layer" && sel.id === id) setSel({ kind: "footage" }); },
  });
  // What the editor knows is newer than the cache: the strips and the timeline compose from it.
  useEffect(() => { if (!docs.loading) primeShotLayers(shot.id, docs.list); }, [docs.list, docs.loading]);
  const layer = sel.kind === "layer" ? docs.list.find((l) => l.id === sel.id) ?? null : null;
  const shown = cur ? layersAt(docs.list, cur) : [];
  const drawing = layer && layer.kind === "drawing" && !layer.locked && cur && shown.some((l) => l.id === layer.id) ? layer : null;

  const setShapes = (shapes: Shape[]) => { if (drawing) docs.update(drawing.id, { shapes }); };
  const ed = useDrawingEditor(drawing?.shapes ?? [], setShapes, false);
  useEffect(() => { ed.reset(false); }, [drawing?.id]);

  // ----- steps -----
  const move = (from: number, to: number) => {
    if (to < 0 || to >= st.draft.length || from === to) return;
    const list = [...st.draft]; const [d] = list.splice(from, 1); list.splice(to, 0, d); st.change(list); setAt(to);
  };
  const addStep = () => { const base = st.draft[i] ?? (cur ? asInput(cur) : null); if (!base) return; st.change([...st.draft.slice(0, i + 1), { ...base, id: crypto.randomUUID() }, ...st.draft.slice(i + 1)]); setAt(i + 1); };
  const removeStep = () => { if (st.draft.length < 2) return; st.change(st.draft.filter((_, k) => k !== i)); setAt(Math.max(0, i - 1)); };
  const patchStep = (p: Partial<StepInput>) => st.change(st.draft.map((d, k) => (k === i ? { ...d, ...p } : d)));
  async function reset() {
    if (!(await confirmDialog({ title: "Reset to photos?", body: "Every step goes; the shot shows its photos again, one step each. Layers shown on chosen steps then show on none until you pick their steps again.", confirmLabel: "Reset", danger: true }))) return;
    await st.reset(); setAt(0);
  }
  const onZoom = (framingIds: string[]) => {
    const photo = cur?.photo ?? shot.photos[0];
    const made = framingIds.map((fid) => ({ id: crypto.randomUUID(), photo_id: photo.id, framing_id: fid }));
    // Without stored steps the implicit photo list should not linger: the zoom replaces it; otherwise it is appended.
    const list = st.stored ? [...st.draft, ...made] : made;
    st.change(list);
    setAt(st.stored ? st.draft.length : 0);
  };

  // ----- layers -----
  const addLayer = async (kind: Layer["kind"]) => {
    const l = await docs.add(kind, { shot_id: shot.id, space: "frame", photo_id: null, range: null, timeline_id: null, clip_id: null });
    if (l) setSel({ kind: "layer", id: l.id });
  };
  const badge = (l: Layer) => {
    if (l.range === null) return null;
    if (!l.range.length) return "no step";
    if (cur && l.range.includes(cur.id)) return l.range.length === 1 ? "this step" : `${l.range.length} steps`;
    return "not here";
  };
  /** Pick the steps a layer shows on: every step, this one, or chosen ones (stored steps first). */
  const setRange = async (l: Layer, kind: "all" | "this" | "some") => {
    if (kind === "all") { docs.update(l.id, { range: null }); return; }
    const list = await st.ensureStored();
    const here = list[i]?.id;
    if (!here) return;
    docs.update(l.id, { range: kind === "this" ? [here] : l.range && l.range.length ? l.range : [here] });
  };
  const toggleStep = async (l: Layer, stepIndex: number) => {
    const list = await st.ensureStored();
    const id = list[stepIndex]?.id;
    if (!id) return;
    const r = l.range ?? list.map((x) => x.id);
    docs.update(l.id, { range: r.includes(id) ? r.filter((x) => x !== id) : [...r, id] });
  };

  // ----- keys -----
  useKeys(bind("compose", {
    prevStep: () => setAt(Math.max(0, i - 1)),
    nextStep: () => setAt(Math.min(st.resolved.length - 1, i + 1)),
  }), !zoom);
  useKeys(drawingKeys(ed, {
    save: () => { void docs.flush(); },
    escape: () => { if (ed.textEdit) { ed.setTextEdit(null); return; } if (ed.selected) { ed.setSelected(null); return; } if (sel.kind !== "footage") { setSel({ kind: "footage" }); return; } onBack(); },
  }), !zoom && sel.kind !== "sketch");

  // ----- sketches (their own editor) -----
  const sketch = useSketchEditor(shot, sel.kind === "sketch" ? sel.id : null, onUpdated, () => setSel({ kind: "footage" }));

  // ----- the stage -----
  const photo = cur?.photo ?? shot.photos[0];
  const frame = cur?.frame ?? null;
  const areas = stackAreas(photo, mode, frame);
  let stage: ComponentChildren;
  if (sel.kind === "sketch") stage = sketch.stage;
  else if (!cur) stage = <Empty icon="view-carousel-outline" title="No steps">Add a step, or reset so the photos are the steps again.</Empty>;
  else if (drawing) {
    const others = shown.filter((l) => l.id !== drawing.id);
    stage = (
      <DrawSurface shapes={drawing.shapes ?? []} onPreview={ed.preview} onCommit={ed.commit} selected={ed.selected} onSelect={ed.setSelected} tool={ed.tool} style={ed.style} mask={ed.mask}
        canvasOf={(w, h) => layerRect(drawing, areas, w, h) ?? { x: 0, y: 0, w, h }} aspect={areas.aspect} maxHeight="calc(100cqh - 300px)" sketch={false}
        textEdit={ed.textEdit} onTextEdit={ed.setTextEdit} onTextDone={ed.textDone}
        background={() => <Composition photo={photo} frame={frame} mode={mode} layers={others} className="compose__photo" />} />
    );
  } else stage = <Composition photo={photo} frame={frame} mode={mode} layers={shown} maxHeight="calc(100cqh - 300px)" />;

  const n = st.resolved.length;
  const root = photo.framings.find((f) => f.id === photo.root_framing_id);
  const d = st.draft[i];
  const stepLabel = (s: Step, k: number) => `Step ${k + 1}: photo ${s.photo.ordinal + 1}${s.framing ? ` · ${s.framing.name}` : ""}`;
  const saveState: SaveState = [st.save, docs.save, sketch.save].find((x) => x === "error") ?? [st.save, docs.save, sketch.save].find((x) => x === "saving" || x === "dirty") ?? (st.save === "saved" || docs.save === "saved" || sketch.save === "saved" ? "saved" : "idle");

  return (
    <>
      <section class="f-stage" aria-label="Compose">
        <div class="f-stage__bar">
          {sel.kind === "sketch" ? sketch.bar : drawing ? <DrawToolbar ed={ed} /> : (
            <>
              <span class="f-board-lbl num">{n ? `Step ${i + 1} of ${n}` : "No steps"}</span>
              <span class="meta">{shown.length ? `${shown.length} layer${shown.length === 1 ? "" : "s"} on this step` : "No layers on this step"}{layer && layer.kind === "drawing" && !drawing ? (layer.locked ? " · the selected layer is locked" : " · the selected layer is not on this step") : ""}</span>
            </>
          )}
          <ToolbarSpacer />
          <SaveStatus state={saveState} onRetry={() => { st.retry(); docs.retry(); sketch.retry(); }} />
          {sel.kind !== "sketch" && <FromTimelines shot={shot} photo={photo} kinds={["layer", "sketch"]} onUpdated={onUpdated} />}
          <Button kind="ghost" size="sm" kbd="Esc" onClick={onBack}>Back to photo</Button>
        </div>
        <div class="f-stage__view compose__view">{stage}</div>
        <div class="f-stage__foot compose__foot">
          <div class="f-strip seq-strip" role="listbox" aria-label="Steps" onDragLeave={() => setDrop(null)}>
            {st.resolved.map((s, k) => (
              <button key={s.id} type="button" role="option" aria-selected={k === i && sel.kind !== "sketch"} aria-label={stepLabel(s, k)} title={stepLabel(s, k)}
                class={cx("f-strip__it", k === i && sel.kind !== "sketch" && "is-sel", drop?.i === k && (drop.after ? "is-drop-after" : "is-drop-before"))}
                draggable={st.stored} onClick={() => { setAt(k); if (sel.kind === "sketch") setSel({ kind: "footage" }); }}
                onDragStart={(e) => { dragging.current = k; if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (dragging.current === null) return; e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDrop({ i: k, after: e.clientX > r.left + r.width / 2 }); }}
                onDrop={(e) => { e.preventDefault(); const from = dragging.current; dragging.current = null; setDrop(null); if (from === null) return; let to = k + (drop?.after ? 1 : 0); if (from < to) to -= 1; move(from, to); }}
                onDragEnd={() => { dragging.current = null; setDrop(null); }}>
                <StepFramed shot={shot} step={s} mode={mode} />
                <span class="f-strip__n">{k + 1}</span>
                {s.framing && <span class="f-strip__g"><Icon name="crop" /></span>}
              </button>
            ))}
          </div>
          <div class="btn-row" style={{ gap: "4px", flexWrap: "wrap" }}>
            <IconButton kind="secondary" icon="plus" label="A copy of this step, after it" title="Add a step (a copy of this one)" onClick={addStep} />
            <Button kind="secondary" size="sm" icon="magnify-plus-outline" title="One step per lens of a rig, as saved framings of this photo" disabled={photo.source !== "camera"} onClick={() => setZoom(true)}>Zoom…</Button>
            <Button kind="ghost" size="sm" icon="restore" disabled={!st.stored} onClick={() => void reset()}>Reset to photos</Button>
          </div>
          <span class="compose__sep" />
          <div class="f-strip compose__items" role="listbox" aria-label="Sketches">
            {shot.sketches.map((k) => (
              <button key={k.id} type="button" role="option" aria-selected={sel.kind === "sketch" && sel.id === k.id} class={cx("f-strip__it", "compose__item", sel.kind === "sketch" && sel.id === k.id && "is-sel")} title={k.name} onClick={() => setSel({ kind: "sketch", id: k.id })}>
                {k.render_url ? <img src={k.render_url} alt="" loading="lazy" /> : <span class="compose__item-empty"><Icon name="floor-plan" /></span>}
                <span class="f-strip__lbl">{k.name}</span>
              </button>
            ))}
            <button type="button" class="f-strip__it compose__item compose__item--new" title="New sketch" onClick={() => void sketch.create().then((id) => id && setSel({ kind: "sketch", id }))}><Icon name="plus" /><span>Sketch</span></button>
          </div>
        </div>
      </section>

      <aside class="f-panel inspector" aria-label="Compose panel">
        <div class="f-panel__body f-panel__body--flush">
          {sel.kind === "sketch" ? sketch.panel : (
            <>
              <div class="f-sec">
                <div class="f-sec__head"><Icon name="layers-outline" />Layers<span class="f-sec__aside"><span class="meta keys-inline"><Kbd>,</Kbd><Kbd>.</Kbd>step</span></span></div>
                {docs.loading ? <Spinner /> : (
                  <LayerList docs={docs} selected={sel.kind === "layer" ? sel.id : FOOTAGE} onSelect={(id) => setSel(id === FOOTAGE ? { kind: "footage" } : { kind: "layer", id })}
                    footage={cur ? stepLabel(cur, i) : "Footage"} badge={badge} />
                )}
                <div class="btn-row" style={{ gap: "6px" }}>
                  <Button kind="secondary" size="sm" icon="draw" onClick={() => void addLayer("drawing")}>Drawing</Button>
                  <Button kind="secondary" size="sm" icon="tune-variant" onClick={() => void addLayer("adjustment")}>Adjustment</Button>
                </div>
              </div>
              {layer ? (
                <LayerProps layer={layer} docs={docs}
                  space={(space) => docs.update(layer.id, { space, photo_id: space === "photo" ? photo.id : null })}
                  range={<RangeControl layer={layer} steps={st.resolved} at={i} onKind={(k) => void setRange(layer, k)} onToggle={(k) => void toggleStep(layer, k)} />}>
                  {layer.kind === "drawing" && <ShapeSection ed={ed} />}
                </LayerProps>
              ) : cur && d && (
                <div class="f-sec" style={{ gap: "10px" }}>
                  <div class="f-sec__head"><Icon name="image-outline" />Step {i + 1}</div>
                  <Select label="Photo" prefix="Photo" width="100%" value={d.photo_id} onChange={(v) => patchStep({ photo_id: v, framing_id: null })}
                    options={shot.photos.map((p, k) => ({ value: p.id, label: `Photo ${k + 1}${p.lens_mm ? ` · ${p.lens_mm} mm` : ""}` }))} />
                  <Select label="Framing" icon="crop" width="100%" value={d.framing_id ?? ""} onChange={(v) => patchStep({ framing_id: v || null })}
                    options={[{ value: "", label: `Root frame · ${root?.name ?? "as captured"}` }, ...photo.framings.map((f) => ({ value: f.id, label: `${f.name}${f.id === photo.root_framing_id ? " · root" : ""}`, group: "Saved framings" }))]} />
                  <div class="btn-row" style={{ gap: "4px" }}>
                    <IconButton kind="secondary" icon="arrow-left" label="Earlier" title="Earlier" disabled={i === 0} onClick={() => move(i, i - 1)} />
                    <IconButton kind="secondary" icon="arrow-right" label="Later" title="Later" disabled={i >= st.draft.length - 1} onClick={() => move(i, i + 1)} />
                    <IconButton kind="secondary" icon="close" label="Remove this step" title="Remove this step" disabled={st.draft.length < 2} onClick={removeStep} />
                    <span class="grow" />
                    <Button kind="secondary" size="sm" icon="export-variant" title="A copy of this step as a shot of its own" onClick={() => onExtract(cur)}>Extract…</Button>
                  </div>
                  {!st.stored && <span class="meta">The photos are the steps until you change them; the first change stores them.</span>}
                  <span class="meta">Select a layer to edit it. A layer shows on every step unless you pick its steps; anchored to the frame it stays put through a zoom or a pan.</span>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      {zoom && <ZoomSequenceDialog shot={shot} photo={photo} presets={presets} onClose={() => setZoom(false)} onUpdated={onUpdated} onDone={onZoom} />}
    </>
  );
}

/** Which steps a layer shows on: every step, this one, or chosen ones (chips per step). */
function RangeControl({ layer, steps, at, onKind, onToggle }: { layer: Layer; steps: Step[]; at: number; onKind: (k: "all" | "this" | "some") => void; onToggle: (i: number) => void }) {
  const here = steps[at];
  const kind = layer.range === null ? "all" : layer.range.length === 1 && here && layer.range[0] === here.id ? "this" : "some";
  return (
    <div class="f-field">
      <span class="f-field__label">Shows on</span>
      <Seg label="Shows on" value={kind} onChange={onKind} options={[{ id: "all", label: "Every step" }, { id: "this", label: "This step" }, { id: "some", label: "Chosen steps" }]} />
      {kind === "some" && (
        <div class="range-chips" role="group" aria-label="Steps">
          {steps.map((s, k) => {
            const on = layer.range?.includes(s.id) ?? true;
            return <button key={s.id} type="button" class={cx("range-chip", on && "is-on", k === at && "is-here")} aria-pressed={on} title={`Step ${k + 1}`} onClick={() => onToggle(k)}>{k + 1}</button>;
          })}
        </div>
      )}
      {layer.space === "photo" && <span class="meta">Anchored to a photo: only on that photo's steps.</span>}
    </div>
  );
}

// ---------- sketches: a free canvas of the shot, autosaved with its render ----------

interface SketchDoc { id: string; name: string; kind: string | null; description: string; shapes: Shape[]; aspect: number; position: number }

function useSketchEditor(shot: Shot, openId: string | null, onUpdated: (s: Shot) => void, onClose: () => void) {
  const [doc, setDoc] = useState<SketchDoc | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const saved = useRef("null");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const setShapes = (shapes: Shape[]) => setDoc((d) => (d ? { ...d, shapes } : d));
  const ed = useDrawingEditor(doc?.shapes ?? [], setShapes, true);

  const persist = async (): Promise<boolean> => {
    const d = docRef.current;
    if (!d || JSON.stringify(d) === saved.current) return true;
    const snapshot = JSON.stringify(d);
    setSave("saving");
    try {
      const drawing: Drawing = { ...emptyDrawing(false), shapes: d.shapes };
      const r = await putSketch(d.id, { shot_id: shot.id, name: d.name.trim() || "Sketch", kind: d.kind, description: d.description.trim() || null, drawing, aspect: d.aspect, position: d.position }, await renderSketch(drawing, d.aspect));
      onUpdated(r.shot);
      saved.current = snapshot;
      setSave(JSON.stringify(docRef.current) === snapshot ? "saved" : "dirty");
      return true;
    } catch (e) { setSave("error"); toast(`Sketch not saved: ${(e as Error).message}`, "danger"); return false; }
  };
  useEffect(() => {
    if (!doc || JSON.stringify(doc) === saved.current) return;
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void persist(); }, 1200);
  }, [doc]);
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void persist(); } }, []);
  // Open another sketch: the current one is saved first.
  useEffect(() => {
    let live = true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; void persist(); }
    if (!openId) { setDoc(null); return; }
    if (docRef.current?.id === openId) return;
    void fetchSketch(openId).then((k) => {
      if (!live) return;
      const d: SketchDoc = { id: k.id, name: k.name, kind: k.kind, description: k.description ?? "", shapes: k.drawing.shapes, aspect: k.aspect, position: k.position };
      saved.current = JSON.stringify(d); setDoc(d); ed.reset(true); setSave("saved");
    }).catch((e: Error) => toast(`Could not open the sketch: ${e.message}`, "danger"));
    return () => { live = false; };
  }, [openId]);

  useKeys(drawingKeys(ed, {
    save: () => { void persist(); },
    escape: () => { if (ed.textEdit) { ed.setTextEdit(null); return; } if (ed.selected) { ed.setSelected(null); return; } onClose(); },
  }), !!openId);

  const create = async (): Promise<string | null> => {
    const d: SketchDoc = { id: crypto.randomUUID(), name: `Sketch ${shot.sketches.length + 1}`, kind: null, description: "", shapes: [], aspect: 16 / 9, position: shot.sketches.length };
    docRef.current = d; setDoc(d); saved.current = "null"; ed.reset(true);
    return (await persist()) ? d.id : null;
  };
  const remove = async () => {
    const d = docRef.current;
    if (!d || !(await confirmDialog({ title: `Delete “${d.name}”?`, body: "The sketch and its render are removed.", confirmLabel: "Delete", danger: true }))) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try { const r = await deleteSketch(d.id); onUpdated(r.shot); saved.current = "null"; setDoc(null); onClose(); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  };

  const stage = doc
    ? <DrawSurface shapes={doc.shapes} onPreview={ed.preview} onCommit={ed.commit} selected={ed.selected} onSelect={ed.setSelected} tool={ed.tool} style={ed.style} mask={ed.mask}
        canvasOf={(w, h) => ({ x: 0, y: 0, w, h })} aspect={doc.aspect} maxHeight="calc(100cqh - 300px)" sketch background={() => null}
        textEdit={ed.textEdit} onTextEdit={ed.setTextEdit} onTextDone={ed.textDone} />
    : <Spinner />;
  const bar = doc ? <DrawToolbar ed={ed} /> : null;
  const panel = doc && (
    <>
      <div class="f-sec" style={{ gap: "10px" }}>
        <div class="inspector__title"><h1 style={{ fontSize: "var(--text-title)" }}>Sketch</h1></div>
        <div class="f-formgrid">
          <label for="sk-name">Name</label>
          <Input sm id="sk-name" value={doc.name} maxLength={80} onInput={(e) => setDoc({ ...doc, name: (e.target as HTMLInputElement).value })} />
          <label>Kind</label>
          <Combobox small options={SKETCH_KINDS.map((k) => ({ value: k, label: SKETCH_KIND_LABELS[k] }))} value={doc.kind} placeholder="Floor plan, lighting…" onChange={(v) => setDoc({ ...doc, kind: v })} onCreate={(t) => setDoc({ ...doc, kind: t.slice(0, 40) })} />
          <label>Canvas</label>
          <Seg label="Canvas aspect" value={SKETCH_ASPECTS.find((a) => Math.abs(a.aspect - doc.aspect) < 0.01)?.id ?? "16:9"} onChange={(id) => setDoc({ ...doc, aspect: SKETCH_ASPECTS.find((a) => a.id === id)!.aspect })} options={SKETCH_ASPECTS.map((a) => ({ id: a.id, label: a.id }))} />
        </div>
        <div class="btn-row"><Button kind="secondary" size="sm" icon="arrow-left" onClick={onClose}>Back to the layers</Button><span class="grow" /><Button kind="danger" size="sm" icon="delete-outline" onClick={() => void remove()}>Delete…</Button></div>
      </div>
      <ShapeSection ed={ed} />
      <div class="f-sec">
        <div class="f-sec__head"><Icon name="text-long" />Description</div>
        <MarkdownField value={doc.description} onChange={(v) => setDoc({ ...doc, description: v })} rows={5} placeholder="What the sketch shows…" />
      </div>
    </>
  );
  return { stage, bar, panel, save, create, retry: () => void persist() };
}

export type { LayerDocs };
