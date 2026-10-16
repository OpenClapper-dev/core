import { useMemo, useRef } from "preact/hooks";
import { computeFraming, LENS_PRESETS_MM, reframe, type RigLens } from "@fielder/fov-math";
import { canMove, clampCentre, resize, withCentre, type Framing } from "@fielder/vocab";
import { deleteFraming, putFraming, setRootFraming, type Photo, type Preset, type Shot } from "./api";
import { capturedFrameOf, frameLayout, imageAspect, sourceRigOf, type FrameGeometry } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { FromTimelines } from "./FromTimelines";
import { bind, NUDGE, useKeys } from "./keys";
import { initialStack, StackBar, StackCanvas, StackLayers, type StackState } from "./StackedFrames";
import { Button, Checkbox, confirmDialog, cx, Empty, Icon, IconButton, promptDialog, Seg, Select, toast, ToolbarSpacer } from "./ui";

/**
 * Shot view stage "Framing" (was Rigs; issue #29). Re-frame a photo for another rig and lens and
 * move the frame on it: the phone usually saw more than the rig. Framings are saved per photo
 * ("As captured" always exists and is never changed); one of them can be the photo's root, which
 * every view on both clients shows. Compare A / B shows two rigs side by side, Stacked any number
 * of frames on one photo (issue #47).
 */

/** "as shot" = the rig the photo was framed with; otherwise a preset id. */
export interface RigChoice { rig: string; lensMm: number }
export const AS_SHOT = "__as_shot__";
export interface RigsState {
  view: "one" | "compare" | "stack";
  a: RigChoice;
  b: RigChoice;
  stack: StackState;
  /** The saved framing being edited; null = as captured or a new, unsaved one. */
  framingId: string | null;
  /** Centre of the frame on the photo (fractions). */
  centre: { x: number; y: number };
}
const CENTRE = { x: 0.5, y: 0.5 };
const choiceOfFraming = (f: Framing): RigChoice => ({ rig: f.rig_id ?? AS_SHOT, lensMm: f.lens_mm });
/** Opens on the photo's root framing, or as captured. */
export function initialRigs(photo: Photo, presets: Preset[]): RigsState {
  const root = photo.framings.find((f) => f.id === photo.root_framing_id);
  const a = root ? choiceOfFraming(root) : { rig: AS_SHOT, lensMm: photo.lens_mm };
  const b = { rig: presets.find((p) => p.id !== photo.preset_id)?.id ?? AS_SHOT, lensMm: photo.lens_mm };
  return {
    view: "one",
    a,
    b,
    stack: initialStack(a, b),
    framingId: root?.id ?? null,
    centre: root ? clampCentre(root.frame) : CENTRE,
  };
}

const lensRange = (p: Preset | undefined) => (p?.lens_min_mm != null && p.lens_max_mm != null ? { min: p.lens_min_mm, max: p.lens_max_mm } : null);
export function lensesFor(p: Preset | undefined, extra: number[]): number[] {
  const r = lensRange(p);
  const list = [...LENS_PRESETS_MM, ...extra].filter((mm) => mm > 0 && (!r || (mm >= r.min && mm <= r.max)));
  if (r) list.push(r.min, r.max);
  return [...new Set(list)].sort((a, b) => a - b);
}

/** The rig frame's size on this photo for a rig + lens choice (as shot = the captured frame), centred; null without framing data. */
export function frameForChoice(photo: Photo, presets: Preset[], choice: RigChoice): FrameGeometry | null {
  const source = sourceRigOf(photo);
  if (!source) return null;
  const p = presets.find((x) => x.id === choice.rig);
  const target: RigLens = p
    ? { rig: { sensor: { widthMm: p.sensor_width_mm, heightMm: p.sensor_height_mm }, speedboosterFactor: p.speedbooster_factor }, lensMm: choice.lensMm, portrait: source.rigLens.portrait }
    : { ...source.rigLens, lensMm: choice.lensMm };
  const r = reframe(source.rigLens, source.frame, target);
  return { width_fraction: r.widthFraction, height_fraction: r.heightFraction };
}
/** "6K FULL · 24 mm" for a choice. */
export function choiceLabel(photo: Photo, presets: Preset[], choice: RigChoice): string {
  const name = presets.find((p) => p.id === choice.rig)?.name ?? photo.preset_name ?? (photo.framing?.preset_name as string | undefined) ?? "As shot";
  return `${name} · ${choice.lensMm} mm`;
}

