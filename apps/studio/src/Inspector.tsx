import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { CAMERA_SUPPORTS, cameraLabel, droppedKeys, INT_EXT, label, lightLabel, MOVEMENTS, SHOT_SIZE_ABBR, SHOT_SIZES, WEATHER, type Extra, type FieldDef } from "@openclapper/vocab";
import { createProjectNamed, existingIdOf, fetchDays, fetchTimelines, patchShot, putLocation, putSpot, type Location, type Photo, type Project, type Shot, type ShootingDay, type ShotState, type Spot, type Timeline } from "./api";
import { ExtraEditor } from "./ExtraEditor";
import { coords, fovLabel, placeLabel, rigDescription, shotTitle, sourceLabel } from "./format";
import { Button, Chip, Combobox, Icon, Input, LightChips, MarkdownField, SaveStatus, Seg, StateMarker, Switch, toast, type SaveState } from "@openclapper/ui";

// Shooting days per project, fetched on demand for the "Days" fact and the move warning.
const daysCache = new Map<string, Promise<ShootingDay[]>>();
export const projectDays = (projectId: string) => {
  let p = daysCache.get(projectId);
  if (!p) { p = fetchDays(projectId).catch(() => []); daysCache.set(projectId, p); }
  return p;
};
/** Call after a day was saved or deleted so the next read is fresh. */
export const invalidateDays = (projectId?: string) => (projectId ? daysCache.delete(projectId) : daysCache.clear());
// Timelines per project, the same way, for the "Timelines" fact and the delete warning.
const timelinesCache = new Map<string, Promise<Timeline[]>>();
export const projectTimelines = (projectId: string) => {
  let p = timelinesCache.get(projectId);
  if (!p) { p = fetchTimelines(projectId).catch(() => []); timelinesCache.set(projectId, p); }
  return p;
};
export const invalidateTimelines = (projectId?: string) => (projectId ? timelinesCache.delete(projectId) : timelinesCache.clear());
/** The timelines that hold a photo of this shot. */
export const timelinesOfShot = (all: Timeline[], shotId: string) => all.filter((t) => t.clips.some((c) => c.shot_id === shotId));

const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

interface Props {
  shot: Shot;
  /** The photo on the stage; camera facts are per photo. */
  photo: Photo;
  projects: Project[];
  /** Extra-field definitions of the shot's project. */
  fields: readonly FieldDef[];
  /** Another project's fields, to tell what a move drops. */
  fieldsOf: (projectId: string) => readonly FieldDef[];
  locations: Location[];
  onLocations: (l: Location[]) => void;
  /** Every spot; the shot's location's are offered. */
  spots: Spot[];
  onSpots: (update: (cur: Spot[]) => Spot[]) => void;
  onUpdated: (s: Shot) => void;
  onState: (state: ShotState) => void;
  stateBusy: boolean;
  onCorrect: () => void;
  /** Open the Compose stage (overlays and sketches). */
  onCompose: () => void;
  onOpenDay: (projectId: string, dayId: string) => void;
  onOpenTimeline: (projectId: string, timelineId: string) => void;
}

