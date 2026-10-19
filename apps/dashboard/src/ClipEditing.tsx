import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { lookFilter, NEUTRAL_LOOK, SKETCH_ASPECTS, withCentre, type Drawing, type Look, type Presentation, type Shape } from "@fielder/vocab";
import { deleteClipSketch, deleteOverlay, fetchOverlay, fetchSketch, putClipOverlay, putClipSketch, type Photo, type Preset, type Timeline, type TimelineClip } from "./api";
import { DrawSurface } from "./compose/DrawSurface";
import { DrawToolbar, drawingKeys, LookSection, ShapeSection, useDrawingEditor } from "./compose/editor";
import type { CanvasRect } from "./compose/geometry";
import { BLUR_FRACTION, renderOverlay, renderSketch, vignetteCss } from "./compose/render";
import { frameModeLabel } from "./format";
import { Framed, framedLayout, type MaskMode } from "./Framed";
import { FramingSelect, presentationFrame, rootPresentation } from "./FramingSelect";
import { bind, NUDGE, useKeys } from "./keys";
import { AS_SHOT, choiceLabel, DragFrame, frameForChoice, lensesFor, Pickers, type RigChoice } from "./RigExplorer";
import { DRAWER_RESIZE, ownReframe, STAGE_H, type Cut, type ResolvedClip } from "./TimelineParts";
import { Button, confirmDialog, Empty, Icon, Input, Panel, PanelBody, PanelHead, SaveStatus, Seg, Spinner, toast, type SaveState } from "@fielder/ui";

/**
 * Inline clip editing on the timeline stage (issue #31), like a video editor's inspector: the
 * frame handle or the drawing canvas goes onto the stage, the settings into the right drawer.
 * Everything is timeline-scoped: a re-frame writes only the clip's presentation, an overlay or a
 * sketch belongs to the clip until it is promoted to the shot (shot view → From timelines).
 * Changes save on their own: the clip with the timeline's autosave, a drawing 1.2 s after the last
 * stroke and when the edit ends.
 */

export type EditKind = "reframe" | "overlay" | "sketch";


type OverlayDoc = { kind: "overlay"; id: string; name: string; shapes: Shape[]; look: Look; isNew: boolean };
type SketchDoc = { kind: "sketch"; id: string; name: string; shapes: Shape[]; aspect: number; isNew: boolean };
type Doc = OverlayDoc | SketchDoc;

interface Options {
  timeline: Timeline;
  clips: ResolvedClip[];
  presets: Preset[];
  /** Write the timeline (autosaved by the page's store). */
  onChange: (t: Timeline) => void;
}

export interface ClipEditing {
  editing: { kind: EditKind; clipId: string } | null;
  start: (kind: EditKind, c: ResolvedClip) => void;
  /** End the edit; a drawing with changes is saved first. Resolves false when that save failed. */
  stop: () => Promise<boolean>;
  stage: ComponentChildren | null;
  panel: ComponentChildren | null;
}

const SAVE_DELAY = 1200;
/** What a save compares: the drawing's content, not whether it was saved before. */
const json = (d: Doc | null) => JSON.stringify(d ? { ...d, isNew: undefined } : null);

