import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { stepsOf, type StepInput } from "@openclapper/vocab";
import { putSteps, type Photo, type Preset, type Shot } from "./api";
import { steps as stepsOfShot, type Step } from "./format";
import { StepFramed, type MaskMode } from "./Framed";
import { bind, useKeys } from "./keys";
import { ZoomSequenceDialog } from "./ZoomSequenceDialog";
import { Button, confirmDialog, cx, Empty, Icon, IconButton, Kbd, SaveStatus, Select, toast, ToolbarSpacer, type SaveState } from "@openclapper/ui";

interface Props {
  shot: Shot; presets: Preset[]; mode: MaskMode;
  onUpdated: (s: Shot) => void;
  /** The selected step's photo, for the inspector. */
  onPhoto: (p: Photo) => void;
  onBack: () => void;
  onExtract: (step: Step) => void;
}

const asInput = (s: Step): StepInput => ({ id: crypto.randomUUID(), photo_id: s.photo.id, framing_id: s.framing?.id ?? null, overlay_id: s.overlay?.id ?? null });
/** The stage's starting draft: the stored rows, else the photos as steps (stored by the first change). */
const fromShot = (shot: Shot): StepInput[] => (shot.steps.length
  ? [...shot.steps].sort((a, b) => a.ordinal - b.ordinal).map((s) => ({ id: s.id, photo_id: s.photo_id, framing_id: s.framing_id, overlay_id: s.overlay_id }))
  : stepsOfShot(shot).map(asInput));

/**
 * Shot view → stage **Sequence** (issue #266): the shot's steps as a draft list, edited in place
 * and autosaved 600 ms after the last change (and when leaving), like a timeline: reordering by
 * drag or keys comes in bursts, the list is small, and the PUT replaces it whole, so a retry is
 * idempotent. A zoom sequence is n framings + n steps, a light progression one step per overlay.
 */
