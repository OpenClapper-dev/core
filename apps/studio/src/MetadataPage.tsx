import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { CAMERA_SUPPORTS, INT_EXT, label, SHOT_SIZES, WEATHER } from "@fielder/vocab";
import { existingIdOf, patchShot, putLocation, type Location, type Project, type Shot, type ShotState, type ShotTags } from "./api";
import { placeLabel, shotTitle } from "./format";
import type { MaskMode } from "./Framed";
import { ScrubCover, SeqBadges } from "./ShotCard";
import { Combobox, cx, EmptyNote, Icon, IconButton, Input, Panel, PanelBody, PanelHead, Seg, Select, StateMarker, toast, Toolbar, ToolbarTitle } from "@fielder/ui";

/**
 * Metadata (issue #42): sort the project's shots into the values of one single-value field
 * by drag and drop, kanban style. The left list holds the shots without a value and empties as you
 * sort; each column is a value. A drop saves at once (one PATCH, Undo in the toast); dragging a card
 * back to the left list clears the value. Multi-value fields (light, movement) are not offered.
 */

export const META_FIELDS = ["location", "int_ext", "weather", "shot_size", "camera_support", "state"] as const;
export type MetaField = (typeof META_FIELDS)[number];
const FIELD_LABELS: Record<MetaField, string> = { location: "Location", int_ext: "INT/EXT", weather: "Weather", shot_size: "Shot size", camera_support: "Camera support", state: "Review state" };
const FIELD_ICONS: Record<MetaField, string> = { location: "map-marker-outline", int_ext: "home-export-outline", weather: "weather-partly-cloudy", shot_size: "crop-free", camera_support: "video-outline", state: "checkbox-marked-outline" };

/** The shot's value for the field; null = unsorted. For the review state, "unreviewed" is the unsorted pile. */
function valueOf(s: Shot, f: MetaField): string | null {
  switch (f) {
    case "location": return s.location_id;
    case "state": return s.state === "unreviewed" ? null : s.state;
    default: return s[f];
  }
}
function patchFor(f: MetaField, v: string | null): Partial<ShotTags> & { state?: ShotState } {
  if (f === "location") return { location_id: v };
  if (f === "state") return { state: (v ?? "unreviewed") as ShotState };
  return { [f]: v };
}

type StateFilter = "review" | "unreviewed" | "approved" | "archived" | "all";
const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: "review", label: "To review + Approved" },
  { value: "unreviewed", label: "To review" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All states" },
];
const inState = (s: Shot, f: StateFilter) => f === "all" || (f === "review" ? s.state !== "archived" : s.state === f);

/**
 * Board layout: values as columns (side by side) or as rows (stacked, cards running sideways), each
 * in a fixed size that scrolls, or "fit": every lane shares the available space, so nothing scrolls.
 */
type Layout = "cols" | "rows";
type LaneSize = "s" | "m" | "l" | "fit";
const LANE_PX: Record<Layout, Record<Exclude<LaneSize, "fit">, number>> = { cols: { s: 200, m: 260, l: 340 }, rows: { s: 190, m: 260, l: 360 } };
const SIZES: LaneSize[] = ["s", "m", "l", "fit"];

