import { useEffect, useMemo, useState } from "preact/hooks";
import { layersAt } from "@openclapper/vocab";
import { label, type FieldDef } from "@openclapper/vocab";
import { deleteShot, extractPhoto, patchShot, type Location, type Spot, type Preset, type Project, type Shot, type ShotState } from "./api";
import { binned, confirmShotBin } from "./apps/trashOps";
import { FRAME_MODES, positionOf, rigLabel, shotTitle, stepSrc, steps as stepsOf, when, type Step } from "./format";
import { downloadCrop, StepFramed, type MaskMode } from "./Framed";
import { Inspector } from "./Inspector";
import { bind, useKeys } from "./keys";
import { ComposeStage } from "./compose/ComposeStage";
import { Composition, useShotLayers } from "./compose/stack";
import { ModeSwitch } from "./ModeSwitch";
import { PositionStage } from "./PositionEditor";
import { initialRigs, RigsStage, type RigsState } from "./RigExplorer";
import type { Stage } from "./router";
import { stepLensMm, stepVignette } from "./vignette";
import { Button, confirmDialog, cx, Icon, IconButton, Kbd, Seg, toast, Toolbar, ToolbarSpacer } from "@openclapper/ui";

export interface ShotContext { line: string; onBack: () => void; backLabel: string }

interface Props {
  shot: Shot;
  /** The list it was opened from (or the review queue), for ←/→ and the position. */
  list: Shot[];
  onNavigate: (s: Shot) => void;
  context: ShotContext;
  stage: Stage;
  onStage: (s: Stage) => void;
  mode: MaskMode;
  onMode: (m: MaskMode) => void;
  projects: Project[];
  presets: Preset[];
  fieldsOf: (projectId: string) => FieldDef[];
  locations: Location[];
  onLocations: (l: Location[]) => void;
  spots: Spot[];
  onSpots: (update: (cur: Spot[]) => Spot[]) => void;
  onUpdated: (s: Shot) => void;
  onDeleted: (id: string) => void;
  /** A shot made here (Extract as own shot): joins the lists. */
  onCreated: (s: Shot) => void;
  /** Open another shot in its own window. */
  onOpen: (s: Shot) => void;
  onShowOnMap: (s: Shot) => void;
  onOpenDay: (projectId: string, dayId: string) => void;
  onOpenTimeline: (projectId: string, timelineId: string) => void;
}

const nextMode = (m: MaskMode) => FRAME_MODES[(FRAME_MODES.indexOf(m) + 1) % FRAME_MODES.length];

