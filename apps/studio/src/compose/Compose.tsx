/**
 * Shot view stage "Compose": overlays on the photo on stage and sketches of the shot. Renders the
 * stage (tool bar, drawing surface, item strip) and the right-hand panel that replaces the
 * inspector (item name, presentation, look, selected shape, description). Saving uploads the
 * vector JSON plus a flattened render; nothing is saved until Save (⌘S).
 */
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState, type MutableRef } from "preact/hooks";
import { emptyDrawing, lookFilter, NEUTRAL_LOOK, PRESENTATION_MODES, SKETCH_ASPECTS, SKETCH_KIND_LABELS, SKETCH_KINDS, sketchKindLabel, type Drawing, type Look, type Presentation, type Shape } from "@fielder/vocab";
import { deleteOverlay, deleteSketch, fetchOverlay, fetchSketch, patchOverlay, patchSketch, putOverlay, putSketch, type Overlay, type Photo, type Preset, type Shot, type Sketch } from "../api";
import { frameModeLabel } from "../format";
import { Framed, framedLayout } from "../Framed";
import { FromTimelines } from "../FromTimelines";
import { useKeys } from "../keys";
import { FramingSelect, presentationFrame, rootPresentation } from "../FramingSelect";
import { Button, Combobox, confirmDialog, cx, Empty, Icon, IconButton, Input, MarkdownField, ReorderButtons, SaveStatus, Seg, toast, ToolbarSpacer, type SaveState } from "@fielder/ui";
import { DrawSurface } from "./DrawSurface";
import { DrawToolbar, drawingKeys, LookSection, ShapeSection, useDrawingEditor } from "./editor";
import type { CanvasRect } from "./geometry";
import { BLUR_FRACTION, renderOverlay, renderSketch, vignetteCss } from "./render";

/** The open item as edited. */
type Doc =
  | { kind: "overlay"; id: string; photoId: string; name: string; description: string; shapes: Shape[]; look: Look; presentation: Presentation; position: number; isNew: boolean }
  | { kind: "sketch"; id: string; name: string; sketchKind: string | null; description: string; shapes: Shape[]; aspect: number; position: number; isNew: boolean };

/** Lets the shot view ask before leaving with unsaved changes. */
export type ComposeGuard = MutableRef<(() => Promise<boolean>) | null>;

