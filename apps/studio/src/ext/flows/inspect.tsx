// What is chosen in a flow's lanes (docs/features/flows.md, "In the Studio"): a keyframe of a light or a camera, a
// fade tile, a marker, a track, or several things at once. The panel keeps its width whatever it shows.
import type { ComponentChildren } from "preact";
import { Button, Checkbox, EmptyState, Icon, NumberInput, Segmented, Select, Slider, Switch, TextInput } from "@openclapper/design";
import { CURVES, EFFECT_OPTIONS, effectHolds, effectLightKind, effectName, effectOptions, holdEffect, effectSettingsOf, fixtureKind, formatValue, modelOf, optionShown, type Control, type Curve, type EffectId, type Value } from "@openclapper/ext-hardware";
import { FLOW_CAMERA_CONTROLS, FLOW_MAX_MS, fmtSeconds, heldLight, LIGHT_PARAMS, LIGHT_SUBLOCKS, LOCK_LABELS, LOCK_PARAMS, type LockParam, MARKER_NAME_MAX, NATIVE_FADES, snap, SNAP_MS, START_KEYFRAME, type Flow, type FlowMarker, type FlowTrack, type Keyframe, type LightParam, NO_HIDES, type PanelHides } from "@openclapper/ext-flows";
import { ColourSwatch } from "../hardware/ColourSwatch";
import { Draft } from "./draft";
import { CURVE_LABELS } from "./lanes";

function Range({ label, value, min, max, step, format, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean }) {
  return <label className="hw-ctl hw-ctl--range"><small>{label}<b>{format(value)}</b></small><Slider value={value} min={min} max={max} step={step} disabled={disabled} onChange={onChange} aria-label={label} /></label>;
}
/**
 * A lock on the start keyframe (#426): locked, this value holds for the whole track and no other keyframe can set
 * it. The padlock shows the state; its label says what it does.
 */
function Lock({ param, locked, onLock }: { param: LockParam; locked?: readonly LockParam[]; onLock?: (p: LockParam, on: boolean) => void }) {
  if (!onLock) return null;
  const on = !!locked?.includes(param);
  const what = param === "light" ? "white or colour" : LOCK_LABELS[param].toLowerCase();
  return <Button size="sm" variant="quiet" icon={on ? "lock" : "unlock"} selected={on} title={on ? `${LOCK_LABELS[param]} is locked: the whole track keeps it. Click to unlock${param === "light" ? " (and the values under it)" : ""}` : `Lock ${what} for the whole track${LIGHT_SUBLOCKS.includes(param) ? " (locks white or colour too)" : ""}`} onClick={() => onLock(param, !on)}>{on ? "Locked" : "Lock"}</Button>;
}
/** A value held by the start keyframe's lock, shown on the other keyframes (#426): what holds, and that it is locked. */
const Held = () => <span className="fl-held" title="Locked on the start keyframe for the whole track"><Icon name="lock" size={12} />Locked</span>;
/** A value a keyframe may set: checked, it sets it; unchecked, the value before holds. The start keyframe always sets it. */
function Channel({ label, on, fixed, toggle, lock, children }: { label: string; on: boolean; fixed?: boolean; toggle: (on: boolean) => void; /** The start keyframe's lock beside the label. */ lock?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div className="fl-chan">
      <div className="fl-chan__head">{fixed ? <strong>{label}</strong> : <Checkbox checked={on} onChange={() => toggle(!on)}>{label}</Checkbox>}{lock}</div>
      {(on || fixed) && children}
    </div>
  );
}
/** A slider with the start keyframe's lock beside it. */
const Locked = ({ lock, children }: { lock?: ComponentChildren; children: ComponentChildren }) => (lock ? <div className="fl-lockrow">{children}{lock}</div> : <>{children}</>);
const Seconds = ({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (ms: number) => void }) => (
  <label className="hw-ctl"><small>{label} (s)</small><NumberInput size="sm" value={value / 1000} step={SNAP_MS / 1000} min={min / 1000} max={max / 1000} onChange={(v: number) => { if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, snap(v * 1000)))); }} /></label>
);

