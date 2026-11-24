// The Optics presets app (docs/features/canvas.md, docs/rewrite/02-optics.md): the project's presets, a
// new one with the create flow, and what may change on one: the name, more lenses, archiving. What
// shapes the picture never changes; Duplicate opens the create flow with a preset's values.
import { useEffect, useMemo, useState } from "preact/hooks";
import { Badge, Button, EmptyState, FormField, Icon, NumberInput, SidebarNav, Switch, Table, TextInput, BrowserLayout, Toolbar, ToolbarSpacer, StatusBar, cx } from "@openclapper/design";
import { opticsView } from "@openclapper/fov-math";
import { focalsOf, type PresetBody } from "@openclapper/model";
import { bin, loadRoot, useRoot } from "../files";
import * as api from "../api";
import { confirm, toast, toastError } from "../hosts";
import { presetsIn, usedFocals, type Preset } from "../optics";
import { draftOf, PresetFlow } from "../PresetFlow";
import type { AppProps } from "./registry";

const lensText = (b: PresetBody) => (b.lenses.kind === "primes" ? `${[...b.lenses.primes].sort((x, y) => x - y).join(", ")} mm` : `${b.lenses.from}–${b.lenses.to} mm zoom`);
const formatText = (b: PresetBody) => `${b.formatName ?? "Own format"} · ${b.format[0]} × ${b.format[1]} mm${b.multiplier !== 1 ? ` · ×${b.multiplier}` : ""}${b.squeeze !== 1 ? ` · ${b.squeeze}× anamorphic` : ""}${b.delivery ? ` · delivers ${b.delivery}:1` : ""}`;

export function PresetsApp({ win, projectId, setTitle }: AppProps) {
  const { files } = useRoot({ project: projectId });
  const presets = presetsIn(files);
  const used = useMemo(() => usedFocals(files), [files]);
  const asked = win.resource?.type === "preset" ? win.resource.id : null;
  const [cur, setCur] = useState<string | null>(asked);
  useEffect(() => { if (asked) setCur(asked); }, [asked, win.stateSeq]);
  const [showArchived, setShowArchived] = useState(false);
  const [flow, setFlow] = useState<{ start?: ReturnType<typeof draftOf>; title?: string } | null>(null);
  const shown = presets.filter((p) => showArchived || !p.body.archived);
  const one = presets.find((p) => p.id === cur) ?? null;
  useEffect(() => { setTitle(one ? `Optics presets · ${one.name}` : "Optics presets"); }, [one?.name]);

  return (
    <BrowserLayout
      toolbar={<Toolbar><strong>Optics presets</strong><ToolbarSpacer /><Switch checked={showArchived} onChange={setShowArchived}>Archived too</Switch><Button size="sm" variant="primary" icon="plus" onClick={() => setFlow({})}>New preset</Button></Toolbar>}
      sidebar={<SidebarNav value={cur ?? "all"} onChange={(id) => setCur(id === "all" ? null : id)} sections={[{ items: [{ id: "all", label: "All presets", icon: "list" }] }, ...(shown.length ? [{ label: "Presets", items: shown.map((p) => ({ id: p.id, label: p.name, icon: "lens" as const })) }] : [])]} />}
      statusBar={<StatusBar>{presets.length} preset{presets.length === 1 ? "" : "s"}{presets.some((p) => p.body.archived) && ` · ${presets.filter((p) => p.body.archived).length} archived`} · a preset belongs to this project</StatusBar>}>
      <div className="st-scroll">
        {!presets.length && files ? (
          <EmptyState icon="lens" title="No optics presets yet" action={<Button variant="primary" icon="plus" onClick={() => setFlow({})}>New preset</Button>}>A preset is a camera with its lenses: format, multiplier, squeeze, delivery aspect and the focal lengths. Frames on a canvas use it.</EmptyState>
        ) : one ? <PresetPage key={one.id} p={one} used={used.get(one.id) ?? new Set()} onDuplicate={() => setFlow({ start: draftOf(`${one.name} copy`, one.body), title: "Duplicate as a new preset" })} onGone={() => setCur(null)} />
          : (
            <Table cursor={cur ?? undefined} onCursor={setCur} onOpen={setCur}
              columns={[{ key: "name", label: "Name" }, { key: "format", label: "Format" }, { key: "lenses", label: "Lenses" }, { key: "use", label: "Frames", numeric: true, width: 90 }]}
              rows={shown.map((p) => ({ id: p.id, name: <span className="st-inline"><strong>{p.name}</strong>{p.body.archived && <Badge>Archived</Badge>}</span>, format: formatText(p.body), lenses: lensText(p.body), use: used.get(p.id)?.size ? `${used.get(p.id)!.size} mm in use` : "–" }))} />
          )}
      </div>
      {flow && <PresetFlow projectId={projectId} files={files} start={flow.start} title={flow.title} onCreated={(id) => { setCur(id); toast("Preset created"); }} onClose={() => setFlow(null)} />}
    </BrowserLayout>
  );
}