interface Props {
  shot: Shot;
  photo: Photo;
  photoIndex: number;
  onPhotoIndex: (i: number) => void;
  presets: Preset[];
  /** The view's frame mode: the default presentation of a new overlay. */
  mode: Presentation["mode"];
  onUpdated: (s: Shot) => void;
  onBack: () => void;
  guard: ComposeGuard;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pct = (r: { left: number; top: number; width: number; height: number }) => ({ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` });

export function Compose(p: Props) {
  const { shot, photo } = p;
  const overlays = useMemo(() => shot.overlays.filter((o) => o.photo_id === photo.id), [shot.overlays, photo.id]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [saved, setSaved] = useState<Doc | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const setShapes = (shapes: Shape[]) => setDoc((d) => (d ? { ...d, shapes } : d));
  const ed = useDrawingEditor(doc?.shapes ?? [], setShapes, false);
  const dirty = !!doc && !same(doc, saved);
  const docRef = useRef(doc); docRef.current = doc;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;

  // The shot view asks here before changing stage, shot or photo.
  useEffect(() => {
    p.guard.current = async () => {
      if (!dirtyRef.current) return true;
      const r = await confirmDialog({ title: "Unsaved changes", body: `“${docRef.current?.name}” has changes that are not saved yet.`, confirmLabel: "Discard", danger: true, altLabel: "Save", cancelLabel: "Keep editing" });
      if (r === "alt") { return doSave(); }
      return r === true;
    };
    return () => { p.guard.current = null; };
  }, []);
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, []);
  // Another shot or photo: close the item (the guard already ran).
  useEffect(() => { close(); }, [shot.id, photo.id]);

  function close() { setDoc(null); setSaved(null); ed.reset(false); setSave("idle"); }
  function openDoc(d: Doc) { setDoc(d); setSaved(d.isNew ? null : d); ed.reset(d.kind === "sketch"); setSave("idle"); }
  async function open(kind: "overlay" | "sketch", id: string) {
    if (doc?.id === id) return;
    if (dirty && !(await p.guard.current?.())) return;
    setLoading(id);
    try {
      if (kind === "overlay") {
        const o = await fetchOverlay(id);
        openDoc({ kind, id: o.id, photoId: o.photo_id, name: o.name, description: o.description ?? "", shapes: o.drawing.shapes, look: o.drawing.look ?? { ...NEUTRAL_LOOK }, presentation: o.presentation, position: o.position, isNew: false });
      } else {
        const s = await fetchSketch(id);
        openDoc({ kind, id: s.id, name: s.name, sketchKind: s.kind, description: s.description ?? "", shapes: s.drawing.shapes, aspect: s.aspect, position: s.position, isNew: false });
      }
    } catch (e) { toast(`Could not open: ${(e as Error).message}`, "danger"); } finally { setLoading(null); }
  }
  async function create(kind: "overlay" | "sketch") {
    if (dirty && !(await p.guard.current?.())) return;
    if (kind === "overlay") {
      const n = overlays.length + 1;
      openDoc({ kind, id: crypto.randomUUID(), photoId: photo.id, name: `Overlay ${n}`, description: "", shapes: [], look: { ...NEUTRAL_LOOK }, position: overlays.length,
        presentation: { mode: p.mode, ...rootPresentation(photo) }, isNew: true });
    } else {
      const n = shot.sketches.length + 1;
      openDoc({ kind, id: crypto.randomUUID(), name: `Sketch ${n}`, sketchKind: null, description: "", shapes: [], aspect: 16 / 9, position: shot.sketches.length, isNew: true });
    }
  }

  // ----- save / delete / reorder -----
  async function doSave(): Promise<boolean> {
    const d = docRef.current;
    if (!d) return true;
    setSave("saving");
    try {
      if (d.kind === "overlay") {
        const drawing: Drawing = { v: 1, shapes: d.shapes, look: d.look };
        const render = await renderOverlay(photo, drawing);
        const res = await putOverlay(d.id, { photo_id: d.photoId, name: d.name.trim() || "Overlay", description: d.description.trim() || null, drawing, presentation: d.presentation, position: d.position }, render);
        p.onUpdated(res.shot);
      } else {
        const drawing: Drawing = { v: 1, shapes: d.shapes, look: null };
        const render = await renderSketch(drawing, d.aspect);
        const res = await putSketch(d.id, { shot_id: shot.id, name: d.name.trim() || "Sketch", kind: d.sketchKind, description: d.description.trim() || null, drawing, aspect: d.aspect, position: d.position }, render);
        p.onUpdated(res.shot);
      }
      const now = { ...d, isNew: false };
      setDoc(now); setSaved(now); setSave("saved");
      return true;
    } catch (e) { setSave("error"); toast(`Save failed: ${(e as Error).message}`, "danger"); return false; }
  }
  async function remove() {
    if (!doc) return;
    if (doc.isNew) { close(); return; }
    const ok = await confirmDialog({ title: `Delete “${doc.name}”?`, body: doc.kind === "overlay" ? "The drawing, its look and the render are removed. The photo stays." : "The sketch and its render are removed.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      const res = doc.kind === "overlay" ? await deleteOverlay(doc.id) : await deleteSketch(doc.id);
      p.onUpdated(res.shot);
      close();
      toast(`${doc.kind === "overlay" ? "Overlay" : "Sketch"} deleted`);
    } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  async function reorder(kind: "overlay" | "sketch", from: number, to: number) {
    const list: (Overlay | Sketch)[] = kind === "overlay" ? overlays : shot.sketches;
    const a = list[from], b = list[to];
    if (!a || !b) return;
    try {
      const patch = kind === "overlay" ? patchOverlay : patchSketch;
      await patch(a.id, { position: to });
      const res = await patch(b.id, { position: from });
      p.onUpdated(res.shot);
      if (doc?.id === a.id) setDoc({ ...doc, position: to }), setSaved((s) => (s ? { ...s, position: to } : s));
    } catch (e) { toast(`Reorder failed: ${(e as Error).message}`, "danger"); }
  }

  useKeys(drawingKeys(ed, {
    save: () => { void doSave(); },
    escape: () => { if (ed.textEdit) { ed.setTextEdit(null); return; } if (ed.selected) { ed.setSelected(null); return; } if (dirty) { void p.guard.current?.().then((ok: boolean) => { if (ok) { close(); } }); return; } if (doc) { close(); return; } p.onBack(); },
  }));

  // ----- presentation (overlay) -----
  const setPresentation = (patch: Partial<Presentation>) => setDoc((d) => (d && d.kind === "overlay" ? { ...d, presentation: { ...d.presentation, ...patch } } : d));

  // ----- surface geometry -----
  const layout = doc?.kind === "overlay" ? framedLayout(photo, doc.presentation.mode, presentationFrame(photo, doc.presentation)) : null;
  const aspect = doc?.kind === "sketch" ? doc.aspect : layout?.aspect ?? 4 / 3;
  const canvasOf = (w: number, h: number): CanvasRect => (layout ? { x: (layout.img.left / 100) * w, y: (layout.img.top / 100) * h, w: (layout.img.width / 100) * w, h: (layout.img.height / 100) * h } : { x: 0, y: 0, w, h });
  const background = (size: { w: number; h: number }, c: CanvasRect): ComponentChildren => {
    if (!doc || doc.kind !== "overlay" || !layout) return null;
    const look = doc.look;
    return (
      <Framed photo={photo} mode={doc.presentation.mode} frame={presentationFrame(photo, doc.presentation)} className="compose__photo" imgStyle={{ filter: lookFilter(look, c.w * BLUR_FRACTION) }}>
        {look.tint && look.tint_opacity > 0 && <div class="compose__layer" style={{ ...pct(layout.img), background: look.tint, opacity: look.tint_opacity }} />}
        {look.vignette > 0 && <div class="compose__layer" style={{ ...pct(layout.img), background: vignetteCss(look.vignette) }} />}
      </Framed>
    );
  };

  const n = shot.photos.length;
  const itemButton = (it: Overlay | Sketch, kind: "overlay" | "sketch") => (
    <button key={it.id} type="button" role="option" aria-selected={doc?.id === it.id} class={cx("f-strip__it", "compose__item", doc?.id === it.id && "is-sel", loading === it.id && "is-loading")} title={it.name} onClick={() => void open(kind, it.id)}>
      {it.render_url ? <img src={it.render_url} alt="" loading="lazy" /> : <span class="compose__item-empty"><Icon name={kind === "overlay" ? "layers-outline" : "floor-plan"} /></span>}
      <span class="f-strip__lbl">{it.name}</span>
    </button>
  );

  return (
    <>
      <section class="f-stage" aria-label="Compose">
        <div class="f-stage__bar">
          {doc ? (
            <>
              <DrawToolbar ed={ed} />
              <ToolbarSpacer />
              <span class="meta">{doc.kind === "overlay" ? `${frameModeLabel(doc.presentation.mode)} · ${doc.presentation.label ?? "as shot"}` : `${sketchKindLabel(doc.sketchKind) || "Sketch"} · ${SKETCH_ASPECTS.find((a) => Math.abs(a.aspect - doc.aspect) < 0.01)?.id ?? doc.aspect.toFixed(2)}`}</span>
            </>
          ) : (
            <>
              <span class="meta">{n > 1 ? `Overlays belong to one photo · photo ${p.photoIndex + 1} of ${n}` : "Overlays draw on the photo; sketches are free canvases"}</span>
              <ToolbarSpacer />
              <FromTimelines shot={shot} photo={photo} kinds={["overlay", "sketch"]} onUpdated={p.onUpdated} />
              <Button kind="ghost" size="sm" kbd="Esc" onClick={p.onBack}>Back to photo</Button>
            </>
          )}
        </div>
        <div class="f-stage__view compose__view">
          {doc ? (
            <DrawSurface shapes={doc.shapes} onPreview={ed.preview} onCommit={ed.commit} selected={ed.selected} onSelect={ed.setSelected} tool={ed.tool} style={ed.style} mask={ed.mask}
              canvasOf={canvasOf} aspect={aspect} maxHeight="calc(100cqh - 300px)" background={background} sketch={doc.kind === "sketch"} textEdit={ed.textEdit} onTextEdit={ed.setTextEdit} onTextDone={ed.textDone} />
          ) : (
            <Empty icon="draw" title={overlays.length + shot.sketches.length ? "Pick an overlay or sketch" : "Nothing composed yet"} actions={<><Button icon="layers-plus" onClick={() => void create("overlay")}>New overlay</Button><Button kind="secondary" icon="floor-plan" onClick={() => void create("sketch")}>New sketch</Button></>}>
              An overlay draws on this photo and can change its look; a sketch is a floor plan or diagram for the shot.
            </Empty>
          )}
        </div>
        <div class="f-stage__foot compose__foot">
          {n > 1 && (
            <div class="btn-row" style={{ gap: "2px", flexWrap: "nowrap" }}>
              <IconButton kind="secondary" icon="chevron-left" label="Previous photo (,)" disabled={p.photoIndex === 0} onClick={() => p.onPhotoIndex(p.photoIndex - 1)} />
              <span class="meta num" style={{ whiteSpace: "nowrap" }}>Photo {p.photoIndex + 1}/{n}</span>
              <IconButton kind="secondary" icon="chevron-right" label="Next photo (.)" disabled={p.photoIndex === n - 1} onClick={() => p.onPhotoIndex(p.photoIndex + 1)} />
            </div>
          )}
          <div class="f-strip compose__items" role="listbox" aria-label="Overlays and sketches">
            {overlays.map((o) => itemButton(o, "overlay"))}
            <button type="button" class="f-strip__it compose__item compose__item--new" title="New overlay on this photo" onClick={() => void create("overlay")}><Icon name="layers-plus" /><span>Overlay</span></button>
            <span class="compose__sep" />
            {shot.sketches.map((s) => itemButton(s, "sketch"))}
            <button type="button" class="f-strip__it compose__item compose__item--new" title="New sketch" onClick={() => void create("sketch")}><Icon name="plus" /><span>Sketch</span></button>
          </div>
          <ToolbarSpacer />
          {doc && (
            <div class="btn-row" style={{ gap: "8px", flexWrap: "nowrap" }}>
              <SaveStatus state={dirty ? "dirty" : save} onRetry={() => void doSave()} savedLabel={doc.isNew ? "Not saved yet" : "Saved"} />
              <Button size="sm" icon="content-save-outline" kbd="⌘S" disabled={!dirty && !doc.isNew} onClick={() => void doSave()}>Save</Button>
            </div>
          )}
        </div>
      </section>

      <aside class="f-panel inspector" aria-label="Compose panel">
        <div class="f-panel__body f-panel__body--flush">
          {!doc ? (
            <div class="f-sec">
              <div class="f-sec__head"><Icon name="draw" />Compose</div>
              <p class="meta" style={{ margin: 0 }}>Overlays here belong to the photo on stage ({overlays.length}); the shot has {shot.sketches.length} sketch{shot.sketches.length === 1 ? "" : "es"}.</p>
              <p class="meta" style={{ margin: 0 }}>Keys while editing: V P L A R O T S E tools · 1–0 colours · ⌘Z undo · Del removes the selected shape · ⌘S saves.</p>
            </div>
          ) : (
            <>
              <div class="f-sec" style={{ gap: "10px" }}>
                <div class="inspector__title"><h1 style={{ fontSize: "var(--text-title)" }}>{doc.kind === "overlay" ? "Overlay" : "Sketch"}</h1><span class="meta">{doc.kind === "overlay" && n > 1 ? `photo ${p.photoIndex + 1} of ${n}` : ""}</span></div>
                <div class="f-formgrid">
                  <label for="cmp-name">Name</label>
                  <Input sm id="cmp-name" value={doc.name} maxLength={80} onInput={(e) => setDoc({ ...doc, name: (e.target as HTMLInputElement).value })} />
                  {doc.kind === "sketch" && (
                    <>
                      <label>Kind</label>
                      <Combobox small options={SKETCH_KINDS.map((k) => ({ value: k, label: SKETCH_KIND_LABELS[k] }))} value={doc.sketchKind} placeholder="Floor plan, lighting…" onChange={(v) => setDoc({ ...doc, sketchKind: v })} onCreate={(t) => setDoc({ ...doc, sketchKind: t.slice(0, 40) })} />
                      <label>Canvas</label>
                      <Seg label="Canvas aspect" value={SKETCH_ASPECTS.find((a) => Math.abs(a.aspect - doc.aspect) < 0.01)?.id ?? "16:9"} onChange={(id) => setDoc({ ...doc, aspect: SKETCH_ASPECTS.find((a) => a.id === id)!.aspect })} options={SKETCH_ASPECTS.map((a) => ({ id: a.id, label: a.id }))} />
                    </>
                  )}
                </div>
                <div class="btn-row" style={{ flexWrap: "nowrap", gap: "6px" }}>
                  {!doc.isNew && <ReorderButtons index={doc.position} count={doc.kind === "overlay" ? overlays.length : shot.sketches.length} onMove={(i, d) => void reorder(doc.kind, i, i + d)} onRemove={() => void remove()} remove={{ label: "Delete…" }} />}
                  <span class="grow" />
                  <Button kind="danger" size="sm" icon={doc.isNew ? "close" : "delete-outline"} onClick={() => void remove()}>{doc.isNew ? "Discard" : "Delete…"}</Button>
                </div>
              </div>

              {doc.kind === "overlay" && (
                <>
                  <div class="f-sec">
                    <div class="f-sec__head"><Icon name="vector-rectangle" />Presentation<span class="f-sec__aside">default view of this overlay</span></div>
                    <Seg label="Frame mode" value={doc.presentation.mode} onChange={(m) => setPresentation({ mode: m })} options={PRESENTATION_MODES.map((m) => ({ id: m, label: frameModeLabel(m) }))} />
                    {photo.source === "camera" && <FramingSelect photo={photo} value={doc.presentation} onChange={setPresentation} />}
                    <span class="meta">The drawing stays in place in every mode and rig; this is only how it opens.</span>
                  </div>
                  <LookSection look={doc.look} onLook={(look) => setDoc({ ...doc, look })} />
                </>
              )}

              <ShapeSection ed={ed} />

              <div class="f-sec">
                <div class="f-sec__head"><Icon name="text-long" />Description</div>
                <MarkdownField value={doc.description} onChange={(v) => setDoc({ ...doc, description: v })} rows={5} placeholder={doc.kind === "overlay" ? "What this look or marking means…" : "What the sketch shows…"} />
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

export { emptyDrawing };
