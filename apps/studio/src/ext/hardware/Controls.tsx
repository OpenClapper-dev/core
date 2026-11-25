// A device's controls as its catalogue model declares them (docs/features/hardware.md), in the Studio; the phone draws
// the same list in its touch form. A value set here shows at once and wins over the device's reports for
// REPORT_HOLD_MS, so a slider does not jump back while the device catches up.
import { useRef, useState } from "preact/hooks";
import { Button, Chip, NumberInput, Segmented, Select, Slider, Switch, TextInput, cx, type IconName } from "@openclapper/design";
import {
  OUTPUT_ROWS, OUTPUTS, REPORT_HOLD_MS, controlCommand, controlValue, effectCommand, effectOptions, effectsOf, formatValue, optionShown, outputBits, outputCommand,
  type Control, type EffectId, type EffectSettings, type FixtureLive, type LightCommand, type Model, type Value,
} from "@openclapper/ext-hardware";

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
    case "switch": return <div className="hw-ctl hw-ctl--switch" title={c.hint}><Switch checked={!!value} disabled={disabled} onChange={set}>{c.label}</Switch></div>;
    case "range": return <Range label={c.label} hint={c.hint} value={Number(value ?? c.min)} min={c.min} max={c.max} step={c.step} format={(v) => formatValue(c.format, v)} disabled={disabled} onChange={set} />;
    case "choice": return <Choice label={c.label} options={c.options} display={c.display} value={value === undefined ? null : Number(value)} disabled={disabled} onChange={set} />;
    case "number": return <label className="hw-ctl" title={c.hint}><small>{c.unit ? `${c.label} (${c.unit})` : c.label}</small><NumberInput size="sm" value={Number(value ?? c.min)} min={c.min} max={c.max} disabled={disabled} onChange={(v: number) => { if (Number.isFinite(v) && v >= c.min && v <= c.max) set(Math.round(v)); }} /></label>;
    case "text": return <TextCtl label={c.label} max={c.maxLength} value={String(value ?? "")} disabled={disabled} onChange={set} />;
    case "button": return <div className="hw-ctl hw-ctl--button" title={c.hint}><Button size="sm" variant={c.tone === "primary" ? "primary" : c.tone === "danger" ? "danger" : "secondary"} icon={c.icon as IconName | undefined} disabled={disabled} onClick={() => set(true)}>{c.label}</Button></div>;
    case "colour": return <Colour live={live} send={send} held={held} disabled={disabled} />;
    case "effect": return <Effects m={m} live={live} send={send} disabled={disabled} />;
    case "outputs": return <Outputs live={live} send={send} disabled={disabled} />;
  }
}

function Range({ label, hint, value, min, max, step, format, onChange, disabled }: { label: string; hint?: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="hw-ctl hw-ctl--range" title={hint}>
      <small>{label}<b>{format(value)}</b></small>
      <Slider value={value} min={min} max={max} step={step} disabled={disabled} onChange={onChange} aria-label={label} />
    </label>
  );
}

function Choice({ label, options, display, value, onChange, disabled }: { label: string; options: readonly { value: number; label: string }[]; display: "select" | "segmented"; value: number | null; onChange: (v: number) => void; disabled: boolean }) {
  if (display === "segmented") return <div className="hw-ctl"><small>{label}</small><Segmented label={label} value={value === null ? "" : String(value)} disabled={disabled} onChange={(v: string) => onChange(Number(v))} options={options.map((o) => ({ value: String(o.value), label: o.label }))} /></div>;
  const known = options.some((o) => o.value === value);
  return (
    <div className="hw-ctl"><small>{label}</small>
      <Select size="sm" aria-label={label} disabled={disabled} value={value === null ? "" : String(value)} onChange={(v: string) => onChange(Number(v))}
        options={[...(value === null ? [{ value: "", label: "Not reported" }] : !known ? [{ value: String(value), label: `Other (${value})` }] : []), ...options.map((o) => ({ value: String(o.value), label: o.label }))]} />
    </div>
  );
}