interface Props { shot: Shot; photo: Photo; presets: Preset[]; mode: MaskMode; state: RigsState; onState: (s: RigsState) => void; onBack: () => void; onUpdated: (s: Shot) => void }

const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;

export function RigsStage({ shot, photo, presets, mode, state, onState, onBack, onUpdated }: Props) {
  const source = sourceRigOf(photo);
  const preset = presets.find((p) => p.id === state.a.rig);
  const lenses = useMemo(() => lensesFor(preset, [photo.lens_mm]), [preset, photo.lens_mm]);
  const saved = photo.framings.find((f) => f.id === state.framingId) ?? null;
  const isRoot = (id: string | null) => (photo.root_framing_id ?? null) === id;
  const allPhotos = useRef(false);

  const size = (c: RigChoice) => frameForChoice(photo, presets, c);
  const frameA = (): FrameGeometry | null => { const s = size(state.a); return s ? resize({ ...s, ...state.centre }, s) : null; };
  const isCaptured = !state.framingId && state.a.rig === AS_SHOT && state.a.lensMm === photo.lens_mm && near(state.centre.x, 0.5) && near(state.centre.y, 0.5);
  const dirty = saved ? (saved.rig_id ?? AS_SHOT) !== state.a.rig || saved.lens_mm !== state.a.lensMm || !near(saved.frame.x ?? 0.5, state.centre.x) || !near(saved.frame.y ?? 0.5, state.centre.y) : !isCaptured;

  const setA = (a: RigChoice) => {
    const s = size(a);
    onState({ ...state, a, centre: s ? clampCentre({ ...s, ...state.centre }) : state.centre });
  };
  const pick = (id: string) => {
    if (id === "__captured__") { onState({ ...state, framingId: null, a: { rig: AS_SHOT, lensMm: photo.lens_mm }, centre: CENTRE }); return; }
    const f = photo.framings.find((x) => x.id === id);
    if (f) onState({ ...state, framingId: f.id, a: choiceOfFraming(f), centre: clampCentre(f.frame) });
  };
  const stepLens = (d: number) => {
    const i = lenses.indexOf(state.a.lensMm);
    const n = lenses[Math.max(0, Math.min(lenses.length - 1, (i < 0 ? lenses.findIndex((x) => x > state.a.lensMm) : i) + d))];
    if (n) setA({ ...state.a, lensMm: n });
  };
  const nudge = (dx: number, dy: number) => { const f = frameA(); if (f) onState({ ...state, centre: clampCentre({ ...f, x: state.centre.x + dx, y: state.centre.y + dy }) }); };

  /** Save the current frame as `id` (new or existing) on this photo, or on every photo of the sequence. */
  async function save(id: string | null, name: string, root: boolean) {
    const photos = allPhotos.current && shot.photos.length > 1 ? shot.photos : [photo];
    let last: Shot | null = null;
    let made: string | null = null;
    try {
      for (const ph of photos) {
        const s = frameForChoice(ph, presets, state.a);
        if (!s) continue;
        const fid = ph.id === photo.id && id ? id : crypto.randomUUID();
        if (ph.id === photo.id) made = fid;
        last = await putFraming(fid, { photo_id: ph.id, name, rig_id: state.a.rig === AS_SHOT ? null : state.a.rig, lens_mm: state.a.lensMm, frame: withCentre({ ...s, ...state.centre }), root });
      }
      if (last) { onUpdated(last); onState({ ...state, framingId: made }); toast(root ? `“${name}” is the root frame${photos.length > 1 ? ` of ${photos.length} photos` : ""}` : `Saved “${name}”${photos.length > 1 ? ` on ${photos.length} photos` : ""}`); }
    } catch (e) { toast(`Saving the framing failed: ${(e as Error).message}`, "danger"); }
  }
  async function saveAsNew(root = false) {
    const name = await promptDialog({ title: "Save framing", input: { label: "Name", value: `${choiceLabel(photo, presets, state.a)}${isCaptured ? "" : " · moved"}`, placeholder: "e.g. Tighter, door left" }, confirmLabel: root ? "Save and set as root" : "Save" });
    if (name) await save(null, name, root);
  }
  async function setRoot() {
    if (state.framingId === null && isCaptured) {
      try { onUpdated(await setRootFraming(photo.id, null)); toast("Root frame: as captured"); } catch (e) { toast(`Failed: ${(e as Error).message}`, "danger"); }
      return;
    }
    if (saved && !dirty) {
      try { onUpdated(await setRootFraming(photo.id, saved.id)); toast(`“${saved.name}” is the root frame`); } catch (e) { toast(`Failed: ${(e as Error).message}`, "danger"); }
      return;
    }
    if (saved) await save(saved.id, saved.name, true); else await saveAsNew(true);
  }
  async function remove() {
    if (!saved) return;
    const ok = await confirmDialog({ title: `Delete the framing “${saved.name}”?`, body: `${isRoot(saved.id) ? "It is the root frame: the photo goes back to as captured. " : ""}Overlays and timeline clips that use it keep the frame they had.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try { onUpdated(await deleteFraming(saved.id)); onState({ ...state, framingId: null, a: { rig: AS_SHOT, lensMm: photo.lens_mm }, centre: CENTRE }); toast("Framing deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }

  useKeys(bind("framing", {
    lensDown: () => stepLens(-1),
    lensUp: () => stepLens(1),
    nudge: (e) => { const d = NUDGE[e.key]; if (d) nudge(d[0], d[1]); },
    save: () => { if (saved && dirty) void save(saved.id, saved.name, isRoot(saved.id)); else if (!saved && !isCaptured) void saveAsNew(); },
    back: onBack,
  }), state.view === "one");
  useKeys(bind("framing", { back: onBack }), state.view !== "one");

  if (!source) return <><div class="f-stage__bar"><span class="grow" /><Button kind="ghost" size="sm" kbd="Esc" onClick={onBack}>Back to photo</Button></div><div class="f-stage__view" style={{ color: "#fff" }}><Empty icon="crop-free" title="No framing data">{photo.source === "camera" ? "This photo cannot be re-framed." : "Uploaded and drawn images have no rig: there is nothing to re-frame."}</Empty></div></>;

  const fa = frameA();
  const rigName = (c: RigChoice) => presets.find((p) => p.id === c.rig)?.name ?? `As shot · ${photo.preset_name ?? (photo.framing?.preset_name as string | undefined) ?? "rig"}`;
  const setB = (b: RigChoice) => onState({ ...state, b });
  const editMode: MaskMode = mode === "frame" ? "frame" : "mask"; // fit and raw cannot show where the frame sits
  const options = [
    { value: "__captured__", label: `As captured${isRoot(null) ? " · root" : ""}` },
    ...photo.framings.map((f) => ({ value: f.id, label: `${f.name}${isRoot(f.id) ? " · root" : ""}`, group: "Saved framings" })),
  ];
  const capturedSize = capturedFrameOf(photo);

  return (
    <>
      <div class="f-stage__bar">
        <Seg label="Explorer" value={state.view} onChange={(view) => onState({ ...state, view })} options={[{ id: "one", label: "Framing" }, { id: "compare", label: "Compare A / B" }, { id: "stack", label: "Stacked" }]} />
        {state.view === "stack" && <StackBar stack={state.stack} onStack={(stack) => onState({ ...state, stack })} />}
        {state.view === "one" && (
          <>
            <Select label="Framing" icon="crop" width="220px" value={state.framingId ?? "__captured__"} onChange={pick} options={options} />
            <Pickers photo={photo} presets={presets} choice={state.a} onChoice={setA} />
            {dirty && <span class="f-edited">{saved ? "Edited" : "Not saved"}</span>}
            <FromTimelines shot={shot} photo={photo} kinds={["framing"]} onUpdated={onUpdated} />
          </>
        )}
        <ToolbarSpacer />
        {state.view === "one" && (
          <div class="btn-row" style={{ gap: "6px", flexWrap: "nowrap" }}>
            {shot.photos.length > 1 && <Checkbox checked={allPhotos.current} role="checkbox" aria-checked={allPhotos.current} title="Save the same rig, lens and position on every photo of the sequence" onClick={() => { allPhotos.current = !allPhotos.current; onState({ ...state }); }}>All {shot.photos.length} photos</Checkbox>}
            {saved && dirty && <Button size="sm" kind="secondary" icon="content-save-outline" kbd="⌘S" onClick={() => void save(saved.id, saved.name, isRoot(saved.id))}>Update</Button>}
            {(!saved || dirty) && !isCaptured && <Button size="sm" kind="secondary" icon="content-save-plus-outline" kbd={saved ? undefined : "⌘S"} onClick={() => void saveAsNew()}>Save as new…</Button>}
            {(() => {
              const rootNow = !dirty && ((saved && isRoot(saved.id)) || (!saved && isCaptured && isRoot(null)));
              return <Button size="sm" kind={rootNow ? "approve" : "primary"} icon={rootNow ? "check-circle" : "star-outline"} disabled={!!rootNow} title="Every view, the phone and Download crop show the root frame" onClick={() => void setRoot()}>{rootNow ? "Root frame" : "Set as root"}</Button>;
            })()}
            {saved && <IconButton icon="delete-outline" label="Delete this framing…" title="Delete this framing…" onClick={() => void remove()} />}
          </div>
        )}
        <Button kind="ghost" size="sm" kbd="Esc" onClick={onBack}>Back to photo</Button>
      </div>
      <div class="f-stage__view">
        {state.view === "one" ? (
          fa && <Framed photo={photo} mode={editMode} frame={fa} maxHeight="calc(100cqh - 290px)">
            <DragFrame photo={photo} frame={fa} mode={editMode} onMove={(c) => onState({ ...state, centre: c })} />
          </Framed>
        ) : state.view === "stack" ? (
          <StackCanvas photo={photo} presets={presets} centre={state.centre} stack={state.stack} />
        ) : (
          <div class="compare">
            {([["A", state.a, (a: RigChoice) => onState({ ...state, a })], ["B", state.b, setB]] as const).map(([tag, c, set]) => {
              const s = size(c);
              return (
                <div key={tag} class="compare__pane">
                  <div class="compare__head"><span class="f-board-lbl">{tag}</span><Pickers photo={photo} presets={presets} choice={c} onChoice={set} /></div>
                  <div class="compare__photo">{s && <Framed photo={photo} mode={mode === "off" ? "mask" : mode} frame={tag === "A" ? resize({ ...s, ...state.centre }, s) : s} maxHeight="calc(100cqh - 290px)" />}</div>
                  <span class="compare__facts num">{s ? factsText(rigOf(source.rigLens, presets, c), s) : ""}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {state.view === "stack" && <div class="f-stage__foot"><StackLayers photo={photo} presets={presets} stack={state.stack} onStack={(stack) => onState({ ...state, stack })} /></div>}
      {state.view === "one" && (
        <div class="f-stage__foot">
          <div class="framing-facts">
            <span class="meta num">{fa ? factsText(rigOf(source.rigLens, presets, state.a), fa) : ""}</span>
            <span class="meta">{fa && canMove(fa) ? <><Icon name="cursor-move" size={14} />Drag the frame · ⇧ + arrows nudge · ←/→ lens</> : "This rig sees more than the photo: the frame cannot move."}{capturedSize && !isCaptured ? ` · as captured ${Math.round(capturedSize.width_fraction * 100)} % wide` : ""}</span>
          </div>
          <div class="f-strip" role="listbox" aria-label={`Lenses of ${rigName(state.a)}`}>
            {lenses.map((mm) => {
              const s = size({ ...state.a, lensMm: mm });
              return (
                <button key={mm} type="button" role="option" aria-selected={mm === state.a.lensMm} class={cx("f-strip__it", mm === state.a.lensMm && "is-sel")} title={`${mm} mm`} onClick={() => setA({ ...state.a, lensMm: mm })}>
                  {s && <Framed photo={photo} mode="mask" frame={resize({ ...s, ...state.centre }, s)} />}
                  <span class="f-strip__lbl">{mm} mm</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function rigOf(source: RigLens, presets: Preset[], c: RigChoice): RigLens {
  const p = presets.find((x) => x.id === c.rig);
  if (!p) return { ...source, lensMm: c.lensMm };
  return { rig: { sensor: { widthMm: p.sensor_width_mm, heightMm: p.sensor_height_mm }, speedboosterFactor: p.speedbooster_factor }, lensMm: c.lensMm, portrait: source.portrait };
}

function factsText(rig: RigLens, frame: FrameGeometry): string {
  const f = computeFraming(rig.rig, rig.lensMm);
  const wider = frame.width_fraction > 1 || frame.height_fraction > 1;
  return `FF ${f.fullFrameEquivalentMm.toFixed(1)} mm · HFOV ${f.fov.horizontal.toFixed(1)}° · VFOV ${f.fov.vertical.toFixed(1)}°${wider ? " · sees more than this photo" : ""}`;
}

/** The frame as a drag handle inside a Framed box: moving it moves the frame's centre over the photo (clamped). */
export function DragFrame({ photo, frame, mode, onMove }: { photo: Photo; frame: FrameGeometry; mode: MaskMode; onMove: (c: { x: number; y: number }) => void }) {
  const l = frameLayout(frame, mode, imageAspect(photo));
  const drag = useRef<{ px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);
  if (!l.frame || !canMove(frame)) return null;
  const c = withCentre(frame);
  return (
    <div class="framing-drag" style={{ left: `${l.frame.left}%`, top: `${l.frame.top}%`, width: `${l.frame.width}%`, height: `${l.frame.height}%` }} title="Drag to move the frame"
      onPointerDown={(e) => {
        const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
        // The photo's size in px inside the box (it is shrunk when the rig sees more on one axis).
        drag.current = { px: e.clientX, py: e.clientY, x: c.x, y: c.y, w: (box.width * l.img.width) / 100, h: (box.height * l.img.height) / 100 };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        onMove(clampCentre({ ...frame, x: d.x + (e.clientX - d.px) / d.w, y: d.y + (e.clientY - d.py) / d.h }));
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <span class="framing-drag__grip"><Icon name="cursor-move" /></span>
    </div>
  );
}

export function Pickers({ photo, presets, choice, onChoice }: { photo: Photo; presets: Preset[]; choice: RigChoice; onChoice: (c: RigChoice) => void }) {
  const preset = presets.find((p) => p.id === choice.rig);
  const lenses = lensesFor(preset, [photo.lens_mm, choice.lensMm]);
  const pickRig = (v: string) => { const p = presets.find((x) => x.id === v); const r = lensRange(p); onChoice({ rig: v, lensMm: r ? Math.min(r.max, Math.max(r.min, choice.lensMm)) : choice.lensMm }); };
  return (
    <>
      <Select label="Rig" prefix="Rig" width="200px" value={choice.rig} onChange={pickRig}
        options={[{ value: AS_SHOT, label: "As shot" }, ...presets.map((p) => ({ value: p.id, label: p.name }))]} />
      <Select label="Lens" prefix="Lens" width="120px" value={String(choice.lensMm)} onChange={(v) => onChoice({ ...choice, lensMm: Number(v) })}
        options={lenses.map((mm) => ({ value: String(mm), label: `${mm} mm` }))} />
    </>
  );
}
