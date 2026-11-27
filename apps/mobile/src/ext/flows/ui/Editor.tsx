import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { persisted } from "../../../store";
import { randomUUID } from "expo-crypto";
import { CATALOGUE, modelOf } from "@openclapper/ext-hardware";
import {
  addKeyframe, addMarker, addTrack, fmtClock, fmtSeconds, FlowPlayer, LEVEL_STEPS, patchMarker, patchTrack, removeKeys, removeTrack, setDuration, setKeyframe,
  DEFAULT_VIEW, START_KEYFRAME, VIEW_LABELS, type Flow, type FlowBody, type FlowView, type Keyframe, type KeyframeSize, type LevelStep,
} from "@openclapper/ext-flows";
import { ApiError, authHeaders, canCall, lockFile, unlockFile } from "../../../api";
import { API_URL } from "../../../config";
import { log } from "../../../log";
import { useBack } from "../../../shell/back";
import { Banner, Block, Button, Chip, Header, Hint, IconButton, Input, ListRow, makeStyles, Seg, Sheet, SheetList, Slider, Toggle, type, useTheme } from "../../../ui";
import { hub } from "../../hardware/hub";
import { useDevices } from "../../hardware/library";
import { proxyRunning, startProxy, useHardware } from "../../hardware/proxy";
import { loadFlows, saveFlow, usePendingOf, type LocalFlow } from "../store";
import { CameraKeyframe, FadeInspect, LightKeyframe, MarkerInspect, TrackInspect } from "./Inspect";
import { Lanes, MARKS_H, RULER_H, type AxisLock, type Mode, type Pick } from "./Lanes";

const RENEW_MS = 30_000;
const ZOOM_MAX = 32, HEIGHT_MIN = 48, HEIGHT_MAX = 240;
/** What the lanes show and how large, on this device (#426): the Studio's View options, keyframe size, width and height. */
interface DeviceView {
  view: FlowView; kfSize: KeyframeSize; zoom: number; height: number;
  /** Intensity drags snap to this many percent; absent (kept before it existed): 1. */ levelStep?: LevelStep;
  /** A keyframe drag kept to one axis (a pen on set): "time" holds its time, "level" its intensity. */ axisLock?: AxisLock;
}
const deviceView = persisted<DeviceView>("flows.view.v1", { view: DEFAULT_VIEW, kfSize: "m", zoom: 1, height: 64 },
  (v) => typeof v === "object" && v !== null && typeof (v as DeviceView).zoom === "number" && typeof (v as DeviceView).height === "number");
type Lock = { state: "mine"; holder: string } | { state: "offline" } | { state: "theirs"; by: string } | { state: "asking" };

/**
 * A flow edited on the device itself (docs/features/flows.md, "On the device"; #426): the same tracks, keyframes,
 * fades and markers as in the Studio, played on this device's own connections, without a connection to the server
 * if need be. Online it holds the edit lock like the Studio (one editor at a time); offline it edits freely and the
 * store sends the result later (saved beside the server's version when that changed meanwhile).
 */
