import { useEffect, useRef, useState } from "preact/hooks";
import {
  commandsFor, CURVES, effectName, fixtureKind, sampleTrack, SEQUENCE_MAX_MS, SEQUENCE_TICK_MS,
  type Curve, type EffectId, type Keyframe, type LightSequence, type SequenceSample, type SequenceTrack,
} from "@openclapper/vocab";
import { Button, Checkbox, confirmDialog, cx, Empty, ErrorLine, Field, Icon, IconButton, Input, Panel, PanelBody, PanelHead, Seg, Select, Switch, toast, Toolbar, ToolbarSpacer, ToolbarTitle } from "@openclapper/ui";
import { fetchFixtures, type ServerFixture } from "../api";
import { Range } from "../compose/editor";
import { useLightProxy } from "../lightProxy";
import { deleteSequence, getSequences, upsertSequence, useSequences } from "../sequences";
import type { AppProps } from "./registry";

/**
 * Sequences (#304), first version: a track per light, keyframes on it, played from here through the
 * phone proxy (#307). Every SEQUENCE_TICK_MS the runner samples each track and sends what changed.
 * While stopped, Live sends the state at the playhead, so a keyframe can be tuned with the lights on.
 */

const CURVE_LABELS: Record<Curve, string> = { linear: "Linear", exp: "Expo", log: "Log", s: "S-curve" };
const SNAP_MS = 100;
const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;
const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const newId = () => crypto.randomUUID();

function newSequence(n: number): LightSequence {
  return { id: newId(), name: `Sequence ${n}`, durationMs: 10_000, loop: false, tracks: [], updatedAt: new Date().toISOString() };
}

