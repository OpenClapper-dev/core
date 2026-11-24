/**
 * A light's built-in effects as controls (docs/features/hardware.md): the options of each effect (EFFECT_OPTIONS,
 * from the makers' apps) turned into the catalogue's control kinds, so the Studio and the phone draw them alike
 * and build the same `effect` command. Steps run 1..10; 11 is Random where the effect allows it.
 */
import { EFFECT_OPTIONS, effectSettingsOf, type EffectId, type EffectSettings } from "./lighting.ts";
import type { Control, Model } from "./catalogue.ts";
import type { LightCommand } from "./lightProxy.ts";

/** One option as a control; `read`/`write` map it onto the effect's settings. */
export interface EffectOption { control: Control; read(s: EffectSettings): number; write(s: EffectSettings, v: number): EffectSettings }

const range = (id: string, label: string, min: number, max: number, step: number, format: "plain" | "percent" | "kelvin" | "steps" | "degrees"): Control =>
  ({ id, label, group: "Effect", kind: "range", min, max, step, format: format === "steps" ? "plain" : format, ...(format === "steps" && max === 11 ? { hint: "11: the light varies it at random." } : {}) } as Control);

/** The options of an effect on a model (the white range is the model's). */
export function effectOptions(m: Model, effect: EffectId): EffectOption[] {
  const spec = EFFECT_OPTIONS[effect];
  if (!spec) return [];
  const white = m.controls.find((c) => c.id === "kelvin") as { min: number; max: number } | undefined;
  const lo = white?.min ?? 2700, hi = white?.max ?? 6500;
  const out: EffectOption[] = [];
  for (const o of spec.options) {
    switch (o.key) {
      case "frequency": case "speed":
        out.push({ control: range(o.key, o.label, 1, o.max, 1, "steps"), read: (s) => s[o.key] ?? 5, write: (s, v) => ({ ...s, [o.key]: v }) });
        break;
      case "ember":
        out.push({ control: range("ember", o.label, 1, 10, 1, "plain"), read: (s) => s.ember ?? 5, write: (s, v) => ({ ...s, ember: v }) });
        break;
      case "intensityRange":
        out.push({ control: range("intensityMin", `${o.label}, from`, 0, 1, 0.01, "percent"), read: (s) => s.intensityMin ?? 0, write: (s, v) => ({ ...s, intensityMin: Math.min(v, s.intensityMax ?? 1) }) });
        out.push({ control: range("intensityMax", `${o.label}, to`, 0, 1, 0.01, "percent"), read: (s) => s.intensityMax ?? 0.5, write: (s, v) => ({ ...s, intensityMax: Math.max(v, s.intensityMin ?? 0) }) });
        break;
      case "kelvinRange":
        out.push({ control: range("kelvin", `${o.label}, from`, lo, hi, 50, "kelvin"), read: (s) => s.kelvin ?? lo, write: (s, v) => ({ ...s, kelvin: Math.min(v, s.kelvinMax ?? hi) }) });
        out.push({ control: range("kelvinMax", `${o.label}, to`, lo, hi, 50, "kelvin"), read: (s) => s.kelvinMax ?? hi, write: (s, v) => ({ ...s, kelvinMax: Math.max(v, s.kelvin ?? lo) }) });
        break;
      case "kelvin":
        out.push({ control: range("kelvin", o.label, lo, hi, 50, "kelvin"), read: (s) => s.kelvin ?? 5600, write: (s, v) => ({ ...s, kelvin: v }) });
        break;
      case "saturation":
        out.push({ control: range("saturation", o.label, 0, 1, 0.01, "percent"), read: (s) => s.saturation ?? 1, write: (s, v) => ({ ...s, saturation: v }) });
        break;
      case "choice":
        out.push({ control: { id: "choice", label: o.label, group: "Effect", kind: "choice", display: o.values.length > 3 ? "select" : "segmented", options: o.values.map((label, value) => ({ value, label })) }, read: (s) => s.choice ?? 0, write: (s, v) => ({ ...s, choice: v }) });
        break;
      case "color":
        // White at a temperature, or a colour: a choice, then the values of the one chosen.
        out.push({ control: { id: "colorMode", label: o.label, group: "Effect", kind: "choice", display: "segmented", options: [{ value: 0, label: "White" }, { value: 1, label: "Colour" }] },
          read: (s) => (s.color && "kelvin" in s.color ? 0 : 1), write: (s, v) => ({ ...s, color: v === 0 ? { kelvin: 5600 } : { h: 0, s: 1 } }) });
        out.push({ control: range("colorKelvin", "White", lo, hi, 50, "kelvin"), read: (s) => (s.color && "kelvin" in s.color ? s.color.kelvin : 5600), write: (s, v) => ({ ...s, color: { kelvin: v } }) });
        out.push({ control: range("colorHue", "Hue", 0, 360, 1, "degrees"), read: (s) => (s.color && "h" in s.color ? s.color.h : 0), write: (s, v) => ({ ...s, color: { h: v, s: s.color && "s" in s.color ? s.color.s : 1 } }) });
        out.push({ control: range("colorSat", "Saturation", 0, 1, 0.01, "percent"), read: (s) => (s.color && "s" in s.color ? s.color.s : 1), write: (s, v) => ({ ...s, color: { h: s.color && "h" in s.color ? s.color.h : 0, s: v } }) });
        break;
    }
  }
  return out;
}

/** Which colour options show: those of the colour mode chosen. */
export const optionShown = (o: EffectOption, s: EffectSettings) =>
  o.control.id === "colorKelvin" ? !!s.color && "kelvin" in s.color : o.control.id === "colorHue" || o.control.id === "colorSat" ? !s.color || !("kelvin" in s.color) : true;

/** The command that runs an effect with its settings (defaults filled in), or stops it. */
export const effectCommand = (effect: EffectId | null, settings?: EffectSettings): LightCommand =>
  effect ? { op: "effect", effect, settings: effectSettingsOf(effect, settings) } : { op: "effect", effect: null };
