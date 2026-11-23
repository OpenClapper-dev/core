// UX workshop U6: the flow editor, one component for the Studio and for the phone or tablet (`touch`). It follows
// today's light sequences (docs/features/lights.md): tracks of one device type with an assigned device, a start
// keyframe that cannot move, keyframes that hold values and jump, fade tiles between them, markers, track colours,
// view options, Select and Insert modes, play, loop and live. A prototype: nothing is sent to a device.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Checkbox, DropdownMenu, Icon, PropertyList, ResizablePanel, PropertyRow, PropertySection, Segmented, Select, Slider, Switch, TextInput, cx, type IconName } from "@openclapper/design";
import { ColourButton, type Colour } from "../u1/catalogue";

export interface Key { id: string; t: number; on: boolean; level: number; mode: "white" | "colour"; kelvin: number; colour: string; effect?: string; /** How the values arrive from the keyframe before: a jump, or a fade with a curve. */ fade?: string }
export interface Track { id: string; name: string; type: string; device?: string; color: number; muted?: boolean; keys: Key[] }
export interface Marker { id: string; name: string; t: number; out?: number }
export interface Flow { id: string; name: string; length: number; tracks: Track[]; markers: Marker[] }
/** Device types a track can be of, with the devices of the project that are of that type. */
export const TYPES: Record<string, { icon: IconName; devices: string[]; colour?: boolean; effects?: boolean; record?: boolean }> = {
  "Aputure MC": { icon: "light-fixture", devices: ["MC, window", "MC, practical"], colour: true, effects: true }, "NEEWER FS300B": { icon: "light-fixture", devices: ["Key"] }, "NEEWER FS230B": { icon: "light-fixture", devices: ["Fill"] }, "Blackmagic Pocket 6K": { icon: "video", devices: ["A cam"], record: true },
};
const k = (id: string, t: number, c: Partial<Key> = {}): Key => ({ id, t, on: true, level: 60, mode: "white", kelvin: 4300, colour: "#ff7a3d", ...c });
export const START_FLOWS: Flow[] = [
  { id: "f1", name: "Sunrise through the window", length: 20, markers: [{ id: "m1", name: "Sun up", t: 4 }, { id: "m2", name: "Dialogue", t: 8, out: 16 }], tracks: [
    { id: "t1", name: "Window", type: "Aputure MC", device: "MC, window", color: 3, keys: [k("a", 0, { level: 0, mode: "colour", colour: "#ff5a1f" }), k("b", 4, { level: 60, mode: "colour", colour: "#ff9a4d", fade: "s" }), k("c", 12, { level: 70, kelvin: 5600, fade: "linear" }), k("d", 18, { level: 0, on: false })] },
    { id: "t2", name: "Key", type: "NEEWER FS300B", device: "Key", color: 6, keys: [k("e", 0, { level: 0, on: false, kelvin: 5600 }), k("f", 6, { level: 0, kelvin: 5600 }), k("g", 8, { level: 85, kelvin: 5600, fade: "expo" })] },
    { id: "t3", name: "A cam", type: "Blackmagic Pocket 6K", device: "A cam", color: 1, keys: [k("h", 0, { on: false }), k("i", 2, { on: true }), k("j", 19, { on: false })] },
  ] },
  { id: "f2", name: "Lightning", length: 4, markers: [], tracks: [{ id: "t1", name: "Strike", type: "Aputure MC", device: "MC, practical", color: 2, keys: [k("a", 0, { level: 0 }), k("b", 1, { level: 100, kelvin: 6500, effect: "Lightning" }), k("c", 1.6, { level: 0 })] }] },
];
export const newFlow = (n: number): Flow => ({ id: `f${Date.now()}`, name: `Flow ${n}`, length: 10, markers: [], tracks: [{ id: "t1", name: "Track 1", type: "Aputure MC", color: 1, keys: [k("a", 0, { level: 0 })] }] });