export function SequencesApp(_p: AppProps) {
  const proxy = useLightProxy();
  const sequences = useSequences();
  const [selId, setSelId] = useState<string | null>(sequences[0]?.id ?? null);
  const seq = sequences.find((s) => s.id === selId) ?? null;
  const [fixtures, setFixtures] = useState<ServerFixture[]>([]);
  useEffect(() => { void fetchFixtures().then((f) => setFixtures(f.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })))).catch(() => {}); }, []);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [live, setLive] = useState(true);
  const [selKf, setSelKf] = useState<{ fixtureId: string; id: string } | null>(null);

  // What was last sent per light, so only changes go out (reset on play: the first tick sends all).
  const sent = useRef(new Map<string, SequenceSample | null>());
  const seqRef = useRef(seq);
  seqRef.current = seq;

  const save = (s: LightSequence) => { if (!upsertSequence(s)) toast("This browser did not store the sequence", "danger"); };
  /** Edits start from the stored sequence, not this render's copy: quick clicks and drags must not undo each other. */
  const current = () => getSequences().find((s) => s.id === selId) ?? null;
  const patch = (fn: (s: LightSequence) => LightSequence) => { const cur = current(); if (cur) save(fn(cur)); };
  const patchTrack = (fixtureId: string, fn: (t: SequenceTrack) => SequenceTrack) => patch((s) => ({ ...s, tracks: s.tracks.map((t) => (t.fixtureId === fixtureId ? fn(t) : t)) }));

  /** Samples every track at t and sends the difference to what each light last got. */
  const emit = (t: number) => {
    const s = seqRef.current;
    if (!s || !proxy.proxy) return;
    for (const tr of s.tracks) {
      const { commands, sent: now } = commandsFor(sent.current.get(tr.fixtureId) ?? null, sampleTrack(tr.keyframes, t));
      sent.current.set(tr.fixtureId, now);
      for (const c of commands) proxy.send(tr.fixtureId, c);
    }
  };

  // The runner: a 100 ms tick while playing.
  useEffect(() => {
    if (!playing || !seq) return;
    sent.current.clear();
    let start = performance.now() - playhead;
    const h = setInterval(() => {
      const s = seqRef.current;
      if (!s) return;
      let t = performance.now() - start;
      if (t >= s.durationMs) {
        if (s.loop) { start += s.durationMs; t -= s.durationMs; sent.current.clear(); }
        else { emit(s.durationMs); setPlayhead(s.durationMs); setPlaying(false); return; }
      }
      emit(t);
      setPlayhead(t);
    }, SEQUENCE_TICK_MS);
    return () => clearInterval(h);
  }, [playing, selId]);

  // Live: while stopped, the lights follow the playhead and every edit.
  const seqKey = seq ? JSON.stringify(seq.tracks) : "";
  useEffect(() => { if (!playing && live) emit(playhead); }, [playhead, seqKey, live, playing, !!proxy.proxy]);

  const play = () => {
    if (!seq) return;
    if (playing) { setPlaying(false); return; }
    if (playhead >= seq.durationMs) setPlayhead(0);
    setPlaying(true);
  };

  const create = () => { const s = newSequence(sequences.length + 1); save(s); setSelId(s.id); setPlayhead(0); };
  const remove = async () => {
    if (!seq) return;
    if ((await confirmDialog({ title: `Delete “${seq.name}”?`, body: "It is stored only in this browser.", confirmLabel: "Delete", danger: true })) !== true) return;
    deleteSequence(seq.id);
    setSelId(sequences.find((s) => s.id !== seq.id)?.id ?? null);
  };

  const kf = selKf && seq ? seq.tracks.find((t) => t.fixtureId === selKf.fixtureId)?.keyframes.find((k) => k.id === selKf.id) ?? null : null;
  const unused = fixtures.filter((f) => !seq?.tracks.some((t) => t.fixtureId === f.id) && fixtureKind(f.kind_id)?.caps.intensity);

  return (
    <>
      <Toolbar>
        <ToolbarTitle icon="chart-timeline-variant">Sequences</ToolbarTitle>
        {sequences.length > 0 && <Select label="Sequence" value={selId ?? ""} onChange={(id) => { setSelId(id); setPlaying(false); setPlayhead(0); setSelKf(null); }} options={sequences.map((s) => ({ value: s.id, label: s.name }))} />}
        <Button size="sm" kind="secondary" icon="plus" onClick={create}>New</Button>
        <ToolbarSpacer />
        <span class={cx("devices-chip", proxy.proxy ? "is-ok" : "is-off")}><Icon name={proxy.proxy ? "access-point" : "access-point-off"} />{proxy.proxy ? `Proxy: ${proxy.proxy.phone.model ?? "phone"}` : "No proxy"}</span>
      </Toolbar>
      {!seq ? (
        <div class="f-app__body"><Empty icon="chart-timeline-variant" title="No sequence yet" actions={<Button icon="plus" onClick={create}>New sequence</Button>}>A track per light, keyframes on it, played through the phone's proxy. Stored in this browser for now.</Empty></div>
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
              <Button size="sm" icon={playing ? "stop" : "play"} disabled={!proxy.proxy && !playing} onClick={play}>{playing ? "Stop" : "Play"}</Button>
              <IconButton icon="delete-outline" label="Delete the sequence" onClick={() => void remove()} />
            </div>
            <Lanes seq={seq} fixtures={fixtures} playhead={playhead} selKf={selKf}
              onSeek={(t) => { if (!playing) setPlayhead(t); }}
              onAdd={(fixtureId, at) => {
                const tr = current()?.tracks.find((t) => t.fixtureId === fixtureId);
                if (!tr) return;
                const s = sampleTrack(tr.keyframes, at);
                const k: Keyframe = { id: newId(), at, ease: "linear", intensity: s.intensity ?? 0.5, ...(tr.keyframes.length === 0 ? { power: true } : {}) };
                patchTrack(fixtureId, (t) => ({ ...t, keyframes: [...t.keyframes, k] }));
                setSelKf({ fixtureId, id: k.id });
                setPlayhead(at);
              }}
              onSelect={(fixtureId, k) => { setSelKf({ fixtureId, id: k.id }); if (!playing) setPlayhead(k.at); }}
              onMove={(fixtureId, id, at) => patchTrack(fixtureId, (t) => ({ ...t, keyframes: t.keyframes.map((k) => (k.id === id ? { ...k, at } : k)) }))}
              onRemoveTrack={(fixtureId) => { patch((s) => ({ ...s, tracks: s.tracks.filter((t) => t.fixtureId !== fixtureId) })); setSelKf(null); }} />
            <div class="seq-add">
              {unused.length > 0
                ? <Select label="Add a light" prefix="Add track" value="" onChange={(id) => id && patch((s) => ({ ...s, tracks: [...s.tracks, { fixtureId: id, keyframes: [] }] }))}
                    options={[{ value: "", label: "Pick a light…" }, ...unused.map((f) => ({ value: f.id, label: f.label }))]} />
                : <p class="meta">{fixtures.length ? "Every light has a track." : "No lights paired: pair them in Devices."}</p>}
              <p class="meta">Click a lane to add a keyframe there; drag one to move it (snaps to 0.1 s); click the ruler to move the playhead.</p>
            </div>
          </div>
          {kf && selKf && (
            <KeyframePanel key={kf.id} kf={kf} fixture={fixtures.find((f) => f.id === selKf.fixtureId)} durationMs={seq.durationMs}
              onChange={(next) => patchTrack(selKf.fixtureId, (t) => ({ ...t, keyframes: t.keyframes.map((k) => (k.id === kf.id ? next : k)) }))}
              onDelete={() => { patchTrack(selKf.fixtureId, (t) => ({ ...t, keyframes: t.keyframes.filter((k) => k.id !== kf.id) })); setSelKf(null); }}
              onClose={() => setSelKf(null)} />
          )}
          {!proxy.proxy && <div class="seq-noproxy"><ErrorLine>No proxy: open Setup → Lights proxy on the phone to play or preview.</ErrorLine></div>}
        </div>
      )}
    </>
  );
}

