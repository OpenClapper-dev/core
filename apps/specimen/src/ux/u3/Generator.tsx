// The generator of a framing series (docs/rewrite/04-shots.md): from one photo and optics it makes ONE internal
// canvas with a frame per step, and one progression picture per frame. A zoom is frames of different focal lengths
// on one centre; a pan or a tilt is one focal length at different positions.
import { useState } from "preact/hooks";
import { Banner, Button, Dialog, FormField, NumberInput, Segmented, Select, Slider, TextInput, cx } from "@openclapper/design";
import type { FileRec } from "../u1/data";
import { PRESETS } from "../u2/model";
import { clock, eqOf, fromPreset, rect, type Fr } from "./model";
import { Pic } from "./Pic";
import { picture } from "../u1/pictures";

export interface Made { photo: string; frames: Fr[]; hold: number; add: boolean; name: string }

export default function Generator({ files, start, has, onMake, onClose }: { files: FileRec[]; start?: string; has: boolean; onMake: (m: Made) => void; onClose: () => void }) {
  const photos = files.filter((f) => f.type === "photo" && !f.binned && eqOf(f));
  const [photo, setPhoto] = useState(photos.some((p) => p.id === start) ? start! : photos.find((p) => eqOf(p) === 24)!.id);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [move, setMove] = useState("zoom");
  const [primes, setPrimes] = useState<number[] | null>(null);
  const [steps, setSteps] = useState(5);
  const [focal, setFocal] = useState<number | null>(null);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(100);
  const [hold, setHold] = useState(1);
  const [add, setAdd] = useState("replace");
  const [name, setName] = useState("");
  const [at, setAt] = useState(0);

  const file = photos.find((p) => p.id === photo)!, eq = eqOf(file)!, preset = PRESETS.find((p) => p.id === presetId)!;
  const range = preset.zoom ?? [preset.primes![0], preset.primes![preset.primes!.length - 1]];
  const one = focal != null && focal >= range[0] && focal <= range[1] ? focal : preset.primes ? preset.primes[Math.floor(preset.primes.length / 2)] : range[1];
  const n = Math.max(2, steps);
  let frames: Fr[];
  if (move === "zoom") {
    const mms = preset.primes ? (primes ?? preset.primes).filter((p) => preset.primes!.includes(p)) : [...new Set(Array.from({ length: n }, (_, i) => Math.round(range[0] + ((range[1] - range[0]) * i) / (n - 1))))];
    frames = mms.map((mm, i) => fromPreset(preset, mm, i));
  } else {
    // The frame travels as far as the photo lets it: 0 % and 100 % are the two edges.
    const size = rect(fromPreset(preset, one, 0), eq), span = move === "pan" ? Math.max(0, 1 - size.w) : Math.max(0, 1 - size.h), lo = move === "pan" ? size.w / 2 : size.h / 2;
    frames = Array.from({ length: n }, (_, i) => { const p = lo + (span * (from + ((to - from) * i) / (n - 1))) / 100; return { ...fromPreset(preset, one, i, move === "pan" ? p : 0.5, move === "tilt" ? p : 0.5), name: `${one} mm · ${i + 1}` }; });
  }
  const beyond = frames.filter((f) => { const r = rect(f, eq); return r.w > 1 || r.h > 1; });
  const still = (move === "pan" ? rect(frames[0] ?? fromPreset(preset, one, 0), eq).w : move === "tilt" ? rect(frames[0] ?? fromPreset(preset, one, 0), eq).h : 0) >= 1;
  const cur = frames[Math.min(at, frames.length - 1)];
  const seen = (f: Fr) => ({ file, src: picture(file.pic!), eq, frame: f, source: "own" as const });

  return (
    <Dialog fixed className="u3-gen" title="Generate a framing series" onClose={onClose}
      footer={<><span className="u3-hint">Makes one internal canvas on {file.name} with {frames.length} frames, and {frames.length} pictures in the progression ({clock(frames.length * hold)}).</span><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={frames.length < 2 || still} onClick={() => onMake({ photo, frames, hold, add: add === "add", name: name.trim() })}>Generate</Button></>}>
      <div className="u3-gen__grid">
        <div className="u3-gen__form">
          <FormField label="Photo" hint="Only photos with an angle of view can be framed."><Select value={photo} onChange={setPhoto} options={photos.map((p) => ({ value: p.id, label: `${p.name} · ${eqOf(p)} mm equivalent` }))} /></FormField>
          <FormField label="Optics"><Select value={presetId} onChange={(v) => { setPresetId(v); setPrimes(null); setFocal(null); setAt(0); }} options={PRESETS.map((p) => ({ value: p.id, label: p.name }))} /></FormField>
          <FormField label="Movement"><Segmented label="Movement" value={move} onChange={(v) => { setMove(v); setAt(0); }} options={[{ value: "zoom", label: "Zoom" }, { value: "pan", label: "Pan" }, { value: "tilt", label: "Tilt" }]} /></FormField>
          {move === "zoom" ? (
            preset.primes
              ? <FormField label="Focal lengths" hint="One frame per ticked lens of the preset."><span className="u3-chipset">{preset.primes.map((p) => { const on = (primes ?? preset.primes!).includes(p); return <button type="button" key={p} className={cx(on && "is-on")} onClick={() => setPrimes(on ? (primes ?? preset.primes!).filter((x) => x !== p) : [...(primes ?? preset.primes!), p].sort((a, b) => a - b))}>{p}</button>; })}</span></FormField>
              : <FormField label="Steps" hint={`Across the zoom, ${range[0]} to ${range[1]} mm.`}><NumberInput value={steps} min={2} max={12} onChange={(v) => setSteps(Math.round(v))} /></FormField>
          ) : (
            <>
              <FormField label="Focal length" hint={move === "pan" ? "From and To: 0 % is the left edge of the photo, 100 % the right." : "From and To: 0 % is the top of the photo, 100 % the bottom."}>{preset.primes ? <span className="u3-chipset">{preset.primes.map((p) => <button type="button" key={p} className={cx(one === p && "is-on")} onClick={() => setFocal(p)}>{p}</button>)}</span> : <span className="u3-slide"><Slider min={range[0]} max={range[1]} step={1} value={one} onChange={setFocal} /><b className="oc-num">{one} mm</b></span>}</FormField>
              <div className="u3-row"><FormField label="Steps"><NumberInput value={steps} min={2} max={12} onChange={(v) => setSteps(Math.round(v))} /></FormField><FormField label="From"><NumberInput value={from} unit="%" min={0} max={100} step={5} onChange={setFrom} /></FormField><FormField label="To"><NumberInput value={to} unit="%" min={0} max={100} step={5} onChange={setTo} /></FormField></div>
            </>
          )}
          <div className="u3-row"><FormField label="Each picture holds"><NumberInput value={hold} unit="s" min={0.5} max={30} step={0.5} onChange={setHold} /></FormField><FormField label="Name of the canvas"><TextInput value={name} placeholder="Framing series" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></FormField></div>
          {has && <FormField label="The shot already has a progression"><Segmented label="Existing progression" value={add} onChange={setAdd} options={[{ value: "replace", label: "Replace it" }, { value: "add", label: "Add to its end" }]} /></FormField>}
        </div>
        <div className="u3-gen__preview">
          <div className="u3-gen__stage">{cur && <Pic seen={seen(cur)} mode="outline" others={frames} label />}</div>
          <div className="u3-gen__strip">{frames.map((f, i) => <button type="button" key={f.id} className={cx(i === Math.min(at, frames.length - 1) && "is-on")} onMouseEnter={() => setAt(i)} onClick={() => setAt(i)}><span><Pic seen={seen(f)} /></span><small>{f.name}</small></button>)}</div>
          {still && <Banner tone="warning">At {one} mm the frame is as {move === "pan" ? "wide" : "tall"} as the photo: there is no room to {move}. Take a longer focal length or a wider photo.</Banner>}
          {!still && beyond.length > 0 && <Banner tone="info">{beyond.map((f) => f.name).join(", ")}: sees more than the photo shows.</Banner>}
        </div>
      </div>
    </Dialog>
  );
}
