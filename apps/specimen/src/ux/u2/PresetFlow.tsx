// UX workshop U2: creating an optics preset, with a preview of what it sees on example photos
// (docs/rewrite/02-optics.md). The form on the left, the preview on the right: a scene, a focal length from the
// preset's lenses, and the frame drawn on the example with the real math. Fake examples: generated pictures that
// stand for photos taken at 14 mm on full frame.
import { useState } from "preact/hooks";
import { Banner, Button, Dialog, FormField, Icon, NumberInput, Segmented, Select, Slider, TextInput, cx } from "@openclapper/design";
import { picture } from "../u1/pictures";
import { ASPECTS, FORMATS, PRIMES, type Preset } from "./model";

/** The example photos the app would ship: each taken at 14 mm on full frame (104° × 81°), so every longer lens is a crop of it. */
const SCENES: { id: string; label: string; seed: number }[] = [{ id: "street", label: "Harbour", seed: 12 }, { id: "interior", label: "Interior", seed: 33 }, { id: "land", label: "Open ground", seed: 42 }, { id: "dusk", label: "Dusk", seed: 16 }];
const EX = { mm: 14, tanH: 36 / (2 * 14), tanV: 24 / (2 * 14), aspect: 3 / 2 };

export interface Draft { name: string; format: [number, number]; mult: number; squeeze: number; delivery?: number; lenses: "primes" | "zoom"; primes: number[]; zoom: [number, number] }
export const EMPTY: Draft = { name: "", format: [24.89, 14], mult: 1, squeeze: 1, delivery: undefined, lenses: "primes", primes: [24, 35, 50, 85], zoom: [18, 35] };

/** What the draft sees at a focal length, as fractions of the example photo. */
function see(d: Draft, focal: number) {
  const eff = focal * d.mult, tw = (d.format[0] * d.squeeze) / (2 * eff), th = d.format[1] / (2 * eff), w = tw / EX.tanH, h = th / EX.tanV;
  const a = (w * EX.aspect) / h, inner = d.delivery ? (d.delivery > a ? { w, h: (h * a) / d.delivery } : { w: (w * d.delivery) / a, h }) : undefined;
  return { w, h, inner, hfov: (2 * Math.atan(tw) * 180) / Math.PI, vfov: (2 * Math.atan(th) * 180) / Math.PI, ffeq: 43.27 / (2 * Math.hypot(tw, th)) };
}