/** A shot on a large stage (Photo · Framing · Compose · Position) with the inspector on the right. */
export function ShotView(p: Props) {
  const { shot, list, stage } = p;
  /** The photo the per-photo stages (Framing, Compose, Position) work on. */
  const [photoIndex, setPhotoIndex] = useState(0);
  /** The step the Photo and Compose stages show (issue #266: a sequence is a progression of steps, which may repeat a photo). */
  const [stepIndex, setStepIndex] = useState(0);
  const [rigs, setRigs] = useState<RigsState>(() => initialRigs(shot.photos[0], p.presets));
  const [busy, setBusy] = useState(false);
  // Everything in Compose saves on its own (leaving sends the rest), so nothing asks before leaving.
  const setStage = (st: Stage) => { if (st !== stage) p.onStage(st); };
  const navigate = (s: Shot) => p.onNavigate(s);
  /** The shot's layers with their shapes, for the Photo stage's live composition (epic #275). */
  const layers = useShotLayers(shot);
  useEffect(() => { setPhotoIndex(0); setStepIndex(0); }, [shot.id]);
  const shotSteps = useMemo(() => stepsOf(shot), [shot]);
  const step: Step = shotSteps[Math.min(stepIndex, shotSteps.length - 1)];
  /** Picking a step on the Photo stage also picks its photo for the other stages and the inspector. */
  const pickStep = (i: number) => { setStepIndex(i); setPhotoIndex(Math.max(0, shot.photos.findIndex((ph) => ph.id === shotSteps[i]?.photo.id))); };
  const photo = stage === "photo" || stage === "compose" ? step.photo : shot.photos[Math.min(photoIndex, shot.photos.length - 1)];
  useEffect(() => { setRigs(initialRigs(photo, p.presets)); }, [photo.id]);
  const index = list.findIndex((s) => s.id === shot.id);
  const prev = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  async function setState(state: ShotState) {
    if (busy || state === shot.state) return;
    const before = shot.state;
    setBusy(true);
    try {
      const s = await patchShot(shot.id, { state });
      p.onUpdated(s);
      toast(`${state === "unreviewed" ? "Back to review" : label(state)} · ${shot.name?.trim() || rigLabel(shot.photos[0])}`, "ok", { label: "Undo", run: () => void patchShot(shot.id, { state: before }).then(p.onUpdated).catch((e: Error) => toast(`Undo failed: ${e.message}`, "danger")) });
    } catch (e) { toast(`Update failed: ${(e as Error).message}`, "danger"); } finally { setBusy(false); }
  }
  /** To the recycle bin (asks first only when timelines or days lose it); Undo in the toast. */
  async function remove() {
    if (!(await confirmShotBin(shot.project_id, [shot.id]))) return;
    try { await deleteShot(shot.id); p.onDeleted(shot.id); binned([{ type: "shot", id: shot.id }], shot.project_id, `“${shotTitle(shot)}”`); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  /** Extract (issue #266): a copy of the step's photo as a shot of its own; the sequence is unchanged. */
  async function extract(st: Step) {
    const what = `photo ${st.photo.ordinal + 1}${st.framing ? ` with the framing “${st.framing.name}” as root` : ""}`;
    const ok = await confirmDialog({ title: "Extract as its own shot?", body: `A copy of ${what}, with the tags, framings and the layers this step shows. The sequence stays as it is; the copy is a new shot with no link back.`, confirmLabel: "Extract" });
    if (!ok) return;
    try {
      const made = await extractPhoto(shot.id, st.photo.id, { framing_id: st.framing?.id ?? null, step_id: st.stored ? st.id : null });
      p.onCreated(made);
      toast(`Extracted “${shotTitle(made)}”`, "ok", { label: "Open", run: () => p.onOpen(made) });
    } catch (e) { toast(`Extract failed: ${(e as Error).message}`, "danger"); }
  }
  const approveKey = () => { if (shot.state !== "approved") void setState("approved"); };
  const archiveKey = () => void setState(shot.state === "archived" ? "unreviewed" : "archived");

  useKeys(bind("shot", {
    prev: () => { if (prev) p.onNavigate(prev); },
    next: () => { if (next) p.onNavigate(next); },
    prevPhoto: () => pickStep(Math.max(0, stepIndex - 1)),
    nextPhoto: () => pickStep(Math.min(shotSteps.length - 1, stepIndex + 1)),
    approve: approveKey,
    archive: archiveKey,
    framing: () => p.onStage("rigs"),
    compose: () => p.onStage("compose"),
    frameMode: () => p.onMode(nextMode(p.mode)),
    back: () => p.context.onBack(),
  }), stage === "photo");

  const pos = index >= 0 ? `${index + 1} of ${list.length}` : "";
  const stored = shot.steps.length > 0;
  return (
    <>
      <Toolbar>
        <Button kind="secondary" size="sm" icon="arrow-left" kbd="Esc" onClick={() => p.context.onBack()}>{p.context.backLabel}</Button>
        <div class="toolbar-pos"><strong class="num">{pos}</strong><span class="meta">{p.context.line}</span></div>
        <div class="btn-row" style={{ gap: "4px" }}>
          <IconButton kind="secondary" icon="chevron-left" label="Previous shot (←)" title="Previous (←)" disabled={!prev || (stage !== "photo" && stage !== "compose")} onClick={() => prev && navigate(prev)} />
          <IconButton kind="secondary" icon="chevron-right" label="Next shot (→)" title="Next (→)" disabled={!next || (stage !== "photo" && stage !== "compose")} onClick={() => next && navigate(next)} />
        </div>
        <ToolbarSpacer />
        <Seg label="Stage" value={stage} onChange={setStage} options={[
          { id: "photo", icon: "image-outline", label: "Photo" },
          { id: "rigs", icon: "crop", label: <>Framing <Kbd>R</Kbd></> },
          { id: "compose", icon: "draw", label: <>Compose <Kbd>C</Kbd></> },
          { id: "position", icon: "crosshairs-gps", label: "Position" },
        ]} />
        {stage !== "compose" && <ModeSwitch value={p.mode} onChange={p.onMode} />}
      {stage === "photo" && stepVignette(step) && <span class="vig-chip" title="This rig darkens the corners at this focal length (Library › Rigs › Vignetting)"><Icon name="circle-half-full" />Vignetting · {stepLensMm(step)} mm</span>}
      </Toolbar>
      <div class="f-app__body">
        {stage === "compose" ? (
          <ComposeStage key={shot.id} shot={shot} presets={p.presets} mode={p.mode} initialStep={stepIndex} onUpdated={p.onUpdated} onBack={() => setStage("photo")} onExtract={(st) => void extract(st)}
            onStep={(k, ph) => { setStepIndex(k); setPhotoIndex(Math.max(0, shot.photos.findIndex((x) => x.id === ph.id))); }} />
        ) : (
        <section class="f-stage" aria-label="Stage">
          {stage === "rigs" ? (
            <RigsStage shot={shot} photo={photo} presets={p.presets} mode={p.mode} state={rigs} onState={setRigs} onBack={() => p.onStage("photo")} onUpdated={p.onUpdated} />
          ) : stage === "position" ? (
            <PositionStage key={photo.id} shot={shot} photo={photo} onSaved={(s) => { p.onUpdated(s); p.onStage("photo"); toast("Position saved"); }} onCancel={() => p.onStage("photo")} onError={(m) => toast(m, "danger")} />
          ) : (
            <>
              <div class="f-stage__view">
                <Composition photo={step.photo} frame={step.frame} mode={p.mode} layers={layersAt(layers, step)} vignette={stepVignette(step)} maxHeight="calc(100cqh - 260px)" />
                <button type="button" class="f-stage__nav f-stage__nav--prev" aria-label="Previous shot (←)" disabled={!prev} onClick={() => prev && p.onNavigate(prev)}><Icon name="chevron-left" /></button>
                <button type="button" class="f-stage__nav f-stage__nav--next" aria-label="Next shot (→)" disabled={!next} onClick={() => next && p.onNavigate(next)}><Icon name="chevron-right" /></button>
              </div>
              <div class="f-stage__foot">
                {shotSteps.length > 1 && (
                  <>
                    <div class="f-strip" role="listbox" aria-label={stored ? "Steps of this sequence" : "Photos in this shot"}>
                      {shotSteps.map((st, i) => (
                        <button key={st.id} type="button" role="option" aria-selected={i === stepIndex} class={cx("f-strip__it", i === stepIndex && "is-sel")} title={st.framing?.name} onClick={() => pickStep(i)}>
                          <StepFramed shot={shot} step={st} mode={p.mode} />
                          <span class="f-strip__n">{i + 1}</span>
                          {st.framing && <span class="f-strip__g"><Icon name="crop" /></span>}
                        </button>
                      ))}
                    </div>
                    <span class="meta keys-inline"><Kbd>,</Kbd><Kbd>.</Kbd>{stored ? "step" : "photo"} {stepIndex + 1} of {shotSteps.length}</span>
                  </>
                )}
                {shotSteps.length === 1 && <span class="meta num">{when(shot.captured_at)}</span>}
                <ToolbarSpacer />
                <div class="btn-row" style={{ gap: "6px", justifyContent: "flex-end" }}>
                  <Button kind="secondary" size="sm" icon="crop" title="Download this step cropped to its frame" onClick={() => void downloadCrop(step.photo, step.frame, stepSrc(shot, step))}>Download crop</Button>
                  <a class="f-btn f-btn--secondary f-btn--sm" href={photo.image_url} download target="_blank" rel="noreferrer"><Icon name="download-outline" />Original</a>
                  {shot.photos.length > 1 && <Button kind="secondary" size="sm" icon="export-variant" title="A copy of this photo as a shot of its own; the sequence stays" onClick={() => void extract(step)}>Extract…</Button>}
                  <Button kind="secondary" size="sm" icon="map-marker-outline" disabled={!positionOf(shot)} title={positionOf(shot) ? undefined : "Captured without GPS: set a position first"} onClick={() => p.onShowOnMap(shot)}>Show on map</Button>
                  <IconButton kind="danger" icon="delete-outline" label="Delete shot…" title="Delete shot…" onClick={() => void remove()} />
                </div>
              </div>
            </>
          )}
        </section>
        )}
        {stage !== "compose" && (
          <Inspector shot={shot} photo={photo} projects={p.projects} fields={p.fieldsOf(shot.project_id)} fieldsOf={p.fieldsOf} locations={p.locations} onLocations={p.onLocations} spots={p.spots} onSpots={p.onSpots}
            onUpdated={p.onUpdated} onState={(s) => void setState(s)} stateBusy={busy} onCorrect={() => p.onStage("position")} onCompose={() => p.onStage("compose")} onOpenDay={p.onOpenDay} onOpenTimeline={p.onOpenTimeline} />
        )}
      </div>
    </>
  );
}
