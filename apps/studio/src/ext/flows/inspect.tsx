// What is chosen in a flow's lanes (docs/features/flows.md, "In the Studio"): a keyframe of a light or a camera, a
// fade tile, a marker, a track, or several things at once. The panel keeps its width whatever it shows.
import type { ComponentChildren } from "preact";
import { Button, Checkbox, EmptyState, NumberInput, Segmented, Select, Slider, Switch, TextInput } from "@openclapper/design";
import { CURVES, EFFECT_OPTIONS, effectName, effectOptions, effectSettingsOf, fixtureKind, formatValue, modelOf, optionShown, type Control, type Curve, type EffectId, type Value } from "@openclapper/ext-hardware";
import { FLOW_CAMERA_CONTROLS, FLOW_MAX_MS, fmtSeconds, MARKER_NAME_MAX, snap, SNAP_MS, START_KEYFRAME, type Flow, type FlowMarker, type FlowTrack, type Keyframe } from "@openclapper/ext-flows";
import { CURVE_LABELS } from "./lanes";

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return <label className="hw-ctl hw-ctl--range"><small>{label}<b>{format(value)}</b></small><Slider value={value} min={min} max={max} step={step} onChange={onChange} aria-label={label} /></label>;
}
/** A value a keyframe may set: checked, it sets it; unchecked, the value before holds. The start keyframe always sets it. */
function Channel({ label, on, fixed, toggle, children }: { label: string; on: boolean; fixed?: boolean; toggle: (on: boolean) => void; children: ComponentChildren }) {
  return (
    <div className="fl-chan">
      {fixed ? <strong>{label}</strong> : <Checkbox checked={on} onChange={() => toggle(!on)}>{label}</Checkbox>}
      {(on || fixed) && children}
    </div>
  );
}
const Seconds = ({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (ms: number) => void }) => (
  <label className="hw-ctl"><small>{label} (s)</small><NumberInput size="sm" value={value / 1000} step={1} min={min / 1000} max={max / 1000} onChange={(v: number) => { if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, snap(v * 1000)))); }} /></label>
);

/**
 * A keyframe's margins (#426): the least distance to the keyframes before and after it on the track, in whole
 * seconds; a neighbour inside one is pushed. 0 removes it; the start keyframe has none before.
 */
function Margins({ kf, durationMs, onChange }: { kf: Keyframe; durationMs: number; onChange: (k: Keyframe) => void }) {
  return (
    <div className="fl-margins">
      {kf.id !== START_KEYFRAME && <Seconds label="Margin before" value={kf.marginBeforeMs ?? 0} min={0} max={durationMs} onChange={(ms) => onChange({ ...kf, marginBeforeMs: ms })} />}
      <Seconds label="Margin after" value={kf.marginAfterMs ?? 0} min={0} max={durationMs} onChange={(ms) => onChange({ ...kf, marginAfterMs: ms })} />
    </div>
  );
}

