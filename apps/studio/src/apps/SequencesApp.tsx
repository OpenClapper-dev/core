import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  CURVES, effectName, effectSettingsOf, FIXTURE_KINDS, MARKER_NAME_MAX, TRACK_COLORS, fixtureKind, inFade, sampleTrack, SEQUENCE_MAX_MS, SequencePlayer, START_KEYFRAME, startKeyframe,
  type Curve, type EffectId, type FixtureLive, type Keyframe, type LightSequence, type SendLight, type SequenceMarker, type SequenceTrack,
} from "@openclapper/vocab";
import { Banner, Button, Checkbox, confirmDialog, cx, Empty, ErrorLine, Field, Icon, IconButton, Input, Panel, PanelBody, PanelHead, Popover, Seg, Select, Switch, toast, Toolbar, ToolbarSpacer, ToolbarTitle } from "@openclapper/ui";
import { fetchFixtures, type ServerFixture } from "../api";
import { Range } from "../compose/editor";
import { bind, useKeys } from "../keys";
import { useLightProxy } from "../lightProxy";
import { BatteryChip, powerOf } from "../power";
import { setPlayingFixtures } from "../sequencePlayback";
import { useProjectId } from "../project";
import { deleteSequence, flushSequence, getSequences, upsertSequence, useSequences } from "../sequences";
import { updateSettings, useSettings } from "../settings";
import { EffectOptionFields } from "./EffectOptions";
import { graphPoints, keyframeLevel, lightColour, SEQ_VIEW_LABELS, shortLabel, useSeqView, type SeqView } from "./sequenceView";
import type { AppProps } from "./registry";

/**
 * Sequences (#304): tracks of a light type, each assigned to a light as a separate step; keyframes
 * hold values and jump, a fade tile on the gap between two keyframes blends them. Played from here
 * through the phone proxy (#307): every SEQUENCE_TICK_MS the runner samples each assigned track and
 * sends what changed; lights that fade by themselves (the MC, #289) get one native fade per tile.
 * While stopped, Live sends the state at the playhead.
 */

const CURVE_LABELS: Record<Curve, string> = { linear: "Linear", exp: "Expo", log: "Log", s: "S-curve" };
const SNAP_MS = 100;
const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;
const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const newId = () => crypto.randomUUID();
const TRACK_KINDS = FIXTURE_KINDS.filter((k) => k.caps.intensity);
/** The inspector always takes this width, empty or not, so the lanes never change width under the pointer. */
const INSPECTOR_W = "360px";

/** A selected keyframe: track id and keyframe id. */
const keyOf = (trackId: string, kfId: string) => `${trackId}/${kfId}`;
const splitKey = (k: string) => { const i = k.indexOf("/"); return [k.slice(0, i), k.slice(i + 1)] as const; };
/** A selected marker (#323) shares the selection with keyframes: box, Shift-click, drag and Delete treat both alike. */
const markKey = (id: string) => `@m/${id}`;
const markOf = (k: string) => (k.startsWith("@m/") ? k.slice(3) : null);

function newSequence(n: number): LightSequence {
  return { id: newId(), name: `Sequence ${n}`, durationMs: 10_000, loop: false, tracks: [], updatedAt: new Date().toISOString() };
}