const white = (kelvin: number) => { const u = Math.min(1, Math.max(0, (kelvin - 2700) / 3800)); return `rgb(255, ${Math.round(180 + 53 * u)}, ${Math.round(107 + 148 * u)})`; };
const shows = (key: Key) => (!key.on || key.level === 0 ? "transparent" : key.mode === "colour" ? key.colour : white(key.kelvin));
type Sel = { kind: "key" | "fade"; track: string; id: string } | { kind: "track" | "marker"; id: string } | null;

/**
 * `frame` lets the host place the two parts itself: the Studio puts the inspector into its dock beside its other
 * panels. Without it (phone and tablet) the inspector is a panel under the tracks.
 */
export function FlowEditor({ flow, onChange, touch, onRun, frame }: { flow: Flow; onChange: (f: Flow) => void; touch?: boolean; onRun?: () => void; frame?: (main: ComponentChildren, inspector: ComponentChildren) => ComponentChildren }) {
  const [sel, setSel] = useState<Sel>(null);
  const [mode, setMode] = useState("select");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [live, setLive] = useState(true);
  const [zoom, setScale] = useState(46);
  const [room, setRoom] = useState(0);
  const [view, setView] = useState({ graph: true, colour: true, labels: !touch });
  const lanes = useRef<HTMLDivElement>(null);
  // How wide the lanes are, to fit the whole flow into them: always on a phone or tablet, on request in the Studio.
  useEffect(() => { const el = lanes.current; if (!el) return; const ro = new ResizeObserver(() => setRoom(el.clientWidth)); ro.observe(el); setRoom(el.clientWidth); return () => ro.disconnect(); }, []);
  const fit = room ? Math.max(8, (room - (touch ? 108 : 206) - 28) / flow.length) : 28, scale = touch ? Math.max(24, fit) : zoom;
  useEffect(() => { if (!playing) return; const t0 = performance.now() - t * 1000; let raf = 0; const tick = () => { const now = (performance.now() - t0) / 1000; if (now >= flow.length) { if (loop) { setT(0); setPlaying(false); setTimeout(() => setPlaying(true), 0); } else { setPlaying(false); setT(0); } } else { setT(now); raf = requestAnimationFrame(tick); } }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [playing, loop, flow.length]);
  const setTrack = (id: string, c: Partial<Track>) => onChange({ ...flow, tracks: flow.tracks.map((x) => (x.id === id ? { ...x, ...c } : x)) });
  const setKey = (track: string, id: string, c: Partial<Key>) => onChange({ ...flow, tracks: flow.tracks.map((x) => (x.id === track ? { ...x, keys: x.keys.map((y) => (y.id === id ? { ...y, ...c } : y)).sort((a, b) => a.t - b.t) } : x)) });
  const timeAt = (clientX: number) => { const r = lanes.current!.getBoundingClientRect(); return Math.max(0, Math.min(flow.length, Math.round(((clientX - r.left + lanes.current!.scrollLeft - (touch ? 108 : 206)) / scale) * 10) / 10)); };
  const scrub = (e: PointerEvent) => { e.preventDefault(); setPlaying(false); const to = (m: PointerEvent) => setT(timeAt(m.clientX)); to(e); const up = () => { removeEventListener("pointermove", to); removeEventListener("pointerup", up); }; addEventListener("pointermove", to); addEventListener("pointerup", up); };
  const moveKey = (track: Track, key: Key) => (e: PointerEvent) => {
    e.stopPropagation(); setSel({ kind: "key", track: track.id, id: key.id });
    if (key.t === 0) return; // the start keyframe stays
    let moved = false;
    const move = (m: PointerEvent) => { moved = true; setKey(track.id, key.id, { t: Math.max(0.1, timeAt(m.clientX)) }); };
    // The release of a drag is not a click on the lane under it, which would drop the selection.
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); if (moved) { const eat = (c: MouseEvent) => c.stopPropagation(); addEventListener("click", eat, { capture: true, once: true }); setTimeout(() => removeEventListener("click", eat, { capture: true }), 0); } };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const addKey = (track: Track, at: number) => { const prev = [...track.keys].reverse().find((x) => x.t <= at) ?? track.keys[0], id = `k${Date.now()}`; setTrack(track.id, { keys: [...track.keys, { ...prev, id, t: at, fade: undefined, effect: undefined }].sort((a, b) => a.t - b.t) }); setSel({ kind: "key", track: track.id, id }); };
  const remove = () => {
    if (!sel) return;
    if (sel.kind === "key") { const tr = flow.tracks.find((x) => x.id === sel.track)!; if (tr.keys.find((x) => x.id === sel.id)?.t === 0) return; setTrack(tr.id, { keys: tr.keys.filter((x) => x.id !== sel.id) }); }
    else if (sel.kind === "marker") onChange({ ...flow, markers: flow.markers.filter((m) => m.id !== sel.id) });
    else if (sel.kind === "track") onChange({ ...flow, tracks: flow.tracks.filter((x) => x.id !== sel.id) });
    setSel(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (touch || (e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); } else if (e.key === "v") setMode("select"); else if (e.key === "i") setMode("insert");
      else if (e.key === "m") onChange({ ...flow, markers: [...flow.markers, { id: `m${Date.now()}`, name: "Marker", t: Math.round(t * 10) / 10 }] });
      else if (e.key === "Delete" || e.key === "Backspace") remove();
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  });

  const head = touch ? 92 : 190, pad = head + 16, h = view.graph ? 64 : 44, step = [1, 2, 5, 10].find((x) => x * scale >= 56) ?? 20;
  const track = sel && (sel.kind === "key" || sel.kind === "fade") ? flow.tracks.find((x) => x.id === sel.track) : sel?.kind === "track" ? flow.tracks.find((x) => x.id === sel.id) : undefined;
  const key = sel?.kind === "key" || sel?.kind === "fade" ? track?.keys.find((x) => x.id === sel.id) : undefined;
  const marker = sel?.kind === "marker" ? flow.markers.find((m) => m.id === sel.id) : undefined;
  const type = track ? TYPES[track.type] : undefined;
  const setM = (c: Partial<Marker>) => marker && onChange({ ...flow, markers: flow.markers.map((m) => (m.id === marker.id ? { ...m, ...c } : m)) });
  const inspector = (
    <PropertyList key={sel ? `${sel.kind}${sel.id}` : "none"}>
      {sel?.kind === "key" && key && track && type && (
        <PropertySection title={key.t === 0 ? "Start keyframe" : `Keyframe at ${key.t.toFixed(1)} s`} icon="timeline">
          {key.t === 0 && <p className="u6-note">Every track starts with one. It cannot be moved or removed, so a flow never starts from whatever the device showed before.</p>}
          <div className="u6-pad"><Switch checked={key.on} onChange={(v) => setKey(track.id, key.id, { on: v })}>{type.record ? "Recording" : "Power"}</Switch></div>
          {!type.record && <>
            <PropertyRow label="Intensity"><span className="u3-slide"><Slider min={0} max={100} value={key.level} onChange={(v) => setKey(track.id, key.id, { level: v })} /><b className="oc-num">{key.level} %</b></span></PropertyRow>
            {type.colour && <PropertyRow label="Light"><Segmented label="White or colour" value={key.mode} onChange={(v) => setKey(track.id, key.id, { mode: v as "white" | "colour" })} options={[{ value: "white", label: "White" }, { value: "colour", label: "Colour" }]} /></PropertyRow>}
            {key.mode === "colour" && type.colour ? <PropertyRow label="Colour"><ColourButton value={key.colour} label="Light colour" onChange={(c: Colour) => setKey(track.id, key.id, { colour: String(c) })} /></PropertyRow> : <PropertyRow label="White"><span className="u3-slide"><Slider min={2700} max={6500} step={100} value={key.kelvin} onChange={(v) => setKey(track.id, key.id, { kelvin: v })} /><b className="oc-num">{key.kelvin} K</b></span></PropertyRow>}
            {type.effects && <PropertyRow label="Effect"><Select size="sm" value={key.effect ?? ""} onChange={(v) => setKey(track.id, key.id, { effect: v || undefined })} options={[{ value: "", label: "None" }, ...["Fire", "Lightning", "TV", "Pulsing", "Paparazzi"].map((x) => ({ value: x, label: x }))]} /></PropertyRow>}
          </>}
          {key.t > 0 && <div className="u6-pad"><Button size="sm" variant="quiet" icon="trash" onClick={remove}>Remove the keyframe</Button></div>}
        </PropertySection>
      )}
      {sel?.kind === "fade" && key && track && (
        <PropertySection title={`Into the keyframe at ${key.t.toFixed(1)} s`} icon="route">
          <PropertyRow label="Arrives by"><Segmented label="Jump or fade" value={key.fade ? "fade" : "jump"} onChange={(v) => setKey(track.id, key.id, { fade: v === "fade" ? "linear" : undefined })} options={[{ value: "jump", label: "Jump" }, { value: "fade", label: "Fade" }]} /></PropertyRow>
          {key.fade && <PropertyRow label="Curve"><Select size="sm" value={key.fade} onChange={(v) => setKey(track.id, key.id, { fade: v })} options={[{ value: "linear", label: "Linear" }, { value: "expo", label: "Expo" }, { value: "log", label: "Log" }, { value: "s", label: "S" }]} /></PropertyRow>}
          <p className="u6-note">Between two keyframes the device holds the first one's values and jumps at the second, unless the gap is a fade: then everything that differs blends over it.</p>
        </PropertySection>
      )}
      {sel?.kind === "track" && track && (
        <PropertySection title="Track" icon="rows">
          <PropertyRow label="Name"><TextInput size="sm" value={track.name} style={{ width: "100%" }} onInput={(e) => setTrack(track.id, { name: (e.target as HTMLInputElement).value })} /></PropertyRow>
          <PropertyRow label="Device type"><Select size="sm" value={track.type} onChange={(v) => setTrack(track.id, { type: v, device: undefined })} options={Object.keys(TYPES).map((x) => ({ value: x, label: x }))} /></PropertyRow>
          <PropertyRow label="Device"><Select size="sm" value={track.device ?? ""} onChange={(v) => setTrack(track.id, { device: v || undefined })} options={[{ value: "", label: "Not assigned: does not play" }, ...TYPES[track.type].devices.map((x) => ({ value: x, label: x }))]} /></PropertyRow>
          <PropertyRow label="Colour"><ColourButton value={track.color} label="Track colour" onChange={(c) => setTrack(track.id, { color: typeof c === "number" ? c : 1 })} /></PropertyRow>
          <div className="u6-pad"><Switch checked={!!track.muted} onChange={(v) => setTrack(track.id, { muted: v })}>Muted: left out of playback</Switch></div>
          <div className="u6-pad"><Button size="sm" variant="quiet" icon="trash" onClick={remove}>Remove the track</Button></div>
        </PropertySection>
      )}
      {marker && (
        <PropertySection title="Marker" icon="bookmark">
          <PropertyRow label="Name"><TextInput size="sm" value={marker.name} style={{ width: "100%" }} onInput={(e) => setM({ name: (e.target as HTMLInputElement).value })} /></PropertyRow>
          <div className="u6-pad"><Checkbox checked={marker.out != null} onChange={(v) => setM({ out: v ? Math.min(flow.length, marker.t + 2) : undefined })}>A range, with an end</Checkbox></div>
          <div className="u6-pad"><Button size="sm" variant="quiet" icon="trash" onClick={remove}>Remove the marker</Button></div>
        </PropertySection>
      )}
      {!sel && frame && <p className="u6-note">Nothing is chosen. {mode === "insert" ? "Insert: click a lane to add a keyframe there." : "Click a keyframe, the strip under a gap, a marker or a track's name."}</p>}
      {!sel && !frame && (
        <PropertySection title="Flow" icon="route">
          <PropertyRow label="Name"><TextInput size="sm" value={flow.name} style={{ width: "100%" }} onInput={(e) => onChange({ ...flow, name: (e.target as HTMLInputElement).value })} /></PropertyRow>
          <PropertyRow label="Length"><span className="u3-slide"><Slider min={2} max={60} value={flow.length} onChange={(v) => onChange({ ...flow, length: v })} /><b className="oc-num">{flow.length} s</b></span></PropertyRow>
          <p className="u6-note">{mode === "insert" ? "Insert: tap a lane to add a keyframe there." : "Select: tap a keyframe, the strip under a gap, a marker or a track's name."}</p>
        </PropertySection>
      )}
    </PropertyList>
  );
  const bar = (
      <div className="u6f-bar">
        <Button size="sm" variant="primary" icon={playing ? "pause" : "play"} label={playing ? "Stop (Space)" : "Play from the playhead (Space)"} onClick={() => setPlaying(!playing)} />
        <span className="oc-num u6-saved">{t.toFixed(1)} / {flow.length} s</span>
        <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: "select", icon: "cursor", title: "Select (V)" }, { value: "insert", icon: "plus", title: "Insert keyframes (I)" }]} />
        <Button size="sm" variant="quiet" icon="refresh" selected={loop} label="Loop" onClick={() => setLoop(!loop)} />
        {!touch && <Button size="sm" variant="quiet" icon="bulb" selected={live} title="Live: while stopped, the devices show the state at the playhead" onClick={() => setLive(!live)}>Live</Button>}
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon="bookmark" title="A marker at the playhead (M)" onClick={() => onChange({ ...flow, markers: [...flow.markers, { id: `m${Date.now()}`, name: "Marker", t: Math.round(t * 10) / 10 }] })}>{touch ? undefined : "Marker"}</Button>
        <Button size="sm" variant="quiet" icon="plus" onClick={() => { const id = `t${Date.now()}`; onChange({ ...flow, tracks: [...flow.tracks, { id, name: `Track ${flow.tracks.length + 1}`, type: "Aputure MC", color: (flow.tracks.length % 8) + 1, keys: [k(`s${Date.now()}`, 0, { level: 0 })] }] }); setSel({ kind: "track", id }); }}>{touch ? undefined : "Track"}</Button>
        <DropdownMenu size="sm" variant="quiet" icon="eye" align="end" items={[{ id: "graph", label: "Intensity graph", checked: view.graph }, { id: "colour", label: "Light colour", checked: view.colour }, { id: "labels", label: "Value labels", checked: view.labels }]} onSelect={(x) => setView({ ...view, [x]: !view[x as "graph"] })} />
        {!touch && <Button size="sm" variant="quiet" icon="expand" title="Fit the whole flow into the width" onClick={() => setScale(fit)}>Fit</Button>}
        {!touch && <span className="u3-slide" style={{ flex: "none", width: 110 }}><Slider min={8} max={110} step={2} value={Math.round(scale)} onChange={setScale} /></span>}
        {onRun && <Button size="sm" icon="mobile" onClick={onRun}>Run on phone</Button>}
      </div>
  );
  const grid = (
        <div className="u6f-grid" ref={lanes} style={{ "--head": `${head}px`, "--h": `${h}px` }}>
          <div className="u6f-inner" style={{ width: pad + flow.length * scale + 24 }}>
            <div className="u6f-ruler" onPointerDown={scrub}>{Array.from({ length: Math.floor(flow.length / step) + 1 }, (_, i) => <span key={i} style={{ left: pad + i * step * scale }}>{i * step} s</span>)}</div>
            <div className="u6f-markers">{flow.markers.map((m) => <button type="button" key={m.id} className={cx(sel?.kind === "marker" && sel.id === m.id && "is-on", m.out != null && "is-range")} style={{ left: pad + m.t * scale, width: m.out != null ? (m.out - m.t) * scale : undefined }} onClick={() => { setSel({ kind: "marker", id: m.id }); setT(m.t); }}><Icon name="bookmark" size={10} />{m.name}</button>)}</div>
            {flow.tracks.map((tr) => {
              const c = `var(--cat-${tr.color})`, pts = tr.keys.flatMap((x, i) => { const prev = tr.keys[i - 1], y = (v: Key) => h - 8 - ((v.on ? v.level : 0) / 100) * (h - 16); return prev && !x.fade ? [`${pad + x.t * scale},${y(prev)}`, `${pad + x.t * scale},${y(x)}`] : [`${pad + x.t * scale},${y(x)}`]; });
              const last = tr.keys[tr.keys.length - 1];
              return (
                <div key={tr.id} className={cx("u6f-track", tr.muted && "is-muted")} style={{ "--c": c }}>
                  <button type="button" className={cx("u6f-label", sel?.kind === "track" && sel.id === tr.id && "is-on")} onClick={() => setSel({ kind: "track", id: tr.id })}><Icon name={TYPES[tr.type].icon} /><span><b>{tr.name}</b><small>{tr.device ?? "Not assigned"}</small></span>{tr.muted && <Icon name="eye-off" size={12} />}</button>
                  <div className="u6f-lane" onClick={(e) => { if (mode === "insert" || e.altKey) addKey(tr, timeAt(e.clientX)); else setSel(null); }}>
                    {view.graph && !TYPES[tr.type].record && <svg className="u6f-graph" width={pad + flow.length * scale} height={h}><polyline points={[...pts, `${pad + flow.length * scale},${h - 8 - ((last.on ? last.level : 0) / 100) * (h - 16)}`].join(" ")} /></svg>}
                    {tr.keys.slice(1).map((x, i) => <button type="button" key={`f${x.id}`} className={cx("u6f-fade", x.fade && "is-fade", sel?.kind === "fade" && sel.id === x.id && "is-on")} style={{ left: pad + tr.keys[i].t * scale + 8, width: (x.t - tr.keys[i].t) * scale - 16 }} title={x.fade ? `Fade (${x.fade})` : "Jump: click to make it a fade"} onClick={(e) => { e.stopPropagation(); if (!x.fade) setKey(tr.id, x.id, { fade: "linear" }); setSel({ kind: "fade", track: tr.id, id: x.id }); }} />)}
                    {tr.keys.map((x) => <button type="button" key={x.id} className={cx("u6f-key", x.t === 0 && "is-start", !x.on && "is-off", sel?.kind === "key" && sel.id === x.id && sel.track === tr.id && "is-on")} style={{ left: pad + x.t * scale, top: view.graph ? h - 8 - ((x.on ? x.level : 0) / 100) * (h - 16) : h / 2, background: view.colour ? shows(x) : undefined }} onClick={(e) => e.stopPropagation()} onPointerDown={moveKey(tr, x)}>{view.labels && <span>{TYPES[tr.type].record ? (x.on ? "rec" : "stop") : x.on ? `${x.level} %` : "off"}{x.effect ? ` · ${x.effect}` : ""}</span>}</button>)}
                  </div>
                </div>
              );
            })}
            <i className="u6f-head" style={{ left: pad + t * scale }}><b onPointerDown={scrub} title="Drag to scrub" /></i>
          </div>
        </div>
  );
  if (frame) return <div className="u6f">{frame(<div className="u6f-main">{bar}{grid}</div>, inspector)}</div>;
  return (
    <div className={cx("u6f", touch && "u6f--touch")}>
      {bar}
      <div className="u6f-body">
        {grid}
        <ResizablePanel side={touch ? "bottom" : "right"} defaultSize={touch ? 236 : 300} min={touch ? 120 : 240} max={touch ? 560 : 520} collapsible className="u6f-side" aria-label="What is chosen">{inspector}</ResizablePanel>
      </div>
    </div>
  );
}
