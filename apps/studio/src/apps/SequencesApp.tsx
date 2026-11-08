import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  commandsFor, CURVES, effectName, FIXTURE_KINDS, fixtureKind, inFade, nativeStep, sampleTrack, SEQUENCE_MAX_MS, SEQUENCE_TICK_MS, START_KEYFRAME, startKeyframe,
  type Curve, type EffectId, type FixtureLive, type Keyframe, type LightSequence, type SequenceSample, type SequenceTrack,
} from "@openclapper/vocab";
import { Button, Checkbox, confirmDialog, cx, Empty, ErrorLine, Field, Icon, IconButton, Input, Panel, PanelBody, PanelHead, Seg, Select, Switch, Toolbar, ToolbarSpacer, ToolbarTitle } from "@openclapper/ui";
import { fetchFixtures, type ServerFixture } from "../api";
import { Range } from "../compose/editor";
import { bind, useKeys } from "../keys";
import { useLightProxy } from "../lightProxy";
import { BatteryChip, powerOf } from "../power";
import { setPlayingFixtures } from "../sequencePlayback";
import { useProjectId } from "../project";
import { deleteSequence, getSequences, upsertSequence, useSequences } from "../sequences";
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

  const sent = useRef(new Map<string, SequenceSample | null>());
  const fadeKeys = useRef(new Map<string, string | null>());
  /** Per light with switchable smoothing (NEEWER): what it was last told; null after a reset. */
  const smoothSent = useRef(new Map<string, boolean>());
  const seqRef = useRef(seq);
  seqRef.current = seq;

  const save = (s: LightSequence) => { upsertSequence(s); };
  /** Edits start from the stored sequence, not this render's copy: quick clicks and drags must not undo each other. */
  const current = () => getSequences().find((s) => s.id === selId) ?? null;
  const patch = (fn: (s: LightSequence) => LightSequence) => { const cur = current(); if (cur) save(fn(cur)); };
  const patchTrack = (trackId: string, fn: (t: SequenceTrack) => SequenceTrack) => patch((s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === trackId ? fn(t) : t)) }));
  const native = (t: SequenceTrack) => !!fixtureKind(t.kindId)?.caps.fade;

  /**
   * Samples every assigned track at t and sends the difference to what its light last got. While
   * playing, a light that fades by itself gets one native fade per tile and nothing in between.
   */
  const emit = (t: number, playback: boolean) => {
    const s = seqRef.current;
    if (!s || !proxy.proxy) return;
    for (const tr of s.tracks) {
      if (!tr.fixtureId || tr.muted) continue;
      const prev = sent.current.get(tr.id) ?? null;
      const step = playback && native(tr)
        ? nativeStep(tr.keyframes, t, prev, fadeKeys.current.get(tr.id) ?? null)
        : { ...commandsFor(prev, sampleTrack(tr.keyframes, t)), key: null };
      // Lights that can switch smoothing: instant at jumps, smooth inside fades (and while scrubbing).
      if (fixtureKind(tr.kindId)?.caps.smoothing) {
        const smooth = !playback || inFade(tr.keyframes, t);
        if (smoothSent.current.get(tr.id) !== smooth) { smoothSent.current.set(tr.id, smooth); proxy.send(tr.fixtureId, { op: "smooth", on: smooth }); }
      }
      sent.current.set(tr.id, step.sent);
      fadeKeys.current.set(tr.id, step.key);
      for (const c of step.commands) proxy.send(tr.fixtureId, c);
    }
  };

  // The runner: a 100 ms tick while playing.
  useEffect(() => {
    if (!playing || !seq) return;
    sent.current.clear();
    fadeKeys.current.clear();
    smoothSent.current.clear();
    setPlayingFixtures(seq.tracks.flatMap((t) => (t.fixtureId && !t.muted ? [t.fixtureId] : [])));
    let start = performance.now() - playhead;
    const h = setInterval(() => {
      const s = seqRef.current;
      if (!s) return;
      let t = performance.now() - start;
      if (t >= s.durationMs) {
        if (s.loop) { start += s.durationMs; t -= s.durationMs; sent.current.clear(); fadeKeys.current.clear(); }
        else { emit(s.durationMs, true); setPlayhead(s.durationMs); setPlaying(false); return; }
      }
      emit(t, true);
      setPlayhead(t);
    }, SEQUENCE_TICK_MS);
    return () => { clearInterval(h); setPlayingFixtures([]); };
  }, [playing, selId]);

  // Live: while stopped, the lights follow the playhead and every edit.
  const seqKey = seq ? JSON.stringify(seq.tracks) : "";
  useEffect(() => { if (!playing && live) emit(playhead, false); }, [playhead, seqKey, live, playing, !!proxy.proxy]);

  /** Play from the playhead; while playing: stop and return to where play started (Space, as in DaVinci Resolve). */
  const play = () => {
    if (!seq) return;
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
  const deleteSelected = () => {
    if (!sel.size) return false;
    const drop = new Set([...sel].filter((k) => splitKey(k)[1] !== START_KEYFRAME));
    if (!drop.size) return false;
    patch((s) => ({ ...s, tracks: s.tracks.map((t) => ({ ...t, keyframes: t.keyframes.filter((k) => !drop.has(keyOf(t.id, k.id))) })) }));
    setSel(new Set());
  };
  useKeys(bind("sequences", {
    remove: () => deleteSelected(),
    all: () => { if (!seq) return false; select(seq.tracks.flatMap((t) => t.keyframes.map((k) => keyOf(t.id, k.id)))); },
    clear: () => { if (!sel.size && !tile) return false; setSel(new Set()); setTile(null); },
    play: () => play(),
    stopHere: () => stopHere(),
  }), !!seq);

  const addTrack = (kindId: string) => {
    const kind = fixtureKind(kindId);
    if (!kind) return;
    patch((s) => {
      const n = s.tracks.filter((t) => t.kindId === kindId).length + 1;
      return { ...s, tracks: [...s.tracks, { id: newId(), name: `${kind.model} ${n}`, kindId, fixtureId: null, keyframes: [startKeyframe(kind)] }] };
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
              <Input sm value={seq.name} aria-label="Name" boxStyle={{ width: "200px" }} onInput={(e) => { const name = (e.target as HTMLInputElement).value; patch((s) => ({ ...s, name })); }} />
              <Field label="Length"><Input sm unit="s" inputMode="decimal" boxStyle={{ width: "90px" }} value={String(seq.durationMs / 1000)}
                onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v > 0) patch((s) => ({ ...s, durationMs: Math.min(SEQUENCE_MAX_MS, snap(v * 1000)) })); }} /></Field>
              <Switch on={seq.loop} onClick={() => patch((s) => ({ ...s, loop: !s.loop }))}>Loop</Switch>
              <Switch on={live} onClick={() => setLive(!live)}>Live</Switch>
              <ToolbarSpacer />
              <span class="num seq-time">{fmt(playhead)} / {fmt(seq.durationMs)}</span>
              <IconButton icon="skip-previous" label="To the start" onClick={() => { setPlaying(false); setPlayhead(0); }} />
              <Button size="sm" icon={playing ? "stop" : "play"} disabled={!proxy.proxy && !playing} title={playing ? "Stop and go back (Space); K stops here" : "Play from the playhead (Space)"} onClick={play}>{playing ? "Stop" : "Play"}</Button>
              <IconButton icon="delete-outline" label="Delete the sequence" onClick={() => void remove()} />
            </div>
            <Lanes seq={seq} fixtures={fixtures} liveOf={(id) => proxy.proxy?.fixtures.find((l) => l.id === id)} playhead={playhead} playing={playing} sel={sel} tile={tile}
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
              onMoveAll={(moves) => patch((s) => ({ ...s, tracks: s.tracks.map((t) => ({ ...t, keyframes: t.keyframes.map((k) => { const at = moves.get(keyOf(t.id, k.id)); return at === undefined ? k : { ...k, at }; }) })) }))}
              onTile={(trackId, toId) => {
                const tr = current()?.tracks.find((t) => t.id === trackId);
                const k = tr?.keyframes.find((x) => x.id === toId);
                if (k && !k.fadeIn) patchTrack(trackId, (t) => ({ ...t, keyframes: t.keyframes.map((x) => (x.id === toId ? { ...x, fadeIn: "linear" } : x)) }));
                setSel(new Set());
                setTile({ trackId, toId });
              }}
              onTrack={(trackId, fn) => patchTrack(trackId, fn)}
              onRemoveTrack={(trackId) => { patch((s) => ({ ...s, tracks: s.tracks.filter((t) => t.id !== trackId) })); setSel(new Set()); setTile(null); }} />
            <div class="seq-add">
              <Select label="Add a track" prefix="Add track" value="" onChange={(id) => id && addTrack(id)}
                options={[{ value: "", label: "Pick a light type…" }, ...TRACK_KINDS.map((k) => ({ value: k.id, label: `${k.brand} ${k.model}` }))]} />
              <p class="meta">Click a lane to add a keyframe; Shift-click to add to the selection, or drag a box over the lanes. Drag a selected keyframe to move them all (0.1 s steps); Delete removes them. Click the strip between two keyframes to fade from one to the other. Drag the playhead's thumb to scrub.</p>
            </div>
          </div>
          {selKf && selTrack && (
            <KeyframePanel key={selKf.id} kf={selKf} track={selTrack} durationMs={seq.durationMs}
              onChange={(next) => patchTrack(selTrack.id, (t) => ({ ...t, keyframes: t.keyframes.map((k) => (k.id === selKf.id ? next : k)) }))}
              onDelete={() => deleteSelected()} onClose={() => setSel(new Set())} />
          )}
          {sel.size > 1 && (
            <Panel label="Selection" width={INSPECTOR_W}>
              <PanelHead title={`${sel.size} keyframes`}><IconButton icon="close" label="Clear the selection" onClick={() => setSel(new Set())} /></PanelHead>
              <PanelBody>
                <p class="meta">Drag one of them to move them all. Start keyframes stay where they are.</p>
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
          {!(selKf && selTrack) && sel.size <= 1 && !(tile && tileKf && tileTrack) && (
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
  seq: LightSequence; fixtures: ServerFixture[]; liveOf: (id: string) => FixtureLive | undefined; playhead: number; playing: boolean; sel: ReadonlySet<string>; tile: { trackId: string; toId: string } | null;
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
    if (e.button !== 0 || target.closest(".seq-kf, .seq-gap, .seq-label, .seq-ruler")) return;
    const x0 = e.clientX, y0 = e.clientY, add = e.shiftKey;
    const lane = target.closest<HTMLElement>(".seq-lane");
    let moved = false;
    gesture((ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      setBox({ x0, y0, x1: ev.clientX, y1: ev.clientY });
    }, (ev) => {
      setBox(null);
      if (!moved) { if (lane?.dataset.track) p.onAdd(lane.dataset.track, timeAt(ev.clientX)); return; }
      const [l, r] = [Math.min(x0, ev.clientX), Math.max(x0, ev.clientX)], [t, b] = [Math.min(y0, ev.clientY), Math.max(y0, ev.clientY)];
      const hit = [...(lanesRef.current?.querySelectorAll<HTMLElement>(".seq-kf") ?? [])].filter((el) => {
        const q = el.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2;
        return cx >= l && cx <= r && cy >= t && cy <= b;
      }).map((el) => el.dataset.key!);
      p.onSelect(hit, add);
    });
  };

  // A press on a keyframe: Shift toggles it; otherwise it (and the rest of the selection) can be dragged.
  const pressKf = (e: PointerEvent, key: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (e.shiftKey) { p.onToggle(key); return; }
    const group = p.sel.has(key) ? [...p.sel] : [key];
    if (!p.sel.has(key)) p.onSelect([key], false);
    const origin = new Map<string, number>();
    for (const k of group) {
      const [tid, kid] = splitKey(k);
      const kf = seq.tracks.find((t) => t.id === tid)?.keyframes.find((x) => x.id === kid);
      if (kf && kf.id !== START_KEYFRAME) origin.set(k, kf.at);
    }
    if (!origin.size) return;
    const x0 = e.clientX, perPx = msPerPx();
    const lo = Math.min(...origin.values()), hi = Math.max(...origin.values());
    gesture((ev) => {
      // The group moves together and stays inside the sequence (never onto 0, the start keyframe's place).
      const d = Math.min(seq.durationMs - hi, Math.max(SNAP_MS - lo, snap((ev.clientX - x0) * perPx)));
      p.onMoveAll(new Map([...origin].map(([k, at]) => [k, at + d])));
    });
  };

  return (
    <div class="seq-lanes" ref={lanesRef} onPointerDown={pressLanes}>
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
      {seq.tracks.map((tr) => <TrackRow key={tr.id} {...p} tr={tr} pct={pct} pressKf={pressKf} />)}
      {seq.tracks.length === 0 && <p class="meta seq-empty">Add a track below: pick the type of light it is for, then assign a light to it.</p>}
      {box && <div class="seq-box" style={{ left: `${Math.min(box.x0, box.x1)}px`, top: `${Math.min(box.y0, box.y1)}px`, width: `${Math.abs(box.x1 - box.x0)}px`, height: `${Math.abs(box.y1 - box.y0)}px` }} />}
    </div>
  );
}

function TrackRow(p: LanesProps & { tr: SequenceTrack; pct: (t: number) => string; pressKf: (e: PointerEvent, key: string) => void }) {
  const { tr, seq, pct } = p;
  const kind = fixtureKind(tr.kindId);
  const ks = [...tr.keyframes].sort((a, b) => a.at - b.at);
  // A light drives at most one track of a sequence.
  const taken = new Set(seq.tracks.filter((t) => t.id !== tr.id && t.fixtureId).map((t) => t.fixtureId!));
  const options = p.fixtures.filter((f) => f.kind_id === tr.kindId && !taken.has(f.id)).map((f) => ({ value: f.id, label: f.label }));
  const missing = tr.fixtureId && !options.some((o) => o.value === tr.fixtureId) ? [{ value: tr.fixtureId, label: "Removed light" }] : [];
  const assigned = tr.fixtureId ? p.fixtures.find((f) => f.id === tr.fixtureId) : undefined;
  return (
    <div class="seq-row">
      <div class="seq-label">
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
          <IconButton icon="close" label="Remove the track" onClick={() => p.onRemoveTrack(tr.id)} />
        </div>
      </div>
      <div class={cx("seq-lane", !tr.fixtureId && "is-unassigned", tr.muted && "is-muted")} data-track={tr.id}>
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
          return (
            <button key={k.id} type="button" data-key={key} class={cx("seq-kf", k.id === START_KEYFRAME && "is-start", p.sel.has(key) && "is-selected", k.hue !== undefined && "is-colour", k.effect?.id && "is-effect")}
              style={{ left: pct(k.at) }} title={`${k.id === START_KEYFRAME ? "Start · " : ""}${fmt(k.at)} · ${summary(k)}`}
              onPointerDown={(e) => p.pressKf(e, key)} />
          );
        })}
        <span class="seq-playhead" style={{ left: pct(p.playhead) }} />
      </div>
    </div>
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
          <Channel label="Effect" on={kf.effect !== undefined} toggle={(on) => (on ? set({ effect: { id: caps.effects![0] } }) : drop("effect"))}>
            <Select label="Effect" value={kf.effect?.id ?? "off"} onChange={(v) => set({ effect: { id: v === "off" ? null : (v as EffectId) } })}
              options={[{ value: "off", label: "Off (stop)" }, ...caps.effects.map((id) => ({ value: id, label: effectName(id) }))]} />
          </Channel>
        )}
        {caps?.curves && (
          <Channel label="Dimming curve" on={kf.curve !== undefined} toggle={(on) => (on ? set({ curve: "linear" }) : drop("curve"))}>
            <Select label="Dimming curve" value={kf.curve ?? "linear"} onChange={(v) => set({ curve: v as Curve })} options={CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] }))} />
          </Channel>
        )}
        <p class="meta">Values jump at the keyframe; a fade on the strip before it blends into them instead. Effects run with their default options.</p>
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