/** Right-hand inspector of the shot view: decision, tags (saved per change), facts. */
export function Inspector({ shot, photo, projects, fields, fieldsOf, locations, onLocations, spots, onSpots, onUpdated, onState, stateBusy, onCorrect, onCompose, onOpenDay, onOpenTimeline }: Props) {
  const [save, setSave] = useState<SaveState>("idle");
  const last = useRef<Parameters<typeof patchShot>[1] | null>(null);
  const [name, setName] = useState(shot.name ?? "");
  const [extra, setExtra] = useState<Extra>(shot.extra);
  const [description, setDescription] = useState(shot.description ?? "");
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [days, setDays] = useState<ShootingDay[]>([]);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [raw, setRaw] = useState(false);
  const extraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setName(shot.name ?? ""); setExtra(shot.extra); setDescription(shot.description ?? ""); setMoveTo(null); setSave("idle"); }, [shot.id]);
  useEffect(() => { let live = true; void projectDays(shot.project_id).then((d) => { if (live) setDays(d.filter((x) => x.shots.some((s) => s.shot_id === shot.id))); }); return () => { live = false; }; }, [shot.id, shot.project_id]);
  useEffect(() => { let live = true; void projectTimelines(shot.project_id).then((t) => { if (live) setTimelines(timelinesOfShot(t, shot.id)); }); return () => { live = false; }; }, [shot.id, shot.project_id]);

  async function patch(p: Parameters<typeof patchShot>[1]) {
    last.current = p;
    setSave("saving");
    try { onUpdated(await patchShot(shot.id, p)); setSave("saved"); } catch { setSave("error"); }
  }
  const retry = () => { if (last.current) void patch(last.current); };
  const commitName = () => { const n = name.trim() || null; if (n !== (shot.name ?? null)) void patch({ name: n }); };
  const changeExtra = (v: Extra) => {
    setExtra(v);
    setSave("dirty");
    if (extraTimer.current) clearTimeout(extraTimer.current);
    extraTimer.current = setTimeout(() => void patch({ extra: v }), 700);
  };
  const commitDescription = (v: string) => { if (descTimer.current) clearTimeout(descTimer.current); const d = v.trim() || null; if (d !== (shot.description ?? null)) void patch({ description: d }); };
  const changeDescription = (v: string) => {
    setDescription(v);
    setSave("dirty");
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => commitDescription(v), 700);
  };
  async function setLocation(id: string | null, createName?: string) {
    if (createName) {
      setSave("saving");
      try {
        const created = await putLocation({ id: crypto.randomUUID(), project_id: shot.project_id, name: createName });
        onLocations([...locations, created].sort((a, b) => a.name.localeCompare(b.name)));
        id = created.id;
      } catch (err) {
        const existing = existingIdOf(err);
        if (!existing) { setSave("error"); return; }
        id = existing;
      }
    }
    void patch({ location_id: id });
  }
  async function setSpot(id: string | null, createName?: string) {
    if (createName && shot.location_id) {
      setSave("saving");
      try {
        const created = await putSpot({ id: crypto.randomUUID(), location_id: shot.location_id, name: createName });
        onSpots((list) => [...list, created]);
        id = created.id;
      } catch (err) {
        const existing = existingIdOf(err);
        if (!existing) { setSave("error"); return; }
        id = existing;
      }
    }
    void patch({ spot_id: id });
  }
  async function createProject(name: string) {
    setSave("saving");
    try { pickProject((await createProjectNamed(name)).id); } catch (e) { setSave("error"); toast(`Could not create the project: ${(e as Error).message}`, "danger"); }
  }
  const dropsOf = (projectId: string) => droppedKeys(fieldsOf(projectId), shot.extra).map((k) => fields.find((d) => d.key === k)?.label ?? k);
  const pickProject = (v: string | null) => {
    if (!v || v === shot.project_id) { setMoveTo(null); return; }
    if (days.length === 0 && dropsOf(v).length === 0) void patch({ project_id: v });
    else setMoveTo(v);
  };
  const drops = moveTo ? dropsOf(moveTo) : [];

  const unrev = shot.state === "unreviewed";
  const f = photo.framing ?? {};
  const dev = photo.device ?? {};
  const spotOptions = spots.filter((sp) => sp.location_id === shot.location_id).sort((a, b) => a.name.localeCompare(b.name)).map((sp) => ({ value: sp.id, label: sp.name, hint: sp.shot_count ? `${sp.shot_count}` : undefined }));
  const locationOptions = locations.map((l) => ({ value: l.id, label: l.name, hint: l.shot_count ? `${l.shot_count}` : undefined }));
  const projectName = projects.find((p) => p.id === shot.project_id)?.name ?? shot.project_name ?? "";

  return (
    <aside class="f-panel inspector" aria-label="Inspector">
      <div class="f-panel__body f-panel__body--flush">
        <div class="f-sec" style={{ gap: "10px" }}>
          <div class="inspector__title"><h1>{shotTitle(shot)}</h1><StateMarker state={shot.state} lg /></div>
          <span class="meta" style={{ fontSize: "var(--text-small)" }}>{[placeLabel(shot) || "No location", label(shot.int_ext).toUpperCase(), lightLabel(shot.light, shot.artificial), cameraLabel(shot)].filter(Boolean).join(" · ")}</span>
          <div class="btn-row" style={{ flexWrap: "nowrap" }}>
            {unrev ? (
              <>
                <Button kind="approve" icon="check-circle" kbd="A" style={{ flex: 1 }} disabled={stateBusy} onClick={() => onState("approved")}>Approve</Button>
                <Button kind="archive" icon="archive" kbd="E" style={{ flex: 1 }} disabled={stateBusy} onClick={() => onState("archived")}>Archive</Button>
              </>
            ) : (
              <>
                <Button kind="archive" icon="undo-variant" kbd={shot.state === "archived" && "E"} style={{ flex: 1 }} disabled={stateBusy} onClick={() => onState("unreviewed")}>Back to review</Button>
                {shot.state === "approved"
                  ? <Button kind="archive" icon="archive" kbd="E" style={{ flex: 1 }} disabled={stateBusy} onClick={() => onState("archived")}>Archive</Button>
                  : <Button kind="approve" icon="check-circle" kbd="A" style={{ flex: 1 }} disabled={stateBusy} onClick={() => onState("approved")}>Approve</Button>}
              </>
            )}
          </div>
        </div>

        <div class="f-sec">
          <div class="f-sec__head"><Icon name="tag-outline" />Tags<span class="f-sec__aside"><SaveStatus state={save} onRetry={retry} /></span></div>
          <div class="f-formgrid">
            <label>Project</label>
            <div class="f-field">
              <Combobox small options={projects.map((p) => ({ value: p.id, label: p.name }))} value={moveTo ?? shot.project_id} clearable={false} onChange={pickProject} onCreate={(t) => void createProject(t)} onCancel={() => setMoveTo(null)} />
              {moveTo && (
                <div class="move-warn">
                  {days.length > 0 && <span class="f-field__help" style={{ color: "var(--warn-ink)", fontWeight: 600, display: "flex", gap: "4px" }}><Icon name="alert" />Leaves {days.length} shooting day{days.length === 1 ? "" : "s"} in {projectName}.</span>}
                  {drops.length > 0 && <span class="f-field__help" style={{ color: "var(--warn-ink)", fontWeight: 600, display: "flex", gap: "4px" }}><Icon name="alert" />Drops {drops.join(", ")}: the other project's fields don't take {drops.length === 1 ? "it" : "them"}.</span>}
                  <div class="btn-row" style={{ gap: "6px" }}>
                    <Button size="sm" onClick={() => { const v = moveTo; setMoveTo(null); void patch({ project_id: v }); }}>Move</Button>
                    <Button kind="ghost" size="sm" onClick={() => setMoveTo(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
            <label for="ins-name">Name</label>
            <Input sm id="ins-name" value={name} maxLength={120} placeholder="e.g. Bridge from the east bank" onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(shot.name ?? ""); (e.target as HTMLInputElement).blur(); } }} />
            <label>Location</label>
            <Combobox small icon="map-marker-outline" options={locationOptions} value={shot.location_id} placeholder="Search or create…" onChange={(v) => void setLocation(v)} onCreate={(t) => void setLocation(null, t)} />
            <label>Spot</label>
            {shot.location_id
              ? <Combobox small icon="map-marker-radius-outline" key={shot.location_id} options={spotOptions} value={shot.spot_id} placeholder="A place within the location…" onChange={(v) => void setSpot(v)} onCreate={(t) => void setSpot(null, t)} />
              : <span class="f-field__help">Pick a location first.</span>}
            <label>INT/EXT</label>
            <Seg label="INT/EXT" value={shot.int_ext ?? "none"} onChange={(v) => void patch({ int_ext: v === "none" ? null : v })} options={[...INT_EXT.map((v) => ({ id: v, label: label(v).toUpperCase() })), { id: "none", label: "–", title: "Not set" }]} />
            <label style={{ alignSelf: "start", paddingTop: "8px" }}>Light</label>
            <LightChips light={shot.light} artificial={shot.artificial} onChange={(l, a) => void patch({ light: l, artificial: a })} />
            <label>Weather</label>
            <Combobox small options={WEATHER.map((v) => ({ value: v, label: label(v) }))} value={shot.weather} placeholder="—" onChange={(v) => void patch({ weather: v })} />
            <label>Shot size</label>
            <Combobox small options={SHOT_SIZES.map((v) => ({ value: v, label: `${SHOT_SIZE_ABBR[v]} · ${label(v)}` }))} value={shot.shot_size} placeholder="—" onChange={(v) => void patch({ shot_size: v })} />
            <label>Support</label>
            <Combobox small options={CAMERA_SUPPORTS.map((v) => ({ value: v, label: label(v) }))} value={shot.camera_support} placeholder="—" onChange={(v) => void patch({ camera_support: v })} />
            <label style={{ alignSelf: "start", paddingTop: "8px" }}>Movement</label>
            <div class="f-chips" role="group" aria-label="Movement">
              {MOVEMENTS.map((m) => <Chip key={m} selected={shot.movement.includes(m)} onClick={() => void patch({ movement: MOVEMENTS.filter((x) => (x === m ? !shot.movement.includes(x) : shot.movement.includes(x))) })}>{label(m)}</Chip>)}
            </div>
          </div>
          {fields.length > 0 && (
            <>
              <div class="f-sec__head" style={{ marginTop: "4px", color: "var(--text-dim)" }}>Extra · {projectName}</div>
              <div class="inspector__extra"><ExtraEditor defs={fields} value={extra} onChange={changeExtra} /></div>
            </>
          )}
        </div>

        <div class="f-sec">
          <div class="f-sec__head"><Icon name="text-long" />Description</div>
          <MarkdownField value={description} onChange={changeDescription} onBlur={() => commitDescription(description)} rows={4} placeholder="What this shot is for, what to watch out for…" label="Description" />
        </div>

        <div class="f-sec">
          <div class="f-sec__head"><Icon name="draw" />Compose<span class="f-sec__aside"><Button kind="secondary" size="sm" style={{ height: "26px" }} kbd="C" onClick={onCompose}>Open</Button></span></div>
          <dl class="f-facts">
            <dt>Overlays</dt><dd>{shot.overlays.length === 0 ? <span class="meta">none</span> : shot.overlays.map((o) => o.name).join(", ")}</dd>
            <dt>Sketches</dt><dd>{shot.sketches.length === 0 ? <span class="meta">none</span> : shot.sketches.map((s) => s.name).join(", ")}</dd>
          </dl>
        </div>

        <div class="f-sec">
          <div class="f-sec__head"><Icon name="crosshairs-gps" />Position<span class="f-sec__aside"><Button kind="secondary" size="sm" style={{ height: "26px" }} onClick={onCorrect}>{photo.lat === null ? "Set position" : "Correct"}</Button></span></div>
          <Switch on={shot.position_from_location} onClick={() => void patch({ position_from_location: !shot.position_from_location })}>Use the spot’s or location’s pin</Switch>
          {shot.position_from_location && (
            <span class="f-field__help">{!shot.location_id ? "No location set: the shot keeps its own position." : shot.location_position ? `Maps use ${placeLabel(shot)}: ${shot.location_position.lat.toFixed(5)}, ${shot.location_position.lon.toFixed(5)}. The photos keep their GPS below.` : `${placeLabel(shot)} has no pin yet (Library › Locations). The shot keeps its own position until then.`}</span>
          )}
          <dl class="f-facts">
            <dt>{shot.photos.length > 1 ? `Photo ${photo.ordinal + 1}` : "Photo"}</dt>
            <dd>{photo.lat === null ? <span class="meta">No position · captured without GPS</span>
              : <a href={`https://www.openstreetmap.org/?mlat=${photo.lat}&mlon=${photo.lon}#map=17/${photo.lat}/${photo.lon}`} target="_blank" rel="noreferrer">{coords(photo)}</a>}</dd>
            {photo.lat !== null && <><dt>Accuracy</dt><dd>{photo.position_corrected ? "corrected by hand" : photo.gps_accuracy_m != null ? `±${Math.round(photo.gps_accuracy_m)} m` : "unknown"}</dd></>}
          </dl>
        </div>

        <div class="f-sec">
          <div class="f-sec__head"><Icon name="information-outline" />Shot</div>
          <dl class="f-facts">
            <dt>Captured</dt><dd>{stamp(shot.captured_at)}</dd>
            <dt>Photos</dt><dd>{shot.photos.length}{shot.photos.length > 1 ? " · sequence" : ""}{shot.steps.length ? ` · ${shot.steps.length} steps` : ""}</dd>
            <dt>Uploaded</dt><dd>{stamp(shot.created_at)}</dd>
            <dt>Days</dt><dd>{days.length === 0 ? <span class="meta">not planned</span> : days.map((d, i) => <Fragment key={d.id}>{i > 0 && ", "}<a href="#" onClick={(e) => { e.preventDefault(); onOpenDay(shot.project_id, d.id); }}>{dayLabel(d.date)}</a></Fragment>)}</dd>
            <dt>Timelines</dt><dd>{timelines.length === 0 ? <span class="meta">not used</span> : timelines.map((t, i) => <Fragment key={t.id}>{i > 0 && ", "}<a href="#" onClick={(e) => { e.preventDefault(); onOpenTimeline(shot.project_id, t.id); }}>{t.name}</a></Fragment>)}</dd>
          </dl>
        </div>

        <div class="f-sec">
          <div class="f-sec__head"><Icon name="camera-outline" />Camera{shot.photos.length > 1 ? ` · photo ${photo.ordinal + 1} of ${shot.photos.length}` : ""}</div>
          {sourceLabel(photo) ? (
            <dl class="f-facts"><dt>Source</dt><dd>{sourceLabel(photo)} · made in the Studio, no rig or lens</dd>{photo.width && photo.height ? <><dt>Size</dt><dd>{photo.width} × {photo.height} px</dd></> : null}</dl>
          ) : (
          <dl class="f-facts">
            <dt>Rig</dt><dd>{[photo.preset_name ?? (f.preset_name as string | undefined) ?? "deleted / unsynced", rigDescription(photo)].filter(Boolean).join(" · ")}</dd>
            <dt>Frame</dt><dd>{photo.framings.find((f) => f.id === photo.root_framing_id)?.name ?? "As captured"}{photo.framings.length ? <span class="meta"> · {photo.framings.length} framing{photo.framings.length === 1 ? "" : "s"}</span> : null}</dd>
            <dt>Lens</dt><dd>{photo.lens_mm} mm{typeof f.full_frame_equivalent_mm === "number" ? ` · FF ${f.full_frame_equivalent_mm} mm` : ""}</dd>
            <dt>FOV</dt><dd>{fovLabel(photo).replace(/^[^·]*mm FF-eq · /, "") || "n/a"}{typeof f.rig_orientation === "string" ? ` · ${f.rig_orientation}` : ""}</dd>
            <dt>Time</dt><dd>{new Date(photo.timestamp).toLocaleTimeString()}</dd>
            <dt>GPS</dt><dd>{[photo.gps_accuracy_m != null ? `±${Math.round(photo.gps_accuracy_m)} m` : null, typeof dev.gps_fix_age_ms === "number" ? `fix ${Math.round(dev.gps_fix_age_ms / 1000)} s old` : null, typeof dev.gps_altitude_m === "number" ? `${Math.round(dev.gps_altitude_m)} m alt.` : null].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Phone</dt><dd>{[dev.phone_model, typeof f.phone_equivalent_focal_mm === "number" ? `${f.phone_equivalent_focal_mm} mm equiv.` : null].filter(Boolean).join(" · ") || "—"}</dd>
          </dl>
          )}
        </div>

        <div class={raw ? "f-sec" : "f-sec is-collapsed"}>
          <button type="button" class="f-sec__head sec-toggle" aria-expanded={raw} onClick={() => setRaw(!raw)}>
            <Icon name={raw ? "chevron-down" : "chevron-right"} />Raw metadata<span class="f-sec__aside">framing · device</span>
          </button>
          {/* Kept mounted so it can fold open and shut (motion.css, #168). */}
          <div class="f-sec__body" inert={!raw}>
            <div>
              <pre class="raw">{JSON.stringify({ id: shot.id, photo: photo.id, framing: photo.framing, device: photo.device }, null, 2)}</pre>
              <Button kind="secondary" size="sm" icon="content-copy" style={{ alignSelf: "flex-start" }} onClick={() => void navigator.clipboard.writeText(JSON.stringify({ framing: photo.framing, device: photo.device }, null, 2))}>Copy</Button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
