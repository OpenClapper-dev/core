import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { CAMERA_SUPPORTS, extraSummary, INT_EXT, label, LIGHT, lightLabel, MOVEMENTS, patchExtra, PHASE_ICONS, SHOT_SIZE_ABBR, SHOT_SIZES, SHOT_STATES, WEATHER, type Extra, type ExtraValue, type FieldDef } from "@openclapper/vocab";
import { createProjectNamed, existingIdOf, patchShot, patchShots, putLocation, type BulkSet, type Location, type Project, type Shot } from "./api";
import { ExtraEditor } from "./ExtraEditor";
import { cover, shotTitle } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { invalidateDays, projectDays } from "./Inspector";
import { Button, Chip, Combobox, cx, Icon, IconButton, Input, LinkButton, Modal, Panel, PanelBody, PanelFoot, PanelHead, Seg, Switch, toast } from "@openclapper/ui";

/** Edited fields of a bulk edit by column id ("location_id", "light", "extra.<key>"); a missing id keeps every shot's value. */
export type BulkDraft = Record<string, unknown>;

/** One editable field of a shot: how to read it and how to show a value. */
interface Col { id: string; label: string; get: (s: Shot) => unknown; text: (v: unknown) => string; nullable: boolean; def?: FieldDef }

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
/** Order-independent JSON, so groups with keys in another order still compare equal. */
const canon = (v: unknown): string => isEmpty(v) ? "null"
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function valueText(def: FieldDef, v: unknown): string {
  if (def.type === "group" && v && typeof v === "object" && !Array.isArray(v)) return extraSummary(def.fields ?? [], v as Extra);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

const sizeText = (v: unknown) => `${SHOT_SIZE_ABBR[v as keyof typeof SHOT_SIZE_ABBR] ?? v} · ${label(v as string)}`;

function columns(projects: Project[], locations: Location[], defs: readonly FieldDef[]): Col[] {
  const nameIn = (list: { id: string; name: string }[], id: unknown) => list.find((x) => x.id === id)?.name ?? "deleted";
  return [
    { id: "project_id", label: "Project", get: (s) => s.project_id, text: (v) => nameIn(projects, v), nullable: false },
    { id: "name", label: "Name", get: (s) => s.name, text: String, nullable: true },
    { id: "state", label: "Review state", get: (s) => s.state, text: (v) => label(v as string), nullable: false },
    { id: "location_id", label: "Location", get: (s) => s.location_id, text: (v) => nameIn(locations, v), nullable: true },
    { id: "int_ext", label: "INT/EXT", get: (s) => s.int_ext, text: (v) => label(v as string).toUpperCase(), nullable: true },
    { id: "light", label: "Light", get: (s) => s.light, text: (v) => lightLabel(v as string[], false), nullable: true },
    { id: "artificial", label: "Artificial light", get: (s) => s.artificial, text: (v) => (v ? "Yes" : "No"), nullable: false },
    { id: "position_from_location", label: "Position", get: (s) => s.position_from_location, text: (v) => (v ? "From location" : "Own"), nullable: false },
    { id: "weather", label: "Weather", get: (s) => s.weather, text: (v) => label(v as string), nullable: true },
    { id: "shot_size", label: "Shot size", get: (s) => s.shot_size, text: sizeText, nullable: true },
    { id: "camera_support", label: "Camera support", get: (s) => s.camera_support, text: (v) => label(v as string), nullable: true },
    { id: "movement", label: "Movement", get: (s) => s.movement, text: (v) => (v as string[]).map(label).join(" / "), nullable: true },
    ...defs.map((d): Col => ({ id: `extra.${d.key}`, label: d.label, get: (s) => s.extra[d.key] ?? null, text: (v) => valueText(d, v), nullable: true, def: d })),
  ];
}

/** The extra-field part of a draft, keyed by field key. */
const extraPatchOf = (draft: BulkDraft): Extra =>
  Object.fromEntries(Object.entries(draft).filter(([id]) => id.startsWith("extra.")).map(([id, v]) => [id.slice(6), (v ?? null) as ExtraValue]));

/** A shot's value after the draft is applied, as the Worker will compute it. */
function afterOf(col: Col, s: Shot, draft: BulkDraft, defs: readonly FieldDef[]): unknown {
  if (col.def) return patchExtra(defs, s.extra, extraPatchOf(draft))[col.def.key] ?? null;
  if (!(col.id in draft)) return col.get(s);
  const v = draft[col.id];
  return col.id === "name" ? String(v ?? "").trim() || null : v;
}

/** The request body for a draft. */
function requestOf(draft: BulkDraft): { set: BulkSet; extra: Extra } {
  const set: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(draft)) {
    if (id.startsWith("extra.")) continue;
    if (id === "light" || id === "movement") set[id] = v ?? [];
    else if (id === "name") set.name = String(v ?? "").trim() || null;
    else set[id] = v ?? null;
  }
  return { set: set as BulkSet, extra: extraPatchOf(draft) };
}

