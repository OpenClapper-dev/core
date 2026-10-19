import { useEffect, useState } from "preact/hooks";
import { CAMERAS, CUSTOM_CAMERA_ID, findFormat } from "@fielder/fov-math";
import { deletePreset, putPreset, type Preset, type Shot } from "./api";
import { bind, useKeys } from "./keys";
import { Button, Combobox, confirmDialog, cx, ErrorLine, Field, IconButton, Input, Panel, PanelBody, PanelFoot, PanelHead, Switch, toast, Toolbar, ToolbarSpacer, ToolbarTitle } from "@fielder/ui";

interface Props { presets: Preset[]; shots: Shot[]; onChange: (p: Preset[]) => void; selectedId: string | null; onSelect: (id: string | null) => void }

interface Draft { id: string; name: string; cameraId: string; formatId: string | null; w: string; h: string; sb: string; lmin: string; lmax: string; isNew: boolean }
/** Shots with at least one photo taken on the rig. */
const usedBy = (shots: Shot[], presetId: string) => shots.filter((s) => s.photos.some((p) => p.preset_id === presetId)).length;
const num = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) && v > 0 ? v : null; };
const bodyName = (p: Preset) => (p.camera_id ? CAMERAS.find((c) => c.id === p.camera_id)?.name ?? p.camera_id : "Custom");

function autoName(d: Draft): string {
  const cam = CAMERAS.find((c) => c.id === d.cameraId);
  const f = findFormat(d.cameraId, d.formatId);
  const base = cam && f ? `${cam.name.replace("Blackmagic ", "")} ${f.name.split(" ")[0]}` : "Custom";
  const sb = num(d.sb);
  return sb && sb !== 1 ? `${base} + ×${sb}` : base;
}
const toDraft = (p: Preset): Draft => ({
  id: p.id, name: p.name, isNew: false,
  cameraId: p.camera_id && findFormat(p.camera_id, p.format_id) ? p.camera_id : CUSTOM_CAMERA_ID,
  formatId: p.format_id, w: String(p.sensor_width_mm), h: String(p.sensor_height_mm), sb: p.speedbooster_factor.toFixed(2),
  lmin: p.lens_min_mm == null ? "" : String(p.lens_min_mm), lmax: p.lens_max_mm == null ? "" : String(p.lens_max_mm),
});
const newDraft = (): Draft => { const f = CAMERAS[0].formats[0]; return { id: crypto.randomUUID(), name: "", cameraId: CAMERAS[0].id, formatId: f.id, w: String(f.widthMm), h: String(f.heightMm), sb: "1.00", lmin: "", lmax: "", isNew: true }; };

