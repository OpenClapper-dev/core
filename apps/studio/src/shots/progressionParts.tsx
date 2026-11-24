// Parts of a shot's progression (docs/features/shots.md): the clock format, and the default frame's chooser
// (none, a preset with a focal length, free-form values, or an aspect ratio).
import { Button, NumberInput, Popover, Segmented, Select, Slider, cx } from "@openclapper/design";
import { DELIVERIES, FORMATS, SQUEEZES } from "@openclapper/fov-math";
import type { FrameValues } from "@openclapper/model";
import type { Preset } from "../optics";
import { describeFrame } from "./picture";

/** A time in ms as "2.0 s", or "1:05.0" from a minute on. */
export function clock(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

const int = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** The values a new default frame of each kind starts with. */
export function startFrame(kind: string, presets: readonly Preset[]): FrameValues | null {
  if (kind === "aspect") return { kind: "aspect", aspect: 2.39, size: 0.8, portrait: false };
  if (kind === "free") return { kind: "free", format: [24.89, 13.87], multiplier: 1, squeeze: 1, delivery: null, focal: 35, portrait: false };
  const p = presets.find((x) => !x.body.archived);
  if (kind === "preset" && p) return { kind: "preset", preset: p.id, focal: p.body.lenses.kind === "primes" ? [...p.body.lenses.primes].sort((a, b) => a - b)[0] : p.body.lenses.from, portrait: false };
  return null;
}

/** Focal lengths of a preset as chips (primes) or a slider (a zoom). */
export function FocalPick({ preset, value, onChange }: { preset: Preset; value: number; onChange: (mm: number) => void }) {
  const l = preset.body.lenses;
  return l.kind === "primes"
    ? <span className="sh-chipset">{[...l.primes].sort((a, b) => a - b).map((mm) => <button type="button" key={mm} className={cx(value === mm && "is-on")} onClick={() => onChange(mm)}>{mm}</button>)}</span>
    : <span className="sh-bar" style={{ flex: 1 }}><Slider min={l.from} max={l.to} step={1} value={value} onChange={onChange} /><b className="oc-num">{value} mm</b></span>;
}

export function DefaultFrame({ value, presets, onChange }: { value: FrameValues | null; presets: readonly Preset[]; onChange: (v: FrameValues | null) => void }) {
  const live = presets.filter((p) => !p.body.archived || p.id === value?.preset);
  const preset = value?.kind === "preset" ? presets.find((p) => p.id === value.preset) : undefined;
  const set = (c: Partial<FrameValues>) => value && onChange({ ...value, ...c });
  return (
    <Popover trigger={<Button size="sm" variant={value ? "secondary" : "quiet"} icon="frame" iconAfter="chevron-down">{value ? describeFrame(value, (id) => presets.find((p) => p.id === id)?.name) : "No default frame"}</Button>}>
      <div className="sh-pop">
        <Segmented label="Default frame" value={value?.kind ?? "none"} onChange={(k) => onChange(k === "none" ? null : startFrame(k, presets))}
          options={[{ value: "none", label: "None" }, ...(live.length ? [{ value: "preset", label: "Preset" }] : []), { value: "free", label: "Free" }, { value: "aspect", label: "Aspect" }]} />
        {value?.kind === "preset" && (
          <>
            <Select size="sm" value={value.preset ?? ""} onChange={(id) => { const p = presets.find((x) => x.id === id); if (p) onChange(startFrame("preset", [p])); }} options={live.map((p) => ({ value: p.id, label: p.name }))} />
            {preset && <FocalPick preset={preset} value={value.focal ?? 0} onChange={(mm) => set({ focal: mm })} />}
          </>
        )}
        {value?.kind === "free" && (
          <>
            <Select size="sm" value={`${value.format![0]}x${value.format![1]}`} onChange={(v) => { const [w, h] = v.split("x").map(Number); set({ format: [w, h] }); }}
              options={FORMATS.map((x) => ({ value: `${x.w}x${x.h}`, label: `${x.name} · ${x.w} × ${x.h} mm` }))} />
            <span className="sh-pair"><NumberInput size="sm" value={value.focal ?? 35} unit="mm" min={1} max={2000} aria-label="Focal length" onChange={(v) => set({ focal: int(v, 1, 2000) })} /><NumberInput size="sm" value={value.multiplier ?? 1} step={0.01} min={0.2} max={5} unit="×" aria-label="Multiplier" onChange={(v) => set({ multiplier: v })} /></span>
            <span className="sh-pair">
              <Select size="sm" value={String(value.squeeze ?? 1)} onChange={(v) => set({ squeeze: Number(v) })} options={SQUEEZES.map((x) => ({ value: String(x), label: x === 1 ? "Spherical" : `${x}× squeeze` }))} />
              <Select size="sm" value={value.delivery ? String(value.delivery) : ""} onChange={(v) => set({ delivery: v ? Number(v) : null })} options={[{ value: "", label: "As seen" }, ...DELIVERIES.map((d) => ({ value: String(d.ratio), label: d.label }))]} />
            </span>
          </>
        )}
        {value?.kind === "aspect" && (
          <>
            <Select size="sm" value={String(value.aspect)} onChange={(v) => set({ aspect: Number(v) })} options={DELIVERIES.map((d) => ({ value: String(d.ratio), label: d.label }))} />
            <span className="sh-bar"><Slider min={10} max={100} step={1} value={Math.round((value.size ?? 0.8) * 100)} onChange={(v) => set({ size: v / 100 })} /><b className="oc-num">{Math.round((value.size ?? 0.8) * 100)} %</b></span>
          </>
        )}
        <p className="sh-hint">Applied, centred, to pictures that have an angle of view and no frame of their own. A picture that is one frame of a canvas keeps that frame.</p>
      </div>
    </Popover>
  );
}