/** The ruler and one lane per track, positions in % of the sequence length. */
function Lanes({ seq, fixtures, playhead, selKf, onSeek, onAdd, onSelect, onMove, onRemoveTrack }: {
  seq: LightSequence; fixtures: ServerFixture[]; playhead: number; selKf: { fixtureId: string; id: string } | null;
  onSeek: (t: number) => void; onAdd: (fixtureId: string, at: number) => void; onSelect: (fixtureId: string, k: Keyframe) => void;
  onMove: (fixtureId: string, id: string, at: number) => void; onRemoveTrack: (fixtureId: string) => void;
}) {
  const timeAt = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.min(seq.durationMs, Math.max(0, snap(((e.clientX - r.left) / r.width) * seq.durationMs)));
  };
  const pct = (t: number) => `${(t / seq.durationMs) * 100}%`;
  const ticks = Math.min(60, Math.max(1, Math.floor(seq.durationMs / 1000)));
  const step = Math.ceil(ticks / 12);
  const drag = useRef<{ fixtureId: string; id: string; lane: HTMLElement; moved: boolean } | null>(null);
  return (
    <div class="seq-lanes">
      <div class="seq-row">
        <div class="seq-label" />
        <div class="seq-ruler" onClick={(e) => onSeek(timeAt(e, e.currentTarget as HTMLElement))}>
          {Array.from({ length: Math.floor(ticks / step) + 1 }, (_, i) => i * step * 1000).filter((t) => t <= seq.durationMs).map((t) => (
            <span key={t} class="seq-tick" style={{ left: pct(t) }}>{t / 1000}</span>
          ))}
          <span class="seq-playhead" style={{ left: pct(playhead) }} />
        </div>
      </div>
      {seq.tracks.map((tr) => {
        const f = fixtures.find((x) => x.id === tr.fixtureId);
        return (
          <div key={tr.fixtureId} class="seq-row">
            <div class="seq-label"><span class="seq-name">{f?.label ?? "Removed light"}</span><IconButton icon="close" label="Remove the track" onClick={() => onRemoveTrack(tr.fixtureId)} /></div>
            <div class="seq-lane"
              onClick={(e) => { if ((e.target as HTMLElement).classList.contains("seq-lane")) onAdd(tr.fixtureId, timeAt(e, e.currentTarget as HTMLElement)); }}
              onPointerMove={(e) => { const d = drag.current; if (d && d.fixtureId === tr.fixtureId) { d.moved = true; onMove(d.fixtureId, d.id, timeAt(e, d.lane)); } }}
              onPointerUp={() => { drag.current = null; }}>
              {tr.keyframes.map((k) => (
                <button key={k.id} type="button" class={cx("seq-kf", selKf?.id === k.id && "is-selected", k.hue !== undefined && "is-colour", k.effect?.id && "is-effect")}
                  style={{ left: pct(k.at) }} title={`${fmt(k.at)} · ${summary(k)}`}
                  onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { fixtureId: tr.fixtureId, id: k.id, lane: (e.currentTarget as HTMLElement).parentElement!, moved: false }; }}
                  onPointerMove={(e) => { const d = drag.current; if (d?.id === k.id) { d.moved = true; onMove(d.fixtureId, d.id, timeAt(e, d.lane)); } }}
                  onPointerUp={() => { const d = drag.current; drag.current = null; if (!d?.moved) onSelect(tr.fixtureId, k); }} />
              ))}
              <span class="seq-playhead" style={{ left: pct(playhead) }} />
            </div>
          </div>
        );
      })}
      {seq.tracks.length === 0 && <p class="meta seq-empty">Add a track for a light below.</p>}
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

