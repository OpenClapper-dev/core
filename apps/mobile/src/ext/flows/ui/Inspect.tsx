import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { CURVES, EFFECT_OPTIONS, effectName, effectOptions, effectSettingsOf, fixtureKind, formatValue, modelOf, optionShown, type Control, type Curve, type EffectId, type Value } from "@openclapper/ext-hardware";
import { FLOW_CAMERA_CONTROLS, fmtSeconds, lightColour, MARKER_NAME_MAX, NATIVE_FADES, PARAM_LABELS, snap, SNAP_MS, START_KEYFRAME, TRACK_COLORS, type FlowMarker, type FlowTrack, type Keyframe, type LightParam, NO_HIDES, type PanelHides } from "@openclapper/ext-flows";
import { Button, catColor, Chip, Hint, Input, makeStyles, Seg, Slider, Toggle, type, useTheme } from "../../../ui";
import type { HardwareDevice } from "../../hardware/library";

/**
 * What is chosen in a flow on the device (docs/features/flows.md, "On the device"): a light's or a camera's keyframe,
 * the fade into one, a marker, a track. The same choices as the Studio's panel (apps/studio/src/ext/flows/inspect.tsx),
 * in the phone's controls.
 */
export const CURVE_LABELS: Record<Curve, string> = { linear: "Linear", exp: "Expo", log: "Log", s: "S-curve" };

function Part({ label, children }: { label: string; children: ReactNode }) {
  const s = useStyles();
  return <View style={s.part}><Text style={s.label}>{label}</Text>{children}</View>;
}
/**
 * A lock on the start keyframe (#426): locked, this value holds for the whole track and no other keyframe can set
 * it. The padlock shows the state.
 */
function Lock({ param, locked, onLock }: { param: LightParam; locked?: readonly LightParam[]; onLock?: (p: LightParam, on: boolean) => void }) {
  if (!onLock) return null;
  const on = !!locked?.includes(param);
  return <Chip label={on ? "Locked" : "Lock"} icon={on ? "lock" : "unlock"} selected={on} onPress={() => onLock(param, !on)} />;
}
/** A value a keyframe may set: on, it sets it; off, the value before holds. The start keyframe always sets it. */
function Channel({ label, on, fixed, toggle, lock, children }: { label: string; on: boolean; fixed?: boolean; toggle: (on: boolean) => void; /** The start keyframe's lock beside the label. */ lock?: ReactNode; children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.part}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>{fixed ? <Text style={s.label}>{label}</Text> : <Toggle label={label} value={on} onChange={toggle} />}</View>
        {lock}
      </View>
      {(on || fixed) && children}
    </View>
  );
}
/** A slider with the start keyframe's lock beside it. */
function Locked({ lock, children }: { lock?: ReactNode; children: ReactNode }) {
  const s = useStyles();
  return lock ? <View style={s.head}><View style={{ flex: 1 }}>{children}</View>{lock}</View> : <>{children}</>;
}
function Choices<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const s = useStyles();
  return <View style={s.chips}>{options.map((o) => <Chip key={String(o.value)} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />)}</View>;
}
const At = ({ kf, durationMs, onChange }: { kf: Keyframe; durationMs: number; onChange: (at: number) => void }) => (
  <Slider label="At" value={kf.at} min={SNAP_MS} max={durationMs} step={SNAP_MS} format={fmtSeconds} onChange={(v) => onChange(snap(v))} />
);
/**
 * A keyframe's margins (#426), half seconds: the least distance to the keyframes before and after it on the track; a
 * neighbour inside one is pushed. 0 removes it; the start keyframe has none before.
 */