/** Filters and layout, remembered per browser; added location columns per project. */
interface Prefs { state: StateFilter; q: string; layout: Layout; colSize: LaneSize; rowSize: LaneSize }
const PREFS_KEY = "metadataBoard";
function readPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    const size = (x: unknown): LaneSize => (SIZES.includes(x as LaneSize) ? (x as LaneSize) : "m");
    return {
      state: STATE_OPTIONS.some((o) => o.value === v.state) ? v.state! : "review", q: typeof v.q === "string" ? v.q : "",
      layout: v.layout === "rows" ? "rows" : "cols", colSize: size(v.colSize), rowSize: size(v.rowSize),
    };
  } catch { return { state: "review", q: "", layout: "cols", colSize: "m", rowSize: "m" }; }
}
const colsKey = (projectId: string) => `metadataColumns.${projectId}`;
function readAdded(projectId: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(colsKey(projectId)) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

const DRAG_TYPE = "application/x-fielder-meta-shot";
const LEFT = "\u0000unsorted";

interface Props {
  project: Project;
  /** The project's shots. */
  shots: Shot[];
  locations: Location[];
  onLocations: (l: Location[]) => void;
  mask: MaskMode;
  field: MetaField;
  onField: (f: MetaField) => void;
  onUpdated: (s: Shot | Shot[]) => void;
  onOpen: (s: Shot, list: Shot[]) => void;
}

export function MetadataPage(p: Props) {
  return <Board key={p.project.id} {...p} />;
}

function Board(p: Props & { project: Project }) {
  const { field } = p;
  const [prefs, setPrefs] = useState(readPrefs);
  const set = (patch: Partial<Prefs>) => setPrefs((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* per-browser convenience */ }
    return next;
  });
  const [added, setAddedState] = useState(() => readAdded(p.project.id));
  const setAdded = (l: string[]) => { setAddedState(l); try { localStorage.setItem(colsKey(p.project.id), JSON.stringify(l)); } catch { /* per-browser convenience */ } };
  const [over, setOver] = useState<string | null>(null);
  const size = prefs.layout === "cols" ? prefs.colSize : prefs.rowSize;

  const visible = useMemo(() => {
    const needle = prefs.q.trim().toLowerCase();
    return p.shots
      .filter((s) => field === "state" || inState(s, prefs.state))
      .filter((s) => !needle || shotTitle(s).toLowerCase().includes(needle) || placeLabel(s).toLowerCase().includes(needle))
      .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  }, [p.shots, prefs, field]);

  const locName = new Map(p.locations.map((l) => [l.id, l.name]));
  const columns: { value: string; label: string; closable: boolean }[] = useMemo(() => {
    switch (field) {
      case "location": {
        const used = new Set(p.shots.map((s) => s.location_id).filter((x): x is string => !!x));
        const ids = [...new Set([...used, ...added.filter((id) => locName.has(id))])];
        return ids.map((id) => ({ value: id, label: locName.get(id) ?? "Location", closable: !used.has(id) })).sort((a, b) => a.label.localeCompare(b.label));
      }
      case "int_ext": return INT_EXT.map((v) => ({ value: v, label: v.toUpperCase(), closable: false }));
      case "weather": return WEATHER.map((v) => ({ value: v, label: label(v), closable: false }));
      case "shot_size": return SHOT_SIZES.map((v) => ({ value: v, label: label(v), closable: false }));
      case "camera_support": return CAMERA_SUPPORTS.map((v) => ({ value: v, label: label(v), closable: false }));
      case "state": return [{ value: "approved", label: "Approved", closable: false }, { value: "archived", label: "Archived", closable: false }];
    }
  }, [field, p.shots, added, p.locations]);

  const unsorted = visible.filter((s) => valueOf(s, field) === null);
  const inColumn = (v: string) => visible.filter((s) => valueOf(s, field) === v);
  const labelOf = (v: string | null) => (v === null ? (field === "state" ? "Back to review" : "No value") : columns.find((c) => c.value === v)?.label ?? label(v));

  async function move(shotId: string, to: string | null) {
    const s = p.shots.find((x) => x.id === shotId);
    if (!s) return;
    const from = valueOf(s, field);
    if (from === to) return;
    try {
      p.onUpdated(await patchShot(s.id, patchFor(field, to)));
      toast(`${shotTitle(s)} → ${labelOf(to)}`, "ok", { label: "Undo", run: () => void patchShot(s.id, patchFor(field, from)).then(p.onUpdated).catch((e: Error) => toast(`Undo failed: ${e.message}`, "danger")) });
    } catch (e) { toast(`Update failed: ${(e as Error).message}`, "danger"); }
  }

  /** Drop-target props for the left list (`LEFT`) or a column value. */
  const target = (key: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== key) setOver(key);
    },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer?.getData(DRAG_TYPE);
      setOver(null);
      if (!id) return;
      e.preventDefault();
      void move(id, key === LEFT ? null : key);
    },
  });

  async function addLocation(id: string | null, createName?: string) {
    if (createName) {
      try {
        const created = await putLocation({ id: crypto.randomUUID(), project_id: p.project.id, name: createName });
        p.onLocations([...p.locations, created].sort((a, b) => a.name.localeCompare(b.name)));
        id = created.id;
      } catch (err) {
        const existing = existingIdOf(err);
        if (!existing) { toast(`Could not create the location: ${(err as Error).message}`, "danger"); return; }
        id = existing;
      }
    }
    if (id && !added.includes(id)) setAdded([...added, id]);
  }

  const card = (s: Shot, list: Shot[]) => (
    <div key={s.id} class="f-card rw-card mb-card" draggable title={`${shotTitle(s)} · drag onto a value`}
      onDragStart={(e) => { e.dataTransfer?.setData(DRAG_TYPE, s.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
      onDblClick={() => p.onOpen(s, list)}>
      <ScrubCover shot={s} mask={p.mask} badges={(at) => (
        <>
          <SeqBadges count={s.photos.length} at={at} />
          <div class="f-card__tr"><StateMarker state={s.state} iconOnly /></div>
        </>
      )} />
      <div class="f-card__body">
        <span class="f-card__title">{shotTitle(s)}</span>
        <span class="f-card__sub">{placeLabel(s) || "No location"}</span>
      </div>
    </div>
  );

  const unusedLocations = p.locations.filter((l) => !columns.some((c) => c.value === l.id));
  return (
    <>
      <Toolbar>
        <ToolbarTitle>Metadata</ToolbarTitle>
        <Select label="Field" icon={FIELD_ICONS[field]} value={field} onChange={(v) => p.onField(v as MetaField)} options={META_FIELDS.map((f) => ({ value: f, label: FIELD_LABELS[f] }))} />
        {field !== "state" && <Select label="State" icon="checkbox-marked-outline" value={prefs.state} onChange={(v) => set({ state: v as StateFilter })} options={STATE_OPTIONS} />}
        <Seg label="Lay the values out as" value={prefs.layout} onChange={(v) => set({ layout: v })}
          options={[{ id: "cols", icon: "view-column-outline", title: "Columns, side by side" }, { id: "rows", icon: "view-agenda-outline", title: "Rows, stacked" }]} />
        <Seg label={prefs.layout === "cols" ? "Column width" : "Row height"} value={size} onChange={(v) => set(prefs.layout === "cols" ? { colSize: v } : { rowSize: v })}
          options={SIZES.map((z) => (z === "fit"
            ? { id: z, icon: prefs.layout === "cols" ? "arrow-expand-horizontal" : "arrow-expand-vertical", title: `Fit: every ${prefs.layout === "cols" ? "column" : "row"} shares the screen, no scrolling` }
            : { id: z, label: z.toUpperCase(), title: `${{ s: "Small", m: "Medium", l: "Large" }[z]} ${prefs.layout === "cols" ? "columns" : "rows"} (${LANE_PX[prefs.layout][z]} px)` }))} />
        <Input sm value={prefs.q} placeholder="Search name or location…" style={{ width: "220px" }} onInput={(e) => set({ q: (e.target as HTMLInputElement).value })} />
        <span class="grow" />
        <span class="meta num">{unsorted.length} without {field === "state" ? "a decision" : FIELD_LABELS[field].toLowerCase()} · {visible.length} shots</span>
      </Toolbar>
      <div class="f-app__body">
        <Panel left label="Unsorted shots" width="380px" resize={{ key: "metadataList", min: 260, max: 720 }}>
          <PanelHead title={field === "state" ? "To review" : `No ${FIELD_LABELS[field].toLowerCase()}`}><span class="meta num">{unsorted.length}</span></PanelHead>
          <PanelBody>
            <div class={cx("mb-drop mb-drop--left", over === LEFT && "is-over")} {...target(LEFT)}>
              <span class="meta">{field === "state" ? "Drag a shot onto Approved or Archived; back here returns it to review." : "Drag a shot onto a value; back here clears it. Double-click opens it."}</span>
              {unsorted.length === 0 && <EmptyNote title="All sorted">Every shot in this filter has a {field === "state" ? "decision" : "value"}.</EmptyNote>}
              <div class="rw-grid">{unsorted.map((s) => card(s, unsorted))}</div>
            </div>
          </PanelBody>
        </Panel>
        <div class={cx("f-scroll mb-board", prefs.layout === "rows" && "mb-board--rows", size === "fit" && "mb-board--fit")}
          style={size === "fit" ? undefined : { "--mb-lane": `${LANE_PX[prefs.layout][size]}px` } as JSX.CSSProperties}>
          {columns.map((c) => {
            const list = inColumn(c.value);
            return (
              <section key={c.value} class={cx("mb-col", over === c.value && "is-over")} aria-label={c.label} {...target(c.value)}>
                <header class="mb-col__head">
                  <strong class="ellipsis">{c.label}</strong>
                  <span class="meta num">{list.length}</span>
                  {c.closable && list.length === 0 && <IconButton icon="close" label={`Close the ${c.label} column`} title="Close this column" onClick={() => setAdded(added.filter((x) => x !== c.value))} />}
                </header>
                <div class="mb-col__list">
                  {list.length === 0 && <span class="meta mb-col__empty">Drop shots here</span>}
                  {list.map((s) => card(s, list))}
                </div>
              </section>
            );
          })}
          {field === "location" && (
            <section class="mb-col mb-col--add" aria-label="Add a location column">
              <header class="mb-col__head"><Icon name="plus" /><strong>Add a location</strong></header>
              <Combobox options={unusedLocations.map((l) => ({ value: l.id, label: l.name }))} value={null} placeholder="Pick or create…" clearable={false}
                onChange={(id) => void addLocation(id)} onCreate={(name) => void addLocation(null, name)} small icon="map-marker-outline" />
              <span class="meta">The column stays (on this browser) until you close it while empty.</span>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