/** One keyframe of a light track: when, and which values it sets. */
export function LightKeyframe({ kf, track, durationMs, onChange, onDelete }: { kf: Keyframe; track: FlowTrack; durationMs: number; onChange: (k: Keyframe) => void; onDelete: () => void }) {
  const kind = fixtureKind(track.model), caps = kind?.caps, m = modelOf(track.model);
  const isStart = kf.id === START_KEYFRAME;
  const set = (patch: Partial<Keyframe>) => onChange({ ...kf, ...patch });
  const drop = (...keys: (keyof Keyframe)[]) => { const n = { ...kf }; for (const k of keys) delete n[k]; onChange(n); };
  const mode = kf.hue !== undefined ? "colour" : kf.kelvin !== undefined ? "white" : "leave";
  const cct = caps?.cct;
  const fx = kf.effect?.id ?? null;
  const settings = fx ? effectSettingsOf(fx, kf.effect?.settings) : {};
  return (
    <div className="fl-inspect">
      {isStart ? <p className="fl-note">What the light shows when the flow starts. It always sets power, intensity and the light, so a flow never starts from whatever the light showed before.</p>
        : <Seconds label="At" value={kf.at} min={SNAP_MS} max={durationMs} onChange={(at) => set({ at })} />}
      <Margins kf={kf} durationMs={durationMs} onChange={onChange} />
      <Channel label="Power" fixed={isStart} on={kf.power !== undefined} toggle={(on) => (on ? set({ power: true }) : drop("power"))}>
        <Segmented label="Power" value={kf.power ? "on" : "off"} onChange={(v: string) => set({ power: v === "on" })} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} />
      </Channel>
      <Channel label="Intensity" fixed={isStart} on={kf.intensity !== undefined} toggle={(on) => (on ? set({ intensity: 0.5 }) : drop("intensity"))}>
        <Range label="Intensity" value={Math.round((kf.intensity ?? 0.5) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ intensity: x / 100 })} />
      </Channel>
      {(cct || caps?.hsi) && (
        <div className="fl-chan">
          <strong>Light</strong>
          <Segmented label="White or colour" value={mode}
            onChange={(v: string) => {
              const n: Keyframe = { ...kf };
              delete n.kelvin; delete n.gm; delete n.hue; delete n.sat;
              if (v === "white") Object.assign(n, { kelvin: cct ? Math.round((cct.min + cct.max) / 200) * 100 : 5600, gm: 0 });
              if (v === "colour") Object.assign(n, { hue: 0, sat: 1 });
              onChange(n);
            }}
            options={[...(isStart ? [] : [{ value: "leave", label: "As before" }]), ...(cct ? [{ value: "white", label: "White" }] : []), ...(caps?.hsi ? [{ value: "colour", label: "Colour" }] : [])]} />
          {mode === "white" && cct && <>
            <Range label="White" value={kf.kelvin ?? 5600} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={(x) => set({ kelvin: x })} />
            {cct.gm && <Range label="Green / magenta" value={kf.gm ?? 0} min={cct.gm.min} max={cct.gm.max} step={1} format={(x) => (x > 0 ? `+${x} M` : x < 0 ? `${-x} G` : "neutral")} onChange={(x) => set({ gm: x })} />}
          </>}
          {mode === "colour" && <>
            <Range label="Hue" value={Math.round(kf.hue ?? 0)} min={0} max={360} step={1} format={(x) => `${x}°`} onChange={(x) => set({ hue: x })} />
            <Range label="Saturation" value={Math.round((kf.sat ?? 1) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ sat: x / 100 })} />
          </>}
        </div>
      )}
      {!!caps?.effects?.length && m && (
        <Channel label="Effect" on={kf.effect !== undefined} toggle={(on) => (on ? set({ effect: { id: caps.effects![0], settings: effectSettingsOf(caps.effects![0]) } }) : drop("effect"))}>
          <Select size="sm" aria-label="Effect" value={fx ?? "off"} onChange={(v: string) => { const id = v === "off" ? null : (v as EffectId); set({ effect: id ? { id, settings: effectSettingsOf(id) } : { id: null } }); }}
            options={[{ value: "off", label: "Off (stop)" }, ...caps.effects.map((id) => ({ value: id, label: effectName(id) }))]} />
          {fx && EFFECT_OPTIONS[fx] && effectOptions(m, fx).filter((o) => optionShown(o, settings)).map((o) => o.control.kind === "choice"
            ? <label key={o.control.id} className="hw-ctl"><small>{o.control.label}</small><Select size="sm" value={String(o.read(settings))} onChange={(v: string) => set({ effect: { id: fx, settings: o.write(settings, Number(v)) } })} options={o.control.options.map((x) => ({ value: String(x.value), label: x.label }))} /></label>
            : o.control.kind === "range" ? <Range key={o.control.id} label={o.control.label} value={o.read(settings)} min={o.control.min} max={o.control.max} step={o.control.step}
              format={(v) => ((o.control as { max: number }).max === 11 && v === 11 ? "Random" : formatValue((o.control as { format: "plain" }).format, v))} onChange={(v) => set({ effect: { id: fx, settings: o.write(settings, v) } })} /> : null)}
        </Channel>
      )}
      {caps?.curves && (
        <Channel label="Dimming curve" on={kf.curve !== undefined} toggle={(on) => (on ? set({ curve: "linear" }) : drop("curve"))}>
          <Select size="sm" aria-label="Dimming curve" value={kf.curve ?? "linear"} onChange={(v: string) => set({ curve: v as Curve })} options={CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] }))} />
        </Channel>
      )}
      <p className="fl-note">Values jump at the keyframe; a fade on the strip before it blends into them instead.</p>
      {!isStart && <div><Button size="sm" variant="danger" icon="trash" onClick={onDelete}>Delete keyframe</Button></div>}
    </div>
  );
}