const Margins = ({ kf, durationMs, hide, onChange }: { kf: Keyframe; durationMs: number; hide: PanelHides; onChange: (k: Keyframe) => void }) => (
  <>
    {kf.id !== START_KEYFRAME && !hide.fields.includes("marginBefore") && <Slider label="Margin before" value={kf.marginBeforeMs ?? 0} min={0} max={durationMs} step={SNAP_MS} format={(v) => (v ? fmtSeconds(v) : "none")} onChange={(v) => onChange({ ...kf, marginBeforeMs: v })} />}
    {!hide.fields.includes("marginAfter") && <Slider label="Margin after" value={kf.marginAfterMs ?? 0} min={0} max={durationMs} step={SNAP_MS} format={(v) => (v ? fmtSeconds(v) : "none")} onChange={(v) => onChange({ ...kf, marginAfterMs: v })} />}
  </>
);

export function LightKeyframe({ kf, track, durationMs, hide = NO_HIDES, onChange, onDelete, onLock }: { kf: Keyframe; track: FlowTrack; durationMs: number; /** What the account leaves out (#426). */ hide?: PanelHides; onChange: (k: Keyframe) => void; onDelete: () => void; /** A track lock set or cleared (#426), from the start keyframe. */ onLock?: (p: LightParam, on: boolean) => void }) {
  const s = useStyles();
  const kind = fixtureKind(track.model), caps = kind?.caps, m = modelOf(track.model);
  const isStart = kf.id === START_KEYFRAME;
  // The start keyframe sets the locks; on the others a locked parameter is not shown (the start's value holds).
  // Hidden for the model or left out of the sheet (#426): not shown, its lock neither; its value stays.
  const lock = (p: LightParam) => (isStart ? <Lock param={p} locked={track.locked} onLock={onLock} /> : null);
  const forModel = (p: LightParam) => !hide.params.includes(p);
  const inPanel = (p: LightParam) => forModel(p) && !hide.fields.includes(p);
  const shown = (p: LightParam) => inPanel(p) && (isStart || !track.locked?.includes(p));
  const lockedHere = (isStart ? [] : (track.locked ?? [])).filter(forModel);
  const set = (patch: Partial<Keyframe>) => onChange({ ...kf, ...patch });
  const drop = (...keys: (keyof Keyframe)[]) => { const n = { ...kf }; for (const k of keys) delete n[k]; onChange(n); };
  const mode = kf.hue !== undefined ? "colour" : kf.kelvin !== undefined ? "white" : "leave";
  const cct = caps?.cct;
  const fx = kf.effect?.id ?? null;
  const settings = fx ? effectSettingsOf(fx, kf.effect?.settings) : {};
  return (
    <View style={s.wrap}>
      {isStart ? <Hint>What the light shows when the flow starts: power, intensity and the light are always set, so a flow never starts from whatever the light showed before.</Hint>
        : !hide.fields.includes("at") && <At kf={kf} durationMs={durationMs} onChange={(at) => set({ at })} />}
      <Margins kf={kf} durationMs={durationMs} hide={hide} onChange={onChange} />
      {lockedHere.length > 0 && <Hint>{`Locked on the start keyframe for the whole track: ${lockedHere.map((p) => PARAM_LABELS[p]).join(", ")}.`}</Hint>}
      {shown("power") && <Channel label="Power" fixed={isStart} on={kf.power !== undefined} toggle={(on) => (on ? set({ power: true }) : drop("power"))} lock={lock("power")}>
        <Seg accessibilityLabel="Power" value={kf.power ? "on" : "off"} onChange={(v) => set({ power: v === "on" })} options={[{ id: "off", label: "Off" }, { id: "on", label: "On" }]} block />
      </Channel>}
      {shown("intensity") && <Channel label="Intensity" fixed={isStart} on={kf.intensity !== undefined} toggle={(on) => (on ? set({ intensity: 0.5 }) : drop("intensity"))} lock={lock("intensity")}>
        <Slider label="Intensity" value={Math.round((kf.intensity ?? 0.5) * 100)} min={0} max={100} format={(x) => `${x} %`} onChange={(x) => set({ intensity: x / 100 })} />
      </Channel>}
      {((cct && (inPanel("kelvin") || inPanel("gm"))) || (caps?.hsi && inPanel("colour"))) && (
        <Part label="Light">
          <Seg accessibilityLabel="White or colour" value={mode} block
            onChange={(v) => {
              const n: Keyframe = { ...kf };
              delete n.kelvin; delete n.gm; delete n.hue; delete n.sat;
              if (v === "white") Object.assign(n, { kelvin: cct ? Math.round((cct.min + cct.max) / 200) * 100 : 5600, gm: 0 });
              if (v === "colour") Object.assign(n, { hue: 0, sat: 1 });
              onChange(n);
            }}
            options={[...(isStart ? [] : [{ id: "leave" as const, label: "As before" }]), ...(cct && (mode === "white" || inPanel("kelvin") || inPanel("gm")) ? [{ id: "white" as const, label: "White" }] : []), ...(caps?.hsi && (mode === "colour" || inPanel("colour")) ? [{ id: "colour" as const, label: "Colour" }] : [])]} />
          {mode === "white" && cct && <>
            {shown("kelvin") && <Locked lock={lock("kelvin")}><Slider label="White" value={kf.kelvin ?? 5600} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={(x) => set({ kelvin: x })} /></Locked>}
            {cct.gm && shown("gm") && <Locked lock={lock("gm")}><Slider label="Green / magenta" value={kf.gm ?? 0} min={cct.gm.min} max={cct.gm.max} format={(x) => (x > 0 ? `+${x} M` : x < 0 ? `${-x} G` : "neutral")} onChange={(x) => set({ gm: x })} /></Locked>}
          </>}
          {/* The colour the sliders make, live, drawn as the lanes draw it (#426). */}
          {mode === "colour" && shown("colour") && <Locked lock={lock("colour")}><View style={s.colour}>
            <View style={s.colourSliders}>
              <Slider label="Hue" value={Math.round(kf.hue ?? 0)} min={0} max={360} format={(x) => `${x}°`} onChange={(x) => set({ hue: x })} />
              <Slider label="Saturation" value={Math.round((kf.sat ?? 1) * 100)} min={0} max={100} format={(x) => `${x} %`} onChange={(x) => set({ sat: x / 100 })} />
            </View>
            <View style={[s.swatch, { backgroundColor: lightColour({ mode: "colour", hue: kf.hue ?? 0, sat: kf.sat ?? 1 }) ?? undefined }]} />
          </View></Locked>}
        </Part>
      )}
      {!!caps?.effects?.length && m && shown("effect") && (
        <Channel label="Effect" on={kf.effect !== undefined} toggle={(on) => (on ? set({ effect: { id: caps.effects![0], settings: effectSettingsOf(caps.effects![0]) } }) : drop("effect"))} lock={lock("effect")}>
          <Choices value={fx ?? "off"} onChange={(v) => { const id = v === "off" ? null : (v as EffectId); set({ effect: id ? { id, settings: effectSettingsOf(id) } : { id: null } }); }}
            options={[{ value: "off", label: "Off (stop)" }, ...caps.effects.map((id) => ({ value: id as string, label: effectName(id) }))]} />
          {fx && EFFECT_OPTIONS[fx] && effectOptions(m, fx).filter((o) => optionShown(o, settings)).map((o) => o.control.kind === "choice"
            ? <Part key={o.control.id} label={o.control.label}><Choices value={o.read(settings)} onChange={(v) => set({ effect: { id: fx, settings: o.write(settings, v) } })} options={o.control.options.map((x) => ({ value: x.value as number, label: x.label }))} /></Part>
            : o.control.kind === "range" ? <Slider key={o.control.id} label={o.control.label} value={o.read(settings)} min={o.control.min} max={o.control.max} step={o.control.step}
              format={(v) => ((o.control as { max: number }).max === 11 && v === 11 ? "Random" : formatValue((o.control as { format: "plain" }).format, v))} onChange={(v) => set({ effect: { id: fx, settings: o.write(settings, v) } })} /> : null)}
        </Channel>
      )}
      {caps?.curves && shown("curve") && (
        <Channel label="Dimming curve" on={kf.curve !== undefined} toggle={(on) => (on ? set({ curve: "linear" }) : drop("curve"))} lock={lock("curve")}>
          <Choices value={kf.curve ?? "linear"} onChange={(v) => set({ curve: v as Curve })} options={CURVES.map((c) => ({ value: c as string, label: CURVE_LABELS[c] }))} />
        </Channel>
      )}
      <Hint>Values jump at the keyframe; a fade on the strip before it blends into them instead.</Hint>
      {!isStart && <Button kind="danger" icon="trash" label="Delete keyframe" onPress={onDelete} />}
    </View>
  );
}

