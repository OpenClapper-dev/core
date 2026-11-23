// The generator of a zoom (docs/rewrite/04-shots.md): from one photo and optics it makes ONE internal canvas and the
// progression pictures that show it. In steps: a frame per focal length and a picture per frame. Smooth: two frames
// (start and end) and one picture that moves from one to the other over a time. Optics are a preset or typed values.
import { useState } from "preact/hooks";
import { Banner, Button, Checkbox, Dialog, FormField, NumberInput, Segmented, Select, Slider, TextInput, cx } from "@openclapper/design";
import type { FileRec } from "../u1/data";
import { picture } from "../u1/pictures";
import { ASPECTS, FORMATS, PRESETS, PRIMES } from "../u2/model";
import { between, clock, eqOf, fromPreset, fromValues, rect, type Fr, type Values } from "./model";
import { Pic } from "./Pic";

export interface Made { photo: string; frames: Fr[]; items: { frame: string; to?: string; hold: number; ease?: boolean }[]; add: boolean; name: string }
const MAX = 60;

export default function Generator({ files, start, has, onMake, onClose }: { files: FileRec[]; start?: string; has: boolean; onMake: (m: Made) => void; onClose: () => void }) {
  const photos = files.filter((f) => f.type === "photo" && !f.binned && eqOf(f));
  const [photo, setPhoto] = useState(photos.some((p) => p.id === start) ? start! : photos.find((p) => eqOf(p) === 24)!.id);
  const [optics, setOptics] = useState(PRESETS[0].id);
  const [free, setFree] = useState<Values>({ format: [24.89, 14], mult: 1, squeeze: 1 });
  const [kind, setKind] = useState("steps");
  const [primes, setPrimes] = useState<number[] | null>(null);
  const [span, setSpan] = useState<[number, number] | null>(null);
  const [stops, setStops] = useState("common");
  const [every, setEvery] = useState(1);
  const [typed, setTyped] = useState("18, 24, 35, 50");
  const [hold, setHold] = useState(1);
  const [length, setLength] = useState(4);
  const [ease, setEase] = useState(false);
  const [add, setAdd] = useState("replace");
  const [name, setName] = useState("");
  const [at, setAt] = useState(0);
  const [u, setU] = useState(0);

  const file = photos.find((p) => p.id === photo)!, eq = eqOf(file)!, preset = PRESETS.find((p) => p.id === optics);
  const fixed = preset?.primes, limits: [number, number] = preset?.zoom ?? (fixed ? [fixed[0], fixed[fixed.length - 1]] : [8, 300]);
  const [from, to] = span ?? (preset?.zoom ?? (fixed ? [fixed[0], fixed[fixed.length - 1]] : [18, 85]));
  const make = (mm: number, i: number) => (preset ? fromPreset(preset, mm, i) : fromValues(free, mm, i));
  const smooth = kind === "smooth" && !fixed;

  // The focal lengths of the steps, in the direction of the zoom.
  let mms: number[];
  if (fixed) mms = (primes ?? fixed).filter((p) => fixed.includes(p));
  else if (stops === "typed") mms = typed.split(/[\s,;]+/).map(Number).filter((n) => n >= limits[0] && n <= limits[1]);
  else {
    const lo = Math.min(from, to), hi = Math.max(from, to), list = stops === "common" ? PRIMES.filter((p) => p > lo && p < hi) : Array.from({ length: Math.max(0, Math.ceil((hi - lo) / Math.max(0.5, every)) - 1) }, (_, i) => Math.round((lo + (i + 1) * every) * 10) / 10);
    mms = [lo, ...list, hi].filter((v, i, a) => a.indexOf(v) === i); if (from > to) mms.reverse();
  }
  const many = mms.length > MAX;
  const frames = smooth ? [make(from, 0), make(to, 1)] : mms.slice(0, MAX).map(make);
  const items = smooth ? [{ frame: frames[0].id, to: frames[1].id, hold: length, ease }] : frames.map((f) => ({ frame: f.id, hold }));
  const total = items.reduce((a, b) => a + b.hold, 0);
  const beyond = frames.filter((f) => { const r = rect(f, eq); return r.w > 1 || r.h > 1; });
  const ok = smooth ? from !== to : frames.length >= 2;
  const cur = smooth ? between(frames[0], frames[1], u, ease) : frames[Math.min(at, frames.length - 1)];
  const seen = (f: Fr) => ({ file, src: picture(file.pic!), eq, frame: f, source: "own" as const });
  const range = (
    <div className="u3-row">
      <FormField label="From"><NumberInput value={from} unit="mm" min={limits[0]} max={limits[1]} onChange={(v) => setSpan([v, to])} /></FormField>
      <FormField label="To"><NumberInput value={to} unit="mm" min={limits[0]} max={limits[1]} onChange={(v) => setSpan([from, v])} /></FormField>
    </div>
  );

  return (
    <Dialog fixed className="u3-gen" title="Generate a zoom" onClose={onClose}
      footer={<><span className="u3-hint">{smooth ? `Makes one internal canvas on ${file.name} with the start and end frame, and one moving picture in the progression (${clock(total)}).` : `Makes one internal canvas on ${file.name} with ${frames.length} frames, and ${frames.length} pictures in the progression (${clock(total)}).`}</span><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onMake({ photo, frames, items, add: add === "add", name: name.trim() })}>Generate</Button></>}>
      <div className="u3-gen__grid">
        <div className="u3-gen__form">
          <FormField label="Photo" hint="Only photos with an angle of view can be framed."><Select value={photo} onChange={setPhoto} options={photos.map((p) => ({ value: p.id, label: `${p.name} · ${eqOf(p)} mm equivalent` }))} /></FormField>
          <FormField label="Optics"><Select value={optics} onChange={(v) => { setOptics(v); setPrimes(null); setSpan(null); setAt(0); }} options={[...PRESETS.map((p) => ({ value: p.id, label: p.name })), { value: "free", label: "Free-form values…" }]} /></FormField>
          {!preset && (
            <>
              <FormField label="Format"><Select value={`${free.format[0]}x${free.format[1]}`} onChange={(v) => { const [w, h] = v.split("x").map(Number); setFree({ ...free, format: [w, h] }); }} options={FORMATS.map(([n, w, h]) => ({ value: `${w}x${h}`, label: `${n} · ${w} × ${h} mm` }))} /></FormField>
              <div className="u3-row">
                <FormField label="Multiplier"><NumberInput value={free.mult} step={0.01} min={0.5} max={2} onChange={(v) => setFree({ ...free, mult: v })} /></FormField>
                <FormField label="Squeeze"><Select value={String(free.squeeze)} onChange={(v) => setFree({ ...free, squeeze: Number(v) })} options={[1, 1.33, 1.5, 1.8, 2].map((x) => ({ value: String(x), label: x === 1 ? "Spherical" : `${x}×` }))} /></FormField>
                <FormField label="Delivery"><Select value={free.delivery ? String(free.delivery) : ""} onChange={(v) => setFree({ ...free, delivery: v ? Number(v) : undefined })} options={[{ value: "", label: "As seen" }, ...ASPECTS.map(([n, a]) => ({ value: String(a), label: n }))]} /></FormField>
              </div>
            </>
          )}
          <FormField label="Zoom" hint={fixed ? "Primes do not zoom smoothly. For a smooth zoom take a zoom preset or free-form values." : undefined}><Segmented label="Zoom" value={smooth ? "smooth" : "steps"} disabled={!!fixed} onChange={setKind} options={[{ value: "steps", label: "In steps" }, { value: "smooth", label: "Smooth" }]} /></FormField>
          {smooth ? (
            <>
              {range}
              <div className="u3-row"><FormField label="Takes"><NumberInput value={length} unit="s" min={0.5} max={60} step={0.5} onChange={setLength} /></FormField><FormField label="Speed"><Checkbox checked={ease} onChange={setEase}>Ease in and out</Checkbox></FormField></div>
            </>
          ) : fixed ? (
            <FormField label="Focal lengths" hint="One frame per ticked lens of the preset."><span className="u3-chipset">{fixed.map((p) => { const on = (primes ?? fixed).includes(p); return <button type="button" key={p} className={cx(on && "is-on")} onClick={() => setPrimes(on ? (primes ?? fixed).filter((x) => x !== p) : [...(primes ?? fixed), p].sort((a, b) => a - b))}>{p}</button>; })}</span></FormField>
          ) : (
            <>
              <FormField label="Focal lengths"><Segmented label="Focal lengths" value={stops} onChange={setStops} options={[{ value: "common", label: "Common stops" }, { value: "every", label: "Every … mm" }, { value: "typed", label: "Typed" }]} /></FormField>
              {stops === "typed" ? <FormField label="List" hint="In the order they are shown. Separate with commas."><TextInput value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} /></FormField> : range}
              {stops === "every" && <FormField label="Step"><NumberInput value={every} unit="mm" min={0.5} max={50} step={0.5} onChange={setEvery} /></FormField>}
            </>
          )}
          <div className="u3-row">{!smooth && <FormField label="Each picture holds"><NumberInput value={hold} unit="s" min={0.1} max={30} step={0.1} onChange={setHold} /></FormField>}<FormField label="Name of the canvas"><TextInput value={name} placeholder={smooth ? "Zoom" : "Framing series"} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></FormField></div>
          {has && <FormField label="The shot already has a progression"><Segmented label="Existing progression" value={add} onChange={setAdd} options={[{ value: "replace", label: "Replace it" }, { value: "add", label: "Add to its end" }]} /></FormField>}
        </div>
        <div className="u3-gen__preview">
          <div className="u3-gen__stage">{cur && <Pic seen={seen(cur)} mode="outline" others={frames} label />}</div>
          {smooth ? (
            <div className="u3-gen__smooth"><span><Pic seen={seen(cur)} /></span><div><Slider min={0} max={100} value={Math.round(u * 100)} onChange={(v) => setU(v / 100)} /><small className="oc-num">{cur.focal!.toFixed(1)} mm · {clock(Math.round(u * length * 10) / 10)} of {clock(length)}</small><small>Drag to look through the move. In the progression it plays by itself.</small></div></div>
          ) : <div className="u3-gen__strip">{frames.map((f, i) => <button type="button" key={f.id} className={cx(i === Math.min(at, frames.length - 1) && "is-on")} onMouseEnter={() => setAt(i)} onClick={() => setAt(i)}><span><Pic seen={seen(f)} /></span><small>{f.name}</small></button>)}</div>}
          {many && <Banner tone="warning">{mms.length} focal lengths: only the first {MAX} are made. Take a larger step, or a smooth zoom.</Banner>}
          {!ok && <Banner tone="warning">{smooth ? "Start and end are the same focal length." : "At least two focal lengths are needed."}</Banner>}
          {beyond.length > 0 && <Banner tone="info">{beyond.length === frames.length ? "Every frame" : beyond.map((f) => f.name).join(", ")}: sees more than the photo shows.</Banner>}
        </div>
      </div>
    </Dialog>
  );
}
