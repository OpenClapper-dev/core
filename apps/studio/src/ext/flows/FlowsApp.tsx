// The Flows app (docs/features/flows.md, docs/rewrite/ux-6-devices.md): the project's flows in a panel, the chosen
// one's tracks in the middle, what is chosen in them in the other panel (the Dock: move, size, collapse, stack as
// tabs). One person edits a flow at a time (the edit lock); the others watch. It plays through the phone that holds
// the connections, or runs on that phone itself. The same editor runs in the phone and tablet app's web view.
import "../hardware/hardware.css";
import "./flows.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Badge, Banner, Button, Dock, EmptyState, Icon, ListRow, List, NumberInput, Popover, Segmented, Select, Slider, Spinner, StatusBar, Switch, TextInput, Toolbar, ToolbarSpacer,
  cx, useDockLayout, type DockPanel,
} from "@openclapper/design";
import { CATALOGUE, fixtureKind, modelOf, type HardwareBody } from "@openclapper/ext-hardware";
import { FlowPlayer, FLOW_MAX_MS, fmtClock, fmtSeconds, inFade, LEVEL_STEPS, sampleTrack, snap, SNAP_MS, START_KEYFRAME, startKeyframe, TRACK_COLORS, type Flow, type FlowBody, type FlowMarker, type FlowTrack, type Keyframe, type LevelStep, type SendLight } from "@openclapper/ext-flows";
import * as api from "../../api";
import type { FileRec } from "../../api";
import type { AppProps } from "../../apps/registry";
import * as store from "../../files";
import { confirm, toast, toastError } from "../../hosts";
import { bind, useKeys } from "../../keys";
import { useEditLock } from "../../lock";
import { usePeople } from "../../people";
import { useProjects } from "../../projects";
import { useUser } from "../../user";
import { command as sendCommand, setBusyDevices, useHardware } from "../hardware/link";
import { CameraKeyframe, FadeInspect, LightKeyframe, MarkerInspect, NothingChosen, SelectionInspect, TrackInspect } from "./inspect";
import { keyOf, Lanes, markKey, markOf, splitKey } from "./lanes";
import { requestRun, useRun } from "./run";
import { useFlowView, useKeyframeSize, useLevelStep, useTrackHeight, useZoom, VIEW_LABELS, ZOOM_MAX, ZOOM_MIN, type FlowView } from "./view";

const SAVE_AFTER_MS = 400;
const TRACK_MODELS = CATALOGUE.filter((m) => m.type === "light" || m.type === "camera");
const bodyOf = (f: FileRec): FlowBody => ({ durationMs: 30_000, loop: false, tracks: [], markers: [], ...(f.body as Partial<FlowBody>) });

export function FlowsApp({ projectId, setTitle, setRoute, resource, focused }: AppProps) {
  const { files } = store.useRoot({ project: projectId });
  const flows = (files ?? []).filter((f) => f.type === "flow").sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const [chosen, setChosen] = useState<string | null>(resource?.id ?? null);
  useEffect(() => { if (resource?.id) setChosen(resource.id); }, [resource?.id]);
  useEffect(() => { if (files && !flows.some((f) => f.id === chosen)) setChosen(flows[0]?.id ?? null); }, [files, flows.map((f) => f.id).join(",")]);
  const f = flows.find((x) => x.id === chosen) ?? null;
  useEffect(() => { setTitle(f ? `Flows · ${f.name}` : "Flows"); setRoute(f ? f.id : ""); }, [f?.id, f?.name]);
  const create = async () => {
    try { const made = await store.create({ project: projectId }, "flow", { name: `Flow ${flows.length + 1}` }); setChosen((made as FileRec).id); } catch (e) { toastError(e); }
  };
  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  const list = (
    <List className="fl-list">
      {flows.map((x) => <ListRow key={x.id} icon="timeline" selected={x.id === chosen} onClick={() => setChosen(x.id)} meta={fmtSeconds(bodyOf(x).durationMs)}>{x.name}</ListRow>)}
      {!flows.length && <EmptyState icon="timeline" title="No flows yet">Tracks of lights and cameras, keyframes on them, played through a device.</EmptyState>}
    </List>
  );
  return f ? <FlowEditor key={f.id} f={f} projectId={projectId} active={focused} list={list} onNew={() => void create()} onGone={() => setChosen(null)} />
    : <Empty list={list} onNew={() => void create()} />;
}

