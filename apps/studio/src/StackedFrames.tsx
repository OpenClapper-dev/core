import { COMPOSE_PALETTE } from "@openclapper/vocab";
import type { Photo, Preset } from "./api";
import { imageAspect, type FrameGeometry } from "./format";
import { Button, Checkbox, IconButton, Select } from "@openclapper/ui";
import { AS_SHOT, choiceLabel, frameForChoice, Pickers, type RigChoice } from "./RigExplorer";

/**
 * Framing stage → Stacked (issue #47): one photo, any number of rig + lens frames drawn over it, each
 * in its own colour, optionally named at a chosen corner. Ad hoc: nothing is saved. Frames share the
 * Framing view's centre (clamped per frame), so a stack shows what each rig would see from one spot.
 */

export type LabelPlace = "in-tl" | "in-tr" | "in-bl" | "in-br" | "out-tl" | "out-tr" | "out-bl" | "out-br";
export const LABEL_PLACES: { value: LabelPlace; label: string }[] = [
  { value: "in-tl", label: "Inside, top left" }, { value: "in-tr", label: "Inside, top right" },
  { value: "in-bl", label: "Inside, bottom left" }, { value: "in-br", label: "Inside, bottom right" },
  { value: "out-tl", label: "Outside, above left" }, { value: "out-tr", label: "Outside, above right" },
  { value: "out-bl", label: "Outside, below left" }, { value: "out-br", label: "Outside, below right" },
];

export interface StackLayer { id: string; choice: RigChoice; color: string }
export interface StackState { layers: StackLayer[]; names: boolean; place: LabelPlace }

// Drawn over photos, so the colours are the fixed compose palette, never the theme (white and black skipped first).
const COLORS = [COMPOSE_PALETTE[2], COMPOSE_PALETTE[6], COMPOSE_PALETTE[4], COMPOSE_PALETTE[5], COMPOSE_PALETTE[8], COMPOSE_PALETTE[3], COMPOSE_PALETTE[7], COMPOSE_PALETTE[0]];
const nextColor = (used: string[]) => COLORS.find((c) => !used.includes(c)) ?? COLORS[used.length % COLORS.length];
/** Readable text on a frame colour. */
const inkOn = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140 ? "#0B0B0C" : "#FFFFFF"; };

export function initialStack(a: RigChoice, b: RigChoice): StackState {
  return { layers: [{ id: crypto.randomUUID(), choice: a, color: COLORS[0] }, { id: crypto.randomUUID(), choice: b, color: COLORS[1] }], names: false, place: "in-tl" };
}

interface Props { photo: Photo; presets: Preset[]; centre: { x: number; y: number }; stack: StackState; onStack: (s: StackState) => void }

/** The bar controls of the stacked view: names on/off, where they go, another frame. */
export function StackBar({ stack, onStack }: { stack: StackState; onStack: (s: StackState) => void }) {
  const add = () => {
    const last = stack.layers.at(-1);
    onStack({ ...stack, layers: [...stack.layers, { id: crypto.randomUUID(), choice: last?.choice ?? { rig: AS_SHOT, lensMm: 35 }, color: nextColor(stack.layers.map((l) => l.color)) }] });
  };
  return (
    <>
      <Checkbox checked={stack.names} role="checkbox" aria-checked={stack.names} onClick={() => onStack({ ...stack, names: !stack.names })}>Rig names</Checkbox>
      {stack.names && <Select label="Name placement" icon="label-outline" width="210px" value={stack.place} onChange={(v) => onStack({ ...stack, place: v as LabelPlace })} options={LABEL_PLACES} />}
      <Button size="sm" kind="secondary" icon="plus" onClick={add}>Frame</Button>
    </>
  );
}

/** Each frame's rig and lens, colour and removal, under the stage. */
export function StackLayers({ photo, presets, stack, onStack }: Omit<Props, "centre">) {
  const set = (id: string, patch: Partial<StackLayer>) => onStack({ ...stack, layers: stack.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const cycle = (l: StackLayer) => set(l.id, { color: COLORS[(COLORS.indexOf(l.color as (typeof COLORS)[number]) + 1) % COLORS.length] });
  return (
    <div class="stack-layers">
      {stack.layers.map((l) => (
        <div key={l.id} class="stack-layer">
          <button type="button" class="stack-layer__swatch" style={{ background: l.color }} title="Next colour" aria-label={`Colour of ${choiceLabel(photo, presets, l.choice)}: next colour`} onClick={() => cycle(l)} />
          <Pickers photo={photo} presets={presets} choice={l.choice} onChoice={(choice) => set(l.id, { choice })} />
          <IconButton icon="close" label="Remove this frame" disabled={stack.layers.length <= 1} onClick={() => onStack({ ...stack, layers: stack.layers.filter((x) => x.id !== l.id) })} />
        </div>
      ))}
    </div>
  );
}

/** The photo with every frame of the stack on it, laid out so the widest frame fits. */
export function StackCanvas({ photo, presets, centre, stack }: Omit<Props, "onStack">) {
  const frames = stack.layers.map((l) => ({ l, f: frameForChoice(photo, presets, l.choice) })).filter((x): x is { l: StackLayer; f: FrameGeometry } => !!x.f);
  // The photo shrinks when some rig sees more than the phone did, like Mask / Frame mode.
  const scale = 1 / Math.max(1, ...frames.flatMap(({ f }) => [f.width_fraction, f.height_fraction]));
  const img = { left: (1 - scale) * 50, top: (1 - scale) * 50, width: scale * 100, height: scale * 100 };
  const aspect = imageAspect(photo);
  return (
    <div class={`framed stack-canvas ${scale < 1 ? "is-beyond" : ""}`} style={{ aspectRatio: String(aspect), width: `min(100%, calc((100cqh - 330px) * ${aspect}))` }}>
      <img src={photo.image_url} alt="" style={{ inset: "auto", left: `${img.left}%`, top: `${img.top}%`, width: `${img.width}%`, height: `${img.height}%` }} />
      {frames.map(({ l, f }) => {
        // Every frame takes the shared centre, clamped so it stays on the photo where it can move at all.
        const cx = f.width_fraction >= 1 ? 0.5 : Math.min(1 - f.width_fraction / 2, Math.max(f.width_fraction / 2, centre.x));
        const cy = f.height_fraction >= 1 ? 0.5 : Math.min(1 - f.height_fraction / 2, Math.max(f.height_fraction / 2, centre.y));
        const w = f.width_fraction * img.width, h = f.height_fraction * img.height;
        const box = { left: img.left + cx * img.width - w / 2, top: img.top + cy * img.height - h / 2, width: w, height: h };
        return (
          <div key={l.id} class={`stack-frame${f.width_fraction > 1 || f.height_fraction > 1 ? " is-wider" : ""}`} style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, borderColor: l.color }}>
            {stack.names && <span class={`stack-frame__name stack-frame__name--${stack.place}`} style={{ background: l.color, color: inkOn(l.color) }}>{choiceLabel(photo, presets, l.choice)}</span>}
          </div>
        );
      })}
    </div>
  );
}