export function SequencesApp(_p: AppProps) {
  const proxy = useLightProxy();
  const sequences = useSequences(useProjectId());
  const [selId, setSelId] = useState<string | null>(sequences[0]?.id ?? null);
  // Sequences arrive from the server after the first render: pick the first once they do.
  useEffect(() => { if (!sequences.some((s) => s.id === selId)) setSelId(sequences[0]?.id ?? null); }, [sequences.map((s) => s.id).join(",")]);
  const seq = sequences.find((s) => s.id === selId) ?? null;
  const [fixtures, setFixtures] = useState<ServerFixture[]>([]);
  useEffect(() => { void fetchFixtures().then((f) => setFixtures(f.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })))).catch(() => {}); }, []);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Where the last play started: stopping goes back there, as in a video editor. */
  const playFrom = useRef(0);
  const [live, setLive] = useState(true);
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [tile, setTile] = useState<{ trackId: string; toId: string } | null>(null);
  /** Select (default): clicks never add; Insert: a click on a lane adds a keyframe (#321). Alt+click adds in either. */
  const [mode, setMode] = useState<"select" | "insert">("select");
  const kfSize = useSettings().keyframeSize;
  const [view, setView] = useSeqView();
  const [viewMenu, setViewMenu] = useState(false);
  /** Shift+M's first press: the range's in point, waiting for its out point. */
  const rangeIn = useRef<number | null>(null);

  const seqRef = useRef(seq);
  seqRef.current = seq;
  const proxyRef = useRef(proxy);
  proxyRef.current = proxy;
  /** Commands go through the proxy; nothing without one. */
  const sendLight: SendLight = (id, cmd) => { if (proxyRef.current.proxy) proxyRef.current.send(id, cmd); };
  /** Live (scrubbing, edits) and Play share what was sent, so a play starts from what the lights show. */
  const player = useRef<SequencePlayer | null>(null);
  player.current ??= new SequencePlayer(() => seqRef.current, sendLight, { now: () => performance.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) }, {
    tick: (t) => setPlayhead(t),
    end: (t) => { setPlayhead(t); setPlaying(false); },
  });

  // Running on the phone (#321): the phone plays, the Studio watches. That sequence is locked, and
  // nothing here plays or follows the playhead meanwhile (it would fight the phone for the lights).
  const run = proxy.run;
  const runActive = run?.phase === "playing" || run?.phase === "loading";
  const locked = runActive && run?.sequenceId === seq?.id;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [, setRunTick] = useState(0);
  useEffect(() => { if (!locked) return; const h = setInterval(() => setRunTick((n) => n + 1), 100); return () => clearInterval(h); }, [locked]);
  // The phone's position, carried on between its reports.
  const runAt = (() => {
    if (!locked || !run || run.phase !== "playing" || !run.durationMs) return run?.atMs ?? 0;
    const t = run.atMs + (performance.now() - run.receivedAt);
    return run.loop ? t % run.durationMs : Math.min(run.durationMs, t);
  })();
  // After a run, Live sends everything again: the lights show what the phone left them at.
  useEffect(() => { if (!runActive) player.current?.emitter.reset(); }, [runActive]);
  useEffect(() => { if (runActive) setPlaying(false); }, [runActive]);
  useEffect(() => { if (locked) { setSel(new Set()); setTile(null); } }, [locked]);

  const runOnPhone = async (from: number) => {
    if (!seq || !proxy.proxy) return;
    const fading = seq.tracks.filter((t) => t.fixtureId && !t.muted && inFade(t.keyframes, from)).length;
    if (from > 0 && fading) toast(`${fading} track${fading === 1 ? " starts" : "s start"} inside a fade: ${fading === 1 ? "its light jumps" : "their lights jump"} to the value there, then ${fading === 1 ? "fades" : "fade"} the rest`, "info");
    try {
      const revision = await flushSequence(seq.id);
      proxy.request({ type: "lights.run", sequenceId: seq.id, revision, fromMs: from });
    } catch (e) { toast(`Not started on the phone: ${(e as Error).message}`, "danger"); }
  };
  const stopRun = () => proxy.request({ type: "lights.run.stop" });

  const save = (s: LightSequence) => { if (!lockedRef.current) upsertSequence(s); };
  /** Edits start from the stored sequence, not this render's copy: quick clicks and drags must not undo each other. */
  const current = () => getSequences().find((s) => s.id === selId) ?? null;
  const patch = (fn: (s: LightSequence) => LightSequence) => { const cur = current(); if (cur) save(fn(cur)); };
  const patchTrack = (trackId: string, fn: (t: SequenceTrack) => SequenceTrack) => patch((s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === trackId ? fn(t) : t)) }));

  const emit = (t: number) => { const sq = seqRef.current; if (sq && proxy.proxy) player.current!.emitter.emit(sq, t, false, sendLight); };

  // The runner (shared with the phone, vocab/sequencePlayer.ts): a tick every SEQUENCE_TICK_MS while playing.
  useEffect(() => {
    if (!playing || !seq) return;
    setPlayingFixtures(seq.tracks.flatMap((t) => (t.fixtureId && !t.muted ? [t.fixtureId] : [])));
    player.current!.play(playhead);
    return () => { player.current!.stop(); setPlayingFixtures([]); };
  }, [playing, selId]);

  // Live: while stopped, the lights follow the playhead and every edit.
  const seqKey = seq ? JSON.stringify(seq.tracks) : "";
  useEffect(() => { if (!playing && live && !runActive) emit(playhead); }, [playhead, seqKey, live, playing, !!proxy.proxy, runActive]);

  /** Play from the playhead; while playing: stop and return to where play started (Space, as in DaVinci Resolve). */
  const play = () => {
    if (!seq) return;
    // Space stops a run on the phone.
    if (runActive) { stopRun(); return; }
    if (playing) { setPlaying(false); setPlayhead(playFrom.current); return; }
    if (!proxy.proxy) return;
    const from = playhead >= seq.durationMs ? 0 : playhead;
    playFrom.current = from;
    setPlayhead(from);
    setPlaying(true);
  };
  /** Stop and leave the playhead where it is (K). */
  const stopHere = () => { if (!playing) return false; setPlaying(false); };
  const create = () => { const s = newSequence(sequences.length + 1); save(s); setSelId(s.id); setPlayhead(0); setSel(new Set()); };
  const remove = async () => {
    if (!seq) return;
    if ((await confirmDialog({ title: `Delete “${seq.name}”?`, body: "It is deleted from the project for everyone.", confirmLabel: "Delete", danger: true })) !== true) return;
    deleteSequence(seq.id);
    setSelId(sequences.find((s) => s.id !== seq.id)?.id ?? null);
  };

  const select = (keys: Iterable<string>, add = false) => { setTile(null); setSel(new Set([...(add ? sel : []), ...keys])); };
  /** The one selected marker: its inspector replaces the keyframe's. */
  const selMarker = sel.size === 1 ? markOf([...sel][0]) : null;

  const addMarker = (at: number, end?: number, trackId?: string) => {
    const cur = current();
    if (!cur || lockedRef.current) return;
    const n = (cur.markers ?? []).length + 1;
    const m: SequenceMarker = { id: newId(), at: snap(at), name: end !== undefined ? `Section ${n}` : `Marker ${n}`, ...(end !== undefined && snap(end) > snap(at) ? { end: snap(end) } : {}), ...(trackId ? { trackId } : {}) };
    patch((s) => ({ ...s, markers: [...(s.markers ?? []), m] }));
    pickMarker(m.id);
  };
  const pickMarker = (id: string) => {
    const m = current()?.markers?.find((x) => x.id === id);
    setTile(null); setSel(new Set([markKey(id)]));
    if (m && !playing && !lockedRef.current) setPlayhead(m.at);
  };
  const patchMarker = (id: string, fn: (m: SequenceMarker) => SequenceMarker) => patch((s) => ({ ...s, markers: (s.markers ?? []).map((m) => (m.id === id ? fn(m) : m)) }));
  const deleteMarker = (id: string) => { patch((s) => ({ ...s, markers: (s.markers ?? []).filter((m) => m.id !== id) })); setSel(new Set()); };
  /** Shift+M: in point, then out point (#323). */
  const markRange = () => {
    if (rangeIn.current === null) { rangeIn.current = playhead; toast(`In at ${fmt(playhead)}: move the playhead, Shift+M again for the out point`, "info"); return; }
    const a = Math.min(rangeIn.current, playhead), b = Math.max(rangeIn.current, playhead);
    rangeIn.current = null;
    if (b - a < SNAP_MS) { toast("A range needs an out point after its in point", "info"); return; }
    addMarker(a, b);
  };
  const deleteSelected = () => {
    if (!sel.size || lockedRef.current) return false;
    const drop = new Set([...sel].filter((k) => splitKey(k)[1] !== START_KEYFRAME));
    if (!drop.size) return false;
    patch((s) => ({ ...s, markers: (s.markers ?? []).filter((m) => !drop.has(markKey(m.id))), tracks: s.tracks.map((t) => ({ ...t, keyframes: t.keyframes.filter((k) => !drop.has(keyOf(t.id, k.id))) })) }));
    setSel(new Set());
  };
  useKeys(bind("sequences", {
    remove: () => deleteSelected(),
    marker: () => addMarker(playhead),
    markerRange: () => markRange(),
    all: () => { if (!seq) return false; select([...seq.tracks.flatMap((t) => t.keyframes.map((k) => keyOf(t.id, k.id))), ...(seq.markers ?? []).map((m) => markKey(m.id))]); },
    clear: () => { if (!sel.size && !tile) return false; setSel(new Set()); setTile(null); },
    play: () => play(),
    stopHere: () => stopHere(),
    selectMode: () => setMode("select"),
    insertMode: () => setMode("insert"),
  }), !!seq);

  const addTrack = (kindId: string) => {
    const kind = fixtureKind(kindId);
    if (!kind) return;
    patch((s) => {
      const n = s.tracks.filter((t) => t.kindId === kindId).length + 1;
      // The next colour no track has yet (#323), else round again.
      const used = new Set(s.tracks.map((t) => t.color));
      const color = Array.from({ length: TRACK_COLORS }, (_, i) => i).find((i) => !used.has(i)) ?? s.tracks.length % TRACK_COLORS;
      return { ...s, tracks: [...s.tracks, { id: newId(), name: `${kind.model} ${n}`, kindId, fixtureId: null, color, keyframes: [startKeyframe(kind)] }] };
    });
  };

  const one = sel.size === 1 ? splitKey([...sel][0]) : null;
  const selTrack = one && seq ? seq.tracks.find((t) => t.id === one[0]) : undefined;
  const selKf = one && selTrack ? selTrack.keyframes.find((k) => k.id === one[1]) ?? null : null;
  const tileTrack = tile && seq ? seq.tracks.find((t) => t.id === tile.trackId) : undefined;
  const tileKf = tile && tileTrack ? tileTrack.keyframes.find((k) => k.id === tile.toId) ?? null : null;

  return (
    <>
      <Toolbar>
        <ToolbarTitle icon="chart-timeline-variant">Sequences</ToolbarTitle>
        {sequences.length > 0 && <Select label="Sequence" value={selId ?? ""} onChange={(id) => { setSelId(id); setPlaying(false); setPlayhead(0); setSel(new Set()); setTile(null); }} options={sequences.map((s) => ({ value: s.id, label: s.name }))} />}
        <Button size="sm" kind="secondary" icon="plus" onClick={create}>New</Button>
        <ToolbarSpacer />
        <span class={cx("devices-chip", proxy.proxy ? "is-ok" : "is-off")}><Icon name={proxy.proxy ? "access-point" : "access-point-off"} />{proxy.proxy ? `Proxy: ${proxy.proxy.phone.model ?? "phone"}` : "No proxy"}</span>
      </Toolbar>
      {!seq ? (
        <div class="f-app__body"><Empty icon="chart-timeline-variant" title="No sequence yet" actions={<Button icon="plus" onClick={create}>New sequence</Button>}>Tracks of a light type, keyframes on them, played through the phone's proxy. Saved with the project.</Empty></div>
      ) : (
        <div class="f-app__body">
          <div class="seq-main">
            <div class="seq-bar">
              <Input sm value={seq.name} aria-label="Name" disabled={locked} boxStyle={{ width: "200px" }} onInput={(e) => { const name = (e.target as HTMLInputElement).value; patch((s) => ({ ...s, name })); }} />
              <Field label="Length"><Input sm unit="s" disabled={locked} inputMode="decimal" boxStyle={{ width: "90px" }} value={String(seq.durationMs / 1000)}
                onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) patch((s) => ({ ...s, durationMs: Math.min(SEQUENCE_MAX_MS, snap(v * 1000)) })); }} /></Field>
              <Switch on={seq.loop} onClick={() => patch((s) => ({ ...s, loop: !s.loop }))}>Loop</Switch>
              <Switch on={live} onClick={() => setLive(!live)}>Live</Switch>
              <Seg label="Click on a lane" value={mode} onChange={setMode} options={[{ id: "select", icon: "cursor-default-outline", label: "Select", title: "Select (V): clicks select, never add" }, { id: "insert", icon: "plus", label: "Insert", title: "Insert (I): a click on a lane adds a keyframe; Alt+click adds in Select too" }]} />
              <span class="menu-anchor">
                <Button size="sm" kind="secondary" icon="eye-outline" aria-expanded={viewMenu} onClick={() => setViewMenu((x) => !x)}>View</Button>
                {viewMenu && (
                  <Popover onClose={() => setViewMenu(false)}>
                    <div class="seq-viewmenu">
                      {(Object.keys(SEQ_VIEW_LABELS) as (keyof SeqView)[]).map((k) => <Switch key={k} on={view[k]} onClick={() => setView({ [k]: !view[k] })}>{SEQ_VIEW_LABELS[k]}</Switch>)}
                    </div>
                  </Popover>
                )}
              </span>
              <Button size="sm" kind="secondary" icon="map-marker-outline" disabled={locked} title="A marker at the playhead (M); Shift+M twice for a range" onClick={() => addMarker(playhead)}>Marker</Button>
              <Seg label="Keyframe size" value={kfSize} onChange={(v) => updateSettings({ keyframeSize: v })} options={[{ id: "s", label: "S" }, { id: "m", label: "M" }, { id: "l", label: "L" }]} />
              <ToolbarSpacer />
              <span class="num seq-time">{fmt(locked ? runAt : playhead)} / {fmt(seq.durationMs)}</span>
              <IconButton icon="skip-previous" label="To the start" onClick={() => { setPlaying(false); setPlayhead(0); }} />
              <Button size="sm" kind="secondary" icon="cellphone-play" disabled={!proxy.proxy || runActive} title="Run on the phone from the start: it plays on its own, without the relay, as on set" onClick={() => void runOnPhone(0)}>Run on phone</Button>
              <IconButton icon="ray-start-arrow" label="Run on the phone from the playhead" disabled={!proxy.proxy || runActive} onClick={() => void runOnPhone(playhead)} />
              <Button size="sm" icon={playing ? "stop" : "play"} disabled={(!proxy.proxy && !playing) || runActive} title={playing ? "Stop and go back (Space); K stops here" : "Play from the playhead (Space)"} onClick={play}>{playing ? "Stop" : "Play"}</Button>
              <IconButton icon="delete-outline" label="Delete the sequence" onClick={() => void remove()} />
            </div>
            {runActive && run && (
              <div class="seq-run">
                <Banner kind="info" icon="cellphone-play" title={run.phase === "loading" ? "Starting on the phone…" : `Running on the phone: ${run.name ?? "a sequence"}`}
                  action={<Button size="sm" icon="stop" onClick={stopRun}>Stop</Button>}
                  meta={locked ? "The phone plays it on its own; this sequence is locked until it stops (Space). The playhead follows the phone's reports." : "Play and Live are off while the phone runs a sequence."} />
              </div>
            )}
            {run?.phase === "error" && run.sequenceId === seq.id && <div class="seq-run"><ErrorLine>{run.error ?? "Not started on the phone"}</ErrorLine></div>}
            <div class={cx("seq-lock", locked && "is-locked")}>
            <Lanes seq={seq} mode={mode} kfSize={kfSize} view={view} onMarkerAdd={addMarker} onMarkerPick={pickMarker} onMarkerResize={(id, edge, at) => patchMarker(id, (m) => ({ ...m, [edge]: at }))} fixtures={fixtures} liveOf={(id) => proxy.proxy?.fixtures.find((l) => l.id === id)} playhead={locked ? runAt : playhead} playing={playing || locked} sel={sel} tile={tile}
              onSeek={(t) => { if (!playing) setPlayhead(t); }}
              onAdd={(trackId, at) => {
                const tr = current()?.tracks.find((t) => t.id === trackId);
                if (!tr || tr.keyframes.some((k) => k.at === at)) return;
                const s = sampleTrack(tr.keyframes, at);
                const k: Keyframe = { id: newId(), at, intensity: s.intensity ?? 0.5 };
                patchTrack(trackId, (t) => ({ ...t, keyframes: [...t.keyframes, k] }));
                select([keyOf(trackId, k.id)]);
                if (!playing) setPlayhead(at);
              }}
              onSelect={(keys, add) => select(keys, add)}
              onToggle={(key) => { const n = new Set(sel); if (n.has(key)) n.delete(key); else n.add(key); setTile(null); setSel(n); }}
              onMoveAll={(moves) => patch((s) => ({
                ...s,
                // A marker keeps its length when moved with the selection.
                markers: (s.markers ?? []).map((m) => { const at = moves.get(markKey(m.id)); return at === undefined ? m : { ...m, at, ...(m.end !== undefined ? { end: m.end + at - m.at } : {}) }; }),
                tracks: s.tracks.map((t) => ({ ...t, keyframes: t.keyframes.map((k) => { const at = moves.get(keyOf(t.id, k.id)); return at === undefined ? k : { ...k, at }; }) })) }))}
              onTile={(trackId, toId) => {
                const tr = current()?.tracks.find((t) => t.id === trackId);
                const k = tr?.keyframes.find((x) => x.id === toId);
                if (k && !k.fadeIn) patchTrack(trackId, (t) => ({ ...t, keyframes: t.keyframes.map((x) => (x.id === toId ? { ...x, fadeIn: "linear" } : x)) }));
                setSel(new Set());
                setTile({ trackId, toId });
              }}
              onTrack={(trackId, fn) => patchTrack(trackId, fn)}
              onRemoveTrack={(trackId) => { patch((s) => ({ ...s, tracks: s.tracks.filter((t) => t.id !== trackId) })); setSel(new Set()); setTile(null); }} />
            </div>
            <div class="seq-add">
              <Select label="Add a track" prefix="Add track" value="" onChange={(id) => id && addTrack(id)}
                options={[{ value: "", label: "Pick a light type…" }, ...TRACK_KINDS.map((k) => ({ value: k.id, label: `${k.brand} ${k.model}` }))]} />
              <p class="meta">Markers: M at the playhead, Shift+M twice for a range, or in Insert mode click (point) or drag (range) in the marker strip under the ruler, or in a lane's top strip for that track only. Markers select, move and delete like keyframes; drag a range's edges to resize it. In Insert mode (I) a click on a lane adds a keyframe; in Select mode (V) Alt+click does. Shift-click to add to the selection, or drag a box over the lanes. Drag a selected keyframe to move them all (0.1 s steps); Delete removes them. Click the strip between two keyframes to fade from one to the other. Drag the playhead's thumb to scrub.</p>
            </div>
          </div>
          {selMarker && seq.markers?.some((m) => m.id === selMarker) && (
            <MarkerPanel key={selMarker} m={seq.markers.find((m) => m.id === selMarker)!} seq={seq}
              onChange={(fn) => patchMarker(selMarker, fn)} onDelete={() => deleteMarker(selMarker)} onClose={() => setSel(new Set())} />
          )}
          {selKf && selTrack && (
            <KeyframePanel key={selKf.id} kf={selKf} track={selTrack} durationMs={seq.durationMs}
              onChange={(next) => patchTrack(selTrack.id, (t) => ({ ...t, keyframes: t.keyframes.map((k) => (k.id === selKf.id ? next : k)) }))}
              onDelete={() => deleteSelected()} onClose={() => setSel(new Set())} />
          )}
          {sel.size > 1 && (
            <Panel label="Selection" width={INSPECTOR_W}>
              <PanelHead title={`${sel.size} selected`}><IconButton icon="close" label="Clear the selection" onClick={() => setSel(new Set())} /></PanelHead>
              <PanelBody>
                <p class="meta">Keyframes and markers: drag one of them to move them all; Delete removes them. Start keyframes stay where they are.</p>
                <div class="btn-row"><Button size="sm" kind="danger" icon="delete-outline" onClick={() => deleteSelected()}>Delete</Button></div>
              </PanelBody>
            </Panel>
          )}
          {tile && tileKf && tileTrack && (
            <FadePanel kf={tileKf} track={tileTrack}
              onStepped={(stepped) => patchTrack(tileTrack.id, (t) => ({ ...t, keyframes: t.keyframes.map((k) => { if (k.id !== tileKf.id) return k; const n = { ...k }; if (stepped) n.fadeStepped = true; else delete n.fadeStepped; return n; }) }))}
              onChange={(curve) => patchTrack(tileTrack.id, (t) => ({ ...t, keyframes: t.keyframes.map((k) => { if (k.id !== tileKf.id) return k; const n = { ...k }; if (curve) n.fadeIn = curve; else { delete n.fadeIn; delete n.fadeStepped; } return n; }) }))}
              onClose={() => setTile(null)} />
          )}
          {!(selKf && selTrack) && sel.size <= 1 && !(tile && tileKf && tileTrack) && !(selMarker && seq.markers?.some((m) => m.id === selMarker)) && (
            <Panel label="Inspector" width={INSPECTOR_W}>
              <PanelBody><Empty icon="cursor-default-click-outline" title="Nothing selected">Select a keyframe to edit its values, or click the strip between two keyframes for a fade.</Empty></PanelBody>
            </Panel>
          )}
          {!proxy.proxy && <div class="seq-noproxy"><ErrorLine>No proxy: open Setup → Lights proxy on the phone to play or preview.</ErrorLine></div>}
        </div>
      )}
    </>
  );
}