/**
 * A keyframe's margins (#426): the least distance to the keyframes before and after it on the track, in half
 * seconds; a neighbour inside one is pushed. 0 removes it; the start keyframe has none before.
 */
function Margins({ kf, durationMs, hide, onChange }: { kf: Keyframe; durationMs: number; hide: PanelHides; onChange: (k: Keyframe) => void }) {
  const before = kf.id !== START_KEYFRAME && !hide.fields.includes("marginBefore"), after = !hide.fields.includes("marginAfter");
  if (!before && !after) return null;
  return (
    <div className="fl-margins">
      {before && <Seconds label="Margin before" value={kf.marginBeforeMs ?? 0} min={0} max={durationMs} onChange={(ms) => onChange({ ...kf, marginBeforeMs: ms })} />}
      {after && <Seconds label="Margin after" value={kf.marginAfterMs ?? 0} min={0} max={durationMs} onChange={(ms) => onChange({ ...kf, marginAfterMs: ms })} />}
    </div>
  );
}

/** One keyframe of a light track: when, and which values it sets. */
export function LightKeyframe({ kf, track, durationMs, hide = NO_HIDES, onChange, onDelete, onLock }: { kf: Keyframe; track: FlowTrack; durationMs: number; /** What the account leaves out (#426). */ hide?: PanelHides; onChange: (k: Keyframe) => void; onDelete: () => void; /** A track lock set or cleared (#426), from the start keyframe. */ onLock?: (p: LockParam, on: boolean) => void }) {
  const kind = fixtureKind(track.model), caps = kind?.caps, m = modelOf(track.model);
  const isStart = kf.id === START_KEYFRAME;
  // The start keyframe sets the locks; on the others a locked parameter is not shown (the start's value holds).
  // Hidden for the model or left out of the panel (#426): not shown, its lock neither; its value stays.
  const lock = (p: LockParam) => (isStart ? <Lock param={p} locked={track.locked} onLock={onLock} /> : null);
  const isLocked = (p: LockParam) => !!track.locked?.includes(p);
  const shown = (p: LightParam) => !hide.params.includes(p) && !hide.fields.includes(p) && (isStart || !(LOCK_PARAMS as readonly string[]).includes(p) || !isLocked(p as LockParam));
  // The light's locks (#426, a hierarchy): on the start keyframe a lock beside each; on the others what is held shows, disabled.
  const start = track.keyframes.find((k) => k.id === START_KEYFRAME);
  const lightHeld = !isStart && isLocked("light") ? heldLight(track) : null;
  const sub = (p: LockParam) => (isStart ? lock(p) : lightHeld && isLocked(p) ? <Held /> : null);
  const subHeld = (p: LockParam) => !isStart && !!lightHeld && isLocked(p);
  const forModel = (p: LightParam) => !hide.params.includes(p);
  const inPanel = (p: LightParam) => forModel(p) && !hide.fields.includes(p);
  const lockedHere = (isStart ? [] : (track.locked ?? [])).filter((p): p is LightParam & LockParam => (LIGHT_PARAMS as readonly string[]).includes(p) && !LIGHT_SUBLOCKS.includes(p));
  const set = (patch: Partial<Keyframe>) => onChange({ ...kf, ...patch });
  const drop = (...keys: (keyof Keyframe)[]) => { const n = { ...kf }; for (const k of keys) delete n[k]; onChange(n); };
  const mode = kf.hue !== undefined ? "colour" : kf.kelvin !== undefined ? "white" : "leave";
  const cct = caps?.cct;
  const fx = kf.effect?.id ?? null;
  // A locked white or colour (#426) is the light of every effect that can show it; the others are not offered.
  const held = isStart ? null : heldLight(track);
  const holds = !!fx && !!held && effectHolds(fx, held);
  const settings = fx ? (holds ? effectSettingsOf(fx, holdEffect(fx, kf.effect?.settings, held!)) : effectSettingsOf(fx, kf.effect?.settings)) : {};
  const heldText = !held ? "" : held.mode === "white" ? `the locked white${held.kelvin !== undefined ? `, ${held.kelvin} K` : ""}`
    : `the locked colour${[held.h !== undefined ? `hue ${Math.round(held.h)}°` : "", held.s !== undefined ? `saturation ${Math.round(held.s * 100)} %` : ""].filter(Boolean).map((x) => `, ${x}`).join("")}`;
  // Which of the effect's light options the lock holds: white or colour always; a value where it is locked too.
  const isLightOpt = (id: string) => !!held && (id === "colorMode" || ((id === "kelvin" || id === "colorKelvin") && held.mode === "white" && held.kelvin !== undefined)
    || (id === "colorHue" && held.mode === "colour" && held.h !== undefined) || (id === "colorSat" && held.mode === "colour" && held.s !== undefined) || (id === "choice" && !!fx && effectLightKind(fx) === "whiteChoice"));
  const fxOpts = fx && m ? effectOptions(m, fx).filter((o) => optionShown(o, settings)) : [];
  const satOpt = fxOpts.find((o) => o.control.id === "colorSat");
  return (
    <div className="fl-inspect">
      {isStart ? <p className="fl-note">What the light shows when the flow starts. It always sets power, intensity and the light, so a flow never starts from whatever the light showed before.</p>
        : !hide.fields.includes("at") && <Seconds label="At" value={kf.at} min={SNAP_MS} max={durationMs} onChange={(at) => set({ at })} />}
      <Margins kf={kf} durationMs={durationMs} hide={hide} onChange={onChange} />
      {lockedHere.some(forModel) && <p className="fl-note">Locked on the start keyframe for the whole track: {lockedHere.filter(forModel).map((p) => LOCK_LABELS[p]).join(", ")}.</p>}
      {shown("power") && <Channel label="Power" fixed={isStart} on={kf.power !== undefined} toggle={(on) => (on ? set({ power: true }) : drop("power"))} lock={lock("power")}>
        <Segmented label="Power" value={kf.power ? "on" : "off"} onChange={(v: string) => set({ power: v === "on" })} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} />
      </Channel>}
      {shown("intensity") && <Channel label="Intensity" fixed={isStart} on={kf.intensity !== undefined} toggle={(on) => (on ? set({ intensity: 0.5 }) : drop("intensity"))} lock={lock("intensity")}>
        <Range label="Intensity" value={Math.round((kf.intensity ?? 0.5) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ intensity: x / 100 })} />
      </Channel>}
      {/* A keyframe that turns an effect on (#426): the effect's own options are its light; the white or colour set before stays for when it stops. */}
      {!(fx && !isStart) && ((cct && (inPanel("kelvin") || inPanel("gm"))) || (caps?.hsi && inPanel("colour"))) && (
        <div className="fl-chan">
          <div className="fl-chan__head"><strong>Light</strong>{isStart ? lock("light") : lightHeld && <Held />}</div>
          <Segmented label="White or colour" value={mode}
            onChange={(v: string) => {
              const n: Keyframe = { ...kf };
              delete n.kelvin; delete n.gm; delete n.hue; delete n.sat;
              if (v === "white") Object.assign(n, { kelvin: start?.kelvin ?? (cct ? Math.round((cct.min + cct.max) / 200) * 100 : 5600), gm: start?.gm ?? 0 });
              if (v === "colour") Object.assign(n, { hue: start?.hue ?? 0, sat: start?.sat ?? 1 });
              onChange(n);
            }}
            options={[...(isStart ? [] : [{ value: "leave", label: "As before" }]),
              ...(cct && (mode === "white" || inPanel("kelvin") || inPanel("gm")) && (!lightHeld || lightHeld.mode === "white") ? [{ value: "white", label: "White" }] : []),
              ...(caps?.hsi && (mode === "colour" || inPanel("colour")) && (!lightHeld || lightHeld.mode === "colour") ? [{ value: "colour", label: "Colour" }] : [])]} />
          {lightHeld && mode === "leave" && <p className="fl-note">{lightHeld.mode === "white" ? "White" : "Colour"} is locked on the start keyframe: setting the light here sets {lightHeld.mode === "white" ? "white" : "a colour"}.</p>}
          {mode === "white" && cct && <>
            {inPanel("kelvin") && <Locked lock={sub("kelvin")}><Range label="White" value={subHeld("kelvin") ? start?.kelvin ?? 5600 : kf.kelvin ?? 5600} min={cct.min} max={cct.max} step={100} disabled={subHeld("kelvin")} format={(x) => `${x} K`} onChange={(x) => set({ kelvin: x })} /></Locked>}
            {cct.gm && inPanel("gm") && <Locked lock={sub("gm")}><Range label="Green / magenta" value={subHeld("gm") ? start?.gm ?? 0 : kf.gm ?? 0} min={cct.gm.min} max={cct.gm.max} step={1} disabled={subHeld("gm")} format={(x) => (x > 0 ? `+${x} M` : x < 0 ? `${-x} G` : "neutral")} onChange={(x) => set({ gm: x })} /></Locked>}
          </>}
          {/* The colour the sliders make, live, drawn as the lanes draw it (#426); hue and saturation each lockable. */}
          {mode === "colour" && inPanel("colour") && (() => {
            const h = subHeld("hue") ? start?.hue ?? 0 : kf.hue ?? 0, sv = subHeld("sat") ? start?.sat ?? 1 : kf.sat ?? 1;
            return (
              <div className="fl-colour">
                <div className="fl-colour__sliders">
                  <Locked lock={sub("hue")}><Range label="Hue" value={Math.round(h)} min={0} max={360} step={1} disabled={subHeld("hue")} format={(x) => `${x}°`} onChange={(x) => set({ hue: x })} /></Locked>
                  <Locked lock={sub("sat")}><Range label="Saturation" value={Math.round(sv * 100)} min={0} max={100} step={1} disabled={subHeld("sat")} format={(x) => `${x} %`} onChange={(x) => set({ sat: x / 100 })} /></Locked>
                </div>
                <ColourSwatch className="fl-colour__swatch" align="end" disabled={subHeld("hue") && subHeld("sat")} hue={h} sat={sv} onChange={(hue, sat) => set({ ...(subHeld("hue") ? {} : { hue }), ...(subHeld("sat") ? {} : { sat }) })} />
              </div>
            );
          })()}
        </div>
      )}
      {!!caps?.effects?.length && m && shown("effect") && (
        <Channel label="Effect" on={kf.effect !== undefined} toggle={(on) => (on ? set({ effect: { id: caps.effects![0], settings: effectSettingsOf(caps.effects![0]) } }) : drop("effect"))} lock={lock("effect")}>
          <Select size="sm" aria-label="Effect" value={fx ?? "off"} onChange={(v: string) => { const id = v === "off" ? null : (v as EffectId); set({ effect: id ? { id, settings: effectSettingsOf(id) } : { id: null } }); }}
            options={[{ value: "off", label: "Off (stop)" }, ...caps.effects.map((id) => { const no = !!held && !effectHolds(id, held); return { value: id, label: no ? `${effectName(id)}: cannot show ${held!.mode === "white" ? "the locked white" : "the locked colour"}` : effectName(id), disabled: no && id !== fx }; })]} />
          {fx && held && !holds && <p className="fl-note fl-warn">{effectName(fx)} brings its own light: it cannot show {heldText}. It plays as it is; pick another effect to keep the lock.</p>}
          {holds && <p className="fl-note">Its light is {heldText}, locked on the start keyframe.</p>}
          {fx && EFFECT_OPTIONS[fx] && fxOpts.map((o) => {
            const off = holds && isLightOpt(o.control.id);
            if (o.control.id === "colorSat") return null;
            // The effect's colour as Light's (#426): hue and saturation beside the swatch that opens the colour field.
            if (o.control.id === "colorHue" && satOpt) return (
              <div key="fxcolour" className="fl-colour">
                <div className="fl-colour__sliders">
                  <Range label="Hue" value={Math.round(o.read(settings))} min={0} max={360} step={1} disabled={off} format={(x) => `${x}°`} onChange={(v) => set({ effect: { id: fx, settings: o.write(settings, v) } })} />
                  <Range label="Saturation" value={Math.round(satOpt.read(settings) * 100)} min={0} max={100} step={1} disabled={off} format={(x) => `${x} %`} onChange={(v) => set({ effect: { id: fx, settings: satOpt.write(settings, v / 100) } })} />
                </div>
                <ColourSwatch className="fl-colour__swatch" align="end" disabled={off} hue={o.read(settings)} sat={satOpt.read(settings)} onChange={(h, sv) => set({ effect: { id: fx, settings: { ...settings, color: { h, s: sv } } } })} />
              </div>
            );
            return o.control.kind === "choice"
              ? <label key={o.control.id} className="hw-ctl"><small>{o.control.label}</small><Select size="sm" disabled={off} value={String(o.read(settings))} onChange={(v: string) => set({ effect: { id: fx, settings: o.write(settings, Number(v)) } })} options={o.control.options.map((x) => ({ value: String(x.value), label: x.label }))} /></label>
              : o.control.kind === "range" ? <Range key={o.control.id} label={o.control.label} value={o.read(settings)} min={o.control.min} max={o.control.max} step={o.control.step} disabled={off}
                format={(v) => ((o.control as { max: number }).max === 11 && v === 11 ? "Random" : formatValue((o.control as { format: "plain" }).format, v))} onChange={(v) => set({ effect: { id: fx, settings: o.write(settings, v) } })} /> : null;
          })}
        </Channel>
      )}
      {caps?.curves && shown("curve") && (
        <Channel label="Dimming curve" on={kf.curve !== undefined} toggle={(on) => (on ? set({ curve: "linear" }) : drop("curve"))} lock={lock("curve")}>
          <Select size="sm" aria-label="Dimming curve" value={kf.curve ?? "linear"} onChange={(v: string) => set({ curve: v as Curve })} options={CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] }))} />
        </Channel>
      )}
      <p className="fl-note">Values jump at the keyframe; a fade on the strip before it blends into them instead.</p>
      {!isStart && <div><Button size="sm" variant="danger" icon="trash" onClick={onDelete}>Delete keyframe</Button></div>}
    </div>
  );
}

