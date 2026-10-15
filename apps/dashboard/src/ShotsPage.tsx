import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { cameraLabel, label, lightLabel, SHOT_STATES, STATE_ICONS, type FieldDef } from "@fielder/vocab";
import { deleteShot, type Location, type SavedView, type Shot } from "./api";
import { BulkEditPanel, MoveDialog, type BulkDraft } from "./BulkEdit";
import { FilterPanel } from "./FilterBuilder";
import { cover, rigLabel, shotTitle, when } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { useKeys } from "./keys";
import { ShotsMap } from "./MapView";
import { ModeSwitch } from "./ModeSwitch";
import { ShotCard } from "./ShotCard";
import { filterPills, ruleCount, runQuery, type Layout, type RefLists, type ShotsQuery, type Sort, type StateFilter } from "./shotsQuery";
import { Banner, Button, Checkbox, confirmDialog, cx, Empty, Icon, IconButton, LinkButton, MenuItem, Popover, SearchInput, Seg, SeqBadge, StateMarker, toast, Toolbar, ToolbarSpacer, ToolbarTitle } from "./ui";

interface Props {
  shots: Shot[] | null;
  error: string | null;
  scopeName: string;
  query: ShotsQuery;
  onQuery: (q: ShotsQuery) => void;
  view: SavedView | null;
  edited: boolean;
  onSaveView: () => void;
  onSaveAsNew: () => void;
  onRevert: () => void;
  onViewMenu: (action: "rename" | "delete") => void;
  panel: boolean;
  onPanel: (open: boolean) => void;
  layout: Layout;
  onLayout: (l: Layout) => void;
  mask: MaskMode;
  onMask: (m: MaskMode) => void;
  ctx: RefLists;
  onOpen: (s: Shot, list: Shot[]) => void;
  mapSelected: string | null;
  onMapSelected: (id: string | null) => void;
  onDeleted: (ids: string[]) => void;
  onUpdated: (shots: Shot[]) => void;
  onLocations: (l: Location[]) => void;
  fieldsOf: (projectId: string) => FieldDef[];
  onReload: () => void;
  onSwitchScope: () => void;
  /** Open the New shot dialog (upload images or draw). */
  onNewShot: () => void;
}

const SORTS: { id: Sort; label: string }[] = [{ id: "newest", label: "Newest first" }, { id: "oldest", label: "Oldest first" }, { id: "name", label: "Name A–Z" }];