interface LanesProps {
  seq: LightSequence; mode: "select" | "insert"; kfSize: "s" | "m" | "l"; view: SeqView;
  onMarkerAdd: (at: number, end?: number, trackId?: string) => void; onMarkerPick: (id: string) => void; onMarkerResize: (id: string, edge: "at" | "end", at: number) => void; fixtures: ServerFixture[]; liveOf: (id: string) => FixtureLive | undefined; playhead: number; playing: boolean; sel: ReadonlySet<string>; tile: { trackId: string; toId: string } | null;
  onSeek: (t: number) => void; onAdd: (trackId: string, at: number) => void;
  onSelect: (keys: string[], add: boolean) => void; onToggle: (key: string) => void;
  onMoveAll: (moves: Map<string, number>) => void; onTile: (trackId: string, toId: string) => void;
  onTrack: (trackId: string, fn: (t: SequenceTrack) => SequenceTrack) => void; onRemoveTrack: (trackId: string) => void;
}

/**
 * The ruler with the playhead's thumb, and a lane per track: keyframes (the start one square), the
 * strip of gaps between them (a fade tile where one is set), a selection box drawn over the lanes.
 */
function Lanes(p: LanesProps) {
  const { seq } = p;
  const pct = (t: number) => `${(t / seq.durationMs) * 100}%`;
  const ticks = Math.min(60, Math.max(1, Math.floor(seq.durationMs / 1000)));
  const step = Math.ceil(ticks / 12);
  const lanesRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** The time under the pointer, on the lanes' time axis (every lane is as wide as the ruler). */
  const timeAt = (clientX: number) => {
    const r = rulerRef.current!.getBoundingClientRect();
    return Math.min(seq.durationMs, Math.max(0, snap(((clientX - r.left) / r.width) * seq.durationMs)));
  };
  const msPerPx = () => seq.durationMs / rulerRef.current!.getBoundingClientRect().width;

  /** A pointer gesture: `move` while the button is held, `up` once. */
  const gesture = (move: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) => {
    const end = (e: PointerEvent) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); up?.(e); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  // Scrubbing: press on the ruler (or the thumb) and drag.
  const scrub = (e: PointerEvent) => {
    e.stopPropagation();
    if (p.playing || e.button !== 0) return;
    p.onSeek(timeAt(e.clientX));
    gesture((ev) => p.onSeek(timeAt(ev.clientX)));
  };

  // A press on empty lane space: a click adds a keyframe, a drag draws a selection box.
  const pressLanes = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest(".seq-kf, .seq-gap, .seq-label, .seq-ruler, .seq-mark")) return;
    const x0 = e.clientX, y0 = e.clientY, add = e.shiftKey, insert = p.mode === "insert" || e.altKey;
    const lane = target.closest<HTMLElement>(".seq-lane");
    let moved = false;
    gesture((ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      setBox({ x0, y0, x1: ev.clientX, y1: ev.clientY });
    }, (ev) => {
      setBox(null);
      // A plain click: adds in Insert mode (or with Alt); in Select mode it clears the selection.
      if (!moved) { if (insert && lane?.dataset.track) p.onAdd(lane.dataset.track, timeAt(ev.clientX)); else if (!add) p.onSelect([], false); return; }
      const [l, r] = [Math.min(x0, ev.clientX), Math.max(x0, ev.clientX)], [t, b] = [Math.min(y0, ev.clientY), Math.max(y0, ev.clientY)];
      const hit = [...(lanesRef.current?.querySelectorAll<HTMLElement>(".seq-kf, .seq-mark[data-key]") ?? [])].filter((el) => {
        const q = el.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2;
        return cx >= l && cx <= r && cy >= t && cy <= b;
      }).map((el) => el.dataset.key!);
      p.onSelect(hit, add);
    });
  };

  // A press on a keyframe or marker: Shift toggles it; otherwise it (and the rest of the selection) can
  // be dragged. A marker clicked without moving also moves the playhead to it.
  const pressKf = (e: PointerEvent, key: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (e.shiftKey) { p.onToggle(key); return; }
    const group = p.sel.has(key) ? [...p.sel] : [key];
    if (!p.sel.has(key)) p.onSelect([key], false);
    // Where each item is, how far it reaches (a range's end), and how early it may go (keyframes never onto 0).
    const origin = new Map<string, { at: number; reach: number; min: number }>();
    for (const k of group) {
      const mid = markOf(k);
      if (mid) { const m = seq.markers?.find((x) => x.id === mid); if (m) origin.set(k, { at: m.at, reach: m.end ?? m.at, min: 0 }); continue; }
      const [tid, kid] = splitKey(k);
      const kf = seq.tracks.find((t) => t.id === tid)?.keyframes.find((x) => x.id === kid);
      if (kf && kf.id !== START_KEYFRAME) origin.set(k, { at: kf.at, reach: kf.at, min: SNAP_MS });
    }
    const picked = markOf(key);
    if (!origin.size) return;
    const x0 = e.clientX, perPx = msPerPx();
    const dMin = Math.max(...[...origin.values()].map((o) => o.min - o.at)), dMax = Math.min(...[...origin.values()].map((o) => seq.durationMs - o.reach));
    let moved = false;
    gesture((ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return;
      moved = true;
      const d = Math.min(dMax, Math.max(dMin, snap((ev.clientX - x0) * perPx)));
      p.onMoveAll(new Map([...origin].map(([k, o]) => [k, o.at + d])));
    }, () => { if (!moved && picked) p.onMarkerPick(picked); });
  };

  return (
    <div class={cx("seq-lanes", `kf-${p.kfSize}`, p.mode === "insert" && "is-insert", p.view.graph && "view-graph", p.view.fill && "view-fill", p.view.badges && "view-badges")} ref={lanesRef} onPointerDown={pressLanes}>
      <div class="seq-row">
        <div class="seq-label" />
        <div class="seq-ruler" ref={rulerRef} onPointerDown={scrub}>
          {Array.from({ length: Math.floor(ticks / step) + 1 }, (_, i) => i * step * 1000).filter((t) => t <= seq.durationMs).map((t) => (
            <span key={t} class="seq-tick" style={{ left: pct(t) }}>{t / 1000}</span>
          ))}
          <span class="seq-thumb" style={{ left: pct(p.playhead) }} title="Drag to scrub" />
          <span class="seq-playhead" style={{ left: pct(p.playhead) }} />
        </div>
      </div>
      <div class="seq-row seq-row--marks">
        <div class="seq-label"><span class="meta">Markers</span></div>
        <MarkStrip {...p} markers={(seq.markers ?? []).filter((m) => !m.trackId)} pct={pct} timeAt={timeAt} gesture={gesture} pressKf={pressKf} />
      </div>
      {seq.tracks.map((tr) => <TrackRow key={tr.id} {...p} tr={tr} pct={pct} pressKf={pressKf} timeAt={timeAt} gesture={gesture} />)}
      {seq.tracks.length === 0 && <p class="meta seq-empty">Add a track below: pick the type of light it is for, then assign a light to it.</p>}
      {box && <div class="seq-box" style={{ left: `${Math.min(box.x0, box.x1)}px`, top: `${Math.min(box.y0, box.y1)}px`, width: `${Math.abs(box.x1 - box.x0)}px`, height: `${Math.abs(box.y1 - box.y0)}px` }} />}
    </div>
  );
}