/** One keyframe of a camera track: the controls it sets from here on (they jump). */
export function CameraKeyframe({ kf, durationMs, onChange, onDelete }: { kf: Keyframe; durationMs: number; onChange: (k: Keyframe) => void; onDelete: () => void }) {
  const isStart = kf.id === START_KEYFRAME;
  const controls = kf.controls ?? {};
  const put = (id: string, v: Value | undefined) => { const c = { ...controls }; if (v === undefined) delete c[id]; else c[id] = v; onChange({ ...kf, controls: c }); };
  const first = (c: Control): Value => (c.kind === "switch" ? true : c.kind === "choice" ? c.options[0].value : c.kind === "range" || c.kind === "number" ? c.min : 0);
  const groups = [...new Set(FLOW_CAMERA_CONTROLS.map((c) => c.group))];
  return (
    <div className="fl-inspect">
      {isStart ? <p className="fl-note">What the camera does when the flow starts: it stops recording, so a flow never starts in the middle of a take.</p>
        : <Seconds label="At" value={kf.at} min={SNAP_MS} max={durationMs} onChange={(at) => onChange({ ...kf, at })} />}
      <Margins kf={kf} durationMs={durationMs} onChange={onChange} />
      {groups.map((g) => (
        <div key={g} className="fl-chan">
          <strong>{g}</strong>
          {FLOW_CAMERA_CONTROLS.filter((c) => c.group === g).map((c) => {
            const on = controls[c.id] !== undefined, v = controls[c.id];
            return (
              <Channel key={c.id} label={c.label} on={on} toggle={(x) => put(c.id, x ? first(c) : undefined)}>
                {c.kind === "switch" ? <Switch checked={!!v} onChange={(x: boolean) => put(c.id, x)}>{c.id === "record" ? (v ? "Record" : "Stop") : v ? "On" : "Off"}</Switch>
                  : c.kind === "choice" ? <Select size="sm" aria-label={c.label} value={String(v)} onChange={(x: string) => put(c.id, Number(x))} options={c.options.map((o) => ({ value: String(o.value), label: o.label }))} />
                  : c.kind === "range" ? <Range label={c.label} value={Number(v)} min={c.min} max={c.max} step={c.step} format={(x) => formatValue(c.format, x)} onChange={(x) => put(c.id, x)} />
                  : c.kind === "number" ? <NumberInput size="sm" value={Number(v)} min={c.min} max={c.max} onChange={(x: number) => { if (Number.isFinite(x)) put(c.id, Math.round(x)); }} /> : null}
              </Channel>
            );
          })}
        </div>
      ))}
      <p className="fl-note">A camera's values jump at the keyframe; they never fade.</p>
      {!isStart && <div><Button size="sm" variant="danger" icon="trash" onClick={onDelete}>Delete keyframe</Button></div>}
    </div>
  );
}

/** The gap before a keyframe: jump at it, or fade into it with a curve; on a light that fades by itself, how. */
export function FadeInspect({ kf, track, onChange, onStepped }: { kf: Keyframe; track: FlowTrack; onChange: (curve: Curve | null) => void; onStepped: (stepped: boolean) => void }) {
  const native = !!fixtureKind(track.model)?.caps.fade;
  return (
    <div className="fl-inspect">
      <strong>Into {fmtSeconds(kf.at)} · {track.name}</strong>
      <Segmented label="Transition" value={kf.fadeIn ? "fade" : "jump"} onChange={(v: string) => onChange(v === "fade" ? kf.fadeIn ?? "linear" : null)} options={[{ value: "jump", label: "Jump" }, { value: "fade", label: "Fade" }]} />
      {kf.fadeIn && <div className="fl-chan"><strong>Curve</strong><Segmented label="Fade curve" value={kf.fadeIn} onChange={(c: string) => onChange(c as Curve)} options={CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] }))} /></div>}
      {kf.fadeIn && native && <div className="fl-chan"><strong>Run by</strong><Segmented label="How the fade runs" value={kf.fadeStepped ? "steps" : "light"} onChange={(v: string) => onStepped(v === "steps")} options={[{ value: "light", label: "The light (smooth)" }, { value: "steps", label: "Steps every 0.1 s" }]} /></div>}
      <p className="fl-note">{kf.fadeIn
        ? `Everything that differs between the two keyframes blends over the gap (white ↔ colour switches at the end).${native && !kf.fadeStepped ? " This light runs the fade by itself, smoothly; nothing else is sent to it meanwhile." : " Sent in steps every 0.1 s."}`
        : "The light keeps the earlier values and jumps to these at the keyframe."}</p>
    </div>
  );
}