export function SequenceStage({ shot, presets, mode, onUpdated, onPhoto, onBack, onExtract }: Props) {
  const [draft, setDraft] = useState<StepInput[]>(() => fromShot(shot));
  const [sel, setSel] = useState(0);
  const [save, setSave] = useState<SaveState>("idle");
  const [zoom, setZoom] = useState(false);
  const [drop, setDrop] = useState<{ i: number; after: boolean } | null>(null);
  const dragging = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, shot });
  latest.current = { draft, shot };
  useEffect(() => { setDraft(fromShot(shot)); setSel(0); setSave("idle"); }, [shot.id]);

  const resolved: Step[] = useMemo(() => (draft.length
    ? stepsOf({ ...shot, steps: draft.map((d, i) => ({ id: d.id, shot_id: shot.id, ordinal: i, photo_id: d.photo_id, framing_id: d.framing_id ?? null, overlay_id: d.overlay_id ?? null })) }).filter((s) => s.stored)
    : []), [shot, draft]);
  const at = Math.min(sel, Math.max(0, resolved.length - 1));
  const cur = resolved[at] ?? null;
  useEffect(() => { if (cur) onPhoto(cur.photo); }, [cur?.photo.id]);

  const flush = (list: StepInput[], id = shot.id) => {
    timer.current = null;
    setSave("saving");
    return putSteps(id, list).then((s) => { onUpdated(s); setSave(timer.current ? "dirty" : "saved"); })
      .catch((e: Error) => { setSave("error"); toast(`Steps not saved: ${e.message}`, "danger"); });
  };
  const change = (list: StepInput[]) => {
    setDraft(list);
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(list), 600);
  };
  // Leaving the stage (or the shot) sends what is pending.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; void putSteps(latest.current.shot.id, latest.current.draft).then(onUpdated).catch(() => {}); } }, []);
  const saveNow = () => { if (timer.current) { clearTimeout(timer.current); void flush(draft); } };

  const patch = (i: number, p: Partial<StepInput>) => change(draft.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.length || from === to) return;
    const list = [...draft]; const [d] = list.splice(from, 1); list.splice(to, 0, d); change(list); setSel(to);
  };
  const add = () => { const base = draft[at] ?? asInput(stepsOfShot(shot)[0]); change([...draft.slice(0, at + 1), { ...base, id: crypto.randomUUID() }, ...draft.slice(at + 1)]); setSel(at + 1); };
  const remove = () => { if (!draft.length) return; change(draft.filter((_, k) => k !== at)); setSel(Math.max(0, at - 1)); };
  const fromOverlays = () => {
    const photo = cur?.photo ?? shot.photos[0];
    const list = shot.overlays.filter((o) => o.photo_id === photo.id);
    if (!list.length) { toast("This photo has no overlays yet (Compose stage)", "info"); return; }
    change([...draft.slice(0, at + 1), ...list.map((o) => ({ id: crypto.randomUUID(), photo_id: photo.id, framing_id: null, overlay_id: o.id })), ...draft.slice(at + 1)]);
    setSel(at + 1);
  };
  async function reset() {
    if (!(await confirmDialog({ title: "Reset to photos?", body: "Every step goes; the shot shows its photos again, one step each.", confirmLabel: "Reset", danger: true }))) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSave("saving");
    try { const s = await putSteps(shot.id, []); onUpdated(s); setDraft(fromShot(s)); setSel(0); setSave("saved"); } catch (e) { setSave("error"); toast(`Reset failed: ${(e as Error).message}`, "danger"); }
  }
  const onZoom = (framingIds: string[]) => {
    const photo = cur?.photo ?? shot.photos[0];
    const made = framingIds.map((fid) => ({ id: crypto.randomUUID(), photo_id: photo.id, framing_id: fid, overlay_id: null }));
    // Without stored steps the implicit photo list should not linger: the zoom replaces it; otherwise it is appended.
    const list = shot.steps.length ? [...draft, ...made] : made;
    change(list);
    setSel(shot.steps.length ? draft.length : 0);
  };

  useKeys(bind("sequence", {
    prevStep: () => setSel(Math.max(0, at - 1)),
    nextStep: () => setSel(Math.min(resolved.length - 1, at + 1)),
    earlier: () => move(at, at - 1),
    later: () => move(at, at + 1),
    remove,
    save: saveNow,
    back: onBack,
  }), !zoom);

  const photo = cur?.photo ?? shot.photos[0];
  const d = draft[at];
  const overlays = shot.overlays.filter((o) => o.photo_id === photo.id);
  const root = photo.framings.find((f) => f.id === photo.root_framing_id);
  const stepLabel = (s: Step, i: number) => `Step ${i + 1}: photo ${s.photo.ordinal + 1}${s.framing ? ` · ${s.framing.name}` : ""}${s.overlay ? ` · ${s.overlay.name}` : ""}`;

  return (
    <>
      <div class="f-stage__bar">
        <span class="f-board-lbl num">{resolved.length ? `Step ${at + 1} of ${resolved.length}` : "No steps"}</span>
        {d && (
          <>
            <Select label="Photo" prefix="Photo" width="170px" value={d.photo_id} onChange={(v) => patch(at, { photo_id: v, framing_id: null, overlay_id: null })}
              options={shot.photos.map((p, i) => ({ value: p.id, label: `Photo ${i + 1}${p.lens_mm ? ` · ${p.lens_mm} mm` : ""}` }))} />
            <Select label="Framing" icon="crop" width="200px" value={d.framing_id ?? ""} onChange={(v) => patch(at, { framing_id: v || null })}
              options={[{ value: "", label: d.overlay_id ? "The overlay’s frame" : `Root frame · ${root?.name ?? "as captured"}` }, ...photo.framings.map((f) => ({ value: f.id, label: `${f.name}${f.id === photo.root_framing_id ? " · root" : ""}`, group: "Saved framings" }))]} />
            <Select label="Overlay" icon="layers-outline" width="200px" value={d.overlay_id ?? ""} onChange={(v) => patch(at, { overlay_id: v || null })}
              options={[{ value: "", label: "Photo as is" }, ...overlays.map((o) => ({ value: o.id, label: o.name, group: "Overlays of this photo" }))]} />
            <div class="btn-row" style={{ gap: "4px" }}>
              <IconButton kind="secondary" icon="arrow-left" label="Move the step earlier (Alt ←)" title="Earlier (Alt ←)" disabled={at === 0} onClick={() => move(at, at - 1)} />
              <IconButton kind="secondary" icon="arrow-right" label="Move the step later (Alt →)" title="Later (Alt →)" disabled={at >= draft.length - 1} onClick={() => move(at, at + 1)} />
              <IconButton kind="secondary" icon="close" label="Remove the step (Del)" title="Remove (Del)" onClick={remove} />
              {cur && <Button kind="secondary" size="sm" icon="export-variant" title="A copy of this step’s photo as a shot of its own" onClick={() => onExtract(cur)}>Extract as own shot…</Button>}
            </div>
          </>
        )}
        <SaveStatus state={save} onRetry={() => void flush(draft)} />
        <ToolbarSpacer />
        <Button kind="ghost" size="sm" kbd="Esc" onClick={onBack}>Back to photo</Button>
      </div>
      <div class="f-stage__view">
        {cur ? <StepFramed step={cur} mode={mode} maxHeight="calc(100cqh - 290px)" />
          : <Empty icon="view-carousel-outline" title="No steps" actions={<Button kind="secondary" onClick={() => void reset()}>Reset to photos</Button>}>Add a step, or reset so the photos are the steps again.</Empty>}
      </div>
      <div class="f-stage__foot">
        <div class="f-strip seq-strip" role="listbox" aria-label="Steps" onDragLeave={() => setDrop(null)}>
          {resolved.map((s, i) => (
            <button key={draft[i].id} type="button" role="option" aria-selected={i === at} aria-label={stepLabel(s, i)} title={stepLabel(s, i)}
              class={cx("f-strip__it", i === at && "is-sel", drop?.i === i && (drop.after ? "is-drop-after" : "is-drop-before"))}
              draggable onClick={() => setSel(i)}
              onDragStart={(e) => { dragging.current = i; if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (dragging.current === null) return; e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDrop({ i, after: e.clientX > r.left + r.width / 2 }); }}
              onDrop={(e) => { e.preventDefault(); const from = dragging.current; dragging.current = null; setDrop(null); if (from === null) return; let to = i + (drop?.after ? 1 : 0); if (from < to) to -= 1; move(from, to); }}
              onDragEnd={() => { dragging.current = null; setDrop(null); }}>
              <StepFramed step={s} mode={mode} />
              <span class="f-strip__n">{i + 1}</span>
              {(s.framing || s.overlay) && <span class="f-strip__g">{s.framing && <Icon name="crop" />}{s.overlay && <Icon name="layers-outline" />}</span>}
            </button>
          ))}
        </div>
        {!shot.steps.length && <span class="seq-hint">Not stored yet: these are the photos. The first change stores them as steps.</span>}
        <ToolbarSpacer />
        <div class="btn-row" style={{ gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <span class="meta keys-inline"><Kbd>,</Kbd><Kbd>.</Kbd>step · drag to reorder</span>
          <Button kind="secondary" size="sm" icon="plus" title="A copy of the selected step, after it" onClick={add}>Step</Button>
          <Button kind="secondary" size="sm" icon="layers-plus" title="One step per overlay of this photo: a light progression" disabled={!overlays.length} onClick={fromOverlays}>From overlays{overlays.length ? ` · ${overlays.length}` : ""}</Button>
          <Button kind="secondary" size="sm" icon="magnify-plus-outline" title="One step per lens of a rig, as saved framings of this photo" disabled={photo.source !== "camera"} onClick={() => setZoom(true)}>Zoom sequence…</Button>
          <Button kind="secondary" size="sm" icon="restore" disabled={!shot.steps.length && !draft.length} onClick={() => void reset()}>Reset to photos</Button>
        </div>
      </div>
      {zoom && <ZoomSequenceDialog shot={shot} photo={photo} presets={presets} onClose={() => setZoom(false)} onUpdated={onUpdated} onDone={onZoom} />}
    </>
  );
}