type Gesture = (move: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) => void;

/**
 * A strip of markers (#323): across the sequence under the ruler, or a lane's top strip for that
 * track. In Insert mode (or with Alt) a click adds a point and a drag a range; in Select mode the
 * strip selects like the lanes. Markers select, move and delete like keyframes; a range's edges drag.
 */
function MarkStrip(p: LanesProps & { markers: SequenceMarker[]; trackId?: string; pct: (t: number) => string; timeAt: (x: number) => number; gesture: Gesture; pressKf: (e: PointerEvent, key: string) => void }) {
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  const press = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".seq-mark")) return;
    // Select mode: the lanes' own press (box selection, a click clears).
    if (p.mode !== "insert" && !e.altKey) return;
    e.stopPropagation();
    const x0 = e.clientX, a = p.timeAt(x0);
    let moved = false;
    p.gesture((ev) => { if (!moved && Math.abs(ev.clientX - x0) < 4) return; moved = true; setDraft({ a, b: p.timeAt(ev.clientX) }); }, (ev) => {
      setDraft(null);
      const b = p.timeAt(ev.clientX);
      if (moved && Math.abs(b - a) >= SNAP_MS) p.onMarkerAdd(Math.min(a, b), Math.max(a, b), p.trackId);
      else p.onMarkerAdd(a, undefined, p.trackId);
    });
  };
  return (
    <div class={cx(p.trackId ? "seq-lane__marks" : "seq-marks")} onPointerDown={press} title={p.trackId ? "This track's markers (Insert mode or Alt: click for a point, drag for a range)" : "Markers (Insert mode or Alt: click for a point, drag for a range; M, Shift+M)"}>
      {p.markers.map((m) => {
        const edge = (e: PointerEvent, which: "at" | "end") => {
          e.stopPropagation();
          if (e.button !== 0) return;
          p.gesture((ev) => {
            const t = p.timeAt(ev.clientX);
            if (which === "at") p.onMarkerResize(m.id, "at", Math.min(t, (m.end ?? t) - SNAP_MS));
            else p.onMarkerResize(m.id, "end", Math.max(t, m.at + SNAP_MS));
          });
        };
        return (
          <button key={m.id} type="button" data-key={markKey(m.id)} class={cx("seq-mark", m.end !== undefined ? "is-range" : "is-point", p.sel.has(markKey(m.id)) && "is-selected")}
            style={{ left: p.pct(m.at), ...(m.end !== undefined ? { width: p.pct(m.end - m.at) } : {}) }}
            title={`${m.name || "Marker"} · ${fmt(m.at)}${m.end !== undefined ? `–${fmt(m.end)}` : ""} (drag to move)`}
            onPointerDown={(e) => p.pressKf(e, markKey(m.id))}>
            <span class="seq-mark__name">{m.name || "Marker"}</span>
            {m.end !== undefined && <><span class="seq-mark__edge is-in" title="Drag the in point" onPointerDown={(e) => edge(e, "at")} /><span class="seq-mark__edge is-out" title="Drag the out point" onPointerDown={(e) => edge(e, "end")} /></>}
          </button>
        );
      })}
      {draft && <span class="seq-mark is-range is-draft" style={{ left: p.pct(Math.min(draft.a, draft.b)), width: p.pct(Math.abs(draft.b - draft.a)) }} />}
    </div>
  );
}