/** Shots: one place to browse (grid, list or map), filter (state switch, search, rules) and keep saved views. */
export function ShotsPage(p: Props) {
  const { query, onQuery, ctx } = p;
  const result = useMemo(() => (p.shots ? runQuery(p.shots, query, ctx.extra) : null), [p.shots, query, ctx.extra]);
  const shots = result?.shots ?? [];
  const rules = ruleCount(query.filter);
  const search = useRef<HTMLInputElement>(null);
  const setQuery = (q: Partial<ShotsQuery>) => onQuery({ ...query, ...q });
  const [menu, setMenu] = useState<"sort" | "view" | null>(null);

  useKeys({
    "/": () => search.current?.focus(),
    f: () => p.onPanel(!p.panel),
    "Shift+N": () => p.onNewShot(),
    Escape: (e) => { if (e.target === search.current) { search.current?.blur(); return; } return false; },
  });

  const title = p.view ? p.view.name : "Shots";
  const total = p.shots?.length ?? 0;
  const filtered = rules > 0 || query.search.trim() !== "";
  const resultLine = !result ? "Loading…" : filtered ? `${result.matched} of ${total} shots` : `${total} shots`;
  const pills = filterPills(query.filter, ctx);
  const removePill = (i: number) => setQuery({ filter: { ...query.filter, rules: query.filter.rules.filter((_, j) => j !== i) } });

  const stateOpt = (s: StateFilter) => ({
    id: s, icon: s === "all" ? undefined : STATE_ICONS[s],
    label: <>{s === "all" ? "All" : label(s)} <span class="f-seg__n">{result ? result.counts[s] : "–"}</span></>,
  });

  return (
    <>
      <Toolbar>
        <ToolbarTitle icon={p.view ? "filter-variant" : undefined} after={p.edited && <span class="f-edited">Edited</span>}>{title}</ToolbarTitle>
        {p.view && p.edited && (
          <div class="btn-row" style={{ gap: "6px" }}>
            <Button size="sm" onClick={p.onSaveView}>Save</Button>
            <Button kind="secondary" size="sm" onClick={p.onSaveAsNew}>Save as new…</Button>
            <Button kind="ghost" size="sm" onClick={p.onRevert}>Revert</Button>
          </div>
        )}
        {!p.view && rules > 0 && <Button kind="secondary" size="sm" icon="content-save-outline" onClick={p.onSaveAsNew}>Save view…</Button>}
        {p.view && (
          <div class="menu-anchor">
            <IconButton icon="dots-horizontal" label="View menu: rename, delete" aria-expanded={menu === "view"} onClick={() => setMenu(menu === "view" ? null : "view")} />
            {menu === "view" && (
              <Popover onClose={() => setMenu(null)}>
                <MenuItem icon="pencil-outline" onClick={() => { setMenu(null); p.onViewMenu("rename"); }}>Rename…</MenuItem>
                <div class="f-menu__sep" />
                <MenuItem icon="delete-outline" danger onClick={() => { setMenu(null); p.onViewMenu("delete"); }}>Delete view…</MenuItem>
              </Popover>
            )}
          </div>
        )}
        <ToolbarSpacer />
        <Button size="sm" icon="plus" kbd="⇧N" title="New shot: upload images or draw a sketch" onClick={p.onNewShot}>New shot</Button>
        <SearchInput inputRef={search} value={query.search} placeholder="Name or location" aria-label="Search shots" onInput={(e) => setQuery({ search: (e.target as HTMLInputElement).value })}
          after={query.search ? <IconButton icon="close" label="Clear search" style={{ height: "24px", width: "24px", marginRight: "4px" }} onClick={() => setQuery({ search: "" })} /> : undefined} />
        <Button kind={p.panel ? "primary" : "secondary"} size="sm" icon="filter-variant" kbd={rules > 0 && rules} aria-pressed={p.panel} onClick={() => p.onPanel(!p.panel)}>Filter</Button>
        <Seg label="Layout" value={p.layout} onChange={p.onLayout} options={[{ id: "grid", icon: "view-grid-outline", label: "Grid" }, { id: "list", icon: "view-list-outline", label: "List" }, { id: "map", icon: "map-outline", label: "Map" }]} />
        <ModeSwitch value={p.mask} onChange={p.onMask} />
      </Toolbar>
      <Toolbar sub>
        <Seg label="Review state" value={query.state} onChange={(state) => setQuery({ state })} options={(["all", ...SHOT_STATES] as StateFilter[]).map(stateOpt)} />
        {pills.length > 0 && (
          <div class="f-fpills">
            {pills.map((pl) => (
              <span key={pl.index} class={cx("f-fpill", pl.any && "f-fpill--any")}>
                <span style={{ cursor: "pointer" }} onClick={() => p.onPanel(true)}>{pl.text} <b>{pl.bold}</b></span>
                <button type="button" class="f-fpill__x" aria-label="Remove rule" onClick={() => removePill(pl.index)}><Icon name="close" /></button>
              </span>
            ))}
            <LinkButton onClick={() => setQuery({ filter: { ...query.filter, rules: [] } })}>Clear</LinkButton>
          </div>
        )}
        <ToolbarSpacer />
        <Button size="sm" icon="plus" kbd="⇧N" title="New shot: upload images or draw a sketch" onClick={p.onNewShot}>New shot</Button>
        <span class="meta num">{resultLine}</span>
        <div class="menu-anchor">
          <Button kind="ghost" size="sm" iconAfter="chevron-down" aria-expanded={menu === "sort"} onClick={() => setMenu(menu === "sort" ? null : "sort")}>{SORTS.find((s) => s.id === query.sort)?.label}</Button>
          {menu === "sort" && (
            <Popover onClose={() => setMenu(null)} right>
              {SORTS.map((s) => <MenuItem key={s.id} icon={s.id === query.sort ? "check" : "blank"} selected={s.id === query.sort} onClick={() => { setMenu(null); setQuery({ sort: s.id }); }}>{s.label}</MenuItem>)}
            </Popover>
          )}
        </div>
      </Toolbar>
      <div class="f-app__body">
        {p.error && !p.shots ? (
          <div class="f-scroll"><div style={{ padding: "16px" }}><LoadError message={p.error} onRetry={p.onReload} /></div></div>
        ) : !result ? (
          <div class="f-scroll"><div class="shot-grid">{Array.from({ length: 12 }, (_, i) => <div key={i} class="skel-card"><div class="f-skel" style={{ aspectRatio: "4 / 3", borderRadius: 0 }} /><div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "6px" }}><div class="f-skel" style={{ height: "14px", width: "70%" }} /><div class="f-skel" style={{ height: "10px", width: "50%" }} /></div></div>)}</div></div>
        ) : total === 0 ? (
          <Empty icon="camera-off-outline" title={`No shots in ${p.scopeName} yet`} actions={<Button kind="secondary" onClick={p.onSwitchScope}>Switch project</Button>}>
            Shots appear here after the phone uploads them. Pick another scope to browse other projects.
          </Empty>
        ) : shots.length === 0 && p.layout !== "map" ? (
          <Empty icon="filter-remove-outline" title="No shots match" actions={<><Button kind="secondary" onClick={() => p.onPanel(true)}>Edit filter</Button><Button kind="ghost" onClick={() => onQuery({ ...query, filter: { ...query.filter, rules: [] }, search: "", state: "all" })}>Clear filter</Button></>}>
            None of the {total} shots pass {rules > 0 ? "all rules" : "the search and state switch"}. Remove a rule or widen a range.
          </Empty>
        ) : p.layout === "map" ? (
          <ShotsMap shots={shots} mask={p.mask} selectedId={p.mapSelected} onSelect={p.onMapSelected} onOpen={(s) => p.onOpen(s, shots)} />
        ) : p.layout === "list" ? (
          <ShotsList shots={shots} mask={p.mask} onOpen={(s) => p.onOpen(s, shots)} onDeleted={p.onDeleted} bulk={{ ...p, ctx }} onBulkOpen={() => p.onPanel(false)} />
        ) : (
          <ShotsGrid shots={shots} mask={p.mask} onOpen={(s) => p.onOpen(s, shots)} />
        )}
        {p.error && p.shots && <div class="float-banner"><LoadError message={p.error} onRetry={p.onReload} /></div>}
        {p.panel && <FilterPanel group={query.filter} ctx={ctx} onChange={(filter) => setQuery({ filter })} onClose={() => p.onPanel(false)} resultLine={resultLine} />}
      </div>
    </>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Banner role="alert" title="Couldn’t load shots" meta={message} action={<Button kind="secondary" size="sm" onClick={onRetry}>Retry</Button>} />;
}