/** One keyframe of a camera track: the controls it sets from here on (they jump). */
export function CameraKeyframe({ kf, durationMs, hide = NO_HIDES, onChange, onDelete }: { kf: Keyframe; durationMs: number; /** What the account leaves out (#426): its time and margins. */ hide?: PanelHides; onChange: (k: Keyframe) => void; onDelete: () => void }) {
  const isStart = kf.id === START_KEYFRAME;
  const controls = kf.controls ?? {};
  const put = (id: string, v: Value | undefined) => { const c = { ...controls }; if (v === undefined) delete c[id]; else c[id] = v; onChange({ ...kf, controls: c }); };
  const first = (c: Control): Value => (c.kind === "switch" ? true : c.kind === "choice" ? c.options[0].value : c.kind === "range" || c.kind === "number" ? c.min : 0);
  const groups = [...new Set(FLOW_CAMERA_CONTROLS.map((c) => c.group))];
  return (
    <div className="fl-inspect">
      {isStart ? <p className="fl-note">What the camera does when the flow starts: it stops recording, so a flow never starts in the middle of a take.</p>
        : !hide.fields.includes("at") && <Seconds label="At" value={kf.at} min={SNAP_MS} max={durationMs} onChange={(at) => onChange({ ...kf, at })} />}
      <Margins kf={kf} durationMs={durationMs} hide={hide} onChange={onChange} />
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
  // How the fade runs is a choice only while native fades are on (off since #426).
  const native = NATIVE_FADES && !!fixtureKind(track.model)?.caps.fade;
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
      <label className="hw-ctl"><small>Name</small><Draft value={tr.name} commit={(v) => { const name = v.trim(); if (name) onChange((t) => ({ ...t, name })); }}>{(d) => <TextInput size="sm" maxLength={60} {...d} />}</Draft></label>
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