function TrackRow(p: LanesProps & { tr: SequenceTrack; pct: (t: number) => string; pressKf: (e: PointerEvent, key: string) => void; timeAt: (x: number) => number; gesture: Gesture }) {
  const { tr, seq, pct } = p;
  const [colours, setColours] = useState(false);
  const global = (seq.markers ?? []).filter((m) => !m.trackId);
  const kind = fixtureKind(tr.kindId);
  const ks = [...tr.keyframes].sort((a, b) => a.at - b.at);
  // A light drives at most one track of a sequence.
  const taken = new Set(seq.tracks.filter((t) => t.id !== tr.id && t.fixtureId).map((t) => t.fixtureId!));
  const options = p.fixtures.filter((f) => f.kind_id === tr.kindId && !taken.has(f.id)).map((f) => ({ value: f.id, label: f.label }));
  const missing = tr.fixtureId && !options.some((o) => o.value === tr.fixtureId) ? [{ value: tr.fixtureId, label: "Removed light" }] : [];
  const assigned = tr.fixtureId ? p.fixtures.find((f) => f.id === tr.fixtureId) : undefined;
  return (
    <div class="seq-row" style={tr.color !== undefined ? { "--track-c": `var(--track-${tr.color + 1})` } : undefined}>
      <div class={cx("seq-label", tr.color !== undefined && "has-colour")}>
        <div class="seq-label__text">
          <div class="seq-label__top">
            <input class="seq-name" value={tr.name} aria-label="Track name" onChange={(e) => { const name = (e.target as HTMLInputElement).value.trim(); if (name) p.onTrack(tr.id, (t) => ({ ...t, name })); }} />
            {/* The assigned light's power (#294): its own battery, the battery it is given, or its socket. */}
            {assigned && <BatteryChip power={powerOf(assigned, p.fixtures, p.liveOf)} />}
          </div>
          <Select label={`Light for ${tr.name}`} value={tr.fixtureId ?? ""} width="100%"
            onChange={(id) => p.onTrack(tr.id, (t) => ({ ...t, fixtureId: id || null }))}
            options={[{ value: "", label: kind ? `No ${kind.model} assigned` : "Not assigned" }, ...missing, ...options]} />
        </div>
        <div class="seq-label__actions">
          <IconButton icon={tr.muted ? "lightbulb-off-outline" : "lightbulb-on-outline"} label={tr.muted ? "Unmute the track" : "Mute the track (left out of playback and Live)"} kind={tr.muted ? "secondary" : "ghost"}
            onClick={() => p.onTrack(tr.id, (t) => ({ ...t, muted: !t.muted }))} />
          <span class="menu-anchor">
            <IconButton icon="palette-outline" label="Track colour" onClick={() => setColours((x) => !x)} />
            {colours && (
              <Popover onClose={() => setColours(false)}>
                <div class="seq-swatches" role="radiogroup" aria-label="Track colour">
                  {Array.from({ length: TRACK_COLORS }, (_, i) => (
                    <button key={i} type="button" role="radio" aria-checked={tr.color === i} aria-label={`Colour ${i + 1}`} class={cx("seq-swatch", tr.color === i && "is-on")} style={{ background: `var(--track-${i + 1})` }}
                      onClick={() => { setColours(false); p.onTrack(tr.id, (t) => ({ ...t, color: i })); }} />
                  ))}
                  <button type="button" class="seq-swatch is-none" aria-label="No colour" onClick={() => { setColours(false); p.onTrack(tr.id, (t) => { const n = { ...t }; delete n.color; return n; }); }} />
                </div>
              </Popover>
            )}
          </span>
          <IconButton icon="close" label="Remove the track" onClick={() => p.onRemoveTrack(tr.id)} />
        </div>
      </div>
      <div class={cx("seq-lane", !tr.fixtureId && "is-unassigned", tr.muted && "is-muted")} data-track={tr.id}>
        {global.map((m) => <span key={m.id} class={cx(m.end !== undefined ? "seq-mband" : "seq-mline")} style={{ left: pct(m.at), ...(m.end !== undefined ? { width: pct(m.end - m.at) } : {}) }} />)}
        <MarkStrip {...p} markers={(seq.markers ?? []).filter((m) => m.trackId === tr.id)} trackId={tr.id} pct={pct} timeAt={p.timeAt} gesture={p.gesture} pressKf={p.pressKf} />
        {p.view.graph && (
          <svg class="seq-graph" viewBox={`0 0 ${seq.durationMs} 1`} preserveAspectRatio="none" aria-hidden="true">
            <polyline points={graphPoints(tr.keyframes, seq.durationMs)} vector-effect="non-scaling-stroke" />
          </svg>
        )}
        {ks.slice(1).map((k, i) => {
          const from = ks[i];
          const on = p.tile?.trackId === tr.id && p.tile.toId === k.id;
          return (
            <button key={`gap-${k.id}`} type="button" class={cx("seq-gap", k.fadeIn && "is-fade", k.fadeIn && kind?.caps.fade && k.fadeStepped && "is-stepped", on && "is-selected")} style={{ left: pct(from.at), width: pct(k.at - from.at) }}
              title={k.fadeIn ? `Fade ${fmt(from.at)}–${fmt(k.at)} (${CURVE_LABELS[k.fadeIn]})${kind?.caps.fade ? (k.fadeStepped ? ": in steps every 0.1 s" : ": the light runs it by itself") : ""}` : "Jump here; click to fade instead"}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onTile(tr.id, k.id)}>
              {k.fadeIn ? <span class="seq-gap__label">{CURVE_LABELS[k.fadeIn]}{kind?.caps.fade && k.fadeStepped ? " · steps" : ""}</span> : <span class="seq-gap__add">+ Fade</span>}
            </button>
          );
        })}
        {ks.map((k) => {
          const key = keyOf(tr.id, k.id);
          // Graph: the keyframe sits at its level (#323); otherwise in the middle of the lane.
          const top = p.view.graph ? `calc(var(--g-top) + ${(1 - keyframeLevel(ks, k)).toFixed(4)} * var(--g-h))` : undefined;
          const fill = p.view.fill ? lightColour(sampleTrack(ks, k.at)) : null;
          const off = k.power === false;
          const label = p.view.labels ? shortLabel(k, !p.view.badges) : "";
          return [
            <button key={k.id} type="button" data-key={key} class={cx("seq-kf", k.id === START_KEYFRAME && "is-start", p.sel.has(key) && "is-selected", k.hue !== undefined && "is-colour", k.effect?.id && "is-effect", fill && "has-fill", p.view.badges && off && "is-off")}
              style={{ left: pct(k.at), ...(top ? { top } : {}), ...(fill ? { "--kf-fill": fill } : {}) }} title={`${k.id === START_KEYFRAME ? "Start · " : ""}${fmt(k.at)} · ${summary(k)}`}
              onPointerDown={(e) => p.pressKf(e, key)} />,
            label ? <span key={`l-${k.id}`} class="seq-kf-label" style={{ left: pct(k.at), ...(top ? { top } : {}) }}>{label}</span> : null,
            p.view.badges && k.effect?.id ? <span key={`b-${k.id}`} class="seq-kf-badge" style={{ left: pct(k.at), ...(top ? { top } : {}) }}>{effectName(k.effect.id)}</span> : null,
          ];
        })}
        <span class="seq-playhead" style={{ left: pct(p.playhead) }} />
      </div>
    </div>
  );
}