export default function PresetFlow({ start, onCreate, onClose }: { start?: Partial<Draft>; onCreate: (p: Preset) => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>({ ...EMPTY, ...start });
  const [scene, setScene] = useState(SCENES[0].id);
  const [focal, setFocal] = useState(start?.primes?.[0] ?? 35);
  const [view, setView] = useState("on");
  const [own, setOwn] = useState<number | null>(null);
  const set = (c: Partial<Draft>) => setD({ ...d, ...c });

  const stops = d.lenses === "primes" ? [...d.primes].sort((a, b) => a - b) : [d.zoom[0], Math.round((d.zoom[0] * 2 + d.zoom[1]) / 3), Math.round((d.zoom[0] + d.zoom[1] * 2) / 3), d.zoom[1]].filter((v, i, a) => a.indexOf(v) === i);
  const mm = d.lenses === "primes" ? (stops.includes(focal) ? focal : stops[0] ?? 35) : Math.min(d.zoom[1], Math.max(d.zoom[0], focal));
  const s = see(d, mm), wide = Math.max(s.w, s.h) > 1, shrink = 1 / Math.max(1, s.w, s.h);
  const seed = SCENES.find((x) => x.id === scene)!.seed;
  const problems = [!d.name.trim() && "Give it a name.", d.lenses === "primes" && !d.primes.length && "Tick at least one focal length.", d.lenses === "zoom" && d.zoom[0] >= d.zoom[1] && "The zoom has to go from a shorter to a longer focal length.", !(d.format[0] > 0 && d.format[1] > 0) && "The format needs a width and a height."].filter((x): x is string => !!x);
  const known = FORMATS.find(([, w, h]) => w === d.format[0] && h === d.format[1]);
  /** One example photo with the frame of a focal length: on the photo, or fitted to what the camera sees. */
  const shot = (f: number, mode: string, small = false) => {
    const q = see(d, f), k = 1 / Math.max(1, q.w, q.h), pic = q.inner ?? q;
    const fit = mode === "sees" ? Math.min(1 / (q.w * k), 1 / (q.h * k)) : 1;
    return (
      <span className={cx("u2p-shot", small && "u2p-shot--small", k < 1 && mode === "on" && "is-beyond")}>
        <span className="u2p-shot__world" style={{ transform: `scale(${fit})` }}>
          <img src={picture(seed)} alt="" draggable={false} style={{ width: `${k * 100}%`, height: `${k * 100}%` }} />
          <span className={cx("u2p-shot__mask", mode === "sees" && "is-solid")} style={{ width: `${pic.w * k * 100}%`, height: `${pic.h * k * 100}%` }} />
          {mode === "on" && <span className={cx("u2p-shot__frame", Math.max(q.w, q.h) > 1 && "is-beyond")} style={{ width: `${q.w * k * 100}%`, height: `${q.h * k * 100}%` }}>{q.inner && <i style={{ width: `${(q.inner.w / q.w) * 100}%`, height: `${(q.inner.h / q.h) * 100}%` }} />}</span>}
        </span>
      </span>
    );
  };

  return (
    <Dialog fixed className="u2p" title="New optics preset" onClose={onClose}
      footer={<>
        {problems.length > 0 ? <span className="u2p-bad"><Icon name="warning" size={12} /> {problems[0]}</span> : <span className="u2p-note">After creating, the format, multiplier, squeeze and delivery are fixed. Lenses can still be added.</span>}
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={problems.length > 0} onClick={() => onCreate({ id: `p${Date.now()}`, name: d.name.trim(), format: d.format, mult: d.mult, squeeze: d.squeeze, delivery: d.delivery, ...(d.lenses === "primes" ? { primes: [...d.primes].sort((a, b) => a - b) } : { zoom: d.zoom }) })}>Create the preset</Button>
      </>}>
      <div className="u2p-grid">
        <div className="u2p-form">
          <FormField label="Name"><TextInput value={d.name} placeholder="Camera and lenses, e.g. Alexa 35 · Signature primes" onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} /></FormField>
          <FormField label="Format" hint="The sensor area the camera records with.">
            <Select value={known ? `${d.format[0]}x${d.format[1]}` : "own"} onChange={(v) => { if (v !== "own") { const [w, h] = v.split("x").map(Number); set({ format: [w, h] }); } else set({ format: [d.format[0] + 0.01, d.format[1]] }); }} options={[...FORMATS.map(([n, w, h]) => ({ value: `${w}x${h}`, label: `${n} · ${w} × ${h} mm` })), { value: "own", label: "Own width and height…" }]} />
            {!known && <span className="u2p-pair"><NumberInput size="sm" value={Number(d.format[0].toFixed(2))} unit="mm" step={0.1} min={1} max={100} onChange={(v) => set({ format: [v, d.format[1]] })} /><span>×</span><NumberInput size="sm" value={d.format[1]} unit="mm" step={0.1} min={1} max={100} onChange={(v) => set({ format: [d.format[0], v] })} /></span>}
          </FormField>
          <div className="u2p-row">
            <FormField label="Multiplier" hint="Reducer or teleconverter; 1 = none."><NumberInput value={d.mult} step={0.01} min={0.5} max={2} onChange={(v) => set({ mult: v })} /></FormField>
            <FormField label="Squeeze"><Select value={String(d.squeeze)} onChange={(v) => set({ squeeze: Number(v) })} options={[1, 1.25, 1.33, 1.5, 1.6, 1.8, 2].map((x) => ({ value: String(x), label: x === 1 ? "Spherical" : `${x}× anamorphic` }))} /></FormField>
          </div>
          <FormField label="Delivery aspect" hint="Optional: the picture that is delivered, cropped out of what the camera sees."><Select value={d.delivery ? String(d.delivery) : ""} onChange={(v) => set({ delivery: v ? Number(v) : undefined })} options={[{ value: "", label: "As the camera sees" }, ...ASPECTS.map(([n, a]) => ({ value: String(a), label: n }))]} /></FormField>
          <FormField label="Lenses">
            <Segmented label="Lenses" value={d.lenses} onChange={(v) => set({ lenses: v as "primes" | "zoom" })} options={[{ value: "primes", label: "Primes" }, { value: "zoom", label: "One zoom" }]} />
            {d.lenses === "primes" ? (
              <>
                <span className="u2-chips u2-chips--wrap">{[...new Set([...PRIMES, ...d.primes])].sort((a, b) => a - b).map((p) => <button type="button" key={p} className={cx(d.primes.includes(p) && "is-on")} onClick={() => { const next = d.primes.includes(p) ? d.primes.filter((x) => x !== p) : [...d.primes, p]; set({ primes: next }); if (!d.primes.includes(p)) setFocal(p); }}>{p}</button>)}</span>
                <span className="u2p-pair"><NumberInput size="sm" value={own} unit="mm" step={1} min={4} max={600} placeholder="Own" onChange={(v) => setOwn(Math.round(v))} /><Button size="sm" icon="plus" disabled={!own || d.primes.includes(own)} onClick={() => { if (own) { set({ primes: [...d.primes, own] }); setFocal(own); setOwn(null); } }}>Add a focal length</Button></span>
              </>
            ) : <span className="u2p-pair"><NumberInput size="sm" value={d.zoom[0]} unit="mm" step={1} min={4} max={600} onChange={(v) => set({ zoom: [Math.round(v), d.zoom[1]] })} /><span>to</span><NumberInput size="sm" value={d.zoom[1]} unit="mm" step={1} min={4} max={600} onChange={(v) => set({ zoom: [d.zoom[0], Math.round(v)] })} /></span>}
          </FormField>
        </div>

        <div className="u2p-preview">
          <div className="u2p-bar">
            <Segmented label="Scene" value={scene} onChange={setScene} options={SCENES.map((x) => ({ value: x.id, label: x.label }))} />
            <span style={{ flex: 1 }} />
            <Segmented label="Preview" value={view} onChange={setView} options={[{ value: "on", label: "On the photo" }, { value: "sees", label: "What it sees" }]} />
          </div>
          {shot(mm, view)}
          <div className="u2p-facts"><strong>{mm} mm</strong><span>{s.hfov.toFixed(0)}° × {s.vfov.toFixed(0)}°</span><span>like {s.ffeq.toFixed(0)} mm on full frame</span>{d.delivery && <span>delivers {d.delivery}:1</span>}{wide && <span className="u2p-bad"><Icon name="expand" size={12} /> wider than the example ({EX.mm} mm on full frame)</span>}</div>
          {d.lenses === "zoom" && <div className="u2-zoom"><Slider min={d.zoom[0]} max={Math.max(d.zoom[0] + 1, d.zoom[1])} step={1} value={mm} onChange={setFocal} /><b className="oc-num">{mm} mm</b></div>}
          <div className="u2p-strip">{stops.map((f) => <button type="button" key={f} className={cx(f === mm && "is-on")} onClick={() => setFocal(f)}>{shot(f, "sees", true)}<span>{f} mm</span></button>)}</div>
          {shrink < 1 && view === "on" && <Banner tone="info">At {mm} mm this preset sees more than the example photo shows; the hatched area is beyond it.</Banner>}
          <p className="u2p-note">The examples stand for photos taken at {EX.mm} mm on full frame from one position, so a longer lens is an exact crop of them. They are placeholders here.</p>
        </div>
      </div>
    </Dialog>
  );
}