/** Library › Rigs: table with usage counts | editor panel mirroring the phone's rig editor. */
export function RigsPage({ presets, shots, onChange, selectedId, onSelect }: Props) {
  const [d, setD] = useState<Draft | null>(null);
  const [focus, setFocus] = useState(0);
  useEffect(() => { const p = presets.find((x) => x.id === selectedId); if (p) setD(toDraft(p)); else if (!d?.isNew) setD(null); }, [selectedId]);
  const open = (i: number) => { const p = presets[i]; if (p) onSelect(p.id); };
  useKeys(bind("rigs", {
    down: () => setFocus((f) => Math.min(presets.length - 1, f + 1)),
    up: () => setFocus((f) => Math.max(0, f - 1)),
    open: () => open(focus),
  }), !d);
  return (
    <>
      <Toolbar><ToolbarTitle count={presets.length}>Rigs</ToolbarTitle><ToolbarSpacer /><Button size="sm" icon="plus" onClick={() => { onSelect(null); setD(newDraft()); }}>New rig</Button></Toolbar>
      <div class="f-app__body">
        <div class="f-scroll">
          <table class="f-table">
            <thead><tr><th>Name</th><th>Body</th><th>Format / sensor</th><th class="is-num">Speedbooster</th><th>Lens range</th><th class="is-num">Shots</th></tr></thead>
            <tbody>
              {presets.map((p, i) => (
                <tr key={p.id} class={cx(p.id === selectedId && "is-selected", i === focus && "is-focus")} onClick={() => { setFocus(i); onSelect(p.id); }}>
                  <td class="is-strong">{p.name}</td>
                  <td>{bodyName(p)}</td>
                  <td>{[findFormat(p.camera_id ?? "", p.format_id)?.name, `${p.sensor_width_mm} × ${p.sensor_height_mm}`].filter(Boolean).join(" · ")}</td>
                  <td class="is-num">{p.speedbooster_factor.toFixed(2)}</td>
                  <td>{p.lens_min_mm != null && p.lens_max_mm != null ? `${p.lens_min_mm}–${p.lens_max_mm} mm` : <span class="is-dim">any</span>}</td>
                  <td class="is-num">{usedBy(shots, p.id)}</td>
                </tr>
              ))}
              {presets.length === 0 && <tr><td colSpan={6} class="is-dim">No rigs yet. The phone and this page share them.</td></tr>}
            </tbody>
          </table>
          <p class="meta" style={{ padding: "12px 16px" }}>The server copy is the source of truth; the phone pulls it on every launch.</p>
        </div>
        {d && <RigEditor key={d.id} draft={d} setDraft={setD} presets={presets} used={usedBy(shots, d.id)} onChange={onChange} onClose={() => { setD(null); onSelect(null); }} onSaved={(id) => onSelect(id)} />}
      </div>
    </>
  );
}