/** One keyframe: when, how it eases in, and which channels it sets (unchecked: left as before). */
function KeyframePanel({ kf, fixture, durationMs, onChange, onDelete, onClose }: {
  kf: Keyframe; fixture: ServerFixture | undefined; durationMs: number; onChange: (k: Keyframe) => void; onDelete: () => void; onClose: () => void;
}) {
  const kind = fixture ? fixtureKind(fixture.kind_id) : undefined;
  const caps = kind?.caps;
  const set = (patch: Partial<Keyframe>) => onChange({ ...kf, ...patch });
  const drop = (...keys: (keyof Keyframe)[]) => { const n = { ...kf }; for (const k of keys) delete n[k]; onChange(n); };
  const mode = kf.hue !== undefined ? "colour" : kf.kelvin !== undefined ? "white" : "leave";
  const cct = caps?.cct;
  return (
    <Panel label="Keyframe" width="360px">
      <PanelHead title={`Keyframe · ${fixture?.label ?? ""}`}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        <div class="two-col">
          <Field label="At"><Input sm unit="s" inputMode="decimal" value={String(kf.at / 1000)}
            onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v >= 0) set({ at: Math.min(durationMs, snap(v * 1000)) }); }} /></Field>
          <Field as="div" label="Ease in"><Select label="Ease in" value={kf.ease} onChange={(v) => set({ ease: v as Curve })} options={CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] }))} /></Field>
        </div>
        <Channel label="Power" on={kf.power !== undefined} toggle={(on) => (on ? set({ power: true }) : drop("power"))}>
          <Seg label="Power" value={kf.power ? "on" : "off"} onChange={(v) => set({ power: v === "on" })} options={[{ id: "off", label: "Off" }, { id: "on", label: "On" }]} />
        </Channel>
        <Channel label="Intensity" on={kf.intensity !== undefined} toggle={(on) => (on ? set({ intensity: 0.5 }) : drop("intensity"))}>
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
              options={[{ id: "leave", label: "As before" }, ...(cct ? [{ id: "white" as const, label: "White" }] : []), ...(caps?.hsi ? [{ id: "colour" as const, label: "Colour" }] : [])]} />
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
        <p class="meta">Unchecked channels keep what the keyframes before set. Effects run with their default options.</p>
        <div class="btn-row"><Button size="sm" kind="danger" icon="delete-outline" onClick={onDelete}>Delete keyframe</Button></div>
      </PanelBody>
    </Panel>
  );
}

function Channel({ label, on, toggle, children }: { label: string; on: boolean; toggle: (on: boolean) => void; children: preact.ComponentChildren }) {
  return (
    <div class="devices-field">
      <Checkbox checked={on} onClick={() => toggle(!on)}>{label}</Checkbox>
      {on && children}
    </div>
  );
}