/** Per shot: on how many shooting days of its own project it is planned (it leaves them when moved). */
function useDayCounts(shots: Shot[]): Map<string, number> {
  const [counts, setCounts] = useState(new Map<string, number>());
  const key = [...new Set(shots.map((s) => s.project_id))].sort().join(",");
  useEffect(() => {
    let live = true;
    void Promise.all(key.split(",").filter(Boolean).map(projectDays)).then((lists) => {
      const n = new Map<string, number>();
      for (const d of lists.flat()) for (const x of d.shots) n.set(x.shot_id, (n.get(x.shot_id) ?? 0) + 1);
      if (live) setCounts(n);
    });
    return () => { live = false; };
  }, [key]);
  return counts;
}
const leaving = (shots: Shot[], counts: Map<string, number>, to: string) => shots.filter((s) => s.project_id !== to && (counts.get(s.id) ?? 0) > 0);

/** Puts the original values of the edited fields back, shot by shot (the shooting days a move left stay left). */
async function undo(originals: Shot[], draft: BulkDraft, onUpdated: (s: Shot[]) => void) {
  const restored: Shot[] = [];
  let failed = 0;
  for (const s of originals) {
    const p: Parameters<typeof patchShot>[1] = {};
    for (const id of Object.keys(draft)) {
      if (id.startsWith("extra.")) p.extra = s.extra;
      else (p as Record<string, unknown>)[id] = s[id as keyof Shot];
    }
    try { restored.push(await patchShot(s.id, p)); } catch { failed++; }
  }
  onUpdated(restored);
  if (failed) toast(`Undo failed for ${plural(failed, "shot")}`, "danger"); else toast(`Restored ${plural(restored.length, "shot")}`, "info");
}

interface PanelProps {
  /** The selected shots, in list order. */
  shots: Shot[];
  draft: BulkDraft;
  onDraft: (d: BulkDraft) => void;
  projects: Project[];
  locations: Location[];
  onLocations: (l: Location[]) => void;
  fieldsOf: (projectId: string) => FieldDef[];
  mask: MaskMode;
  onClose: () => void;
  onUpdated: (shots: Shot[]) => void;
}

/**
 * Bulk edit of the list selection: every field of the inspector, unchanged until touched. Edited
 * fields carry an accent bar and "n of m" (opens the before/after dialog); Apply sends only those.
 */