export function CameraKeyframe({ kf, durationMs, hide = NO_HIDES, onChange, onDelete }: { kf: Keyframe; durationMs: number; /** What the account leaves out (#426): its time and margins. */ hide?: PanelHides; onChange: (k: Keyframe) => void; onDelete: () => void }) {
  const s = useStyles();
  const isStart = kf.id === START_KEYFRAME;
  const controls = kf.controls ?? {};
  const put = (id: string, v: Value | undefined) => { const c = { ...controls }; if (v === undefined) delete c[id]; else c[id] = v; onChange({ ...kf, controls: c }); };
  const first = (c: Control): Value => (c.kind === "switch" ? true : c.kind === "choice" ? c.options[0].value : c.kind === "range" || c.kind === "number" ? c.min : 0);
  return (
    <View style={s.wrap}>
      {isStart ? <Hint>What the camera does when the flow starts: it stops recording, so a flow never starts in the middle of a take.</Hint>
        : !hide.fields.includes("at") && <At kf={kf} durationMs={durationMs} onChange={(at) => onChange({ ...kf, at })} />}
      <Margins kf={kf} durationMs={durationMs} hide={hide} onChange={onChange} />
      {FLOW_CAMERA_CONTROLS.map((c) => {
        const on = controls[c.id] !== undefined, v = controls[c.id];
        return (
          <Channel key={c.id} label={`${c.group} · ${c.label}`} on={on} toggle={(x) => put(c.id, x ? first(c) : undefined)}>
            {c.kind === "switch" ? <Seg accessibilityLabel={c.label} value={v ? "on" : "off"} onChange={(x) => put(c.id, x === "on")} options={[{ id: "off", label: c.id === "record" ? "Stop" : "Off" }, { id: "on", label: c.id === "record" ? "Record" : "On" }]} block />
              : c.kind === "choice" ? <Choices value={v as number} onChange={(x) => put(c.id, x)} options={c.options.map((o) => ({ value: o.value as number, label: o.label }))} />
              : c.kind === "range" || c.kind === "number" ? <Slider label={c.label} value={Number(v)} min={c.min} max={c.max} step={c.kind === "range" ? c.step : 1} format={(x) => (c.kind === "range" ? formatValue(c.format, x) : String(x))} onChange={(x) => put(c.id, x)} /> : null}
          </Channel>
        );
      })}
      <Hint>A camera's values jump at the keyframe; they never fade.</Hint>
      {!isStart && <Button kind="danger" icon="trash" label="Delete keyframe" onPress={onDelete} />}
    </View>
  );
}

