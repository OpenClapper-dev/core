// Creating an optics preset (docs/features/canvas.md, UX workshop U2 round 8): the form on the left, a
// preview on the right of what the preset sees on example pictures, drawn with the optics math. Also the
// way to a changed preset: Duplicate opens it filled in with another preset's values.
import { useState } from "preact/hooks";
import { Banner, Button, Dialog, FormField, Icon, NumberInput, Segmented, Select, Slider, TextInput, cx } from "@openclapper/design";
import { DELIVERIES, FORMATS, opticsFrame, opticsView, PRIMES, SQUEEZES, type Optics } from "@openclapper/fov-math";
import { focalsOf, presetError, type Lenses, type PresetBody } from "@openclapper/model";
import type { FileRec } from "./api";
import { create } from "./files";
import { toastError } from "./hosts";
import { examplesIn, type Example } from "./optics";
import "./presets.css";

interface Draft { name: string; format: [number, number]; formatName: string | null; multiplier: number; squeeze: number; delivery: number | null; lenses: "primes" | "zoom"; primes: number[]; zoom: [number, number] }
const EMPTY: Draft = { name: "", format: [24.89, 18.66], formatName: "Super 35, 4-perf", multiplier: 1, squeeze: 1, delivery: null, lenses: "primes", primes: [24, 35, 50, 85], zoom: [18, 35] };
export const draftOf = (name: string, b: PresetBody): Partial<Draft> => ({
  name, format: b.format, formatName: b.formatName, multiplier: b.multiplier, squeeze: b.squeeze, delivery: b.delivery,
  lenses: b.lenses.kind, ...(b.lenses.kind === "primes" ? { primes: b.lenses.primes } : { zoom: [b.lenses.from, b.lenses.to] as [number, number] }),
});
const bodyOf = (d: Draft): PresetBody => ({
  format: d.format, formatName: d.formatName, multiplier: d.multiplier, squeeze: d.squeeze, delivery: d.delivery,
  lenses: (d.lenses === "primes" ? { kind: "primes", primes: [...d.primes].sort((a, b) => a - b) } : { kind: "zoom", from: d.zoom[0], to: d.zoom[1] }) as Lenses, archived: false,
});

/** An example with what optics see on it: on the whole picture (dimmed outside), or fitted to the frame. */
export function OpticsPreview({ example, optics, mode, small }: { example: Example; optics: Optics; mode: "on" | "sees"; small?: boolean }) {
  const q = opticsFrame(optics, example.view), k = 1 / Math.max(1, q.w, q.h), pic = q.inner ?? q;
  const fit = mode === "sees" ? Math.min(1 / (q.w * k), 1 / (q.h * k)) : 1;
  return (
    <span className={cx("pf-shot", small && "pf-shot--small", k < 1 && mode === "on" && "is-beyond")} style={{ aspectRatio: String(example.aspect) }}>
      <span className="pf-shot__world" style={{ transform: `scale(${fit})` }}>
        <img src={example.src} alt="" draggable={false} style={{ width: `${k * 100}%`, height: `${k * 100}%` }} />
        <span className={cx("pf-shot__mask", mode === "sees" && "is-solid")} style={{ width: `${pic.w * k * 100}%`, height: `${pic.h * k * 100}%` }} />
        {mode === "on" && <span className={cx("pf-shot__frame", Math.max(q.w, q.h) > 1 && "is-beyond")} style={{ width: `${q.w * k * 100}%`, height: `${q.h * k * 100}%` }}>{q.inner && <i style={{ width: `${(q.inner.w / q.w) * 100}%`, height: `${(q.inner.h / q.h) * 100}%` }} />}</span>}
      </span>
    </span>
  );
}