export function BulkEditPanel({ shots, draft, onDraft, projects, locations, onLocations, fieldsOf, mask, onClose, onUpdated }: PanelProps) {
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<string[] | null>(null);
  const counts = useDayCounts(shots);

  // Extra fields: those every target project uses (a shot can only take a field its project has).
  const target = typeof draft.project_id === "string" ? draft.project_id : null;
  const targets = target ? [target] : [...new Set(shots.map((s) => s.project_id))];
  // Locations belong to a project: offer the (new) project's; a move without one remaps by name on the server.
  const locProject = target ?? shots[0]?.project_id ?? "";
  const projectLocations = locations.filter((l) => l.project_id === locProject);
  const { defs, hidden } = useMemo(() => {
    const per = targets.map(fieldsOf);
    const all = [...new Map(per.flat().map((d) => [d.key, d])).values()];
    const shared = (per[0] ?? []).filter((d) => per.every((list) => list.some((x) => x.key === d.key)));
    return { defs: shared, hidden: all.length - shared.length };
  }, [targets.join(","), fieldsOf]);
  const cols = useMemo(() => columns(projects, locations, defs), [projects, locations, defs]);

  const set = (id: string, v: unknown) => onDraft({ ...draft, [id]: v });
  const reset = (id: string) => { const { [id]: _, ...rest } = draft; onDraft(rest); };
  const edited = cols.filter((c) => c.id in draft);
  const changes = (c: Col) => shots.filter((s) => !same(c.get(s), afterOf(c, s, draft, defs))).length;
  const common = (c: Col): { mixed: number; value: unknown } => {
    const vals = new Set(shots.map((s) => canon(c.get(s))));
    return { mixed: vals.size > 1 ? vals.size : 0, value: vals.size === 1 && shots[0] ? c.get(shots[0]) : null };
  };
  const shown = (c: Col) => (c.id in draft ? draft[c.id] : common(c).value);
  const changing = shots.filter((s) => edited.some((c) => !same(c.get(s), afterOf(c, s, draft, defs))));

  async function createProject(name: string) {
    try { pickProject((await createProjectNamed(name)).id); } catch (e) { toast(`Could not create the project: ${(e as Error).message}`, "danger"); }
  }
  function pickProject(v: string | null) {
    if (!v) return;
    // Values of fields the new project does not use cannot be applied.
    const keep = new Set(fieldsOf(v).map((d) => d.key));
    const next: BulkDraft = { ...draft, project_id: v };
    for (const id of Object.keys(next)) if (id.startsWith("extra.") && !keep.has(id.slice(6))) delete next[id];
    onDraft(next);
  }
  async function pickLocation(id: string | null, createName?: string) {
    if (createName) {
      try {
        const created = await putLocation({ id: crypto.randomUUID(), project_id: locProject, name: createName });
        onLocations([...locations, created].sort((a, b) => a.name.localeCompare(b.name)));
        id = created.id;
      } catch (err) {
        const existing = existingIdOf(err);
        if (!existing) { toast(`Could not create the location: ${(err as Error).message}`, "danger"); return; }
        id = existing;
      }
    }
    set("location_id", id);
  }

  async function apply() {
    if (!edited.length || !changing.length) return;
    const originals = changing;
    const { set: s, extra } = requestOf(Object.fromEntries(edited.map((c) => [c.id, draft[c.id]])));
    const leave = target ? leaving(originals, counts, target) : [];
    setBusy(true);
    try {
      const updated = await patchShots(originals.map((x) => x.id), s, extra);
      if (target) for (const p of new Set(originals.map((x) => x.project_id))) invalidateDays(p);
      onUpdated(updated);
      const kept = draft;
      // The panel stays open on the same selection, now showing the new common values.
      onDraft({});
      toast(`Updated ${plural(updated.length, "shot")}${leave.length ? ` · ${plural(leave.length, "shot")} left shooting days` : ""}`, "ok",
        { label: "Undo", run: () => void undo(originals, kept, onUpdated) });
    } catch (e) {
      toast(`Nothing changed: ${(e as Error).message}`, "danger");
    } finally { setBusy(false); }
  }

  const field = (c: Col, control: ComponentChildren, after?: ComponentChildren) => {
    const isEdited = c.id in draft;
    const { mixed, value } = common(c);
    return (
      <div key={c.id} class={cx("bulk-field", isEdited && "is-edited")}>
        <div class="bulk-field__head">
          <span class="bulk-field__label">{c.label}</span>
          {isEdited ? <span class="bulk-field__tag"><Icon name="pencil" />Edited</span> : mixed ? <span class="meta">Mixed · {mixed} values</span> : null}
          <span class="grow" />
          {!isEdited && c.nullable && (mixed || !isEmpty(value)) && <LinkButton onClick={() => set(c.id, null)}>Clear all</LinkButton>}
          {isEdited && (
            <button type="button" class="bulk-field__diff" title={`${c.label}: before and after for each shot`} onClick={() => setDiff([c.id])}>
              <Icon name="compare-horizontal" />{changes(c)} of {shots.length} change
            </button>
          )}
          {isEdited && <IconButton icon="undo-variant" label={`Reset ${c.label}`} onClick={() => reset(c.id)} />}
        </div>
        {control}
        {after}
      </div>
    );
  };
  const col = (id: string) => cols.find((c) => c.id === id)!;
  const mixedHint = (c: Col) => (common(c).mixed && !(c.id in draft) ? "Mixed: pick to set for all" : "—");
  const light = (shown(col("light")) as string[] | null) ?? [];
  const artificial = shown(col("artificial"));
  const movement = (shown(col("movement")) as string[] | null) ?? [];
  const leave = target ? leaving(shots, counts, target) : [];
  const extraShown: Extra = Object.fromEntries(defs.map((d) => [d.key, (shown(col(`extra.${d.key}`)) ?? null) as ExtraValue]));

  return (
    <Panel label="Bulk edit" width="500px">
      <PanelHead title={`Edit ${plural(shots.length, "shot")}`}><IconButton icon="close" label="Close bulk edit" onClick={onClose} /></PanelHead>
      <PanelBody flush>
        {shots.length === 0 ? <p class="meta" style={{ padding: "16px", margin: 0 }}>Select shots in the list to edit them together.</p> : (
          <div class="bulk">
            <p class="meta bulk__intro">Only the fields you edit change; every other value stays as it is on each shot.</p>
            {field(col("project_id"),
              <Combobox small options={projects.map((p) => ({ value: p.id, label: p.name }))} value={(shown(col("project_id")) as string | null) ?? null} clearable={false} placeholder={mixedHint(col("project_id"))} onChange={pickProject} onCreate={(t) => void createProject(t)} />,
              target && leave.length > 0 && <span class="f-field__help bulk-warn"><Icon name="alert" />{plural(leave.length, "shot")} leave their shooting days.</span>)}
            {field(col("name"),
              <Input sm value={(shown(col("name")) as string | null) ?? ""} maxLength={120} placeholder={common(col("name")).mixed ? "Mixed: type to set for all" : "e.g. Bridge from the east bank"} aria-label="Name"
                onInput={(e) => set("name", (e.target as HTMLInputElement).value)} />)}
            {field(col("state"),
              <Seg label="Review state" value={(shown(col("state")) as string | null) ?? "mixed"} onChange={(v) => set("state", v)} options={SHOT_STATES.map((v) => ({ id: v, label: label(v) }))} />)}
            {field(col("location_id"),
              <Combobox small icon="map-marker-outline" options={projectLocations.map((l) => ({ value: l.id, label: l.name, hint: l.shot_count ? `${l.shot_count}` : undefined }))} value={(shown(col("location_id")) as string | null) ?? null}
                placeholder={common(col("location_id")).mixed && !("location_id" in draft) ? "Mixed: pick to set for all" : "Search or create…"} onChange={(v) => void pickLocation(v)} onCreate={(t) => void pickLocation(null, t)} />)}
            {field(col("int_ext"),
              <Seg label="INT/EXT" value={"int_ext" in draft || !common(col("int_ext")).mixed ? ((shown(col("int_ext")) as string | null) ?? "none") : "mixed"} onChange={(v) => set("int_ext", v === "none" ? null : v)}
                options={[...INT_EXT.map((v) => ({ id: v, label: label(v).toUpperCase() })), { id: "none", label: "–", title: "Not set" }]} />)}
            {field(col("light"),
              <div class="f-chips" role="group" aria-label="Light">
                {LIGHT.map((ph) => (
                  <Chip key={ph} icon={light.includes(ph) ? undefined : PHASE_ICONS[ph]} selected={light.includes(ph)}
                    onClick={() => set("light", LIGHT.filter((x) => (x === ph ? !light.includes(x) : light.includes(x))))}>{label(ph)}</Chip>
                ))}
              </div>)}
            {field(col("artificial"),
              <Seg label="Artificial light" value={typeof artificial === "boolean" ? (artificial ? "yes" : "no") : "mixed"} onChange={(v) => set("artificial", v === "yes")}
                options={[{ id: "yes", label: "Yes" }, { id: "no", label: "No" }]} />)}
            {field(col("position_from_location"),
              <Seg label="Position" value={typeof shown(col("position_from_location")) === "boolean" ? (shown(col("position_from_location")) ? "location" : "own") : "mixed"} onChange={(v) => set("position_from_location", v === "location")}
                options={[{ id: "own", label: "Own (photo GPS)" }, { id: "location", label: "From location" }]} />)}
            {field(col("weather"),
              <Combobox small options={WEATHER.map((v) => ({ value: v, label: label(v) }))} value={(shown(col("weather")) as string | null) ?? null} placeholder={mixedHint(col("weather"))} onChange={(v) => set("weather", v)} />)}
            {field(col("shot_size"),
              <Combobox small options={SHOT_SIZES.map((v) => ({ value: v, label: sizeText(v) }))} value={(shown(col("shot_size")) as string | null) ?? null} placeholder={mixedHint(col("shot_size"))} onChange={(v) => set("shot_size", v)} />)}
            {field(col("camera_support"),
              <Combobox small options={CAMERA_SUPPORTS.map((v) => ({ value: v, label: label(v) }))} value={(shown(col("camera_support")) as string | null) ?? null} placeholder={mixedHint(col("camera_support"))} onChange={(v) => set("camera_support", v)} />)}
            {field(col("movement"),
              <div class="f-chips" role="group" aria-label="Movement">
                {MOVEMENTS.map((m) => (
                  <Chip key={m} selected={movement.includes(m)} onClick={() => set("movement", MOVEMENTS.filter((x) => (x === m ? !movement.includes(x) : movement.includes(x))))}>{label(m)}</Chip>
                ))}
              </div>)}
            {(defs.length > 0 || hidden > 0) && <div class="bulk__sub">Extra fields{hidden > 0 && <span class="meta"> · {plural(hidden, "field")} hidden: not used by every project in the selection</span>}</div>}
            {defs.map((d) => field(col(`extra.${d.key}`),
              <ExtraEditor bare defs={[d]} value={extraShown} onChange={(next) => set(`extra.${d.key}`, next[d.key] ?? null)} />))}
          </div>
        )}
      </PanelBody>
      <PanelFoot>
        <span class="meta num" style={{ flex: 1 }}>{edited.length ? `${plural(edited.length, "field")} · ${changing.length} of ${shots.length} change` : "No edits yet"}</span>
        <Button kind="ghost" size="sm" disabled={!edited.length} onClick={() => setDiff(edited.map((c) => c.id))}>Review</Button>
        <Button size="sm" disabled={busy || !changing.length} onClick={() => void apply()}>{busy ? "Applying…" : `Apply to ${plural(changing.length, "shot")}`}</Button>
      </PanelFoot>
      {diff && <DiffDialog cols={cols.filter((c) => diff.includes(c.id) && c.id in draft)} shots={shots} draft={draft} defs={defs} mask={mask} onClose={() => setDiff(null)}
        onReset={diff.length === 1 ? () => { reset(diff[0]); setDiff(null); } : undefined} />}
    </Panel>
  );
}