/** One marker (#323): name, where, a point or a range, the whole sequence or one track. */
function MarkerPanel({ m, seq, onChange, onDelete, onClose }: { m: SequenceMarker; seq: LightSequence; onChange: (fn: (m: SequenceMarker) => SequenceMarker) => void; onDelete: () => void; onClose: () => void }) {
  const secs = (v: string) => { const n = Number(v); return Number.isFinite(n) ? Math.min(seq.durationMs, Math.max(0, snap(n * 1000))) : null; };
  return (
    <Panel label="Marker" width={INSPECTOR_W}>
      <PanelHead title={m.end !== undefined ? "Range" : "Marker"}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        <Field label="Name"><Input sm value={m.name} maxLength={MARKER_NAME_MAX} onInput={(e) => { const name = (e.target as HTMLInputElement).value; onChange((x) => ({ ...x, name })); }} /></Field>
        <Field label={m.end !== undefined ? "In" : "At"}><Input sm unit="s" inputMode="decimal" value={String(m.at / 1000)}
          onChange={(e) => { const at = secs((e.target as HTMLInputElement).value); if (at !== null && (m.end === undefined || at < m.end)) onChange((x) => ({ ...x, at })); }} /></Field>
        <Checkbox checked={m.end !== undefined} onClick={() => onChange((x) => { const n = { ...x }; if (n.end !== undefined) delete n.end; else n.end = Math.min(seq.durationMs, n.at + 1000); return n.end === n.at ? x : n; })}>Range (in and out)</Checkbox>
        {m.end !== undefined && <Field label="Out"><Input sm unit="s" inputMode="decimal" value={String(m.end / 1000)}
          onChange={(e) => { const end = secs((e.target as HTMLInputElement).value); if (end !== null && end > m.at) onChange((x) => ({ ...x, end })); }} /></Field>}
        <Field as="div" label="On"><Select label="Marker scope" value={m.trackId ?? ""} width="100%"
          onChange={(v) => onChange((x) => { const n = { ...x }; if (v) n.trackId = v; else delete n.trackId; return n; })}
          options={[{ value: "", label: "The whole sequence" }, ...seq.tracks.map((t) => ({ value: t.id, label: t.name }))]} /></Field>
        <p class="meta">Markers only help you find your way; playback ignores them.</p>
        <div class="btn-row"><Button size="sm" kind="danger" icon="delete-outline" onClick={onDelete}>Delete marker</Button></div>
      </PanelBody>
    </Panel>
  );
}