function Empty({ list, onNew }: { list: preact.ComponentChildren; onNew: () => void }) {
  const [panels, setPanels] = useDockLayout("flows", { left: { tabs: ["flows"] }, right: { tabs: ["chosen"] } });
  const dock: DockPanel[] = [{ id: "flows", title: "Flows", icon: "timeline", actions: <Button size="sm" variant="quiet" icon="plus" onClick={onNew}>New flow</Button>, body: list }, { id: "chosen", title: "Chosen", icon: "cursor", body: <NothingChosen /> }];
  return <div className="oc-app"><Dock panels={dock} layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 280, right: 340 }}><div className="fl-stage st-center"><EmptyState icon="timeline" title="No flow chosen"><Button variant="primary" icon="plus" onClick={onNew}>New flow</Button></EmptyState></div></Dock></div>;
}

/**
 * One flow: the document under the edit lock (saved a moment after each change), the player shared with the device,
 * Live (the devices follow the playhead and every edit while stopped), running on the device, and the editing.
 */
function FlowEditor({ f, projectId, active, list, onNew, onGone }: { f: FileRec; projectId: string; active: boolean; list?: preact.ComponentChildren; onNew?: () => void; onGone?: () => void }) {
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  const nameOf = (u: string) => (u === me?.id ? "You" : people.get(u) ?? "Someone");
  const { files: home } = store.useRoot("home");
  const devices = useMemo(() => (home ?? []).filter((d) => d.type === "device" && modelOf((d.body as Partial<HardwareBody> | undefined)?.model)), [home]);
  const hw = useHardware();
  const run = useRun();

  // ---------- The document, saved under the lock ----------
  const [body, setBody] = useState<FlowBody>(() => bodyOf(f));
  const latest = useRef(body);
  latest.current = body;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"saved" | "waiting" | "saving" | "failed">("saved");
  const lock = useEditLock(f, nameOf, (x) => { const b = bodyOf(x); latest.current = b; setBody(b); }, () => { if (pending.current) { clearTimeout(pending.current); void save(); } },
    { realtime: project?.canvas_live === "realtime", onRemote: (d) => { const b = { ...bodyOf(f), ...(d.body as Partial<FlowBody>) }; latest.current = b; setBody(b); } });
  async function save(): Promise<string | null> {
    pending.current = null;
    if (!lock.held()) return null;
    setStatus("saving");
    try {
      const rec = await api.putFileLocked(f.id, { body: latest.current as unknown as Record<string, unknown> }, lock.holder);
      setStatus(pending.current ? "waiting" : "saved");
      void store.loadRoot({ project: projectId });
      return rec.updated_at ?? null;
    } catch (e) {
      setStatus("failed");
      if (e instanceof api.ApiError && e.status === 423) lock.lost(); else toastError(e);
      return null;
    }
  }
  const flush = async () => { if (pending.current) clearTimeout(pending.current); return save(); };

  // A flow running on the phone is locked here (no edits, no scrubbing): the phone plays it; the playhead follows.
  const runActive = run?.phase === "playing" || run?.phase === "loading";
  const runsThis = runActive && run?.flow === f.id;
  const readonly = !lock.editing || runsThis;
  const change = (fn: (b: FlowBody) => FlowBody) => {
    if (readonly) return;
    const b = fn(latest.current);
    latest.current = b; setBody(b);
    setStatus("waiting");
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(), SAVE_AFTER_MS);
    lock.send(() => ({ body: latest.current as unknown as Record<string, unknown> }));
  };
  const patchTrack = (id: string, fn: (t: FlowTrack) => FlowTrack) => change((b) => ({ ...b, tracks: b.tracks.map((t) => (t.id === id ? fn(t) : t)) }));
  const flow: Flow = { id: f.id, name: f.name, updatedAt: f.updated_at ?? "", ...body };

  // ---------- Playing through the proxy, Live ----------
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playFrom = useRef(0);
  const [live, setLive] = useState(true);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const proxy = !!hw.state;
  const proxyRef = useRef(proxy);
  proxyRef.current = proxy;
  const send: SendLight = (id, cmd) => { if (proxyRef.current) sendCommand(id, cmd); };
  const player = useRef<FlowPlayer | null>(null);
  player.current ??= new FlowPlayer(() => flowRef.current, send, { now: () => performance.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) },
    { tick: (t) => setPlayhead(t), end: (t) => { setPlayhead(t); setPlaying(false); } });
  useEffect(() => {
    if (!playing) return;
    // The devices it drives are locked in Devices while it plays.
    setBusyDevices(flowRef.current.tracks.flatMap((t) => (t.device && !t.muted ? [t.device] : [])));
    player.current!.play(playhead);
    return () => { player.current!.stop(); setBusyDevices([]); };
  }, [playing]);
  useEffect(() => () => player.current?.stop(), []);
  // After a run on the device, Live sends everything again: the devices show what the phone left them at.
  useEffect(() => { if (!runActive) player.current?.emitter.reset(); else setPlaying(false); }, [runActive]);
  // A proxy that (re)appears knows nothing of what was sent before: Live sends everything again.
  useEffect(() => { if (proxy) player.current?.emitter.reset(); }, [proxy, hw.state?.phone.id]);
  const tracksKey = JSON.stringify(body.tracks);
  useEffect(() => { if (!playing && live && !runActive && proxy) player.current!.emitter.emit(flowRef.current, playhead, false, send); }, [playhead, tracksKey, live, playing, proxy, runActive]);
  // The phone's position, carried on between its reports.
  const [, tickRun] = useState(0);
  useEffect(() => { if (!runsThis) return; const h = setInterval(() => tickRun((n) => n + 1), 100); return () => clearInterval(h); }, [runsThis]);
  const runAt = (() => {
    if (!runsThis || !run || run.phase !== "playing" || !run.durationMs) return run?.atMs ?? 0;
    const t = run.atMs + (performance.now() - run.receivedAt);
    return run.loop ? t % run.durationMs : Math.min(run.durationMs, t);
  })();

  const play = () => {
    if (runActive) { requestRun({ type: "stop" }); return; }
    if (playing) { setPlaying(false); setPlayhead(playFrom.current); return; }
    if (!proxy) return;
    const from = playhead >= flow.durationMs ? 0 : playhead;
    playFrom.current = from; setPlayhead(from); setPlaying(true);
  };
  const runOnPhone = async (from: number) => {
    if (!proxy) return;
    const fading = flow.tracks.filter((t) => t.device && !t.muted && inFade(t.keyframes, from)).length;
    if (from > 0 && fading) toast(`${fading} track${fading === 1 ? " starts" : "s start"} inside a fade: ${fading === 1 ? "its light jumps" : "their lights jump"} to the value there, then ${fading === 1 ? "fades" : "fade"} the rest`, { tone: "info" });
    // The phone plays exactly what was saved: save first (as the editor), else what the server has.
    const revision = lock.editing ? await flush() : f.updated_at;
    if (!revision) { toast("Not started on the device: the flow could not be saved", { tone: "danger" }); return; }
    setPlaying(false);
    requestRun({ type: "run", flow: f.id, revision, fromMs: from });
  };

  // ---------- Selection and editing ----------
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [tile, setTile] = useState<{ trackId: string; toId: string } | null>(null);
  const [trackPick, setTrackPick] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "insert">("select");
  const [kfSize, setKfSize] = useKeyframeSize();
  const [view, setView] = useFlowView();
  const [levelStep, setLevelStep] = useLevelStep();
  const [trackHeight, setTrackHeight] = useTrackHeight();
  const [zoom, setZoom] = useZoom();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const rangeIn = useRef<number | null>(null);
  useEffect(() => { if (readonly) { setSel(new Set()); setTile(null); } }, [readonly]);
  const select = (keys: Iterable<string>, add = false) => { setTile(null); setTrackPick(null); setSel(new Set([...(add ? sel : []), ...keys])); };
  const selMarker = sel.size === 1 ? markOf([...sel][0]) : null;
  const newId = () => crypto.randomUUID();

  const addTrack = (modelId: string) => {
    const m = modelOf(modelId);
    if (!m) return;
    change((b) => {
      const n = b.tracks.filter((t) => t.model === modelId).length + 1;
      const used = new Set(b.tracks.map((t) => t.color));
      const color = Array.from({ length: TRACK_COLORS }, (_, i) => i).find((i) => !used.has(i)) ?? b.tracks.length % TRACK_COLORS;
      const kind = fixtureKind(modelId);
      return { ...b, tracks: [...b.tracks, { id: newId(), name: `${m.model} ${n}`, model: modelId, device: null, color, keyframes: [startKeyframe(kind)] }] };
    });
  };
  const addKeyframe = (trackId: string, at: number) => {
    const tr = latest.current.tracks.find((t) => t.id === trackId);
    if (!tr || tr.keyframes.some((k) => k.at === at)) return;
    const camera = modelOf(tr.model)?.type === "camera";
    const k: Keyframe = camera ? { id: newId(), at, controls: {} } : { id: newId(), at, intensity: sampleTrack(tr.keyframes, at).intensity ?? 0.5 };
    patchTrack(trackId, (t) => ({ ...t, keyframes: [...t.keyframes, k] }));
    select([keyOf(trackId, k.id)]);
    if (!playing) setPlayhead(at);
  };
  const addMarker = (at: number, end?: number, trackId?: string) => {
    if (readonly) return;
    const n = (latest.current.markers ?? []).length + 1;
    const m: FlowMarker = { id: newId(), at: snap(at), name: end !== undefined ? `Section ${n}` : `Marker ${n}`, ...(end !== undefined && snap(end) > snap(at) ? { end: snap(end) } : {}), ...(trackId ? { trackId } : {}) };
    change((b) => ({ ...b, markers: [...(b.markers ?? []), m] }));
    pickMarker(m.id, m.at);
  };
  const pickMarker = (id: string, at?: number) => {
    const m = latest.current.markers?.find((x) => x.id === id);
    setTile(null); setTrackPick(null); setSel(new Set([markKey(id)]));
    if (!playing && !runsThis) setPlayhead(at ?? m?.at ?? playhead);
  };
  const patchMarker = (id: string, fn: (m: FlowMarker) => FlowMarker) => change((b) => ({ ...b, markers: (b.markers ?? []).map((m) => (m.id === id ? fn(m) : m)) }));
  const markRange = () => {
    if (rangeIn.current === null) { rangeIn.current = playhead; toast(`In at ${fmtSeconds(playhead)}: move the playhead, Shift+M again for the out point`, { tone: "info" }); return; }
    const a = Math.min(rangeIn.current, playhead), b = Math.max(rangeIn.current, playhead);
    rangeIn.current = null;
    if (b - a < SNAP_MS) { toast("A range needs an out point after its in point", { tone: "info" }); return; }
    addMarker(a, b);
  };
  const deleteSelected = () => {
    if (!sel.size || readonly) return false;
    const drop = new Set([...sel].filter((k) => splitKey(k)[1] !== START_KEYFRAME));
    if (!drop.size) return false;
    change((b) => ({ ...b, markers: (b.markers ?? []).filter((m) => !drop.has(markKey(m.id))), tracks: b.tracks.map((t) => ({ ...t, keyframes: t.keyframes.filter((k) => !drop.has(keyOf(t.id, k.id))) })) }));
    setSel(new Set());
  };
  useKeys(bind("flows", {
    play: () => play(),
    stopHere: () => { if (!playing) return false; setPlaying(false); },
    selectMode: () => setMode("select"),
    insertMode: () => setMode("insert"),
    marker: () => addMarker(playhead),
    markerRange: () => markRange(),
    remove: () => deleteSelected(),
    all: () => select([...body.tracks.flatMap((t) => t.keyframes.map((k) => keyOf(t.id, k.id))), ...(body.markers ?? []).map((m) => markKey(m.id))]),
    clear: () => { if (!sel.size && !tile && !trackPick) return false; setSel(new Set()); setTile(null); setTrackPick(null); },
  }), active);

  const remove = async () => {
    if (!(await confirm({ danger: true, title: `Delete “${f.name}”?`, message: "It goes to the recycle bin of the project.", confirmLabel: "Delete" }))) return;
    try { await store.bin({ project: projectId }, [f.id]); onGone?.(); } catch (e) { toastError(e); }
  };
  const duplicate = async () => { try { await store.duplicate(f, { name: `${f.name}, copy`.slice(0, 120) }); } catch (e) { toastError(e); } };
  /**
   * Fit height: every track shares the room there is. Measured, not guessed: what is not a track (ruler, markers,
   * padding, the add row) and what a row has beyond the track height (the graph's strip, borders) come off first.
   */
  const stageRef = useRef<HTMLDivElement>(null);
  const fitHeight = () => {
    const scroll = stageRef.current?.querySelector<HTMLElement>(".fl-scroll");
    const rows = [...(scroll?.querySelectorAll<HTMLElement>(".fl-row[data-row]") ?? [])];
    if (!scroll || !rows.length) return;
    const tracksNow = rows.reduce((n, r) => n + r.offsetHeight, 0);
    // The content's own height (scrollHeight is the visible height while the content is shorter).
    const content = [...scroll.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0);
    const other = content - tracksNow;
    // Per row: its set minimum beyond the track height (the graph's strip) and its border; not what the label column
    // forces at a small height, which goes away as the rows grow.
    const beyond = rows.reduce((n, r) => n + (parseFloat(r.style.minHeight) || 0) - (heights[r.dataset.row!] ?? trackHeight) + r.offsetHeight - r.clientHeight, 0);
    setHeights({});
    setTrackHeight(Math.min(240, Math.max(40, Math.floor((scroll.clientHeight - other - beyond) / rows.length))));
  };

  // ---------- What is chosen ----------
  const one = sel.size === 1 && !selMarker ? splitKey([...sel][0]) : null;
  const selTrack = one ? body.tracks.find((t) => t.id === one[0]) : undefined;
  const selKf = one && selTrack ? selTrack.keyframes.find((k) => k.id === one[1]) ?? null : null;
  const tileTrack = tile ? body.tracks.find((t) => t.id === tile.trackId) : undefined;
  const tileKf = tile && tileTrack ? tileTrack.keyframes.find((k) => k.id === tile.toId) ?? null : null;
  const pickedTrack = trackPick ? body.tracks.find((t) => t.id === trackPick) : undefined;
  const marker = selMarker ? body.markers?.find((m) => m.id === selMarker) : undefined;
  const setKf = (tr: FlowTrack, k: Keyframe) => (next: Keyframe) => patchTrack(tr.id, (t) => ({ ...t, keyframes: t.keyframes.map((x) => (x.id === k.id ? next : x)) }));
  const chosen = readonly && (selKf || tileKf || marker || pickedTrack)
    ? <div className="fl-inspect"><p className="fl-note">{runsThis ? "Running on the device: locked until it stops." : "Read-only: Edit to change it."}</p></div>
    : selKf && selTrack ? (modelOf(selTrack.model)?.type === "camera"
      ? <CameraKeyframe key={selKf.id} kf={selKf} durationMs={body.durationMs} onChange={setKf(selTrack, selKf)} onDelete={() => deleteSelected()} />
      : <LightKeyframe key={selKf.id} kf={selKf} track={selTrack} durationMs={body.durationMs} onChange={setKf(selTrack, selKf)} onDelete={() => deleteSelected()} />)
    : tileKf && tileTrack ? <FadeInspect kf={tileKf} track={tileTrack}
      onChange={(curve) => patchTrack(tileTrack.id, (t) => ({ ...t, keyframes: t.keyframes.map((k) => { if (k.id !== tileKf.id) return k; const n = { ...k }; if (curve) n.fadeIn = curve; else { delete n.fadeIn; delete n.fadeStepped; } return n; }) }))}
      onStepped={(st) => patchTrack(tileTrack.id, (t) => ({ ...t, keyframes: t.keyframes.map((k) => { if (k.id !== tileKf.id) return k; const n = { ...k }; if (st) n.fadeStepped = true; else delete n.fadeStepped; return n; }) }))} />
    : marker ? <MarkerInspect key={marker.id} m={marker} flow={flow} onChange={(fn) => patchMarker(marker.id, fn)} onDelete={() => { change((b) => ({ ...b, markers: (b.markers ?? []).filter((m) => m.id !== marker.id) })); setSel(new Set()); }} />
    : pickedTrack ? <TrackInspect tr={pickedTrack} custom={heights[pickedTrack.id] !== undefined} onChange={(fn) => patchTrack(pickedTrack.id, fn)} onHeight={() => setHeights((h) => { const n = { ...h }; delete n[pickedTrack.id]; return n; })}
      onRemove={() => { change((b) => ({ ...b, tracks: b.tracks.filter((t) => t.id !== pickedTrack.id), markers: (b.markers ?? []).map((m) => (m.trackId === pickedTrack.id ? { id: m.id, at: m.at, name: m.name, ...(m.end !== undefined ? { end: m.end } : {}) } : m)) })); setTrackPick(null); }} />
    : sel.size > 1 ? <SelectionInspect n={sel.size} onDelete={() => deleteSelected()} />
    : <NothingChosen />;

  // ---------- The stage ----------
  const lanes = (
    <Lanes flow={flow} zoom={zoom} mode={mode} kfSize={kfSize} view={view} levelStep={levelStep} trackHeight={trackHeight} heights={heights} devices={devices} liveOf={(id) => hw.state?.devices.find((d) => d.id === id)}
      playhead={runsThis ? runAt : playhead} playing={playing || runsThis} locked={readonly} sel={sel} tile={tile}
      onSeek={(t) => { if (!playing && !runsThis) setPlayhead(t); }} onAdd={addKeyframe}
      onSelect={(keys, add) => select(keys, add)} onToggle={(key) => { const n = new Set(sel); if (n.has(key)) n.delete(key); else n.add(key); setTile(null); setSel(n); }}
      onMoveAll={(moves) => change((b) => ({
        ...b,
        markers: (b.markers ?? []).map((m) => { const at = moves.get(markKey(m.id)); return at === undefined ? m : { ...m, at, ...(m.end !== undefined ? { end: m.end + at - m.at } : {}) }; }),
        tracks: b.tracks.map((t) => ({ ...t, keyframes: t.keyframes.map((k) => { const at = moves.get(keyOf(t.id, k.id)); return at === undefined ? k : { ...k, at }; }) })),
      }))}
      onLevel={(trackId, kfId, level) => patchTrack(trackId, (t) => ({ ...t, keyframes: t.keyframes.map((k) => (k.id === kfId ? { ...k, intensity: level } : k)) }))}
      onTile={(trackId, toId) => {
        const k = latest.current.tracks.find((t) => t.id === trackId)?.keyframes.find((x) => x.id === toId);
        if (k && !k.fadeIn) patchTrack(trackId, (t) => ({ ...t, keyframes: t.keyframes.map((x) => (x.id === toId ? { ...x, fadeIn: "linear" } : x)) }));
        setSel(new Set()); setTrackPick(null); setTile({ trackId, toId });
      }}
      onPickTrack={(id) => { setSel(new Set()); setTile(null); setTrackPick(id); }}
      onTrack={patchTrack} onRemoveTrack={(id) => change((b) => ({ ...b, tracks: b.tracks.filter((t) => t.id !== id) }))}
      onMoveTrack={(id, before) => change((b) => { const t = b.tracks.find((x) => x.id === id)!; const rest = b.tracks.filter((x) => x.id !== id); const i = before ? rest.findIndex((x) => x.id === before) : rest.length; return { ...b, tracks: [...rest.slice(0, i), t, ...rest.slice(i)] }; })}
      onHeight={(id, h) => setHeights((x) => ({ ...x, [id]: h }))}
      onMarkerAdd={addMarker} onMarkerPick={(id) => pickMarker(id)} onMarkerResize={(id, edge, at) => patchMarker(id, (m) => ({ ...m, [edge]: at }))} />
  );
  const stage = (
    <div className="fl-stage" ref={stageRef}>
      <div className="fl-bar">
        <Segmented label="Click on a lane" value={mode} onChange={(v: string) => setMode(v as "select" | "insert")} options={[{ value: "select", icon: "cursor", title: "Select (V): clicks select, never add" }, { value: "insert", icon: "plus", title: "Insert (I): a click on a lane adds a keyframe; Alt+click adds in Select too" }]} />
        <Popover trigger={<Button size="sm" variant="quiet" icon="eye" iconAfter="chevron-down">View</Button>}>
          <div className="fl-menu">
            {(Object.keys(VIEW_LABELS) as (keyof FlowView)[]).map((k) => <Switch key={k} checked={view[k]} onChange={(on: boolean) => setView({ ...view, [k]: on })}>{VIEW_LABELS[k]}</Switch>)}
            <label className="hw-ctl"><small>Keyframes</small><Segmented label="Keyframe size" value={kfSize} onChange={(v: string) => setKfSize(v as "s" | "m" | "l")} options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]} /></label>
            <label className="hw-ctl"><small>Intensity snap</small><Segmented label="Intensity snap while dragging" value={String(levelStep)} onChange={(v: string) => setLevelStep(Number(v) as LevelStep)} options={LEVEL_STEPS.map((n) => ({ value: String(n), label: `${n} %` }))} /></label>
          </div>
        </Popover>
        {/* Size (#426): two grouped boxes in the bar, each a slider and its Fit. */}
        <div className="fl-size" role="group" aria-label="Timeline width">
          <label className="hw-ctl hw-ctl--range"><small>Width<b>{zoom === 1 ? "fit" : `${zoom.toFixed(1)}×`}</b></small><Slider value={zoom} min={ZOOM_MIN} max={ZOOM_MAX} step={0.25} onChange={(v: number) => setZoom(v)} aria-label="Timeline width" /></label>
          <Button size="sm" variant="quiet" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit width</Button>
        </div>
        <div className="fl-size" role="group" aria-label="Track height">
          <label className="hw-ctl hw-ctl--range"><small>Height<b>{trackHeight} px</b></small><Slider value={trackHeight} min={40} max={240} step={4} onChange={(v: number) => { setHeights({}); setTrackHeight(v); }} aria-label="Track height" /></label>
          <Button size="sm" variant="quiet" onClick={fitHeight}>Fit height</Button>
        </div>
        <Switch checked={live} onChange={setLive}>Live</Switch>
        <ToolbarSpacer />
        <span className="fl-time">{fmtClock(runsThis ? runAt : playhead)} / {fmtSeconds(flow.durationMs)}</span>
        <Button size="sm" variant="quiet" icon="skip-back" label="To the start" disabled={runsThis} onClick={() => { setPlaying(false); setPlayhead(0); }} />
        <Button size="sm" variant="secondary" icon="mobile" disabled={!proxy || runActive} title="Run on the device from the start: it plays on its own, without the relay, as on set" onClick={() => void runOnPhone(0)}>Run on device</Button>
        <Button size="sm" variant="quiet" icon="skip-forward" label="Run on the device from the playhead" disabled={!proxy || runActive} onClick={() => void runOnPhone(playhead)} />
        <Button size="sm" variant={playing ? "secondary" : "primary"} icon={playing ? "stop" : "play"} disabled={(!proxy && !playing) || (runActive && !runsThis)} title={playing ? "Stop and go back (Space); K stops here" : "Play from the playhead (Space)"} onClick={play}>{runsThis ? "Stop" : playing ? "Stop" : "Play"}</Button>
      </div>
      {runActive && run && (
        <div className="fl-run"><Banner tone="info" icon="mobile" title={run.phase === "loading" ? "Starting on the device…" : `Running on the device: ${run.name ?? "a flow"}`} action={<Button size="sm" icon="stop" onClick={() => requestRun({ type: "stop" })}>Stop</Button>}>
          {runsThis ? "The device plays it on its own; this flow is locked until it stops (Space). The playhead follows the device." : "Play and Live are off while the device runs a flow."}
        </Banner></div>
      )}
      {run?.phase === "error" && run.flow === f.id && <div className="fl-run"><Banner tone="danger" title={run.error ?? "Not started on the device"} /></div>}
      {!proxy && <div className="fl-run"><Banner tone="neutral" icon="mobile" title="No proxy">Switch the proxy on in Hardware on the device to play, preview or run.</Banner></div>}
      <div className="fl-scroll">
        {lanes}
        <div className="fl-add" data-row="end">
          <Select size="sm" aria-label="Add a track" value="" disabled={readonly} onChange={(id: string) => id && addTrack(id)}
            options={[{ value: "", label: "Add a track…" }, ...TRACK_MODELS.map((m) => ({ value: m.id, label: `${m.brand} ${m.model}` }))]} />
        </div>
      </div>
    </div>
  );

  const props = (
    <div className="fl-props">
      <label className="hw-ctl"><small>Name</small><TextInput size="sm" value={f.name} disabled={readonly} maxLength={120} onChange={(e) => { const n = e.currentTarget.value.trim(); if (n && n !== f.name) void store.rename(f, n).catch(toastError); }} /></label>
      <label className="hw-ctl"><small>Length (s)</small><NumberInput size="sm" value={body.durationMs / 1000} step={1} min={1} max={FLOW_MAX_MS / 1000} disabled={readonly}
        onChange={(v: number) => { if (v > 0) change((b) => { const d = Math.min(FLOW_MAX_MS, Math.max(1000, snap(v * 1000))); return { ...b, durationMs: d, tracks: b.tracks.map((t) => ({ ...t, keyframes: t.keyframes.filter((k) => k.at <= d) })), markers: (b.markers ?? []).filter((m) => m.at <= d).map((m) => (m.end !== undefined && m.end > d ? { ...m, end: d } : m)) }; }); }} /></label>
      <Switch checked={body.loop} disabled={readonly} onChange={(on: boolean) => change((b) => ({ ...b, loop: on }))}>Loop</Switch>
      <div className="hw-row">
        <Button size="sm" variant="secondary" icon="copy" onClick={() => void duplicate()}>Duplicate</Button>
        <Button size="sm" variant="danger" icon="trash" disabled={!lock.editing} onClick={() => void remove()}>Delete…</Button>
      </div>
    </div>
  );

  const [panels, setPanels] = useDockLayout("flows", { left: { tabs: ["flows"] }, right: { tabs: ["chosen"] } });
  const dock: DockPanel[] = [
    { id: "flows", title: "Flows", icon: "timeline", actions: onNew ? <Button size="sm" variant="quiet" icon="plus" onClick={onNew}>New flow</Button> : undefined, body: <>{list}{props}</> },
    { id: "chosen", title: "Chosen", icon: "cursor", body: chosen },
  ];
  return (
    <div className="oc-app">
      <Toolbar>
        <Icon name="timeline" size={20} /><strong className="st-title">{f.name}</strong>
        <Badge>{body.tracks.length} tracks</Badge>
        <ToolbarSpacer />
        <span className={cx("lay-pill", proxy ? "is-preview" : "is-none")}><i />{proxy ? `Proxy: ${hw.state!.phone.name || "a device"}` : "No proxy"}</span>
        {lock.editing
          ? <Button size="sm" variant="quiet" icon="eye" title="Save, let the flow go and keep watching it: someone else can edit it now" onClick={() => void lock.stop(async () => { await flush(); })}>Stop editing</Button>
          : <span className="tl-viewing"><Icon name="eye" size={14} /><span>{lock.by === "You" ? "Editing in another window of yours" : lock.by ? `${lock.by} is editing` : "Nobody is editing"}</span><Button size="sm" variant="primary" icon="edit" disabled={!!lock.by} onClick={() => void lock.edit()}>Edit</Button></span>}
      </Toolbar>
      <Dock panels={dock} layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 280, right: 340, bottom: 280 }}>{stage}</Dock>
      <StatusBar>{body.tracks.length} tracks · {body.tracks.reduce((n, t) => n + t.keyframes.length, 0)} keyframes · {(body.markers ?? []).length} markers{body.loop ? " · loops" : ""}{playing ? " · playing" : ""} · {!lock.editing ? (lock.live ? "Read-only, live" : "Read-only, read again every 5 s") : status === "saving" ? "Saving…" : status === "waiting" ? "Changed" : status === "failed" ? <strong>Not saved</strong> : "Saved"}</StatusBar>
    </div>
  );
}
