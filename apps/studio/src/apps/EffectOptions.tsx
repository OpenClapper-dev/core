import { EFFECT_OPTIONS, EFFECT_RANDOM, type EffectId, type EffectSettings, type FixtureKind } from "@openclapper/vocab";
import { Seg, Select } from "@openclapper/ui";
import { Range } from "../compose/editor";

const stepLabel = (x: number, max: number, cycles?: boolean) => (max === 11 && x >= EFFECT_RANDOM ? "Random" : cycles && x > 5 ? `Cycle ${x - 5}` : String(x));

/**
 * An effect's options (speed, white, sparks, ranges, colour…), as the maker's app shows them: in a
 * light's Devices panel and in a sequence keyframe (#321). `settings` comes with the defaults filled in.
 */
export function EffectOptionFields({ fx, settings: o, cct, onChange: set }: { fx: EffectId; settings: EffectSettings; cct: FixtureKind["caps"]["cct"]; onChange: (s: EffectSettings) => void }) {
  const spec = EFFECT_OPTIONS[fx];
  if (!spec) return null;
  const mid = cct ? Math.round((cct.min + cct.max) / 200) * 100 : 5600;
  const kelvin = (label: string, value: number, on: (k: number) => void) => cct
    ? <Range key={label} label={label} value={value} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={on} />
    : null;
  return <>{spec.options.map((opt) => {
        switch (opt.key) {
          case "frequency":
          case "speed":
            return <Range key={opt.key} label={opt.label} value={o[opt.key] ?? 5} min={1} max={opt.max} step={1} format={(x) => stepLabel(x, opt.max, opt.cycles)} onChange={(x) => set({ ...o, [opt.key]: x })} />;
          case "kelvin":
            return kelvin(`Effect ${opt.label.toLowerCase()}`, o.kelvin ?? mid, (k) => set({ ...o, kelvin: k }));
          case "ember":
            return <Range key={opt.key} label={opt.label} value={o.ember ?? 5} min={1} max={10} step={1} onChange={(x) => set({ ...o, ember: x })} />;
          case "intensityRange":
            return (
              <div key={opt.key} class="devices-field">
                <Range label={`${opt.label}: from`} value={Math.round((o.intensityMin ?? 0) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, intensityMin: x / 100, intensityMax: Math.max(x / 100, o.intensityMax ?? 0.5) })} />
                <Range label={`${opt.label}: to`} value={Math.round((o.intensityMax ?? 0.5) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, intensityMax: x / 100, intensityMin: Math.min(x / 100, o.intensityMin ?? 0) })} />
              </div>
            );
          case "kelvinRange":
            return cct ? (
              <div key={opt.key} class="devices-field">
                <Range label={`${opt.label}: from`} value={o.kelvin ?? cct.min} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={(x) => set({ ...o, kelvin: x, kelvinMax: Math.max(x, o.kelvinMax ?? cct.max) })} />
                <Range label={`${opt.label}: to`} value={o.kelvinMax ?? cct.max} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={(x) => set({ ...o, kelvinMax: x, kelvin: Math.min(x, o.kelvin ?? cct.min) })} />
              </div>
            ) : null;
          case "saturation":
            return <Range key={opt.key} label={opt.label} value={Math.round((o.saturation ?? 1) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, saturation: x / 100 })} />;
          case "choice":
            return (
              <Select key={opt.key} label={opt.label} prefix={opt.label} value={String(o.choice ?? 0)} onChange={(x) => set({ ...o, choice: Number(x) })}
                options={opt.values.map((label, i) => ({ value: String(i), label }))} />
            );
          case "color": {
            const color = o.color ?? { h: 0, s: 1 };
            return (
              <div key={opt.key} class="devices-field">
                <Seg label="Effect colour" value={"kelvin" in color ? "white" : "colour"} options={[{ id: "white", label: "White" }, { id: "colour", label: "Colour" }]}
                  onChange={(m) => set({ ...o, color: m === "white" ? { kelvin: mid } : { h: 0, s: 1 } })} />
                {"kelvin" in color ? kelvin("Effect white", color.kelvin, (k) => set({ ...o, color: { kelvin: k } })) : (
                  <>
                    <Range label="Effect hue" value={Math.round(color.h)} min={0} max={360} step={1} format={(x) => `${x}°`} onChange={(x) => set({ ...o, color: { ...color, h: x } })} />
                    <Range label="Effect saturation" value={Math.round(color.s * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, color: { ...color, s: x / 100 } })} />
                  </>
                )}
              </div>
            );
          }
          default: return null;
        }
  })}</>;
}