export function useClipEditing({ timeline, clips, presets, onChange }: Options): ClipEditing {
  const [editing, setEditing] = useState<{ kind: EditKind; clipId: string } | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const savedJson = useRef<string>("null");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const tRef = useRef(timeline); tRef.current = timeline;
  const docRef = useRef(doc); docRef.current = doc;
  const setShapes = (shapes: Shape[]) => setDoc((d) => (d ? { ...d, shapes } : d));
  const ed = useDrawingEditor(doc?.shapes ?? [], setShapes, doc?.kind === "sketch");

  const c = editing ? clips.find((x) => x.clip.id === editing.clipId) ?? null : null;
  const cRef = useRef(c); cRef.current = c;
  // The clip went away (removed, or its shot deleted): the edit ends without saving.
  useEffect(() => { if (editing && !c) { setEditing(null); setDoc(null); } }, [editing, c]);

  const patchClip = (id: string, patch: Partial<TimelineClip>, extra?: Partial<Timeline>) => {
    const t = tRef.current;
    onChange({ ...t, ...extra, clips: t.clips.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  };

  // ----- saving a drawing: serialized, the clip points at the row only after it exists -----
  async function persist(): Promise<boolean> {
    const d = docRef.current, cl = cRef.current, t = tRef.current;
    if (!d || !cl || json(d) === savedJson.current) return true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const snapshot = json(d);
    setSave("saving");
    try {
      const owner = { timeline_id: t.id, clip_id: cl.clip.id };
      if (d.kind === "overlay" && cl.kind === "photo") {
        const drawing: Drawing = { v: 1, shapes: d.shapes, look: d.look };
        const res = await putClipOverlay(d.id, { photo_id: cl.photo.id, name: d.name.trim() || "Clip overlay", description: null, drawing, presentation: cl.pres, ...owner }, await renderOverlay(cl.photo, drawing));
        const { drawing: _drawing, ...row } = res.overlay;
        const now = tRef.current;
        patchClip(cl.clip.id, { overlay_id: row.id }, { overlays: [...now.overlays.filter((o) => o.id !== row.id), row] });
      } else if (d.kind === "sketch") {
        const drawing: Drawing = { v: 1, shapes: d.shapes, look: null };
        const name = d.name.trim() || "Sketch";
        const res = await putClipSketch(d.id, { name, kind: null, description: null, drawing, aspect: d.aspect, ...owner }, await renderSketch(drawing, d.aspect));
        const { drawing: _drawing, ...row } = res.sketch;
        const now = tRef.current;
        patchClip(cl.clip.id, { sketch_id: row.id, title: name.slice(0, 120) }, { sketches: [...now.sketches.filter((k) => k.id !== row.id), row] });
      }
      savedJson.current = snapshot;
      setDoc((cur) => (cur && cur.id === d.id ? { ...cur, isNew: false } : cur));
      if (json(docRef.current) === snapshot || docRef.current?.id !== d.id) setSave("saved"); else setSave("dirty");
      return true;
    } catch (e) {
      setSave("error");
      toast(`Saving the drawing failed: ${(e as Error).message}`, "danger");
      return false;
    }
  }
  const saveNow = () => (chain.current = chain.current.then(persist, persist));
  // Autosave after the last change.
  useEffect(() => {
    if (!doc || json(doc) === savedJson.current) return;
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveNow(); }, SAVE_DELAY);
  }, [doc]);
  // Leaving the page mid-edit still saves the drawing.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); void persist(); }, []);

  async function stop(): Promise<boolean> {
    if (!editing) return true;
    const ok = await saveNow();
    if (!ok) {
      const r = await confirmDialog({ title: "The drawing is not saved", body: "Saving it failed. Leave the edit anyway? The changes since the last save are lost.", confirmLabel: "Leave without saving", danger: true, cancelLabel: "Keep editing" });
      if (!r) return false;
    }
    setEditing(null); setDoc(null); savedJson.current = "null"; setSave("idle");
    return true;
  }

  async function start(kind: EditKind, cl: ResolvedClip) {
    if (editing && !(await stop())) return;
    if (kind === "reframe") {
      if (cl.kind !== "photo" || cl.photo.source !== "camera") return;
      setEditing({ kind, clipId: cl.clip.id });
      return;
    }
    if (kind === "overlay" && cl.kind !== "photo") return;
    if (kind === "sketch" && cl.kind === "photo") return;
    setEditing({ kind, clipId: cl.clip.id });
    setLoading(true);
    try {
      let d: Doc;
      if (kind === "overlay" && cl.kind === "photo") {
        const own = cl.overlay?.clip_id === cl.clip.id;
        if (cl.overlay) {
          // A shot overlay is edited as a copy for this clip: the shot keeps its own.
          const o = await fetchOverlay(cl.overlay.id);
          d = { kind: "overlay", id: own ? o.id : crypto.randomUUID(), name: own ? o.name : `${o.name} · clip`.slice(0, 80), shapes: o.drawing.shapes, look: o.drawing.look ?? { ...NEUTRAL_LOOK }, isNew: !own };
        } else d = { kind: "overlay", id: crypto.randomUUID(), name: "Clip overlay", shapes: [], look: { ...NEUTRAL_LOOK }, isNew: true };
      } else {
        const sk = cl.kind === "sketch" ? cl.sketch : null;
        const own = sk?.clip_id === cl.clip.id;
        if (sk) {
          const k = await fetchSketch(sk.id);
          d = { kind: "sketch", id: own ? k.id : crypto.randomUUID(), name: k.name, shapes: k.drawing.shapes, aspect: k.aspect, isNew: !own };
        } else d = { kind: "sketch", id: crypto.randomUUID(), name: cl.clip.title ?? "Sketch", shapes: [], aspect: 16 / 9, isNew: true };
      }
      // A copy (or a new drawing) is unsaved until its first change.
      savedJson.current = json(d);
      setDoc(d);
      ed.reset(d.kind === "sketch");
      setSave(d.isNew ? "idle" : "saved");
    } catch (e) {
      toast(`Could not open the drawing: ${(e as Error).message}`, "danger");
      setEditing(null);
    } finally { setLoading(false); }
  }

  async function discard() {
    const d = docRef.current, cl = cRef.current;
    if (!d || !cl) return;
    const ok = await confirmDialog({ title: `Delete “${d.name}”?`, body: d.kind === "overlay" ? "The clip's own overlay is removed; the clip shows the photo as is." : "The clip's own sketch is removed; the clip becomes a placeholder again.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      const t = tRef.current;
      if (!d.isNew || json(d) !== savedJson.current) {
        if (d.kind === "overlay" && t.overlays.some((o) => o.id === d.id)) await deleteOverlay(d.id);
        if (d.kind === "sketch" && t.sketches.some((k) => k.id === d.id)) await deleteClipSketch(d.id);
      }
      const now = tRef.current;
      if (d.kind === "overlay") patchClip(cl.clip.id, cl.clip.overlay_id === d.id ? { overlay_id: null } : {}, { overlays: now.overlays.filter((o) => o.id !== d.id) });
      else patchClip(cl.clip.id, cl.clip.sketch_id === d.id ? { sketch_id: null } : {}, { sketches: now.sketches.filter((k) => k.id !== d.id) });
      savedJson.current = "null";
      setEditing(null); setDoc(null); setSave("idle");
    } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }

  // ----- keys: the edit mode owns them, the timeline's map is off meanwhile (modal scopes in shortcuts.ts) -----
  const drawing = !!editing && editing.kind !== "reframe";
  useKeys(drawingKeys(ed, {
    save: () => { void saveNow(); },
    escape: () => { if (ed.textEdit) { ed.setTextEdit(null); return; } if (ed.selected) { ed.setSelected(null); return; } void stop(); },
  }), drawing && !!doc);
  const reframe = editing?.kind === "reframe" && c?.kind === "photo" ? c : null;
  const rf = reframeOf(reframe, presets, (patch) => reframe && patchClip(reframe.clip.id, { presentation: { ...reframe.pres, ...patch } }));
  useKeys(bind("reframe", {
    lensDown: () => rf?.stepLens(-1),
    lensUp: () => rf?.stepLens(1),
    nudge: (e) => { const d = NUDGE[e.key]; if (d) rf?.nudge(d[0], d[1]); },
    done: () => { void stop(); },
  }), !!reframe);

  if (!editing || !c) return { editing: null, start: (k, cl) => void start(k, cl), stop, stage: null, panel: null };

  // ----- stage + panel per mode -----
  let stage: ComponentChildren = null, panel: ComponentChildren = null;
  const done = <Button size="sm" icon="check" kbd="Esc" onClick={() => void stop()}>Done</Button>;
  const promoteHint = (what: string) => <span class="meta"><Icon name="information-outline" size={14} /> Timeline only. To make this {what} the shot's: shot view → {what === "re-frame" ? "Framing" : "Compose"} → From timelines.</span>;

  if (reframe && rf) {
    stage = (
      <Framed photo={reframe.photo} mode={rf.editMode} frame={rf.frame} maxHeight={STAGE_H}>
        {rf.frame && <DragFrame photo={reframe.photo} frame={rf.frame} mode={rf.editMode} onMove={rf.move} />}
      </Framed>
    );
    panel = (
      <Panel label="Re-frame" width="340px" resize={DRAWER_RESIZE}>
        <PanelHead title="Re-frame">{done}</PanelHead>
        <PanelBody>
          {!rf.frame ? <span class="meta">This photo has no framing data: it cannot be re-framed.</span> : (
            <>
              <span class="meta"><Icon name="cursor-move" size={14} /> Drag the frame on the stage · ⇧ + arrows nudge · ←/→ lens</span>
              <div class="tl-pickers"><Pickers photo={reframe.photo} presets={presets} choice={rf.choice} onChoice={rf.setChoice} /></div>
              <div class="f-field"><span class="f-field__label">Start from</span><FramingSelect photo={reframe.photo} value={reframe.pres} onChange={(patch) => patchClip(reframe.clip.id, { presentation: { ...reframe.pres, ...patch } })} /></div>
              <div class="btn-row"><Button kind="secondary" size="sm" icon="restore" onClick={() => patchClip(reframe.clip.id, { presentation: { ...reframe.pres, ...rootPresentation(reframe.photo) } })}>Back to the root frame</Button></div>
              <span class="f-field__help">{ownReframe(reframe.pres) ? <><Icon name="crop" size={14} /> This clip's own re-frame · {reframe.pres.label}</> : `Uses ${reframe.pres.label ?? "the frame as shot"}; moving the frame makes it the clip's own.`}</span>
              {promoteHint("re-frame")}
            </>
          )}
        </PanelBody>
      </Panel>
    );
  } else if (loading || !doc) {
    stage = <div class="tl-preview__empty"><Spinner /></div>;
    panel = <Panel label="Loading" width="340px" resize={DRAWER_RESIZE}><PanelHead title="Opening…">{done}</PanelHead><PanelBody><Spinner /></PanelBody></Panel>;
  } else if (doc.kind === "overlay" && c.kind === "photo") {
    const pres = c.pres;
    const frame = presentationFrame(c.photo, pres);
    const layout = framedLayout(c.photo, pres.mode, frame);
    const canvasOf = (w: number, h: number): CanvasRect => ({ x: (layout.img.left / 100) * w, y: (layout.img.top / 100) * h, w: (layout.img.width / 100) * w, h: (layout.img.height / 100) * h });
    const look = doc.look;
    stage = (
      <DrawSurface shapes={doc.shapes} onPreview={ed.preview} onCommit={ed.commit} selected={ed.selected} onSelect={ed.setSelected} tool={ed.tool} style={ed.style} mask={ed.mask}
        canvasOf={canvasOf} aspect={layout.aspect} maxHeight={STAGE_H} sketch={false} textEdit={ed.textEdit} onTextEdit={ed.setTextEdit} onTextDone={ed.textDone}
        background={(_size, cv) => (
          <Framed photo={c.photo} mode={pres.mode} frame={frame} className="compose__photo" imgStyle={{ filter: lookFilter(look, cv.w * BLUR_FRACTION) }}>
            {look.tint && look.tint_opacity > 0 && <div class="compose__layer" style={pct(layout.img, { background: look.tint, opacity: look.tint_opacity })} />}
            {look.vignette > 0 && <div class="compose__layer" style={pct(layout.img, { background: vignetteCss(look.vignette) })} />}
          </Framed>
        )} />
    );
    panel = (
      <Panel label="Overlay" width="380px" resize={DRAWER_RESIZE}>
        <PanelHead title="Overlay"><SaveStatus state={save} onRetry={() => void saveNow()} savedLabel={doc.isNew ? "Not saved yet" : "Saved"} />{done}</PanelHead>
        <PanelBody flush>
          <div class="f-sec tl-drawbar"><DrawToolbar ed={ed} compact /></div>
          <div class="f-sec">
            <div class="f-formgrid"><label for="clip-ov-name">Name</label><Input sm id="clip-ov-name" value={doc.name} maxLength={80} onInput={(e) => setDoc({ ...doc, name: (e.target as HTMLInputElement).value })} /></div>
            <span class="meta">Drawn in {frameModeLabel(pres.mode)} · {pres.label ?? "as shot"}; it stays on the photo in every frame.</span>
            {promoteHint("overlay")}
          </div>
          <LookSection look={doc.look} onLook={(l) => setDoc({ ...doc, look: l })} />
          <ShapeSection ed={ed} />
          <div class="f-sec"><div class="btn-row"><Button kind="danger" size="sm" icon={doc.isNew ? "close" : "delete-outline"} onClick={() => void discard()}>{doc.isNew ? "Discard" : "Delete overlay…"}</Button></div></div>
        </PanelBody>
      </Panel>
    );
  } else if (doc.kind === "sketch") {
    stage = (
      <DrawSurface shapes={doc.shapes} onPreview={ed.preview} onCommit={ed.commit} selected={ed.selected} onSelect={ed.setSelected} tool={ed.tool} style={ed.style} mask={ed.mask}
        canvasOf={(w, h) => ({ x: 0, y: 0, w, h })} aspect={doc.aspect} maxHeight={STAGE_H} sketch background={() => null}
        textEdit={ed.textEdit} onTextEdit={ed.setTextEdit} onTextDone={ed.textDone} />
    );
    panel = (
      <Panel label="Sketch" width="380px" resize={DRAWER_RESIZE}>
        <PanelHead title="Sketch"><SaveStatus state={save} onRetry={() => void saveNow()} savedLabel={doc.isNew ? "Not saved yet" : "Saved"} />{done}</PanelHead>
        <PanelBody flush>
          <div class="f-sec tl-drawbar"><DrawToolbar ed={ed} compact /></div>
          <div class="f-sec">
            <div class="f-formgrid">
              <label for="clip-sk-name">Name</label>
              <Input sm id="clip-sk-name" value={doc.name} maxLength={80} onInput={(e) => setDoc({ ...doc, name: (e.target as HTMLInputElement).value })} />
              <label>Canvas</label>
              <Seg label="Canvas aspect" value={SKETCH_ASPECTS.find((a) => Math.abs(a.aspect - doc.aspect) < 0.01)?.id ?? "16:9"} onChange={(id) => setDoc({ ...doc, aspect: SKETCH_ASPECTS.find((a) => a.id === id)!.aspect })} options={SKETCH_ASPECTS.map((a) => ({ id: a.id, label: a.id }))} />
            </div>
            <span class="meta">The name is the clip's title too.</span>
            {promoteHint("sketch")}
          </div>
          <ShapeSection ed={ed} />
          <div class="f-sec"><div class="btn-row"><Button kind="danger" size="sm" icon={doc.isNew ? "close" : "delete-outline"} onClick={() => void discard()}>{doc.isNew ? "Discard" : "Back to a placeholder…"}</Button></div></div>
        </PanelBody>
      </Panel>
    );
  } else {
    stage = <Empty icon="alert-outline" title="Nothing to edit" />;
  }
  return { editing, start: (k, cl) => void start(k, cl), stop, stage: <div class="tl-stage__edit">{stage}</div>, panel };
}

const pct = (r: { left: number; top: number; width: number; height: number }, extra: Record<string, string | number>) => ({ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`, ...extra });

/** The re-frame of one clip, derived from its presentation: rig + lens give the size, the drag gives the centre. */
function reframeOf(c: Extract<ResolvedClip, { kind: "photo" }> | null, presets: Preset[], onPatch: (p: Partial<Presentation>) => void) {
  if (!c) return null;
  const photo: Photo = c.photo, pres = c.pres;
  const choice: RigChoice = { rig: pres.rig_id ?? AS_SHOT, lensMm: pres.lens_mm ?? photo.lens_mm };
  const current = presentationFrame(photo, pres);
  const centre = current ? withCentre(current) : { x: 0.5, y: 0.5 };
  const sizeOf = (ch: RigChoice) => frameForChoice(photo, presets, ch);
  const place = (ch: RigChoice, ctr: { x: number; y: number }) => { const s = sizeOf(ch); return s ? withCentre({ ...s, ...ctr }) : null; };
  const frame = place(choice, centre);
  const write = (ch: RigChoice, ctr: { x: number; y: number }) => {
    const f = place(ch, ctr);
    if (!f) return;
    onPatch({ frame: f, framing_id: null, rig_id: ch.rig === AS_SHOT ? null : ch.rig, lens_mm: ch.lensMm, label: `${choiceLabel(photo, presets, ch)} · re-framed` });
  };
  const lenses = lensesFor(presets.find((p) => p.id === choice.rig), [photo.lens_mm]);
  return {
    choice, frame,
    // Fit and raw cannot show where the frame sits.
    editMode: (pres.mode === "frame" ? "frame" : "mask") as MaskMode,
    setChoice: (ch: RigChoice) => write(ch, centre),
    move: (ctr: { x: number; y: number }) => write(choice, ctr),
    nudge: (dx: number, dy: number) => write(choice, { x: centre.x + dx, y: centre.y + dy }),
    stepLens: (d: number) => {
      const i = lenses.indexOf(choice.lensMm);
      const n = lenses[Math.max(0, Math.min(lenses.length - 1, (i < 0 ? lenses.findIndex((x) => x > choice.lensMm) : i) + d))];
      if (n) write({ ...choice, lensMm: n }, centre);
    },
  };
}



/**
 * The cut as the strip and transport may move it while a clip is edited inline: pinned (Settings →
 * Timeline), moving away only explains why not; otherwise it ends the edit first (saving it).
 */
export function guardCut(cut: Cut, inline: ClipEditing, mode: "pin" | "leave"): Cut {
  if (!inline.editing) return cut;
  const leaving = (go: () => void) => {
    if (mode === "pin") { toast("Finish the edit first (Done or Esc). Settings → Timeline lets moving away end it.", "info"); return; }
    void inline.stop().then((ok) => { if (ok) go(); });
  };
  return { ...cut, select: (id) => leaving(() => cut.select(id)), seek: (id, ms) => leaving(() => cut.seek(id, ms)), step: (d) => leaving(() => cut.step(d)), toggle: () => leaving(cut.toggle) };
}
