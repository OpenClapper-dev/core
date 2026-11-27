// The zoom generator (docs/features/shots.md, docs/rewrite/04-shots.md): from one photo and optics (a preset or
// free-form values) it makes ONE internal canvas with frames and the progression's pictures that show it. In steps:
// a frame per focal length and a picture per frame. Smooth: a start and an end frame and one picture that moves
// between them over a time. Zooms only: a pan or a tilt cannot be derived from one photo.
import { useState } from "preact/hooks";
import { Banner, Button, Checkbox, Dialog, FormField, NumberInput, Segmented, Select, Slider, TextInput, cx } from "@openclapper/design";
import { DELIVERIES, FORMATS, PRIMES, SQUEEZES } from "@openclapper/fov-math";
import type { CanvasFrame, ItemData, PresetBody } from "@openclapper/model";
import type { FileRec } from "../api";
import type { Preset } from "../optics";
import { Pic } from "./Pic";
import { seeBetween, seeFrame, type PicCtx } from "./picture";
import { clock } from "./progressionParts";

export interface Made { photo: string; name: string; frames: CanvasFrame[]; item: ItemData; add: boolean }
const MAX = 60;
interface Free { format: [number, number]; multiplier: number; squeeze: number; delivery: number | null }

export function Generator({ files, presets, ctx, start, has, onMake, onClose }: { files: readonly FileRec[]; presets: readonly Preset[]; ctx: PicCtx; start?: string; has: boolean; onMake: (m: Made) => void; onClose: () => void }) {
  const photos = files.filter((f) => f.type === "photo" && !f.internal_of && f.photo?.angle_of_view && f.photo.stored.preview);
  const live = presets.filter((p) => !p.body.archived);
  const [photoId, setPhoto] = useState(photos.some((p) => p.id === start) ? start! : photos[0]?.id ?? "");
  const [optics, setOptics] = useState(live[0]?.id ?? "free");
  const [free, setFree] = useState<Free>({ format: [24.89, 13.87], multiplier: 1, squeeze: 1, delivery: null });
  const [kind, setKind] = useState("steps");
  const [primes, setPrimes] = useState<number[] | null>(null);
  const [span, setSpan] = useState<[number, number] | null>(null);
  const [stops, setStops] = useState("common");
  const [every, setEvery] = useState(5);
  const [typed, setTyped] = useState("18, 24, 35, 50");
  const [hold, setHold] = useState(1);
  const [length, setLength] = useState(4);
  const [eased, setEased] = useState(true);
  const [add, setAdd] = useState("replace");
  const [name, setName] = useState("");
  const [at, setAt] = useState(0);
  const [u, setU] = useState(0);
  if (!photos.length) return (
    <Dialog fixed className="sh-pick" title="Generate a zoom" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <Banner tone="info">A zoom is made from a photo with an angle of view (taken on the phone, or with a lens in its EXIF). This project has none yet.</Banner>
    </Dialog>
  );

  const photo = photos.find((p) => p.id === photoId) ?? photos[0];
  const preset = live.find((p) => p.id === optics), lenses = preset?.body.lenses;
  const fixed = lenses?.kind === "primes" ? [...lenses.primes].sort((a, b) => a - b) : null;
  const limits: [number, number] = lenses?.kind === "zoom" ? [lenses.from, lenses.to] : fixed ? [fixed[0], fixed[fixed.length - 1]] : [1, 2000];
  const [from, to] = span ?? (lenses?.kind === "zoom" ? [lenses.from, lenses.to] : fixed ? [fixed[0], fixed[fixed.length - 1]] : [18, 85]);
  const smooth = kind === "smooth" && !fixed;
  const make = (mm: number, i: number): CanvasFrame => ({
    id: `z${i}`, name: `${mm} mm`, color: (i % 8) + 1, portrait: false, cx: 0.5, cy: 0.5, visible: true, focal: mm,
    ...(preset ? { kind: "preset" as const, preset: preset.id } : { kind: "free" as const, format: free.format, multiplier: free.multiplier, squeeze: free.squeeze, delivery: free.delivery }),
  });

  // The focal lengths of the steps, in the direction of the zoom (whole millimetres).
  let mms: number[];
  if (fixed) mms = (primes ?? fixed).filter((p) => fixed.includes(p));
  else if (stops === "typed") mms = typed.split(/[\s,;]+/).map((x) => Math.round(Number(x))).filter((n) => n >= limits[0] && n <= limits[1]);
  else {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const mid = stops === "common" ? PRIMES.filter((p) => p > lo && p < hi) : Array.from({ length: Math.max(0, Math.ceil((hi - lo) / Math.max(1, every)) - 1) }, (_, i) => lo + (i + 1) * Math.max(1, every)).filter((x) => x < hi);
    mms = [lo, ...mid, hi].filter((v, i, a) => a.indexOf(v) === i);
    if (from > to) mms.reverse();
  }
  mms = mms.filter((v, i, a) => a.indexOf(v) === i);
  const many = mms.length > MAX;
  const frames = smooth ? [make(from, 0), make(to, 1)] : mms.slice(0, MAX).map(make);
  // One zoom block over the canvas's frames: in steps each frame holds its part, smooth it moves from the first to the last.
  const item: ItemData = smooth ? { ms: Math.min(600_000, Math.round(length * 10) * 100), zoom: { mode: "smooth", ease: eased } } : { ms: Math.min(600_000, Math.round(hold * 10) * 100 * Math.max(1, frames.length)), zoom: { mode: "steps", ease: false } };
  const total = item.ms;
  const pmap: ReadonlyMap<string, PresetBody> = ctx.presets;
  const seen = (f: CanvasFrame) => seeFrame(photo, f, pmap);
  const beyond = frames.filter((f) => { const r = seen(f).rect; return !!r && (r.w > 1 || r.h > 1); });
  const ok = smooth ? from !== to : frames.length >= 2;
  const cur = smooth ? seeBetween(photo, frames[0], frames[1], pmap, u, eased) : frames.length ? seeFrame(photo, frames[Math.min(at, frames.length - 1)], pmap, frames) : null;
  const title = name.trim() || (smooth ? "Zoom" : "Framing series");
  const range = (
    <div className="sh-pair">
      <FormField label="From"><NumberInput value={from} unit="mm" min={limits[0]} max={limits[1]} onChange={(v) => setSpan([Math.round(v), to])} /></FormField>
      <FormField label="To"><NumberInput value={to} unit="mm" min={limits[0]} max={limits[1]} onChange={(v) => setSpan([from, Math.round(v)])} /></FormField>
    </div>
  );

  return (
    <Dialog fixed className="sh-gen" title="Generate a zoom" onClose={onClose}
      footer={<><span className="sh-hint">{smooth ? `One internal canvas on ${photo.name} with the start and end frame, and one moving picture (${clock(total)}).` : `One internal canvas on ${photo.name} with ${frames.length} frames, and one zoom block of ${frames.length} pictures (${clock(total)}).`}</span><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onMake({ photo: photo.id, name: title, frames, item, add: add === "add" })}>Generate</Button></>}>
      <div className="sh-gen__grid">
        <div className="sh-gen__form">
          <FormField label="Photo" hint="Only photos with an angle of view can be framed."><Select value={photo.id} onChange={setPhoto} options={photos.map((p) => ({ value: p.id, label: p.name }))} /></FormField>
          <FormField label="Optics"><Select value={preset ? optics : "free"} onChange={(v) => { setOptics(v); setPrimes(null); setSpan(null); setAt(0); }} options={[...live.map((p) => ({ value: p.id, label: p.name })), { value: "free", label: "Free-form values…" }]} /></FormField>
          {!preset && (
            <>
              <FormField label="Format"><Select value={`${free.format[0]}x${free.format[1]}`} onChange={(v) => { const [w, h] = v.split("x").map(Number); setFree({ ...free, format: [w, h] }); }} options={FORMATS.map((x) => ({ value: `${x.w}x${x.h}`, label: `${x.name} · ${x.w} × ${x.h} mm` }))} /></FormField>
              <div className="sh-pair">
                <FormField label="Multiplier"><NumberInput value={free.multiplier} step={0.01} min={0.2} max={5} onChange={(v) => setFree({ ...free, multiplier: v })} /></FormField>
                <FormField label="Squeeze"><Select value={String(free.squeeze)} onChange={(v) => setFree({ ...free, squeeze: Number(v) })} options={SQUEEZES.map((x) => ({ value: String(x), label: x === 1 ? "Spherical" : `${x}×` }))} /></FormField>
                <FormField label="Delivery"><Select value={free.delivery ? String(free.delivery) : ""} onChange={(v) => setFree({ ...free, delivery: v ? Number(v) : null })} options={[{ value: "", label: "As seen" }, ...DELIVERIES.map((d) => ({ value: String(d.ratio), label: d.label }))]} /></FormField>
              </div>
            </>
          )}
          <FormField label="Zoom" hint={fixed ? "Primes do not zoom smoothly. For a smooth zoom take a zoom preset or free-form values." : undefined}>
            <Segmented label="Zoom" value={smooth ? "smooth" : "steps"} disabled={!!fixed} onChange={setKind} options={[{ value: "steps", label: "In steps" }, { value: "smooth", label: "Smooth" }]} />
          </FormField>
          {smooth ? (
            <>
              {range}
              <div className="sh-pair"><FormField label="Takes"><NumberInput value={length} unit="s" min={0.5} max={600} step={0.5} onChange={setLength} /></FormField><FormField label="Speed"><Checkbox checked={eased} onChange={setEased}>Ease in and out</Checkbox></FormField></div>
            </>
          ) : fixed ? (
            <FormField label="Focal lengths" hint="One frame per ticked lens of the preset.">
              <span className="sh-chipset">{fixed.map((p) => { const on = (primes ?? fixed).includes(p); return <button type="button" key={p} className={cx(on && "is-on")} onClick={() => setPrimes(on ? (primes ?? fixed).filter((x) => x !== p) : [...(primes ?? fixed), p].sort((a, b) => a - b))}>{p}</button>; })}</span>
            </FormField>
          ) : (
            <>
              <FormField label="Focal lengths"><Segmented label="Focal lengths" value={stops} onChange={setStops} options={[{ value: "common", label: "Common stops" }, { value: "every", label: "Every … mm" }, { value: "typed", label: "Typed" }]} /></FormField>
              {stops === "typed" ? <FormField label="List" hint="Whole millimetres, in the order they are shown, separated by commas."><TextInput value={typed} onInput={(e) => setTyped(e.currentTarget.value)} /></FormField> : range}
              {stops === "every" && <FormField label="Step"><NumberInput value={every} unit="mm" min={1} max={100} step={1} onChange={(v) => setEvery(Math.max(1, Math.round(v)))} /></FormField>}
            </>
          )}
          <div className="sh-pair">{!smooth && <FormField label="Each picture holds"><NumberInput value={hold} unit="s" min={0.1} max={600} step={0.1} onChange={setHold} /></FormField>}<FormField label="Name of the canvas"><TextInput value={name} placeholder={smooth ? "Zoom" : "Framing series"} onInput={(e) => setName(e.currentTarget.value)} /></FormField></div>
          {has && <FormField label="The shot already has a progression"><Segmented label="Existing progression" value={add} onChange={setAdd} options={[{ value: "replace", label: "Replace it" }, { value: "add", label: "Add to its end" }]} /></FormField>}
        </div>
        <div className="sh-gen__preview">
          <div className="sh-gen__stage sh-box">{cur && <Pic seen={cur} mode="outline" label />}</div>
          {smooth ? (
            <div className="sh-gen__smooth"><span className="sh-box"><Pic seen={seeBetween(photo, frames[0], frames[1], pmap, u, eased)} /></span><div><Slider min={0} max={100} value={Math.round(u * 100)} onChange={(v) => setU(v / 100)} /><small className="oc-num">{cur?.name} · {clock(u * total)} of {clock(total)}</small><small>Drag to look through the move. In the progression it plays by itself.</small></div></div>
          ) : <div className="sh-gen__strip">{frames.map((f, i) => <button type="button" key={f.id} className={cx(i === Math.min(at, frames.length - 1) && "is-on")} onMouseEnter={() => setAt(i)} onClick={() => setAt(i)}><span className="sh-box"><Pic seen={seen(f)} /></span><small>{f.name}</small></button>)}</div>}
          {many && <Banner tone="warning">{mms.length} focal lengths: only the first {MAX} are made. Take a larger step, or a smooth zoom.</Banner>}
          {!ok && <Banner tone="warning">{smooth ? "Start and end are the same focal length." : "At least two focal lengths are needed."}</Banner>}
          {beyond.length > 0 && <Banner tone="info">{beyond.length === frames.length ? "Every frame" : beyond.map((f) => f.name).join(", ")}: sees more than the photo shows.</Banner>}
        </div>
      </div>
    </Dialog>
  );
}
