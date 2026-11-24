import { useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  OUTPUT_ROWS, OUTPUTS, REPORT_HOLD_MS, controlCommand, controlValue, effectCommand, effectOptions, effectsOf, formatValue, optionShown, outputBits, outputCommand,
  type Control, type EffectId, type EffectSettings, type FixtureLive, type LightCommand, type Model, type Value,
} from "@openclapper/ext-hardware";
import { Button, Chip, ChipRow, Hint, Input, ListRow, makeStyles, Row, Seg, Sheet, SheetList, Slider, Toggle, type, useTheme, type IconName } from "../../../ui";

/**
 * The controls of a device as its catalogue model declares them (docs/features/hardware.md), in the phone's touch
 * form; the Studio draws the same list. A value set here shows at once and wins over the device's reports for
 * REPORT_HOLD_MS, so a slider does not jump back while the device catches up.
 */
export function useHeld() {
  const held = useRef(new Map<string, { v: Value; at: number }>());
  const [, tick] = useState(0);
  return {
    get: (id: string, reported: Value | undefined) => { const h = held.current.get(id); return h && Date.now() - h.at < REPORT_HOLD_MS ? h.v : reported; },
    set: (id: string, v: Value) => { held.current.set(id, { v, at: Date.now() }); tick((t) => t + 1); setTimeout(() => tick((t) => t + 1), REPORT_HOLD_MS + 50); },
  };
}
type Held = ReturnType<typeof useHeld>;

export function ControlView({ m, c, live, send, held, disabled }: { m: Model; c: Control; live: FixtureLive | undefined; send: (cmd: LightCommand) => void; held: Held; disabled: boolean }) {
  const value = held.get(c.id, controlValue(m, c, live));
  const set = (v: Value) => { held.set(c.id, v); const cmd = controlCommand(m, c, v, live); if (cmd) send(cmd); };
  switch (c.kind) {
    case "switch": return <Toggle label={c.label} meta={c.hint} value={!!value} disabled={disabled} onChange={set} />;
    case "range": return <View><Slider label={c.label} value={Number(value ?? c.min)} min={c.min} max={c.max} step={c.step} format={(v) => formatValue(c.format, v)} disabled={disabled} onChange={set} />{c.hint ? <Hint>{c.hint}</Hint> : null}</View>;
    case "choice": return <Choice label={c.label} options={c.options} display={c.display} value={value === undefined ? null : Number(value)} disabled={disabled} onChange={set} />;
    case "number": return <NumberRow label={c.label} unit={c.unit} min={c.min} max={c.max} value={Number(value ?? c.min)} disabled={disabled} onChange={set} hint={c.hint} />;
    case "text": return <TextRow label={c.label} max={c.maxLength} value={String(value ?? "")} disabled={disabled} onChange={set} />;
    case "button": return <Button kind={c.tone === "danger" ? "danger" : c.tone === "primary" ? "primary" : "secondary"} icon={(c.icon ?? undefined) as IconName | undefined} label={c.label} disabled={disabled} onPress={() => set(true)} />;
    case "colour": return <Colour live={live} send={send} held={held} disabled={disabled} />;
    case "effect": return <Effects m={m} live={live} send={send} disabled={disabled} />;
    case "outputs": return <Outputs live={live} send={send} disabled={disabled} />;
  }
}

function Choice({ label, options, display, value, onChange, disabled }: { label: string; options: readonly { value: number; label: string }[]; display: "select" | "segmented"; value: number | null; onChange: (v: number) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  if (display === "segmented" && options.length <= 4) {
    return <Row label={label}><Seg block disabled={disabled} accessibilityLabel={label} value={value === null ? null : String(value)} onChange={(v) => onChange(Number(v))} options={options.map((o) => ({ id: String(o.value), label: o.label }))} /></Row>;
  }
  const cur = options.find((o) => o.value === value);
  return (
    <>
      <ListRow title={label} meta={cur?.label ?? "Not reported"} trailing={null} disabled={disabled} onPress={() => setOpen(true)} />
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <SheetList>{options.map((o) => <ListRow key={o.value} title={o.label} selected={o.value === value} onPress={() => { onChange(o.value); setOpen(false); }} />)}</SheetList>
      </Sheet>
    </>
  );
}

function NumberRow({ label, unit, min, max, value, onChange, disabled, hint }: { label: string; unit?: string; min: number; max: number; value: number; onChange: (v: number) => void; disabled: boolean; hint?: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { const v = Math.round(Number(text)); if (text !== null && Number.isFinite(v) && v >= min && v <= max) onChange(v); setText(null); };
  return (
    <View>
      <Row label={unit ? `${label} (${unit})` : label}>
        <Input editable={!disabled} keyboardType="number-pad" value={text ?? String(value)} onChangeText={setText} onEndEditing={commit} onSubmitEditing={commit} accessibilityLabel={label} />
      </Row>
      {hint ? <Hint>{hint}</Hint> : null}
    </View>
  );
}

function TextRow({ label, max, value, onChange, disabled }: { label: string; max: number; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text !== null && text !== value) onChange(text.slice(0, max)); setText(null); };
  return <Row label={label}><Input editable={!disabled} maxLength={max} value={text ?? value} onChangeText={setText} onEndEditing={commit} onSubmitEditing={commit} accessibilityLabel={label} /></Row>;
}

/** A light's colour: hue and saturation at its intensity (the MC's HSI). */
function Colour({ live, send, held, disabled }: { live: FixtureLive | undefined; send: (c: LightCommand) => void; held: Held; disabled: boolean }) {
  const s = useStyles();
  const st = { ...live?.telemetry?.state, ...live?.state };
  const h = Number(held.get("hue", st.hsi?.h ?? 0)), sat = Number(held.get("sat", st.hsi?.s ?? 1)), i = st.intensity ?? st.hsi?.i ?? 0.5;
  const go = (nh: number, ns: number) => send({ op: "hsi", h: nh, s: ns, i });
  return (
    <View>
      <View style={[s.swatch, { backgroundColor: `hsl(${h}, ${Math.round(sat * 100)}%, 50%)` }]} />
      <Slider label="Hue" value={h} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} disabled={disabled} onChange={(v) => { held.set("hue", v); go(v, sat); }} />
      <Slider label="Saturation" value={sat} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} disabled={disabled} onChange={(v) => { held.set("sat", v); go(h, v); }} />
      <Hint>Setting a colour leaves white; setting white leaves the colour.</Hint>
    </View>
  );
}