/** One preset: its name, what it is (fixed), its lenses (add; remove only what no frame uses), archive, delete. */
function PresetPage({ p, used, onDuplicate, onGone }: { p: Preset; used: Set<number>; onDuplicate: () => void; onGone: () => void }) {
  const [name, setName] = useState(p.name);
  const [own, setOwn] = useState<number | null>(null);
  useEffect(() => setName(p.name), [p.name]);
  const save = async (change: { name?: string; body?: PresetBody }) => {
    try { await api.putFile(p.id, change); } catch (e) { toastError(e); } finally { await loadRoot({ project: p.file.project_id! }); }
  };
  const b = p.body;
  const focals = focalsOf(b.lenses);
  const minUsed = used.size ? Math.min(...used) : null, maxUsed = used.size ? Math.max(...used) : null;
  const remove = async () => {
    if (used.size) { toast("Frames use this preset: archive it instead", { tone: "warning" }); return; }
    if (!(await confirm({ title: `Delete “${p.name}”?`, message: "No frame uses it. It goes to the recycle bin.", confirmLabel: "Delete", danger: true }))) return;
    try { await bin({ project: p.file.project_id! }, [p.id]); onGone(); } catch (e) { toastError(e); }
  };
  const v = (f: number) => opticsView({ format: b.format, multiplier: b.multiplier, squeeze: b.squeeze, focal: f, delivery: b.delivery });
  return (
    <div className="pp">
      <FormField label="Name"><span className="st-inline"><TextInput value={name} maxLength={120} style={{ flex: 1 }} onInput={(e) => setName(e.currentTarget.value)} onBlur={() => { if (name.trim() && name.trim() !== p.name) void save({ name: name.trim() }); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />{b.archived && <Badge>Archived</Badge>}</span></FormField>
      <FormField label="What it is" hint="Fixed: a changed camera is a new preset (Duplicate).">
        <span className="pp-fixed"><Icon name="lock" size={12} /> {formatText(b)}</span>
      </FormField>
      <FormField label="Lenses" hint={used.size ? "A focal length that frames use cannot be removed." : "Lenses can always be added."}>
        {b.lenses.kind === "primes" ? (
          <>
            <div className="pp-primes">
              {focals.map((f) => {
                const inUse = used.has(f);
                return (
                  <span key={f} className={cx("pp-prime", inUse && "is-used")} title={inUse ? "Used by frames" : undefined}>
                    <strong>{f} mm</strong><span className="st-note">{v(f).horizontal.toFixed(0)}° · like {v(f).fullFrame.toFixed(0)} mm FF</span>
                    {inUse ? <Badge>in use</Badge> : focals.length > 1 && <Button size="sm" variant="quiet" icon="close" label={`Remove ${f} mm`} onClick={() => void save({ body: { ...b, lenses: { kind: "primes", primes: focals.filter((x) => x !== f) } } })} />}
                  </span>
                );
              })}
            </div>
            <span className="st-inline"><NumberInput size="sm" value={own} unit="mm" step={1} min={1} max={2000} placeholder="mm" onChange={(x) => setOwn(Math.round(x))} /><Button size="sm" icon="plus" disabled={!own || focals.includes(own)} onClick={() => { if (own) { void save({ body: { ...b, lenses: { kind: "primes", primes: [...focals, own] } } }); setOwn(null); } }}>Add a focal length</Button></span>
          </>
        ) : (
          <span className="st-inline">
            <NumberInput size="sm" value={b.lenses.from} unit="mm" step={1} min={1} max={minUsed ?? 2000} onChange={(x) => { const n = Math.round(x); if (b.lenses.kind === "zoom" && n < b.lenses.to && (minUsed === null || n <= minUsed)) void save({ body: { ...b, lenses: { kind: "zoom", from: n, to: b.lenses.to } } }); }} />
            <span>to</span>
            <NumberInput size="sm" value={b.lenses.to} unit="mm" step={1} min={maxUsed ?? 1} max={2000} onChange={(x) => { const n = Math.round(x); if (b.lenses.kind === "zoom" && n > b.lenses.from && (maxUsed === null || n >= maxUsed)) void save({ body: { ...b, lenses: { kind: "zoom", from: b.lenses.from, to: n } } }); }} />
            {used.size > 0 && <span className="st-note">Frames use {minUsed}–{maxUsed} mm</span>}
          </span>
        )}
      </FormField>
      <div className="pp-acts">
        <Button icon="copy" onClick={onDuplicate}>Duplicate as a new preset…</Button>
        <Button icon="archive" onClick={() => void save({ body: { ...b, archived: !b.archived } })}>{b.archived ? "Take out of the archive" : "Archive"}</Button>
        <Button variant="danger" icon="trash" disabled={used.size > 0} onClick={() => void remove()}>Delete</Button>
      </div>
      {used.size > 0 && <p className="st-note">Used by frames at {[...used].sort((x, y) => x - y).join(", ")} mm. A preset in use is archived rather than deleted: it leaves the pickers and its frames keep working.</p>}
    </div>
  );
}