/** One marker: name, where, a point or a range, the whole flow or one track. */
export function MarkerInspect({ m, flow, onChange, onDelete }: { m: FlowMarker; flow: Flow; onChange: (fn: (m: FlowMarker) => FlowMarker) => void; onDelete: () => void }) {
  return (
    <div className="fl-inspect">
      <label className="hw-ctl"><small>Name</small><TextInput size="sm" value={m.name} maxLength={MARKER_NAME_MAX} onInput={(e) => { const name = e.currentTarget.value; onChange((x) => ({ ...x, name })); }} /></label>
      <Seconds label={m.end !== undefined ? "In" : "At"} value={m.at} min={0} max={(m.end ?? flow.durationMs + SNAP_MS) - SNAP_MS} onChange={(at) => onChange((x) => ({ ...x, at }))} />
      <Checkbox checked={m.end !== undefined} onChange={() => onChange((x) => { const n = { ...x }; if (n.end !== undefined) delete n.end; else n.end = Math.min(flow.durationMs, n.at + 1000); return n.end === n.at ? x : n; })}>Range (in and out)</Checkbox>
      {m.end !== undefined && <Seconds label="Out" value={m.end} min={m.at + SNAP_MS} max={flow.durationMs} onChange={(end) => onChange((x) => ({ ...x, end }))} />}
      <label className="hw-ctl"><small>On</small><Select size="sm" value={m.trackId ?? ""} onChange={(v: string) => onChange((x) => { const n = { ...x }; if (v) n.trackId = v; else delete n.trackId; return n; })} options={[{ value: "", label: "The whole flow" }, ...flow.tracks.map((t) => ({ value: t.id, label: t.name }))]} /></label>
      <p className="fl-note">Markers only help you find your way; playback ignores them.</p>
      <div><Button size="sm" variant="danger" icon="trash" onClick={onDelete}>Delete marker</Button></div>
    </div>
  );
}

/** One track: its name, type, colour and height; remove it. */
export function TrackInspect({ tr, custom, onChange, onRemove, onHeight }: { tr: FlowTrack; custom: boolean; onChange: (fn: (t: FlowTrack) => FlowTrack) => void; onRemove: () => void; onHeight: () => void }) {
  const m = modelOf(tr.model);
  return (
    <div className="fl-inspect">
      <label className="hw-ctl"><small>Name</small><TextInput size="sm" value={tr.name} maxLength={60} onInput={(e) => { const name = e.currentTarget.value.trim(); if (name) onChange((t) => ({ ...t, name })); }} /></label>
      <p className="fl-note">{m ? `${m.brand} ${m.model}` : tr.model} · {tr.keyframes.length} keyframe{tr.keyframes.length === 1 ? "" : "s"}{tr.muted ? " · muted" : ""}{tr.device ? "" : " · no device: it does not play"}</p>
      {custom && <div><Button size="sm" variant="secondary" onClick={onHeight}>Back to the common height</Button></div>}
      <div><Button size="sm" variant="danger" icon="trash" onClick={onRemove}>Remove the track</Button></div>
    </div>
  );
}

export function SelectionInspect({ n, onDelete }: { n: number; onDelete: () => void }) {
  return (
    <div className="fl-inspect">
      <strong>{n} selected</strong>
      <p className="fl-note">Keyframes and markers: drag one of them to move them all; Delete removes them. Start keyframes stay where they are.</p>
      <div><Button size="sm" variant="danger" icon="trash" onClick={onDelete}>Delete</Button></div>
    </div>
  );
}

export const NothingChosen = () => <EmptyState icon="cursor" title="Nothing chosen">Choose a keyframe to set its values, the strip between two keyframes for a fade, a marker, or a track's “…”.</EmptyState>;
export const LENGTH_MAX = FLOW_MAX_MS;