/** The built-in effects with their options; Off ends the effect (a white frame, on NEEWER lights). */
function Effects({ m, live, send, disabled }: { m: Model; live: FixtureLive | undefined; send: (c: LightCommand) => void; disabled: boolean }) {
  const st = { ...live?.telemetry?.state, ...live?.state };
  const [effect, setEffect] = useState<EffectId | null>((st.effect as EffectId | null | undefined) ?? null);
  const [settings, setSettings] = useState<EffectSettings>(st.effectSettings ?? {});
  const run = (e: EffectId | null, s: EffectSettings) => { setEffect(e); setSettings(s); send(effectCommand(e, s)); };
  const opts = effect ? effectOptions(m, effect) : [];
  return (
    <View>
      <ChipRow>
        <Chip label="Off" selected={!effect} disabled={disabled} onPress={() => run(null, {})} />
        {effectsOf(m).map((e) => <Chip key={e.id} label={e.name} selected={effect === e.id} disabled={disabled} onPress={() => run(e.id, {})} />)}
      </ChipRow>
      {opts.filter((o) => optionShown(o, settings)).map((o) => (
        <ControlLike key={o.control.id} c={o.control} value={o.read(settings)} disabled={disabled} onChange={(v) => run(effect, o.write(settings, v))} />
      ))}
    </View>
  );
}
/** An effect option: a range or a choice on a value the screen keeps. */
function ControlLike({ c, value, onChange, disabled }: { c: Control; value: number; onChange: (v: number) => void; disabled: boolean }) {
  if (c.kind === "choice") return <Choice label={c.label} options={c.options} display={c.display} value={value} disabled={disabled} onChange={onChange} />;
  if (c.kind !== "range") return null;
  return <View><Slider label={c.label} value={value} min={c.min} max={c.max} step={c.step} format={(v) => (c.max === 11 && v === 11 ? "Random" : formatValue(c.format, v))} disabled={disabled} onChange={onChange} />{c.hint ? <Hint>{c.hint}</Hint> : null}</View>;
}

/** The camera's tools and overlays per output; the camera does not report them, so unknown ones show dimmed. */
function Outputs({ live, send, disabled }: { live: FixtureLive | undefined; send: (c: LightCommand) => void; disabled: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const unknown = OUTPUTS.some((o) => outputBits(live, "4.1", o.bit) === undefined || outputBits(live, "3.0", o.bit) === undefined);
  return (
    <View>
      {OUTPUT_ROWS.map((r) => (
        <View key={r.label} style={s.outRow}>
          <Text style={s.outLabel}>{r.label}</Text>
          {OUTPUTS.map((o) => {
            const bits = outputBits(live, r.key, o.bit);
            return <Chip key={o.id} label={o.label} selected={!!((bits ?? 0) & r.bit)} disabled={disabled} swatch={bits === undefined ? c.textDisabled : undefined} onPress={() => send(outputCommand(live, r.key, r.bit, o.bit))} />;
          })}
        </View>
      ))}
      <Hint>{unknown ? "The camera does not report these: greyed ones are unknown until set from here. Switching one also sets the unknown ones of its group on that output to off." : "The camera does not report these: they show what was set from here."}</Hint>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  swatch: { height: 24, borderRadius: 6, marginVertical: 8, borderWidth: 1, borderColor: c.border },
  outRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  outLabel: { ...type("body"), color: c.text, flex: 1 },
}));