function summary(k: Keyframe): string {
  return [
    k.power !== undefined && (k.power ? "on" : "off"),
    k.intensity !== undefined && `${Math.round(k.intensity * 100)} %`,
    k.kelvin !== undefined && `${k.kelvin} K`,
    k.hue !== undefined && `hue ${Math.round(k.hue)}°`,
    k.effect !== undefined && (k.effect.id ? effectName(k.effect.id) : "effect off"),
    k.curve !== undefined && `curve ${CURVE_LABELS[k.curve]}`,
  ].filter(Boolean).join(" · ") || "empty";
}

/**
 * One keyframe: when, and which values it sets (unchecked: kept from before). The start keyframe sets
 * power, intensity and white or colour always, cannot move and cannot be deleted.
 */
function KeyframePanel({ kf, track, durationMs, onChange, onDelete, onClose }: {
  kf: Keyframe; track: SequenceTrack; durationMs: number; onChange: (k: Keyframe) => void; onDelete: () => void; onClose: () => void;
}) {
  const kind = fixtureKind(track.kindId);
  const caps = kind?.caps;
  const isStart = kf.id === START_KEYFRAME;
  const set = (patch: Partial<Keyframe>) => onChange({ ...kf, ...patch });
  const drop = (...keys: (keyof Keyframe)[]) => { const n = { ...kf }; for (const k of keys) delete n[k]; onChange(n); };
  const mode = kf.hue !== undefined ? "colour" : kf.kelvin !== undefined ? "white" : "leave";
  const cct = caps?.cct;
  return (
    <Panel label="Keyframe" width={INSPECTOR_W}>
      <PanelHead title={`${isStart ? "Start" : "Keyframe"} · ${track.name}`}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        {isStart
          ? <p class="meta">What the light shows when the sequence starts. It always sets power, intensity and the light, so a sequence never starts from whatever the light showed before.</p>
          : <Field label="At"><Input sm unit="s" inputMode="decimal" boxStyle={{ width: "120px" }} value={String(kf.at / 1000)}
              onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) set({ at: Math.min(durationMs, Math.max(SNAP_MS, snap(v * 1000))) }); }} /></Field>}
        <Channel label="Power" fixed={isStart} on={kf.power !== undefined} toggle={(on) => (on ? set({ power: true }) : drop("power"))}>
          <Seg label="Power" value={kf.power ? "on" : "off"} onChange={(v) => set({ power: v === "on" })} options={[{ id: "off", label: "Off" }, { id: "on", label: "On" }]} />
        </Channel>
        <Channel label="Intensity" fixed={isStart} on={kf.intensity !== undefined} toggle={(on) => (on ? set({ intensity: 0.5 }) : drop("intensity"))}>
          <Range label="Intensity" value={Math.round((kf.intensity ?? 0.5) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ intensity: x / 100 })} />
        </Channel>
        {(cct || caps?.hsi) && (
          <div class="devices-field">
            <span class="section-title">Light</span>
            <Seg label="White or colour" value={mode}
              onChange={(m) => {
                const n: Keyframe = { ...kf };
                delete n.kelvin; delete n.gm; delete n.hue; delete n.sat;
                if (m === "white") Object.assign(n, { kelvin: cct ? Math.round((cct.min + cct.max) / 200) * 100 : 5600, gm: 0 });
                if (m === "colour") Object.assign(n, { hue: 0, sat: 1 });
                onChange(n);
              }}
              options={[...(isStart ? [] : [{ id: "leave" as const, label: "As before" }]), ...(cct ? [{ id: "white" as const, label: "White" }] : []), ...(caps?.hsi ? [{ id: "colour" as const, label: "Colour" }] : [])]} />
            {mode === "white" && cct && (
              <>
                <Range label="White" value={kf.kelvin ?? 5600} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={(x) => set({ kelvin: x })} />
                {cct.gm && <Range label="Green / magenta" value={kf.gm ?? 0} min={cct.gm.min} max={cct.gm.max} step={1} format={(x) => (x > 0 ? `+${x} M` : x < 0 ? `${-x} G` : "neutral")} onChange={(x) => set({ gm: x })} />}
              </>
            )}
            {mode === "colour" && (
              <>
                <Range label="Hue" value={Math.round(kf.hue ?? 0)} min={0} max={360} step={1} format={(x) => `${x}°`} onChange={(x) => set({ hue: x })} />
                <Range label="Saturation" value={Math.round((kf.sat ?? 1) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ sat: x / 100 })} />
              </>
            )}
          </div>
        )}
        {!!caps?.effects?.length && (
          <Channel label="Effect" on={kf.effect !== undefined} toggle={(on) => (on ? set({ effect: { id: caps.effects![0], settings: effectSettingsOf(caps.effects![0]) } }) : drop("effect"))}>
            {/* A new effect starts from its own defaults (#321); its options are saved with the keyframe. */}
            <Select label="Effect" value={kf.effect?.id ?? "off"} onChange={(v) => { const id = v === "off" ? null : (v as EffectId); set({ effect: id ? { id, settings: effectSettingsOf(id) } : { id: null } }); }}
              options={[{ value: "off", label: "Off (stop)" }, ...caps.effects.map((id) => ({ value: id, label: effectName(id) }))]} />
            {kf.effect?.id && <EffectOptionFields fx={kf.effect.id} settings={effectSettingsOf(kf.effect.id, kf.effect.settings)} cct={caps.cct} onChange={(settings) => set({ effect: { id: kf.effect!.id, settings } })} />}
          </Channel>
        )}
        {caps?.curves && (
          <Channel label="Dimming curve" on={kf.curve !== undefined} toggle={(on) => (on ? set({ curve: "linear" }) : drop("curve"))}>
            <Select label="Dimming curve" value={kf.curve ?? "linear"} onChange={(v) => set({ curve: v as Curve })} options={CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] }))} />
          </Channel>
        )}
        <p class="meta">Values jump at the keyframe; a fade on the strip before it blends into them instead.</p>
        {!isStart && <div class="btn-row"><Button size="sm" kind="danger" icon="delete-outline" onClick={onDelete}>Delete keyframe</Button></div>}
      </PanelBody>
    </Panel>
  );
}