export function FlowEditor({ flow, back }: { flow: LocalFlow; back: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const [body, setBody] = useState<FlowBody>(flow.body);
  const [name, setName] = useState(flow.name);
  const [pick, setPick] = useState<Pick>(null);
  // Whether what is chosen shows its sheet: only a tap in Edit mode or on a track label opens it (#426).
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("select");
  const dv = deviceView.use();
  const setDv = (p: Partial<DeviceView>) => deviceView.set((x) => ({ ...x, ...p }));
  const zoom = dv.zoom;
  const [room, setRoom] = useState(0);
  // What Fit height would set, computed once: its button is off while the height already is that, like Fit width at 1×.
  const fitH = Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, (room - RULER_H - MARKS_H - 56) / Math.max(1, body.tracks.length))));
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState(true);
  const [sheet, setSheet] = useState<"flow" | "track" | "view" | null>(null);
  const [lock, setLock] = useState<Lock>({ state: "asking" });
  const devices = useDevices();
  const hw = useHardware();
  const unsent = usePendingOf(flow.id);
  useBack(back, true);

  // ---------- The edit lock: held while online, renewed; someone else holding it makes this read-only ----------
  const holderRef = useRef<string | null>(null);
  useEffect(() => {
    let stop = false;
    const holder = randomUUID();
    const take = async () => {
      if (flow.updatedAt === null || !canCall()) { if (!stop) setLock({ state: "offline" }); return; }
      try {
        const l = await lockFile(flow.id, holder);
        if (stop) return;
        holderRef.current = holder;
        void l;
        setLock({ state: "mine", holder });
      } catch (e) {
        if (stop) return;
        // Someone else edits it: watch their saves (read again with each renewal).
        if (e instanceof ApiError && e.status === 423) { holderRef.current = null; setLock({ state: "theirs", by: ((e.body as { lock?: { by?: string } } | null)?.lock?.by) ?? "Someone" }); void loadFlows(flow.projectId); }
        else setLock({ state: "offline" });
      }
    };
    void take();
    const h = setInterval(() => void take(), RENEW_MS);
    // The file's live room (#426): who edits is never stale. Freed: take it at once; saved elsewhere: read it again.
    let ws: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (stop || flow.updatedAt === null || !canCall()) return;
      // React Native's WebSocket takes headers: the session goes as it does for every call (link.ts).
      const s = new (WebSocket as unknown as new (url: string, protocols: string[] | null, opts: { headers: Record<string, string> }) => WebSocket)(`${API_URL.replace(/^http/, "ws")}/api/canvases/${flow.id}/live?holder=${holder}`, null, { headers: authHeaders() });
      ws = s;
      s.onmessage = (e) => {
        let m: { type?: string; by?: string | null };
        try { m = JSON.parse(String(e.data)) as typeof m; } catch { return; }
        if (m.type === "editor" && !m.by && !holderRef.current) void take();
        else if (m.type === "saved" && !holderRef.current) void loadFlows(flow.projectId);
      };
      s.onclose = () => { if (ws === s) ws = null; if (!stop) retry = setTimeout(open, 5000); };
    };
    open();
    return () => { stop = true; clearInterval(h); clearTimeout(retry); ws?.close(); if (holderRef.current) void unlockFile(flow.id, holderRef.current).catch(() => undefined); };
  }, [flow.id]);
  const locked = lock.state === "theirs" || lock.state === "asking";
  // Read-only, it shows the flow as its editor last saved it.
  useEffect(() => { if (lock.state === "theirs") { setBody(flow.body); setName(flow.name); } }, [flow.body, flow.name, lock.state]);

  // ---------- Changes: kept at once, sent by the store ----------
  const latest = useRef({ body, name });
  latest.current = { body, name };
  const change = (fn: (b: FlowBody) => FlowBody) => {
    if (locked) return;
    const next = fn(latest.current.body);
    setBody(next);
    saveFlow({ id: flow.id, projectId: flow.projectId, name: latest.current.name, body: next }, holderRef.current ?? undefined);
  };
  const rename = (n: string) => {
    setName(n);
    if (n.trim()) saveFlow({ id: flow.id, projectId: flow.projectId, name: n.trim(), body: latest.current.body }, holderRef.current ?? undefined);
  };

  // ---------- Playing and Live on this device's own connections ----------
  const seq = useMemo<Flow>(() => ({ id: flow.id, name, updatedAt: flow.updatedAt ?? "", ...body }), [body, name]);
  const seqRef = useRef(seq);
  seqRef.current = seq;
  const send = (id: string, cmd: Parameters<typeof hub.send>[1]) => { hub.send(id, cmd).catch((e) => log("debug", "flow edit: not sent", { device: id, error: e })); };
  const player = useRef<FlowPlayer | null>(null);
  if (!player.current) {
    player.current = new FlowPlayer(() => seqRef.current, send,
      { now: () => Date.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) },
      { tick: (t) => setPlayhead(t), end: (t) => { setPlaying(false); setPlayhead(t); } });
  }
  useEffect(() => () => player.current?.stop(), []);
  const holds = hw.running;
  const play = () => {
    if (!player.current) return;
    if (playing) { player.current.stop(); setPlaying(false); return; }
    if (!proxyRunning()) return;
    player.current.play(playhead >= body.durationMs ? 0 : playhead);
    setPlaying(true);
  };
  // Live: while stopped, the lights show the flow at the playhead and follow every edit.
  useEffect(() => { if (live && !playing && holds) player.current?.emitter.emit(seq, playhead, false, send); }, [live, playing, holds, seq, playhead]);
  useEffect(() => { player.current?.emitter.reset(); }, [holds]);

  // ---------- What is chosen ----------
  const track = pick && (pick.kind === "kf" || pick.kind === "fade" || pick.kind === "track") ? body.tracks.find((t) => t.id === (pick.kind === "track" ? pick.id : pick.track)) : undefined;
  const kf = pick && (pick.kind === "kf" || pick.kind === "fade") ? track?.keyframes.find((k) => k.id === pick.id) : undefined;
  const marker = pick?.kind === "marker" ? body.markers?.find((m) => m.id === pick.id) : undefined;
  const choose = (p: Pick, show = false) => {
    setPick(p);
    setOpen(show && !!p);
    if (playing) return;
    if (p?.kind === "kf") { const k = body.tracks.find((t) => t.id === p.track)?.keyframes.find((x) => x.id === p.id); if (k) setPlayhead(k.at); }
    if (p?.kind === "marker") { const m = body.markers?.find((x) => x.id === p.id); if (m) setPlayhead(m.at); }
  };
  const setKf = (k: Keyframe) => track && change((b) => setKeyframe(b, track.id, k));
  const deviceName = (id: string | null) => (id ? devices.find((d) => d.id === id)?.name ?? "Gone" : "No device");
  const camera = track ? modelOf(track.model)?.type === "camera" : false;

  const inspector = locked ? null
    : kf && track && pick?.kind === "kf" ? (camera
      ? <CameraKeyframe kf={kf} durationMs={body.durationMs} onChange={setKf} onDelete={() => { change((b) => removeKeys(b, new Set([`${track.id}/${kf.id}`]))); unpick(); }} />
      : <LightKeyframe kf={kf} track={track} durationMs={body.durationMs} onChange={setKf} onDelete={() => { change((b) => removeKeys(b, new Set([`${track.id}/${kf.id}`]))); unpick(); }} />)
    : kf && track && pick?.kind === "fade" ? <FadeInspect kf={kf} track={track} onChange={(curve) => { const n = { ...kf }; if (curve) n.fadeIn = curve; else delete n.fadeIn; setKf(n); }} onStepped={(st) => setKf({ ...kf, fadeStepped: st || undefined })} />
    : marker ? <MarkerInspect m={marker} durationMs={body.durationMs} onChange={(fn) => change((b) => patchMarker(b, marker.id, fn))} onDelete={() => { change((b) => removeKeys(b, new Set([`@m/${marker.id}`]))); unpick(); }} />
    : track && pick?.kind === "track" ? <TrackInspect t={track} devices={devices} onChange={(fn) => change((b) => patchTrack(b, track.id, fn))} onDelete={() => { change((b) => removeTrack(b, track.id)); unpick(); }} />
    : null;
  function unpick() { setPick(null); setOpen(false); }
  const pickTitle = pick?.kind === "kf" ? `${kf?.id === START_KEYFRAME ? "Start" : "Keyframe"} · ${track?.name ?? ""}` : pick?.kind === "fade" ? `Into ${fmtSeconds(kf?.at ?? 0)} · ${track?.name ?? ""}` : pick?.kind === "marker" ? "Marker" : pick?.kind === "track" ? "Track" : "";

  const status = lock.state === "theirs" ? `${lock.by} is editing it: read-only here` : lock.state === "offline" ? (unsent ? "Offline · changes kept here" : "Offline · editing here") : unsent ? "Saving…" : "Saved";
  return (
    <View style={s.screen}>
      <Header title={name || "Flow"} sub={`${fmtSeconds(body.durationMs)} · ${status}`} onBack={back}
        actions={[{ icon: "settings", label: "Flow settings", onPress: () => setSheet("flow") }]} />
      <View style={s.bar}>
        {/* Modes (#426): Select moves, Insert adds, Edit opens what is tapped; only Edit opens a sheet. */}
        <Seg accessibilityLabel="Mode" value={mode} onChange={setMode} disabled={locked}
          options={[{ id: "select", icon: "cursor", label: "Select" }, { id: "insert", icon: "plus", label: "Insert" }, { id: "edit", icon: "edit", label: "Edit" }]} />
        <IconButton icon="eye" label="View" onPress={() => setSheet("view")} />
        {/* Axis locks for dragging a keyframe (#426): the padlock shows what a drag holds; one at a time, since both would hold it still. */}
        <Chip label="Time" icon={dv.axisLock === "time" ? "lock" : "unlock"} selected={dv.axisLock === "time"} disabled={locked} onPress={() => setDv({ axisLock: dv.axisLock === "time" ? undefined : "time" })} />
        <Chip label="Intensity" icon={dv.axisLock === "level" ? "lock" : "unlock"} selected={dv.axisLock === "level"} disabled={locked} onPress={() => setDv({ axisLock: dv.axisLock === "level" ? undefined : "level" })} />
        <View style={{ flex: 1 }} />
        <Text style={s.time}>{fmtClock(playhead)}</Text>
        <IconButton icon="skip-back" label="To the start" onPress={() => { player.current?.stop(); setPlaying(false); setPlayhead(0); }} />
        <IconButton icon={playing ? "stop" : "play"} label={playing ? "Stop" : "Play"} disabled={!holds && !playing} onPress={play} color={playing ? c.danger : c.accent} />
      </View>
      {/* Size (#426): two grouped boxes, each a slider and its Fit. */}
      <View style={s.sizes}>
        <View style={s.box}>
          <View style={{ flex: 1 }}><Slider label="Width" value={zoom} min={1} max={ZOOM_MAX} step={0.25} format={(z) => (z === 1 ? "fit" : `${z.toFixed(1)}×`)} onChange={(z) => setDv({ zoom: z })} /></View>
          <Button kind="ghost" label="Fit" disabled={zoom === 1} onPress={() => setDv({ zoom: 1 })} />
        </View>
        <View style={s.box}>
          <View style={{ flex: 1 }}><Slider label="Height" value={dv.height} min={HEIGHT_MIN} max={HEIGHT_MAX} step={4} format={(h) => `${h}`} onChange={(h) => setDv({ height: h })} /></View>
          <Button kind="ghost" label="Fit" disabled={dv.height === fitH} onPress={() => setDv({ height: fitH })} />
        </View>
      </View>
      {lock.state === "theirs" && <Block><Banner kind="info" icon="lock" title="Read-only" meta={`${lock.by} is editing this flow. You can still play it.`} /></Block>}
      {unsent?.error && <Block><Banner kind="warn" icon="warning" title="Not saved to the server" meta={`${unsent.error}. It stays on this device; change it to try again.`} /></Block>}
      {!holds && <Block><Hint>Playing and Live drive the lights connected to this device: hold the connections here.</Hint><Button kind="secondary" icon="bluetooth" label="Hold the connections here" onPress={() => { startProxy(); }} /></Block>}
      <View style={{ flex: 1 }} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
      <Lanes body={body} zoom={zoom} view={dv.view} kfSize={dv.kfSize} levelStep={dv.levelStep ?? 1} axisLock={dv.axisLock} laneHeight={dv.height} mode={mode} playhead={playhead} pick={pick} locked={locked} deviceName={deviceName}
        onPick={(p) => choose(p, p?.kind === "track" || mode === "edit")} onSeek={(t) => { if (!playing) setPlayhead(t); }}
        onAddKeyframe={(trackId, t) => { const r = addKeyframe(latest.current.body, trackId, t, randomUUID()); if (r.keyframe) { change(() => r.body); choose({ kind: "kf", track: trackId, id: r.keyframe.id }); if (!playing) setPlayhead(r.keyframe.at); } }}
        onAddMarker={(t) => { const r = addMarker(latest.current.body, t, randomUUID()); change(() => r.body); choose({ kind: "marker", id: r.marker.id }); }}
        onMoveMarker={(id, t) => change((b) => patchMarker(b, id, (m) => {
          // A range keeps its length and stays inside the flow.
          const len = m.end !== undefined ? m.end - m.at : 0, at = Math.min(b.durationMs - len, Math.max(0, t));
          return m.end !== undefined ? { ...m, at, end: at + len } : { ...m, at };
        }))}
        onMoveKeyframe={(trackId, k, t, level) => change((b) => setKeyframe(b, trackId, { ...k, at: t, ...(level !== undefined ? { intensity: Math.round(level * 100) / 100, ...(level > 0 && k.power === false ? { power: true } : {}) } : {}) }))}
        onAddTrack={() => setSheet("track")} />
      </View>
      <Sheet visible={open && !!inspector} title={pickTitle} onClose={() => setOpen(false)} height={0.6}>{inspector}</Sheet>
      <Sheet visible={sheet === "track"} title="Add a track" onClose={() => setSheet(null)} height={0.7}>
        <SheetList>
          {CATALOGUE.filter((m) => m.type === "light" || m.type === "camera").map((m) => (
            <ListRow key={m.id} icon={m.type === "camera" ? "video" : "light-fixture"} title={`${m.brand} ${m.model}`} meta={devices.filter((d) => d.body.model === m.id).map((d) => d.name).join(", ") || undefined}
              onPress={() => { const id = randomUUID(); change((b) => addTrack(b, m.id, id)); setSheet(null); }} />
          ))}
        </SheetList>
      </Sheet>
      <Sheet visible={sheet === "view"} title="View" onClose={() => setSheet(null)}>
        <View style={s.form}>
          {(Object.keys(VIEW_LABELS) as (keyof FlowView)[]).map((k) => <Toggle key={k} label={VIEW_LABELS[k]} meta={k === "graph" ? "Drag a keyframe up or down to set its intensity" : undefined} value={dv.view[k]} onChange={(on) => setDv({ view: { ...dv.view, [k]: on } })} />)}
          <Text style={s.label}>Keyframes</Text>
          <Seg accessibilityLabel="Keyframe size" block value={dv.kfSize} onChange={(v) => setDv({ kfSize: v })} options={[{ id: "s", label: "Small · pen" }, { id: "m", label: "Medium" }, { id: "l", label: "Large · finger" }]} />
          <Text style={s.label}>Intensity snap while dragging</Text>
          <Seg accessibilityLabel="Intensity snap while dragging" block value={String(dv.levelStep ?? 1)} onChange={(v) => setDv({ levelStep: Number(v) as LevelStep })} options={LEVEL_STEPS.map((n) => ({ id: String(n), label: `${n} %` }))} />
        </View>
      </Sheet>
      <Sheet visible={sheet === "flow"} title="Flow" onClose={() => setSheet(null)}>
        <View style={s.form}>
          <Text style={s.label}>Name</Text>
          <Input value={name} maxLength={120} editable={!locked} onChangeText={rename} />
          <Slider label="Length" value={body.durationMs} min={1000} max={600_000} step={1000} format={fmtSeconds} disabled={locked} onChange={(ms) => change((b) => setDuration(b, ms))} />
          <Toggle label="Loop" meta="Starts again at the end" value={body.loop} disabled={locked} onChange={(loop) => change((b) => ({ ...b, loop }))} />
          <Toggle label="Live" meta="While stopped, the lights show the flow at the playhead" value={live} onChange={setLive} />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  bar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  time: { ...type("label", "semibold"), color: c.text, fontVariant: ["tabular-nums"], marginRight: 4 },
  form: { gap: 14 },
  sizes: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  box: { flex: 1, minWidth: 220, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: c.borderSubtle, borderRadius: 8, backgroundColor: c.surfaceSunken },
  label: { ...type("label", "semibold"), color: c.text },
}));
