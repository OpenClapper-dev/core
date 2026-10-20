import { useEffect, useState } from "preact/hooks";
import type { DeviceSpecs, DeviceSize } from "@openclapper/vocab";
import { putDevice, type DeviceRecord } from "./api";
import type { PhonePreview } from "./phonePreview";
import { Button, EmptyNote, Field, Icon, Input, Modal, Spinner, toast } from "@openclapper/ui";

/**
 * Add device specs (issue #68): read a connected phone out over the preview socket (its Shoot screen
 * size per orientation, lenses and calibration), name it and save it. The phone sends its specs on
 * request and again whenever they change, so turning it on Shoot fills in the other orientation live.
 * Also used to read an already saved phone out again.
 */
export function DeviceDialog({ phone, devices, onSaved, onClose }: { phone: PhonePreview; devices: DeviceRecord[]; onSaved: (d: DeviceRecord) => void; onClose: () => void }) {
  const candidates = phone.phones.filter((p): p is { id: string; model: string | null } => !!p.id);
  const [pick, setPick] = useState<string | null>(null);
  const id = pick ?? candidates[0]?.id ?? null;
  const specs = id ? phone.specs[id] ?? null : null;
  const known = devices.find((d) => d.id === id) ?? null;
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (id) phone.readout(); }, [id]);
  const shownName = name ?? known?.name ?? specs?.model ?? "";

  async function save() {
    if (!id || !specs || !shownName.trim()) return;
    setSaving(true);
    try {
      const d = await putDevice({ id, name: shownName.trim(), specs });
      toast(`${known ? "Updated" : "Saved"} “${d.name}”`);
      onSaved(d);
    } catch (e) { toast(`Could not save the device: ${(e as Error).message}`, "danger"); setSaving(false); }
  }

  return (
    <Modal title={known ? `Read out “${known.name}” again` : "Add device specs"} width="min(560px, 94vw)" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div class="f-modal__body device-dialog">
        {!phone.connected ? <EmptyNote title="Not connected to the server">The Studio reconnects by itself; try again in a moment.</EmptyNote>
          : !candidates.length ? (
            <EmptyNote title="Open the app on the phone">Signed in and in the foreground, the phone connects here by itself. Then open the Shoot tab.</EmptyNote>
          ) : (
            <>
              {candidates.length > 1 && (
                <Field label="Phone">
                  <span class="device-dialog__phones">
                    {candidates.map((p) => <Button key={p.id} kind={p.id === id ? "primary" : "secondary"} size="sm" icon="cellphone" onClick={() => setPick(p.id)}>{p.model ?? "Phone"}</Button>)}
                  </span>
                </Field>
              )}
              {!specs ? <p class="meta"><Spinner /> Reading the phone…</p> : (
                <dl class="device-dialog__facts">
                  <dt>Model</dt><dd>{specs.model ?? "unknown"}</dd>
                  <dt>Portrait</dt><dd><SizeLine size={specs.viewport.portrait} hint="Hold the phone upright on the Shoot tab" /></dd>
                  <dt>Landscape</dt><dd><SizeLine size={specs.viewport.landscape} hint="Turn the phone sideways on the Shoot tab (Setup → Capture → Screen orientation: Auto)" /></dd>
                  <dt>Phone lenses</dt><dd>{specs.stops.map((z) => `${z}×`).join(" · ")}{specs.zoom ? <span class="meta"> (zoom {specs.zoom.min}–{specs.zoom.max})</span> : <span class="meta"> (open Shoot once to read the camera)</span>}</dd>
                  <dt>Main lens</dt><dd>{specs.mainEquivalentMm} mm-eq <span class="meta">({specs.calibration === "auto" ? "from the photos" : "typed in"})</span></dd>
                </dl>
              )}
              <Field label="Name"><Input value={shownName} maxLength={80} placeholder="e.g. My Motorola" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
              <p class="meta">The sizes fill in as the phone shows Shoot in each orientation. Saved, the phone keeps its record up to date with every sync.</p>
            </>
          )}
      </div>
      <div class="f-modal__foot">
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button icon="content-save" disabled={!specs || !shownName.trim() || saving || !(specs.viewport.portrait || specs.viewport.landscape)} onClick={() => void save()}>{known ? "Update" : "Save device"}</Button>
      </div>
    </Modal>
  );
}

function SizeLine({ size, hint }: { size: DeviceSize | null; hint: string }) {
  return size
    ? <span><Icon name="check" /> {size.width} × {size.height} dp</span>
    : <span class="meta"><Icon name="rotate-3d-variant" /> {hint}</span>;
}

/** The screen to preview in an orientation: as measured, else the other orientation turned (minus nothing: a guess, flagged). */
export function deviceScreen(specs: DeviceSpecs | null, portrait: boolean): { w: number; h: number; guessed: boolean } {
  const want = portrait ? specs?.viewport.portrait : specs?.viewport.landscape;
  if (want) return { w: want.width, h: want.height, guessed: false };
  const other = portrait ? specs?.viewport.landscape : specs?.viewport.portrait;
  const base = other ? { w: other.height, h: other.width } : portrait ? { w: 412, h: 851 } : { w: 851, h: 412 };
  return { ...base, guessed: true };
}