export function FadeInspect({ kf, track, onChange, onStepped }: { kf: Keyframe; track: FlowTrack; onChange: (curve: Curve | null) => void; onStepped: (stepped: boolean) => void }) {
  const s = useStyles();
  // How the fade runs is a choice only while native fades are on (off since #426).
  const native = NATIVE_FADES && !!fixtureKind(track.model)?.caps.fade;
  return (
    <View style={s.wrap}>
      <Seg accessibilityLabel="Transition" value={kf.fadeIn ? "fade" : "jump"} onChange={(v) => onChange(v === "fade" ? kf.fadeIn ?? "linear" : null)} options={[{ id: "jump", label: "Jump" }, { id: "fade", label: "Fade" }]} block />
      {kf.fadeIn && <Part label="Curve"><Choices value={kf.fadeIn} onChange={(c) => onChange(c as Curve)} options={CURVES.map((c) => ({ value: c as string, label: CURVE_LABELS[c] }))} /></Part>}
      {kf.fadeIn && native && <Part label="Run by"><Seg accessibilityLabel="How the fade runs" value={kf.fadeStepped ? "steps" : "light"} onChange={(v) => onStepped(v === "steps")} options={[{ id: "light", label: "The light" }, { id: "steps", label: "Steps" }]} block /></Part>}
      <Hint>{kf.fadeIn ? "Everything that differs between the two keyframes blends over the gap." : "The light keeps the earlier values and jumps to these at the keyframe."}</Hint>
    </View>
  );
}