function ShotsGrid({ shots, mask, onOpen }: { shots: Shot[]; mask: MaskMode; onOpen: (s: Shot) => void }) {
  const grid = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  useEffect(() => { if (focus >= shots.length) setFocus(Math.max(0, shots.length - 1)); }, [shots.length]);
  const cols = () => (grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length : 1);
  const move = (d: number) => {
    const n = Math.max(0, Math.min(shots.length - 1, focus + d));
    setFocus(n);
    (grid.current?.querySelectorAll<HTMLElement>(".f-card")[n])?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols() : e.key === "ArrowUp" ? -cols() : 0;
    if (d) { e.preventDefault(); move(d); }
  };
  return (
    <div class="f-scroll">
      <div ref={grid} class="shot-grid" role="grid" aria-label="Shots" onKeyDown={onKey}>
        {shots.map((s, i) => <ShotCard key={s.id} shot={s} mask={mask} focused={i === focus} onFocus={() => setFocus(i)} onClick={() => onOpen(s)} />)}
      </div>
    </div>
  );
}

type BulkProps = Pick<Props, "ctx" | "onUpdated" | "onLocations" | "fieldsOf">;

function ShotsList({ shots, mask, onOpen, onDeleted, bulk, onBulkOpen }: { shots: Shot[]; mask: MaskMode; onOpen: (s: Shot) => void; onDeleted: (ids: string[]) => void; bulk: BulkProps; onBulkOpen: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The bulk edit panel's draft; null = closed. While it is open a row click selects instead of opening. */
  const [draft, setDraft] = useState<BulkDraft | null>(null);
  const [moving, setMoving] = useState(false);
  const [focus, setFocus] = useState(0);
  /** Where a Shift range starts: the row last toggled (by id, so it survives re-sorting), else the focused row. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => { setSelected((cur) => new Set([...cur].filter((id) => shots.some((s) => s.id === id)))); }, [shots]);
  useEffect(() => { body.current?.children[focus]?.scrollIntoView({ block: "nearest" }); }, [focus]);

  /** One row on/off; with `range` every row from the anchor to here takes the anchor's state (so a range can also deselect). */
  const toggle = (i: number, range: boolean) => {
    const id = shots[i]?.id;
    if (!id) return;
    const from = anchor !== null && shots.some((s) => s.id === anchor) ? shots.findIndex((s) => s.id === anchor) : focus;
    setSelected((cur) => {
      const n = new Set(cur);
      if (range && from !== i && shots[from]) {
        const on = anchor === null || cur.has(shots[from].id);
        for (let k = Math.min(from, i); k <= Math.max(from, i); k++) { if (on) n.add(shots[k].id); else n.delete(shots[k].id); }
      } else if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    setAnchor(id);
  };
  async function removeSelected() {
    const ids = shots.filter((s) => selected.has(s.id)).map((s) => s.id);
    if (!ids.length) return;
    const ok = await confirmDialog({ title: `Delete ${ids.length} shot${ids.length === 1 ? "" : "s"}?`, body: "Removes the images and their metadata permanently. Archiving keeps them.", confirmLabel: `Delete ${ids.length}`, danger: true });
    if (!ok) return;
    setBusy(true);
    const done: string[] = [], failed: string[] = [];
    for (const id of ids) { try { await deleteShot(id); done.push(id); } catch (e) { failed.push((e as Error).message); } }
    setBusy(false);
    setSelected(new Set());
    onDeleted(done);
    if (failed.length) toast(`${failed.length} deletion(s) failed: ${failed[0]}`, "danger"); else toast(`Deleted ${done.length} shot${done.length === 1 ? "" : "s"}`);
  }

  const picked = shots.filter((s) => selected.has(s.id));
  const openEdit = () => { if (!picked.length) return false; onBulkOpen(); setDraft((d) => d ?? {}); };
  async function closeEdit() {
    const n = draft ? Object.keys(draft).length : 0;
    if (n && !(await confirmDialog({ title: `Discard edits to ${n} field${n === 1 ? "" : "s"}?`, body: "No shot has changed yet.", confirmLabel: "Discard", cancelLabel: "Keep editing" }))) return;
    setDraft(null);
  }

  useKeys({
    j: () => setFocus((f) => Math.min(shots.length - 1, f + 1)),
    k: () => setFocus((f) => Math.max(0, f - 1)),
    ArrowDown: () => setFocus((f) => Math.min(shots.length - 1, f + 1)),
    ArrowUp: () => setFocus((f) => Math.max(0, f - 1)),
    x: () => toggle(focus, false),
    "Shift+X": () => toggle(focus, true),
    Enter: () => { if (shots[focus]) onOpen(shots[focus]); },
    Delete: () => void removeSelected(),
    e: () => openEdit(),
    "Shift+M": () => { if (!picked.length) return false; setMoving(true); },
    Escape: (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[aria-label=\"Bulk edit\"]")) { t.blur(); return; }
      if (draft !== null) { void closeEdit(); return; }
      if (selected.size === 0) return false;
      setSelected(new Set());
    },
  });

  const all = shots.length > 0 && selected.size === shots.length;
  const some = selected.size > 0 && !all;
  return (
    <>
    <div class="f-scroll" style={{ position: "relative" }}>
      <table class="f-table">
        <thead><tr>
          <th class="is-cell-check"><Checkbox checked={all} indeterminate={some} aria-label={all ? "Deselect all" : "Select all"} onClick={() => setSelected(all ? new Set() : new Set(shots.map((s) => s.id)))} /></th>
          <th style={{ width: "72px" }} />
          <th>Name</th><th>Location</th><th>State</th><th>INT/EXT</th><th>Light</th><th>Camera</th><th>Rig · lens</th><th class="is-num">Photos</th><th>Captured</th>
        </tr></thead>
        <tbody ref={body}>
          {shots.map((s, i) => (
            <tr key={s.id} class={cx(selected.has(s.id) && "is-selected", i === focus && "is-focus")} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }} onClick={(e) => { setFocus(i); if (draft !== null || e.shiftKey || e.metaKey || e.ctrlKey) toggle(i, e.shiftKey); else onOpen(s); }}>
              <td class="is-cell-check" onClick={(e) => { e.stopPropagation(); setFocus(i); toggle(i, e.shiftKey); }}>
                <Checkbox as="span" checked={selected.has(s.id)} role="checkbox" aria-checked={selected.has(s.id)} aria-label={`Select ${shotTitle(s)}`} />
              </td>
              <td><div class="f-table__thumb"><Framed photo={cover(s)} mode={mask} /></div></td>
              <td class="is-strong"><div style={{ display: "flex", alignItems: "center", gap: "6px", maxWidth: "240px" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{shotTitle(s)}</span>{s.photos.length > 1 && <SeqBadge count={s.photos.length} small />}</div></td>
              <td>{s.location_name ?? <span class="is-dim">—</span>}</td>
              <td><StateMarker state={s.state} /></td>
              <td>{label(s.int_ext).toUpperCase() || <span class="is-dim">—</span>}</td>
              <td>{lightLabel(s.light, s.artificial) || <span class="is-dim">—</span>}</td>
              <td>{cameraLabel(s) || <span class="is-dim">—</span>}</td>
              <td class="is-dim">{rigLabel(cover(s))}</td>
              <td class="is-num">{s.photos.length}</td>
              <td class="is-dim">{when(s.captured_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected.size > 0 && (
        <div class="selbar-wrap">
          <div class="f-selbar">
            <Icon name="checkbox-multiple-marked" size={20} />
            <span>{selected.size} selected</span>
            {!all && <LinkButton size="small" onClick={() => setSelected(new Set(shots.map((s) => s.id)))}>Select all {shots.length}</LinkButton>}
            <span class="f-selbar__sp" />
            <Button kind="ghost" size="sm" kbd={draft === null && "Esc"} onClick={() => setSelected(new Set())}>Clear</Button>
            <Button kind="secondary" size="sm" icon="folder-move-outline" kbd="⇧M" onClick={() => setMoving(true)}>Move to project…</Button>
            <Button kind={draft === null ? "secondary" : "primary"} size="sm" icon="pencil-outline" kbd="E" aria-pressed={draft !== null} onClick={() => (draft === null ? openEdit() : void closeEdit())}>Edit…</Button>
            <Button kind="danger" size="sm" icon="delete-outline" disabled={busy} onClick={() => void removeSelected()}>{busy ? "Deleting…" : `Delete ${selected.size} shot${selected.size === 1 ? "" : "s"}…`}</Button>
          </div>
        </div>
      )}
    </div>
    {draft !== null && (
      <BulkEditPanel shots={picked} draft={draft} onDraft={setDraft} projects={bulk.ctx.projects} locations={bulk.ctx.locations} onLocations={bulk.onLocations}
        fieldsOf={bulk.fieldsOf} mask={mask} onClose={() => void closeEdit()} onUpdated={bulk.onUpdated} />
    )}
    {moving && <MoveDialog shots={picked} projects={bulk.ctx.projects} onClose={() => setMoving(false)} onUpdated={bulk.onUpdated} />}
    </>
  );
}
