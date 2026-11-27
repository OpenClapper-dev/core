// The zoom generator (docs/features/shots.md, docs/rewrite/04-shots.md): from one photo and optics (a preset or
// free-form values) it makes ONE internal canvas with frames and one zoom block that shows it (#426 feedback 4). In
// steps: a frame per focal length, each held for its part of the block. Smooth: a start and an end frame, moved
// between over a time. Zooms only: a pan or a tilt cannot be derived from one photo. The photo is picked from cards,
// the shot's own first; a photo without an angle of view is shown but cannot be picked. Opened on a zoom block, it
// starts from that block's canvas and changes it.
import { useState } from "preact/hooks";
import { Banner, Button, Checkbox, Dialog, FormField, NumberInput, Segmented, Select, Slider, TextInput, ThumbnailTile, cx } from "@openclapper/design";
import { DELIVERIES, FORMATS, PRIMES, SQUEEZES } from "@openclapper/fov-math";
import type { CanvasBody, CanvasFrame, ItemData, PresetBody } from "@openclapper/model";
import type { FileRec } from "../api";
import { imageUrl } from "../media";
import type { Preset } from "../optics";
import { Pic } from "./Pic";
import { seeBetween, seeFrame, type PicCtx } from "./picture";
import { clock } from "./progressionParts";

/** What the generator hands back: the canvas's photo, name and frames, and the zoom block's data; `canvas` when it changes one. */
export interface Made { photo: string; name: string; frames: CanvasFrame[]; item: ItemData; canvas?: string }
const MAX = 60;
interface Free { format: [number, number]; multiplier: number; squeeze: number; delivery: number | null }

/** Why a photo cannot be zoomed into, or null when it can. */
export function zoomBlocker(p: FileRec): string | null {
  if (!p.photo?.angle_of_view) return "No angle of view: no lens is known for it";
  if (!p.photo.stored.preview) return "Its picture is not uploaded yet";
  return null;
}

export interface GeneratorProps {
  files: readonly FileRec[]; presets: readonly Preset[]; ctx: PicCtx;
  /** The photos that belong to the shot (in its content, shown by its progressions, or the base of such a canvas). */
  inShot: ReadonlySet<string>;
  start?: string;
  /** A zoom block to change: its canvas and its data. */
  editing?: { canvas: FileRec; data: ItemData };
  /** Where the result goes, said in the footer. */
  where: string;
  onMake: (m: Made) => void; onClose: () => void;
}