function TextCtl({ label, max, value, onChange, disabled }: { label: string; max: number; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => { if (text !== null && text !== value) onChange(text.slice(0, max)); setText(null); };
  return <label className="hw-ctl"><small>{label}</small><TextInput size="sm" maxLength={max} value={text ?? value} disabled={disabled} onInput={(e) => setText(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} /></label>;
}

/** A light's colour: hue and saturation at its intensity (the MC's HSI). */
function Colour({ live, send, held, disabled }: { live: FixtureLive | undefined; send: (c: LightCommand) => void; held: Held; disabled: boolean }) {
  const st = { ...live?.telemetry?.state, ...live?.state };
  const h = Number(held.get("hue", st.hsi?.h ?? 0)), sat = Number(held.get("sat", st.hsi?.s ?? 1)), i = st.intensity ?? st.hsi?.i ?? 0.5;
  const go = (nh: number, ns: number) => send({ op: "hsi", h: nh, s: ns, i });
  return (
    <div className="hw-ctl hw-colour">
      <i className="hw-swatch" style={{ background: `hsl(${h} ${Math.round(sat * 100)}% 50%)` }} />
      <Range label="Hue" value={h} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} disabled={disabled} onChange={(v) => { held.set("hue", v); go(v, sat); }} />
      <Range label="Saturation" value={sat} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} disabled={disabled} onChange={(v) => { held.set("sat", v); go(h, v); }} />
    </div>
  );
}

/** The built-in effects with their options; Off ends the effect. */
function Effects({ m, live, send, disabled }: { m: Model; live: FixtureLive | undefined; send: (c: LightCommand) => void; disabled: boolean }) {
  const st = { ...live?.telemetry?.state, ...live?.state };
  const [effect, setEffect] = useState<EffectId | null>((st.effect as EffectId | null | undefined) ?? null);
  const [settings, setSettings] = useState<EffectSettings>(st.effectSettings ?? {});
  const run = (e: EffectId | null, s: EffectSettings) => { setEffect(e); setSettings(s); send(effectCommand(e, s)); };
  const opts = effect ? effectOptions(m, effect) : [];
  return (
    <div className="hw-ctl hw-effects">
      <div className="hw-chips">
        <Chip selected={!effect} disabled={disabled} onToggle={() => run(null, {})}>Off</Chip>
        {effectsOf(m).map((e) => <Chip key={e.id} selected={effect === e.id} disabled={disabled} onToggle={() => run(e.id, {})}>{e.name}</Chip>)}
      </div>
      <div className="hw-opts">
        {opts.filter((o) => optionShown(o, settings)).map((o) => o.control.kind === "choice"
          ? <Choice key={o.control.id} label={o.control.label} options={o.control.options} display={o.control.display} value={o.read(settings)} disabled={disabled} onChange={(v) => run(effect, o.write(settings, v))} />
          : o.control.kind === "range" ? <Range key={o.control.id} label={o.control.label} hint={o.control.hint} value={o.read(settings)} min={o.control.min} max={o.control.max} step={o.control.step}
            format={(v) => ((o.control as { max: number }).max === 11 && v === 11 ? "Random" : formatValue((o.control as { format: "plain" }).format, v))} disabled={disabled} onChange={(v) => run(effect, o.write(settings, v))} /> : null)}
      </div>
    </div>
  );
}

/** The camera's tools and overlays per output; the camera does not report them, so unknown ones are dimmed. */
function Outputs({ live, send, disabled }: { live: FixtureLive | undefined; send: (c: LightCommand) => void; disabled: boolean }) {
  const unknown = OUTPUTS.some((o) => outputBits(live, "4.1", o.bit) === undefined || outputBits(live, "3.0", o.bit) === undefined);
  return (
    <div className="hw-ctl hw-outputs">
      <table>
        <thead><tr><th />{OUTPUTS.map((o) => <th key={o.id}>{o.label}</th>)}</tr></thead>
        <tbody>{OUTPUT_ROWS.map((r) => (
          <tr key={r.label}><td>{r.label}</td>{OUTPUTS.map((o) => {
            const bits = outputBits(live, r.key, o.bit);
            return <td key={o.id} className={cx(bits === undefined && "is-unknown")} title={bits === undefined ? "Unknown: not set from here since the device app started" : undefined}><Switch checked={!!((bits ?? 0) & r.bit)} disabled={disabled} onChange={() => send(outputCommand(live, r.key, r.bit, o.bit))} aria-label={`${r.label} on ${o.label}`} /></td>;
          })}</tr>
        ))}</tbody>
      </table>
      <small>{unknown ? "The camera does not report these: dimmed ones are unknown until set from here. Switching one also sets the dimmed ones of its group on that output to off." : "The camera does not report these: they show what was set from here."}</small>
    </div>
  );
}