export function MarkerInspect({ m, durationMs, onChange, onDelete }: { m: FlowMarker; durationMs: number; onChange: (fn: (m: FlowMarker) => FlowMarker) => void; onDelete: () => void }) {
  const s = useStyles();
  return (
    <View style={s.wrap}>
      <Part label="Name"><Input value={m.name} maxLength={MARKER_NAME_MAX} onChangeText={(name) => onChange((x) => ({ ...x, name }))} /></Part>
      <Slider label="At" value={m.at} min={0} max={durationMs} step={SNAP_MS} format={fmtSeconds} onChange={(at) => onChange((x) => ({ ...x, at, ...(x.end !== undefined && x.end <= at ? { end: Math.min(durationMs, at + SNAP_MS) } : {}) }))} />
      <Toggle label="A range" value={m.end !== undefined} onChange={(on) => onChange((x) => { const n = { ...x }; if (on) n.end = Math.min(durationMs, x.at + 2000); else delete n.end; return n; })} />
      {m.end !== undefined && <Slider label="Until" value={m.end} min={Math.min(durationMs, m.at + SNAP_MS)} max={durationMs} step={SNAP_MS} format={fmtSeconds} onChange={(end) => onChange((x) => ({ ...x, end }))} />}
      <Button kind="danger" icon="trash" label="Delete marker" onPress={onDelete} />
    </View>
  );
}

export function TrackInspect({ t, devices, onChange, onDelete }: { t: FlowTrack; devices: HardwareDevice[]; onChange: (fn: (t: FlowTrack) => FlowTrack) => void; onDelete: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const m = modelOf(t.model);
  const fits = devices.filter((d) => d.body.model === t.model);
  return (
    <View style={s.wrap}>
      <Part label="Name"><Input value={t.name} maxLength={60} onChangeText={(name) => onChange((x) => ({ ...x, name }))} /></Part>
      <Text style={s.note}>{m ? `${m.brand} ${m.model}` : t.model}</Text>
      <Part label="Drives">
        <Choices value={t.device ?? ""} onChange={(id) => onChange((x) => ({ ...x, device: id || null }))} options={[{ value: "", label: "Nothing yet" }, ...fits.map((d) => ({ value: d.id, label: d.name }))]} />
        {!fits.length && <Hint>No device of this model yet: add one in Hardware.</Hint>}
      </Part>
      <Toggle label="Muted" meta="Left out of playback and Live" value={!!t.muted} onChange={(muted) => onChange((x) => ({ ...x, muted }))} />
      <Part label="Colour">
        <View style={s.chips}>{Array.from({ length: TRACK_COLORS }, (_, i) => <Chip key={i} label={String(i + 1)} swatch={catColor(c, i + 1)} selected={(t.color ?? 0) === i} onPress={() => onChange((x) => ({ ...x, color: i }))} />)}</View>
      </Part>
      <Button kind="danger" icon="trash" label="Delete track" onPress={onDelete} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: 14, paddingBottom: 8 },
  part: { gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { ...type("label", "semibold"), color: c.text },
  note: { ...type("caption"), color: c.textDim },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colour: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  colourSliders: { flex: 1, gap: 8 },
  // A light's colour is content, like a photo: only its frame is a token.
  swatch: { width: 80, minHeight: 64, borderRadius: 8, borderWidth: 1, borderColor: c.border },
}));