export function Generator({ files, presets, ctx, inShot, start, editing, where, onMake, onClose }: GeneratorProps) {
  const photos = files.filter((f) => f.type === "photo" && !f.internal_of && !f.deleted_at);
  const usable = photos.filter((p) => !zoomBlocker(p));
  const live = presets.filter((p) => !p.body.archived);
  // Opened on a zoom block: everything starts from its canvas.
  const body = editing ? (editing.canvas.body as unknown as CanvasBody | undefined) : undefined;
  const was = body?.frames ?? [];
  const wasFocals = was.map((f) => f.focal ?? 0).filter((x) => x > 0);
  const wasPreset = was[0]?.kind === "preset" ? presets.find((p) => p.id === was[0].preset) : undefined;
  const wasPhoto = editing?.canvas.refs?.find((r) => r.kind === "base")?.to;
  const firstHere = usable.find((p) => inShot.has(p.id));
  const [photoId, setPhoto] = useState(wasPhoto ?? (usable.some((p) => p.id === start) ? start! : firstHere?.id ?? usable[0]?.id ?? ""));
  const [optics, setOptics] = useState(editing ? (wasPreset?.id ?? "free") : live[0]?.id ?? "free");
  const [free, setFree] = useState<Free>(editing && was[0]?.kind === "free" ? { format: was[0].format ?? [24.89, 13.87], multiplier: was[0].multiplier ?? 1, squeeze: was[0].squeeze ?? 1, delivery: was[0].delivery ?? null } : { format: [24.89, 13.87], multiplier: 1, squeeze: 1, delivery: null });
  const [kind, setKind] = useState(editing?.data.zoom?.mode ?? "steps");
  const [primes, setPrimes] = useState<number[] | null>(wasPreset?.body.lenses.kind === "primes" && wasFocals.length ? wasFocals : null);
  const [span, setSpan] = useState<[number, number] | null>(wasFocals.length >= 2 ? [wasFocals[0], wasFocals[wasFocals.length - 1]] : null);
  const [stops, setStops] = useState(editing && editing.data.zoom?.mode === "steps" ? "typed" : "common");
  const [every, setEvery] = useState(5);
  const [typed, setTyped] = useState(wasFocals.length ? wasFocals.join(", ") : "18, 24, 35, 50");
  const n0 = Math.max(1, editing?.data.zoom?.mode === "steps" ? was.length : 1);
  const [hold, setHold] = useState(editing ? Math.max(0.1, Math.round(editing.data.ms / n0 / 100) / 10) : 1);
  const [length, setLength] = useState(editing ? editing.data.ms / 1000 : 4);
  const [eased, setEased] = useState(editing?.data.zoom?.ease ?? true);
  const [name, setName] = useState(editing?.canvas.name ?? "");
  const [at, setAt] = useState(0);
  const [u, setU] = useState(0);
  const title = editing ? "Edit the zoom" : "Generate a zoom";
  if (!usable.length) return (
    <Dialog fixed className="sh-pick" title={title} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <Banner tone="info">A zoom is made from a photo with an angle of view (taken on the phone, or with a lens in its EXIF). This project has none yet.</Banner>
    </Dialog>
  );

  const photo = usable.find((p) => p.id === photoId) ?? usable[0];
  const preset = live.find((p) => p.id === optics) ?? (wasPreset?.id === optics ? wasPreset : undefined), lenses = preset?.body.lenses;
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
  const item: ItemData = smooth ? { ms: Math.min(600_000, Math.max(100, Math.round(length * 10) * 100)), zoom: { mode: "smooth", ease: eased } } : { ms: Math.min(600_000, Math.max(100, Math.round(hold * 10) * 100) * Math.max(1, frames.length)), zoom: { mode: "steps", ease: false } };
  const total = item.ms;
  const pmap: ReadonlyMap<string, PresetBody> = ctx.presets;
  const seen = (f: CanvasFrame) => seeFrame(photo, f, pmap);
  const beyond = frames.filter((f) => { const r = seen(f).rect; return !!r && (r.w > 1 || r.h > 1); });
  const ok = smooth ? from !== to : frames.length >= 2;
  const cur = smooth ? seeBetween(photo, frames[0], frames[1], pmap, u, eased) : frames.length ? seeFrame(photo, frames[Math.min(at, frames.length - 1)], pmap, frames) : null;
  const fallback = smooth ? "Zoom" : "Framing series";
  const range = (
    <div className="sh-pair">
      <FormField label="From"><NumberInput value={from} unit="mm" min={limits[0]} max={limits[1]} onChange={(v) => setSpan([Math.round(v), to])} /></FormField>
      <FormField label="To"><NumberInput value={to} unit="mm" min={limits[0]} max={limits[1]} onChange={(v) => setSpan([from, Math.round(v)])} /></FormField>
    </div>
  );
  const here = photos.filter((p) => inShot.has(p.id)), other = photos.filter((p) => !inShot.has(p.id));
  const card = (p: FileRec) => {
    const why = zoomBlocker(p);
    return (
      <ThumbnailTile key={p.id} className={cx("sh-src", why && "is-off")} src={p.photo?.stored.thumbnail ? imageUrl(p.id, "thumbnail") : undefined} name={p.name}
        meta={why ?? (p.photo?.frame?.focal ? `taken at ${p.photo.frame.focal} mm` : `angle of view ${Math.round(p.photo!.angle_of_view!.horizontal)}°`)} selected={p.id === photo.id} disabled={!!why} title={why ?? p.name}
        onClick={() => { if (!why) { setPhoto(p.id); setAt(0); } }} />
    );
  };

  return (
    <Dialog fixed className="sh-gen" title={title} onClose={onClose}
      footer={<><span className="sh-hint">{smooth ? `One internal canvas on ${photo.name} with the start and end frame, and one smooth zoom (${clock(total)}), ${where}.` : `One internal canvas on ${photo.name} with ${frames.length} frames, and one zoom block of ${frames.length} pictures (${clock(total)}), ${where}.`}</span><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onMake({ photo: photo.id, name: name.trim() || fallback, frames, item, canvas: editing?.canvas.id })}>{editing ? "Apply" : "Generate"}</Button></>}>
      <div className="sh-gen__grid">
        <div className="sh-gen__form">
          <FormField label="Photo" hint="A zoom is cut from one photo. It needs the photo's angle of view.">
            <div className="sh-srcs">
              <h4>In this shot · {here.length}</h4>
              {here.length ? <div className="sh-srcs__grid">{here.map(card)}</div> : <p className="sh-hint">No photo of this shot yet.</p>}
              <h4>Other photos in the project · {other.length}</h4>
              <div className="sh-srcs__grid">{other.map(card)}</div>
            </div>
          </FormField>
          <FormField label="Optics"><Select value={preset ? preset.id : "free"} onChange={(v) => { setOptics(v); setPrimes(null); setSpan(null); setAt(0); }} options={[...live.map((p) => ({ value: p.id, label: p.name })), ...(wasPreset?.body.archived ? [{ value: wasPreset.id, label: `${wasPreset.name} (archived)` }] : []), { value: "free", label: "Free-form values…" }]} /></FormField>
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
            <Segmented label="Zoom" value={smooth ? "smooth" : "steps"} disabled={!!fixed} onChange={(v) => setKind(v as "steps" | "smooth")} options={[{ value: "steps", label: "In steps" }, { value: "smooth", label: "Smooth" }]} />
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
          <div className="sh-pair">{!smooth && <FormField label="Each picture holds"><NumberInput value={hold} unit="s" min={0.1} max={600} step={0.1} onChange={setHold} /></FormField>}<FormField label="Name of the canvas"><TextInput value={name} placeholder={fallback} onInput={(e) => setName(e.currentTarget.value)} /></FormField></div>
        </div>
        <div className="sh-gen__preview">
          <div className="sh-gen__stage sh-box">{cur && <Pic seen={cur} mode="outline" label />}</div>
          {smooth ? (
            <div className="sh-gen__smooth"><span className="sh-box"><Pic seen={seeBetween(photo, frames[0], frames[1], pmap, u, eased)} /></span><div><Slider min={0} max={100} value={Math.round(u * 100)} onChange={(v) => setU(v / 100)} /><small className="oc-num">{cur?.name} · {clock(u * total)} of {clock(total)}</small><small>Drag to look through the move. In the progression it plays by itself.</small></div></div>
          ) : <div className="sh-gen__strip">{frames.map((f, i) => <button type="button" key={f.id} className={cx(i === Math.min(at, frames.length - 1) && "is-on")} onMouseEnter={() => setAt(i)} onClick={() => setAt(i)}><span className="sh-box"><Pic seen={seen(f)} /></span><small>{f.name}</small></button>)}</div>}
          {many && <Banner tone="warning">{mms.length} focal lengths: only the first {MAX} are made. Take a larger step, or a smooth zoom.</Banner>}
          {!ok && <Banner tone="warning">{smooth ? "Start and end are the same focal length." : "At least two focal lengths are needed."}</Banner>}
          {beyond.length > 0 && <Banner tone="info">{beyond.length === frames.length ? "Every frame" : beyond.map((f) => f.name).join(", ")}: sees more than the photo shows.</Banner>}
          {!inShot.has(photo.id) && <Banner tone="info">{photo.name} is not in this shot yet. Once the zoom is in a progression it counts as the shot's content, without being listed.</Banner>}
        </div>
      </div>
    </Dialog>
  );
}
