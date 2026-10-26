import { useState } from "preact/hooks";
import { rootFrame, withCentre } from "@openclapper/vocab";
import { putFraming, type Photo, type Preset, type Shot } from "./api";
import { Framed } from "./Framed";
import { AS_SHOT, choiceLabel, frameForChoice, lensesFor, type RigChoice } from "./RigExplorer";
import { Button, Checkbox, Input, Modal, Seg, Select, toast } from "@openclapper/ui";

const EPS = 1e-4;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/**
 * "Zoom sequence…" (issue #266): one saved framing per ticked lens of a rig on the selected photo,
 * all at the photo's root centre, handed back in order so the Sequence stage makes a step of each.
 * Client-side because the frame math (fov-math `reframe`) lives here and framings have an upsert
 * API; a framing identical to an existing one (rig, lens, frame) is reused, not duplicated.
 */
export function ZoomSequenceDialog({ shot, photo, presets, onClose, onUpdated, onDone }: { shot: Shot; photo: Photo; presets: Preset[]; onClose: () => void; onUpdated: (s: Shot) => void; onDone: (framingIds: string[]) => void }) {
  const [rig, setRig] = useState<string>(photo.preset_id && presets.some((p) => p.id === photo.preset_id) ? photo.preset_id : AS_SHOT);
  const [extra, setExtra] = useState<number[]>([]);
  const [custom, setCustom] = useState("");
  const [off, setOff] = useState<Set<number>>(new Set());
  const [dir, setDir] = useState<"in" | "out">("in");
  const [busy, setBusy] = useState(false);
  const preset = presets.find((p) => p.id === rig);
  const lenses = lensesFor(preset, [photo.lens_mm, ...extra]);
  const centre = rootFrame(photo) ?? { x: 0.5, y: 0.5 };
  const frameAt = (mm: number) => { const f = frameForChoice(photo, presets, { rig, lensMm: mm }); return f ? withCentre({ ...f, x: centre.x, y: centre.y }) : null; };
  const chosen = lenses.filter((mm) => !off.has(mm));
  const ordered = dir === "in" ? chosen : [...chosen].reverse();
  const addCustom = () => { const mm = Number(custom); if (mm >= 1 && mm <= 2000) { setExtra((x) => [...new Set([...x, mm])]); setCustom(""); } };

  async function run() {
    if (!ordered.length || busy) return;
    setBusy(true);
    const ids: string[] = [];
    let latest = shot;
    try {
      for (const mm of ordered) {
        const frame = frameAt(mm);
        if (!frame) continue;
        const choice: RigChoice = { rig, lensMm: mm };
        const rigId = rig === AS_SHOT ? null : rig;
        const cur = latest.photos.find((p) => p.id === photo.id) ?? photo;
        const same = cur.framings.find((f) => (f.rig_id ?? null) === rigId && near(f.lens_mm, mm) && (() => { const g = withCentre(f.frame); return near(g.width_fraction, frame.width_fraction) && near(g.height_fraction, frame.height_fraction) && near(g.x, frame.x) && near(g.y, frame.y); })());
        const id = same?.id ?? crypto.randomUUID();
        if (!same) latest = await putFraming(id, { photo_id: photo.id, name: choiceLabel(photo, presets, choice), rig_id: rigId, lens_mm: mm, frame });
        ids.push(id);
      }
      onUpdated(latest);
      onDone(ids);
      onClose();
    } catch (e) {
      // Framings saved so far stay (they are harmless); no steps were changed.
      onUpdated(latest);
      toast(`Zoom sequence stopped: ${(e as Error).message}`, "danger");
      setBusy(false);
    }
  }

  return (
    <Modal title="Zoom sequence" width="760px" onClose={onClose}>
      <div class="f-modal__body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <span class="meta">One step per lens, each a saved framing of this photo at its root centre (move the frame in the Framing stage first to change it). A lens wider than the photo is allowed: the frame then shows the hatch beyond the capture.</span>
        <div class="btn-row" style={{ gap: "8px", flexWrap: "wrap" }}>
          <Select label="Rig" prefix="Rig" width="220px" value={rig} onChange={(v) => { setRig(v); setOff(new Set()); }} options={[{ value: AS_SHOT, label: "As shot" }, ...presets.map((p) => ({ value: p.id, label: p.name }))]} />
          <Seg label="Direction" value={dir} onChange={setDir} options={[{ id: "in", label: "Zoom in (wide → tight)" }, { id: "out", label: "Zoom out (tight → wide)" }]} />
        </div>
        <div class="zoom-lenses" role="group" aria-label="Lenses">
          {lenses.map((mm) => <Checkbox key={mm} checked={!off.has(mm)} onClick={() => setOff((s) => { const n = new Set(s); if (n.has(mm)) n.delete(mm); else n.add(mm); return n; })}>{mm} mm</Checkbox>)}
          <div class="btn-row" style={{ gap: "4px" }}>
            <Input sm type="number" min={1} max={2000} value={custom} placeholder="Custom mm" style={{ width: "110px" }} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
            <Button size="sm" kind="secondary" icon="plus" disabled={!(Number(custom) >= 1)} onClick={addCustom}>Add</Button>
          </div>
        </div>
        <div class="zoom-preview" aria-label="Preview">
          {ordered.map((mm) => { const f = frameAt(mm); return f && <Framed key={mm} photo={photo} mode="mask" frame={f}><span class="f-strip__lbl">{mm} mm</span></Framed>; })}
          {!ordered.length && <span class="meta">Tick at least one lens.</span>}
        </div>
      </div>
      <div class="f-modal__foot">
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button kind="primary" icon="magnify-plus-outline" disabled={!ordered.length || busy} onClick={() => void run()}>{busy ? "Saving…" : `Add ${ordered.length} step${ordered.length === 1 ? "" : "s"}`}</Button>
      </div>
    </Modal>
  );
}