function RigEditor({ draft: d, setDraft, presets, used, onChange, onClose, onSaved }: { draft: Draft; setDraft: (d: Draft) => void; presets: Preset[]; used: number; onChange: (p: Preset[]) => void; onClose: () => void; onSaved: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = (x: Partial<Draft>) => { setDraft({ ...d, ...x }); setError(null); };
  const custom = d.cameraId === CUSTOM_CAMERA_ID;
  const cam = CAMERAS.find((c) => c.id === d.cameraId);
  const pickCamera = (cameraId: string | null) => {
    if (!cameraId) return;
    const f = CAMERAS.find((c) => c.id === cameraId)?.formats[0];
    patch({ cameraId, formatId: f?.id ?? null, w: f ? String(f.widthMm) : d.w, h: f ? String(f.heightMm) : d.h });
  };
  const pickFormat = (formatId: string | null) => { const f = formatId ? findFormat(d.cameraId, formatId) : null; if (f && formatId) patch({ formatId, w: String(f.widthMm), h: String(f.heightMm) }); };
  const lmin = d.lmin.trim() ? num(d.lmin) : null, lmax = d.lmax.trim() ? num(d.lmax) : null;
  const rangeError = (lmin === null) !== (lmax === null) ? "Enter both ends of the lens range, or neither" : lmin !== null && lmax !== null && lmin >= lmax ? "Min must be below max" : null;
  const w = num(d.w), h = num(d.h), sb = num(d.sb);
  const invalid = !w || !h || !sb || !!rangeError;
  const crop = w && h ? Math.hypot(36, 24) / Math.hypot(w, h) : null;

  async function save() {
    if (invalid || busy) { if (!w || !h || !sb) setError("Sensor width, height and speedbooster factor are required."); return; }
    setBusy(true);
    try {
      const saved = await putPreset({ id: d.id, name: d.name.trim() || autoName(d), camera_id: custom ? null : d.cameraId, format_id: custom ? null : d.formatId, sensor_width_mm: w, sensor_height_mm: h, speedbooster_factor: sb, lens_min_mm: lmin, lens_max_mm: lmax });
      onChange([...presets.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
      toast("Rig saved");
      onSaved(saved.id);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    const ok = await confirmDialog({ title: `Delete “${d.name}”?`, body: `${used ? `${used} shot(s) reference it; they keep their framing snapshot. ` : ""}The phone drops it on its next launch.`, confirmLabel: "Delete rig", danger: true });
    if (!ok) return;
    try { await deletePreset(d.id); onChange(presets.filter((x) => x.id !== d.id)); onClose(); toast("Rig deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  useKeys(bind("rig", { save: () => void save(), close: onClose }));

  return (
    <Panel label={d.isNew ? "New rig" : "Edit rig"}>
      <PanelHead title={d.isNew ? "New rig" : d.name}><IconButton icon="close" label="Close (Esc)" onClick={onClose} /></PanelHead>
      <PanelBody>
        <Field label="Name" help={<>Empty = “{autoName(d)}”</>}><Input sm value={d.name} placeholder={autoName(d)} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} /></Field>
        <Switch on={custom} onClick={() => custom ? pickCamera(CAMERAS[0].id) : patch({ cameraId: CUSTOM_CAMERA_ID, formatId: null })}>Custom sensor size</Switch>
        {!custom && (
          <>
            <Field as="div" label="Camera body"><Combobox small options={CAMERAS.map((c) => ({ value: c.id, label: c.name }))} value={d.cameraId} clearable={false} onChange={pickCamera} /></Field>
            <Field as="div" label="Format"><Combobox small options={(cam?.formats ?? []).map((f) => ({ value: f.id, label: `${f.name} · ${f.widthMm} × ${f.heightMm} mm`, hint: f.windowed ? "windowed" : undefined }))} value={d.formatId} clearable={false} onChange={pickFormat} /></Field>
          </>
        )}
        <div class="two-col">
          <Field label="Width" labelStyle={custom ? undefined : { color: "var(--text-disabled)" }}><Input sm unit="mm" inputMode="decimal" value={d.w} disabled={!custom} onInput={(e) => patch({ w: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="Height" labelStyle={custom ? undefined : { color: "var(--text-disabled)" }}><Input sm unit="mm" inputMode="decimal" value={d.h} disabled={!custom} onInput={(e) => patch({ h: (e.target as HTMLInputElement).value })} /></Field>
        </div>
        <Field label="Speedbooster" help="1.00 = none · 0.71 = Metabones Ultra · 0.64 = XL"><Input sm unit="×" boxStyle={{ width: "140px" }} inputMode="decimal" value={d.sb} onInput={(e) => patch({ sb: (e.target as HTMLInputElement).value })} /></Field>
        <Field as="div" label="Lens range" error={rangeError} help="Empty = any lens. Limits the phone’s lens strip and the rig explorer.">
          <div class="btn-row" style={{ gap: "8px" }}>
            <Input sm unit="mm" invalid={!!rangeError} boxStyle={{ width: "100px" }} inputMode="decimal" aria-label="Shortest focal length" value={d.lmin} placeholder="min" onInput={(e) => patch({ lmin: (e.target as HTMLInputElement).value })} />–
            <Input sm unit="mm" invalid={!!rangeError} boxStyle={{ width: "100px" }} inputMode="decimal" aria-label="Longest focal length" value={d.lmax} placeholder="max" onInput={(e) => patch({ lmax: (e.target as HTMLInputElement).value })} />
          </div>
        </Field>
        <dl class="f-facts" style={{ paddingTop: "8px", borderTop: "var(--bw) solid var(--border-subtle)" }}>
          <dt>Crop</dt><dd>{crop ? `${crop.toFixed(2)} × (FF diagonal)${sb && sb !== 1 ? ` · with ×${sb}: ${(crop * sb).toFixed(2)}` : ""}` : "—"}</dd>
          {!d.isNew && <><dt>Used by</dt><dd>{used} shot{used === 1 ? "" : "s"} · they keep their framing snapshot</dd></>}
        </dl>
        {error && <ErrorLine>{error}</ErrorLine>}
      </PanelBody>
      <PanelFoot>
        {!d.isNew && <Button kind="danger" size="sm" icon="delete-outline" onClick={() => void remove()}>Delete…</Button>}
        <span class="grow" />
        <Button size="sm" kbd="⌘S" disabled={invalid || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save rig"}</Button>
      </PanelFoot>
    </Panel>
  );
}