/** The gap before a keyframe: jump at the keyframe, or fade into it with a curve. */
function FadePanel({ kf, track, onChange, onStepped, onClose }: { kf: Keyframe; track: SequenceTrack; onChange: (curve: Curve | null) => void; onStepped: (stepped: boolean) => void; onClose: () => void }) {
  const nativeFade = !!fixtureKind(track.kindId)?.caps.fade;
  return (
    <Panel label="Fade" width={INSPECTOR_W}>
      <PanelHead title={`Into ${fmt(kf.at)} · ${track.name}`}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        <Seg label="Transition" value={kf.fadeIn ? "fade" : "jump"} onChange={(v) => onChange(v === "fade" ? kf.fadeIn ?? "linear" : null)} options={[{ id: "jump", label: "Jump" }, { id: "fade", label: "Fade" }]} />
        {kf.fadeIn && (
          <div class="devices-field">
            <span class="section-title">Curve</span>
            <Seg label="Fade curve" value={kf.fadeIn} onChange={(c) => onChange(c)} options={CURVES.map((c) => ({ id: c, label: CURVE_LABELS[c] }))} />
          </div>
        )}
        {kf.fadeIn && nativeFade && (
          <div class="devices-field">
            <span class="section-title">Run by</span>
            <Seg label="How the fade runs" value={kf.fadeStepped ? "steps" : "light"} onChange={(v) => onStepped(v === "steps")}
              options={[{ id: "light", label: "The light (smooth)" }, { id: "steps", label: "Steps every 0.1 s" }]} />
          </div>
        )}
        <p class="meta">{kf.fadeIn
          ? `Everything that differs between the two keyframes blends over the gap (white ↔ colour switches at the end).${nativeFade && !kf.fadeStepped ? " This light runs the fade by itself, smoothly; nothing else is sent to it meanwhile." : " Sent in steps every 0.1 s."}`
          : "The light keeps the earlier values and jumps to these at the keyframe."}</p>
      </PanelBody>
    </Panel>
  );
}

function Channel({ label, on, fixed, toggle, children }: { label: string; on: boolean; fixed?: boolean; toggle: (on: boolean) => void; children: ComponentChildren }) {
  return (
    <div class="devices-field">
      {fixed ? <span class="section-title">{label}</span> : <Checkbox checked={on} onClick={() => toggle(!on)}>{label}</Checkbox>}
      {(on || fixed) && children}
    </div>
  );
}