export function PresetFlow({ projectId, files, container, start, title = "New optics preset", onCreated, onClose }: { projectId: string; files: readonly FileRec[] | null; container?: string | null; start?: Partial<Draft>; title?: string; onCreated?: (id: string) => void; onClose: () => void }) {
  const [d, setD] = useState<Draft>({ ...EMPTY, ...start });
  const examples = examplesIn(files);
  const [scene, setScene] = useState(examples[0].id);
  const [focal, setFocal] = useState(start?.primes?.[0] ?? start?.zoom?.[0] ?? 35);
  const [view, setView] = useState<"on" | "sees">("on");
  const [own, setOwn] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (c: Partial<Draft>) => setD({ ...d, ...c });
  const example = examples.find((x) => x.id === scene) ?? examples[0];
  const body = bodyOf(d);
  const wrong = presetError(body as unknown as Record<string, unknown>);
  const stops = d.lenses === "primes" ? [...d.primes].sort((a, b) => a - b) : [...new Set([d.zoom[0], Math.round((d.zoom[0] * 2 + d.zoom[1]) / 3), Math.round((d.zoom[0] + d.zoom[1] * 2) / 3), d.zoom[1]])];
  const mm = d.lenses === "primes" ? (stops.includes(focal) ? focal : stops[0] ?? 35) : Math.min(d.zoom[1], Math.max(d.zoom[0], focal));
  const optics = (f: number): Optics => ({ format: d.format, multiplier: d.multiplier, squeeze: d.squeeze, focal: f, delivery: d.delivery });
  const v = opticsView(optics(mm));
  const fr = opticsFrame(optics(mm), example.view);
  const problems = [!d.name.trim() && "Give it a name.", wrong && (d.lenses === "primes" && !d.primes.length ? "Tick at least one focal length." : d.lenses === "zoom" && d.zoom[0] >= d.zoom[1] ? "The zoom has to go from a shorter to a longer focal length." : `Check the values: ${wrong}.`)].filter((x): x is string => !!x);
  const known = FORMATS.find((f) => f.w === d.format[0] && f.h === d.format[1]);
  const createIt = async () => {
    setBusy(true);
    try { const id = crypto.randomUUID(); await create({ project: projectId }, "preset", { id, name: d.name.trim(), container: container ?? null, body: body as unknown as Record<string, unknown> }); onCreated?.(id); onClose(); }
    catch (e) { toastError(e); setBusy(false); }
  };

  return (
    <Dialog fixed className="pf" title={title} onClose={onClose}
      footer={<>
        {problems.length ? <span className="pf-bad"><Icon name="warning" size={12} /> {problems[0]}</span> : <span className="pf-note">After creating, the format, multiplier, squeeze and delivery are fixed. Lenses can still be added.</span>}
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={problems.length > 0 || busy} onClick={() => void createIt()}>Create the preset</Button>
      </>}>
      <div className="pf-grid">
        <div className="pf-form">
          <FormField label="Name"><TextInput value={d.name} maxLength={120} placeholder="Camera and lenses, e.g. Alexa 35 · Signature primes" onInput={(e) => set({ name: e.currentTarget.value })} /></FormField>
          <FormField label="Format" hint="The sensor or film area the camera records.">
            <Select value={known ? known.name : "own"} onChange={(n) => { const f = FORMATS.find((x) => x.name === n); if (f) set({ format: [f.w, f.h], formatName: f.name }); else set({ formatName: null }); }}
              options={[...FORMATS.map((f) => ({ value: f.name, label: `${f.name} · ${f.w} × ${f.h} mm` })), { value: "own", label: "Own width and height…" }]} />
            {!known && <span className="pf-pair"><NumberInput size="sm" value={d.format[0]} unit="mm" step={0.01} min={1} max={150} onChange={(x) => set({ format: [x, d.format[1]], formatName: null })} /><span>×</span><NumberInput size="sm" value={d.format[1]} unit="mm" step={0.01} min={1} max={150} onChange={(x) => set({ format: [d.format[0], x], formatName: null })} /></span>}
          </FormField>
          <div className="pf-row">
            <FormField label="Multiplier" hint="Reducer or teleconverter; 1 = none."><NumberInput value={d.multiplier} step={0.01} min={0.2} max={5} onChange={(x) => set({ multiplier: x })} /></FormField>
            <FormField label="Squeeze"><Select value={String(d.squeeze)} onChange={(x) => set({ squeeze: Number(x) })} options={[...new Set([...SQUEEZES, d.squeeze])].map((x) => ({ value: String(x), label: x === 1 ? "Spherical" : `${x}× anamorphic` }))} /></FormField>
          </div>
          <FormField label="Delivery aspect" hint="Optional: the picture that is delivered, cropped centred out of what the camera sees.">
            <Select value={d.delivery ? String(d.delivery) : ""} onChange={(x) => set({ delivery: x ? Number(x) : null })} options={[{ value: "", label: "As the camera sees" }, ...DELIVERIES.map((a) => ({ value: String(a.ratio), label: a.label }))]} />
          </FormField>
          <FormField label="Lenses">
            <Segmented label="Lenses" value={d.lenses} onChange={(x) => set({ lenses: x as Draft["lenses"] })} options={[{ value: "primes", label: "Primes" }, { value: "zoom", label: "One zoom" }]} />
            {d.lenses === "primes" ? (
              <>
                <span className="pf-chips">{[...new Set([...PRIMES, ...d.primes])].sort((a, b) => a - b).map((p) => <button type="button" key={p} className={cx(d.primes.includes(p) && "is-on")} aria-pressed={d.primes.includes(p)} onClick={() => { set({ primes: d.primes.includes(p) ? d.primes.filter((x) => x !== p) : [...d.primes, p] }); if (!d.primes.includes(p)) setFocal(p); }}>{p}</button>)}</span>
                <span className="pf-pair"><NumberInput size="sm" value={own} unit="mm" step={1} min={1} max={2000} placeholder="Own" onChange={(x) => setOwn(Math.round(x))} /><Button size="sm" icon="plus" disabled={!own || d.primes.includes(own)} onClick={() => { if (own) { set({ primes: [...d.primes, own] }); setFocal(own); setOwn(null); } }}>Add a focal length</Button></span>
              </>
            ) : <span className="pf-pair"><NumberInput size="sm" value={d.zoom[0]} unit="mm" step={1} min={1} max={2000} onChange={(x) => set({ zoom: [Math.round(x), d.zoom[1]] })} /><span>to</span><NumberInput size="sm" value={d.zoom[1]} unit="mm" step={1} min={1} max={2000} onChange={(x) => set({ zoom: [d.zoom[0], Math.round(x)] })} /></span>}
          </FormField>
        </div>
        <div className="pf-preview">
          <div className="pf-bar">
            <Select size="sm" value={example.id} onChange={setScene} options={examples.map((x) => ({ value: x.id, label: x.label }))} aria-label="Example" />
            <span style={{ flex: 1 }} />
            <Segmented label="Preview" value={view} onChange={(x) => setView(x as "on" | "sees")} options={[{ value: "on", label: "On the photo" }, { value: "sees", label: "What it sees" }]} />
          </div>
          <OpticsPreview example={example} optics={optics(mm)} mode={view} />
          <div className="pf-facts"><strong>{mm} mm</strong><span>{v.horizontal.toFixed(0)}° × {v.vertical.toFixed(0)}°</span><span>like {v.fullFrame.toFixed(0)} mm on full frame</span>{d.delivery && <span>delivers {DELIVERIES.find((x) => x.ratio === d.delivery)?.label ?? `${d.delivery}:1`}</span>}{Math.max(fr.w, fr.h) > 1 && <span className="pf-bad"><Icon name="expand" size={12} /> wider than this example</span>}</div>
          {d.lenses === "zoom" && d.zoom[1] > d.zoom[0] && <div className="pf-zoom"><Slider min={d.zoom[0]} max={d.zoom[1]} step={1} value={mm} onChange={setFocal} /><b className="oc-num">{mm} mm</b></div>}
          <div className="pf-strip">{stops.map((f) => <button type="button" key={f} className={cx(f === mm && "is-on")} onClick={() => setFocal(f)}><OpticsPreview example={example} optics={optics(f)} mode="sees" small /><span>{f} mm</span></button>)}</div>
          {Math.max(fr.w, fr.h) > 1 && view === "on" && <Banner tone="info">At {mm} mm this preset sees more than the example shows; the hatched area is beyond it.</Banner>}
          <p className="pf-note">{example.id === "chart" ? "The test chart stands for a photo taken at 14 mm on full frame; its rectangles are full-frame focal lengths. Photos of this project with an angle of view are in the list too." : `${example.label}: a photo of this project, ${example.view.horizontal.toFixed(0)}° × ${example.view.vertical.toFixed(0)}°.`}</p>
          {d.lenses === "zoom" && <p className="pf-note">{focalsOf({ kind: "zoom", from: d.zoom[0], to: Math.max(d.zoom[0], d.zoom[1]) }).length} focal lengths, every whole mm.</p>}
        </div>
      </div>
    </Dialog>
  );
}