/** Before and after for each selected shot, per edited field; unchanged shots are folded away by default. */
function DiffDialog({ cols, shots, draft, defs, mask, onClose, onReset }: { cols: Col[]; shots: Shot[]; draft: BulkDraft; defs: readonly FieldDef[]; mask: MaskMode; onClose: () => void; onReset?: () => void }) {
  const [all, setAll] = useState(false);
  const show = (c: Col, v: unknown) => (isEmpty(v) ? <span class="is-dim">—</span> : c.text(v));
  const single = cols.length === 1;
  return (
    <Modal title={single ? `${cols[0].label}: before and after` : "Review changes"} width="820px" onClose={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }} headAction={<IconButton icon="close" label="Close" onClick={onClose} />}>
      <div class="f-modal__body bulk-diff">
        {cols.length === 0 && <p class="meta">No edited fields.</p>}
        {cols.map((c) => {
          const rows = shots.map((s) => ({ s, before: c.get(s), after: afterOf(c, s, draft, defs) })).map((r) => ({ ...r, changes: !same(r.before, r.after) }));
          const n = rows.filter((r) => r.changes).length;
          const visible = all ? rows : rows.filter((r) => r.changes);
          return (
            <section key={c.id} class="bulk-diff__sec">
              <div class="bulk-diff__head">
                {!single && <h3>{c.label}</h3>}
                <span class="num"><b>{n} of {shots.length}</b> change{n < shots.length ? ` · ${shots.length - n} already have this value` : ""}</span>
              </div>
              {visible.length > 0 && (
                <table class="f-table f-table--dense">
                  <thead><tr><th style={{ width: "72px" }} /><th>Shot</th><th>Now</th><th style={{ width: "28px" }} /><th>After apply</th></tr></thead>
                  <tbody>
                    {visible.map(({ s, before, after, changes }) => (
                      <tr key={s.id} class={cx(!changes && "is-same")}>
                        <td><div class="f-table__thumb"><Framed photo={cover(s)} mode={mask} /></div></td>
                        <td class="is-strong">{shotTitle(s)}</td>
                        <td class={cx("is-wrap", changes && "bulk-diff__before")}>{show(c, before)}</td>
                        <td>{changes && <Icon name="arrow-right" />}</td>
                        <td class={cx("is-wrap", changes && "is-strong")}>{changes ? show(c, after) : <span class="is-dim">no change</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
      <div class="f-modal__foot">
        <Switch on={all} onClick={() => setAll(!all)}>Show unchanged shots</Switch>
        <span class="f-grow" />
        {onReset && <Button kind="ghost" icon="undo-variant" onClick={onReset}>Reset field</Button>}
        <Button kind="secondary" kbd="Esc" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

/** "Move to project…" for the list selection; warns about shooting days the shots leave. */
export function MoveDialog({ shots, projects, onClose, onUpdated }: { shots: Shot[]; projects: Project[]; onClose: () => void; onUpdated: (shots: Shot[]) => void }) {
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = useDayCounts(shots);
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? "deleted project";
  const from = [...shots.reduce((m, s) => m.set(s.project_id, (m.get(s.project_id) ?? 0) + 1), new Map<string, number>())];
  const moving = to ? shots.filter((s) => s.project_id !== to) : [];
  const leave = to ? leaving(shots, counts, to) : [];

  async function move() {
    if (!to || !moving.length) return;
    setBusy(true);
    try {
      const updated = await patchShots(moving.map((s) => s.id), { project_id: to });
      for (const p of new Set(moving.map((s) => s.project_id))) invalidateDays(p);
      onUpdated(updated);
      onClose();
      toast(`Moved ${plural(updated.length, "shot")} to ${nameOf(to)}${leave.length ? ` · ${plural(leave.length, "shot")} left shooting days` : ""}`, "ok",
        { label: "Undo", run: () => void undo(moving, { project_id: to }, onUpdated) });
    } catch (e) {
      toast(`Nothing moved: ${(e as Error).message}`, "danger");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Move ${plural(shots.length, "shot")}`} width="480px" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div class="f-modal__body move-dialog">
        <span class="meta">Now in {from.map(([p, n]) => `${nameOf(p)} (${n})`).join(" · ")}</span>
        <Combobox autoFocus options={projects.map((p) => ({ value: p.id, label: p.name, hint: `${p.shot_count}` }))} value={to} clearable={false} placeholder="Project… or type a new name" onChange={setTo}
          onCreate={(t) => void createProjectNamed(t).then((p) => setTo(p.id)).catch((e: Error) => toast(`Could not create the project: ${e.message}`, "danger"))} />
        {to && moving.length < shots.length && <span class="meta">{plural(shots.length - moving.length, "shot")} already in {nameOf(to)}.</span>}
        {leave.length > 0 && <span class="f-field__help bulk-warn"><Icon name="alert" />{plural(leave.length, "shot")} leave the shooting days of their project.</span>}
        <span class="meta">Extra-field values stay on the shots; the new project shows those it uses.</span>
      </div>
      <div class="f-modal__foot">
        <span class="f-grow" />
        <Button kind="ghost" kbd="Esc" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !moving.length} onClick={() => void move()}>{busy ? "Moving…" : to ? `Move ${plural(moving.length, "shot")}` : "Move"}</Button>
      </div>
    </Modal>
  );
}
