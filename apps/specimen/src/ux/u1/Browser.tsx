// UX workshop U1, round 1: the file browser in its five entries, with list, grid, board and map views, collections,
// search, saved filters, the bin and the properties panel. A prototype on fake data (data.ts): no server, no product code.
import "./u1.css";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  AppIcon, Badge, BrowserLayout, Breadcrumb, Button, Chip, DropdownMenu, EmptyState, Icon, MapControl, MapPin, PropertyList, PropertyRow, PropertySection, ResizablePanel,
  SearchInput, Segmented, Select, SidebarNav, StatusBar, Table, TextInput, Toast, Toolbar, ToolbarSpacer, Tree, cx,
  type IconName, type TreeNodeData,
} from "@openclapper/design";
import { FILES, PROPS, QUERIES, TYPES, type FileRec, type FileType, type PropDef } from "./data";
import { picture } from "./pictures";
import ProjectApp from "./Project";
import { Swatches } from "./catalogue";

type Entry = "files" | "media" | "shots" | "sets" | "locations" | "project";
type View = "list" | "grid" | "board" | "map";
const ENTRIES: { id: Entry; label: string; glyph: IconName; color: number; types: FileType[] }[] = [
  { id: "files", label: "Files", glyph: "folder", color: 5, types: [] },
  { id: "media", label: "Media", glyph: "image", color: 4, types: ["photo", "collection"] },
  { id: "shots", label: "Shots", glyph: "slate", color: 1, types: ["shot"] },
  { id: "sets", label: "Sets", glyph: "home", color: 7, types: ["set"] },
  { id: "locations", label: "Locations", glyph: "location", color: 3, types: ["location"] },
  { id: "project", label: "Project", glyph: "settings", color: 0, types: [] },
];
const CONTAINER: FileType[] = ["folder", "collection"];
const PICTURE: FileType[] = ["photo", "canvas"];

const byId = (files: FileRec[]) => new Map(files.map((f) => [f.id, f]));
/** The picture that stands for a file: its own, its first content picture, or a collection's first photo. */
function thumbOf(f: FileRec, files: FileRec[]): string | undefined {
  if (f.pic != null) return picture(f.pic);
  const m = byId(files);
  const first = f.type === "collection" ? files.find((c) => c.parent === f.id && !c.binned) : (f.content ?? []).map((id) => m.get(id)).find((c) => c && PICTURE.includes(c.type));
  return first?.pic != null ? picture(first.pic) : undefined;
}
const text = (v: string | string[] | undefined) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : v);

/** A choice value as a coloured tag; a reference as a chip naming the file. */
function Value({ def, value, files }: { def: PropDef; value: string | string[] | undefined; files: FileRec[] }) {
  const vals = value == null || value === "" ? [] : Array.isArray(value) ? value : [value];
  if (!vals.length) return <span className="u1-none">–</span>;
  if (def.type === "choice" || def.type === "multi") return <span className="u1-tags">{vals.map((v) => <span key={v} className="u1-tag"><i style={{ background: `var(--cat-${def.options?.find((o) => o.value === v)?.color || 0}, var(--text-secondary))` }} />{v}</span>)}</span>;
  if (def.type === "reference") { const m = byId(files); return <span className="u1-tags">{vals.map((v) => { const f = m.get(v); return <span key={v} className="u1-ref"><AppIcon glyph={TYPES[def.target!].glyph} color={TYPES[def.target!].color} size={20} />{f ? f.name : "Missing"}</span>; })}</span>; }
  return <>{vals.join(", ")}</>;
}

/** A collection's colour as CSS: a categorical token, or the user's own colour. */
const tintOf = (c: FileRec | undefined) => (c?.color == null ? undefined : typeof c.color === "number" ? `var(--cat-${c.color})` : c.color);
/** The circle in a card's corner that ticks it: shown on hover, and on every card once something is ticked. */
function Tick({ on, onTick }: { on: boolean; onTick: () => void }) {
  return <span role="checkbox" aria-checked={on} aria-label="Select" tabIndex={0} className={cx("u1-tick", on && "is-on")} onClick={(e) => { e.stopPropagation(); onTick(); }} onDblClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onTick(); } }}>{on && <Icon name="check" size={12} />}</span>;
}

/** The collection a photo sits in, if any. */
const collOf = (f: FileRec, files: FileRec[]) => { const p = f.parent ? files.find((x) => x.id === f.parent) : undefined; return p?.type === "collection" ? p : undefined; };

/**
 * A file's tile in the grid: a picture where it has one, its type icon otherwise. A collection is a stack that can be
 * scrubbed: moving the pointer across it shows each photo in turn under a red line, as on clips in an editor. A photo
 * of a collection carries the collection's colour as a mark; how it is drawn (bar below or left, dot, frame) is a personal preference.
 */
function Tile({ f, files, selected, current, mark, onClick, onTick, onOpen }: { f: FileRec; files: FileRec[]; selected: boolean; current: boolean; mark: string; onClick: (e: MouseEvent) => void; onTick: () => void; onOpen: () => void }) {
  const [scrub, setScrub] = useState<{ i: number; x: number } | null>(null);
  const t = TYPES[f.type];
  const kids = f.type === "collection" ? files.filter((c) => c.parent === f.id && !c.binned) : [];
  const src = scrub && kids[scrub.i]?.pic != null ? picture(kids[scrub.i].pic!) : thumbOf(f, files);
  const count = f.type === "collection" ? kids.length : f.type === "folder" ? files.filter((c) => c.parent === f.id && !c.binned).length : 0;
  const coll = f.type === "collection" ? f : collOf(f, files);
  const tint = tintOf(coll);
  const meta = f.type === "collection" ? `${count} photos` : f.type === "folder" ? `${count} items` : f.type === "shot" ? [text(f.props.size), text(f.props.lens)].filter(Boolean).join(" · ") || "No picture yet" : f.type === "location" ? text(f.props.address) || "No address" : f.type === "set" ? [text(f.props.intext), text(f.props.daynight)].filter(Boolean).join(" · ") : f.type === "photo" && coll ? coll.name : t.label;
  const move = (e: MouseEvent) => { if (!kids.length) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), x = Math.min(Math.max(e.clientX - r.left, 0), r.width - 1); setScrub({ i: Math.floor((x / r.width) * kids.length), x }); };
  return (
    <button type="button" className={cx("u1-tile", selected && "is-selected", current && "is-current", f.type === "collection" && "is-stack", tint && `u1-tile--${mark}`)} style={tint ? { "--coll": tint } : undefined} aria-pressed={selected} onClick={onClick} onDblClick={onOpen} draggable title={f.type === "photo" && coll ? `In the collection “${coll.name}”` : undefined}>
      <span className="u1-tile__art" onMouseMove={move} onMouseLeave={() => setScrub(null)}>
        {src ? <img src={src} alt="" /> : <AppIcon glyph={t.glyph} color={t.color} size={48} />}
        {src && f.type !== "photo" && !scrub && <span className="u1-tile__type"><AppIcon glyph={t.glyph} color={t.color} size={20} /></span>}
        {f.type === "collection" && <span className="u1-tile__count">{scrub ? `${scrub.i + 1} / ${count}` : count}</span>}
        {scrub && <span className="u1-tile__scrub" style={{ left: scrub.x }} />}
        <Tick on={selected} onTick={onTick} />
      </span>
      <span className="u1-tile__name">{tint && mark === "dot" && <i className="u1-tile__dot" />}{f.name}</span>
      <span className="u1-tile__meta">{meta}</span>
    </button>
  );
}

/** A stand-in map: a river, a few roads. Real tiles come with the build. */
function FakeMap({ items, sel, cur, pick }: { items: FileRec[]; sel: string[]; cur: string | null; pick: (id: string, e: MouseEvent) => void }) {
  const placed = items.filter((f) => f.pos), missing = items.length - placed.length;
  return (
    <div className="u1-map">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect width="100" height="100" fill="var(--surface-sunken)" />
        <path d="M0 78 C 20 70, 30 86, 52 74 S 86 60, 100 66 L100 100 L0 100Z" fill="var(--cat-6)" opacity=".28" />
        <path d="M0 40 L100 30 M30 0 L44 100 M0 62 L60 20 M62 0 L70 70 M10 10 L90 54" stroke="var(--border-control)" stroke-width="1" vector-effect="non-scaling-stroke" fill="none" />
      </svg>
      {placed.map((f) => <span key={f.id} className="u1-map__pin" style={{ left: `${f.pos![0]}%`, top: `${f.pos![1]}%` }}><MapPin icon="location" label={f.name} selected={sel.includes(f.id) || cur === f.id} onClick={(e) => pick(f.id, e)} /></span>)}
      <MapControl style={{ position: "absolute", right: 12, top: 12 }} />
      {missing > 0 && <span className="u1-map__note"><Icon name="info" size={12} /> {missing} without a position {missing === 1 ? "is" : "are"} not on the map</span>}
    </div>
  );
}

export default function U1Browser() {
  const [files, setFiles] = useState<FileRec[]>(FILES);
  const [entry, setEntry] = useState<Entry>("files");
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [nav, setNav] = useState("all");
  const [view, setView] = useState<View>("list");
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<FileType[]>([]);
  const [sort, setSort] = useState("name");
  const [boardBy, setBoardBy] = useState("status");
  const [spread, setSpread] = useState("stack");
  const [panel, setPanel] = useState("right");
  const [cards, setCards] = useState("picture");
  const [mark, setMark] = useState("bar");
  const [barAt, setBarAt] = useState("bottom");
  const markClass = mark === "bar" && barAt === "left" ? "barleft" : mark;
  const [theme, setTheme] = useState("light");
  // Two different things: the current file (one click; what the panel shows) and the ticked selection (for acting on several).
  const [cur, setCur] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const clear = () => { setSel([]); setCur(null); };
  const tick = (id: string) => setSel((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const [toast, setToast] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const map = useMemo(() => byId(files), [files]);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 2600); };
  const go = (e: Entry) => { setEntry(e); setNav("all"); clear(); setQ(""); setTypes([]); setFolder(undefined); setView("list"); setBoardBy(e === "sets" ? "daynight" : "status"); };
  const live = files.filter((f) => !f.binned);
  const flat = entry !== "files" || nav !== "all" || q !== "" || types.length > 0;

  // What the main area lists.
  const items = useMemo(() => {
    const def = ENTRIES.find((e) => e.id === entry)!;
    let out: FileRec[];
    if (entry === "files" && nav === "bin") out = files.filter((f) => f.binned);
    else if (nav in QUERIES) { const qy = QUERIES[nav]; out = live.filter((f) => qy.types.includes(f.type) && Object.entries(qy.where).every(([k, v]) => f.props[k] === v) && (!qy.empty || !(f.content ?? []).length)); }
    else if (entry === "media") {
      const inColl = (f: FileRec) => f.parent != null && map.get(f.parent)?.type === "collection";
      out = spread === "spread" || view === "board" ? live.filter((f) => f.type === "photo") : live.filter((f) => f.type === "collection" || (f.type === "photo" && !inColl(f)));
      if (nav === "collections") out = live.filter((f) => f.type === "collection");
      if (nav === "loose") out = live.filter((f) => f.type === "photo" && !inColl(f));
    } else if (entry !== "files") out = live.filter((f) => def.types.includes(f.type));
    else if (flat) out = live.filter((f) => !f.fixed);
    else out = live.filter((f) => f.parent === folder);
    if (entry === "shots" && nav === "empty") out = out.filter((f) => !(f.content ?? []).length);
    if (types.length) out = out.filter((f) => types.includes(f.type));
    if (q) { const n = q.toLowerCase(); out = out.filter((f) => f.name.toLowerCase().includes(n) || Object.values(f.props).some((v) => text(v).toLowerCase().includes(n)) || Object.entries(f.props).some(([k, v]) => PROPS.find((p) => p.id === k)?.type === "reference" && (Array.isArray(v) ? v : [v]).some((id) => map.get(id)?.name.toLowerCase().includes(n)))); }
    const order = (f: FileRec) => (CONTAINER.includes(f.type) ? "0" : "1") + (sort === "type" ? TYPES[f.type].label : sort === "created" ? f.created : "") + f.name;
    return [...out].sort((a, b) => order(a).localeCompare(order(b), undefined, { numeric: true }));
  }, [files, entry, nav, folder, q, types, sort, spread, view]);

  const pick = (id: string, e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey) tick(id);
    else if (e.shiftKey && (cur || sel.length)) { const ids = items.map((f) => f.id), a = ids.indexOf(cur ?? sel[sel.length - 1]), b = ids.indexOf(id); setSel([...new Set([...sel, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])]); }
    else setCur(id);
  };
  const open = (f: FileRec) => { if (CONTAINER.includes(f.type) && entry === "files") { setFolder(f.id); setNav("all"); setQ(""); clear(); } else if (f.type === "collection") say(`“${f.name}” opens spread out in Media`); else say(`“${f.name}” opens in the ${TYPES[f.type].app} app`); };
  const setProp = (ids: string[], key: string, value: string | string[]) => { setFiles(files.map((f) => (ids.includes(f.id) ? { ...f, props: { ...f.props, [key]: value } } : f))); };
  const setColor = (id: string, color: number | string) => setFiles(files.map((f) => (f.id === id ? { ...f, color } : f)));
  const rename = (id: string, name: string) => setFiles(files.map((f) => (f.id === id ? { ...f, name } : f)));

  // Sidebar: the tree for Files, short lists for the other entries.
  const tree = (parent: string | undefined): TreeNodeData[] => live.filter((f) => CONTAINER.includes(f.type) && f.parent === parent).map((f) => ({ id: f.id, label: f.name, icon: f.type === "collection" ? "layers" : f.fixed ? "lock" : "folder", children: tree(f.id) }));
  const count = (t: FileType[]) => live.filter((f) => t.includes(f.type)).length;
  const sidebar = entry === "files" ? (
    <div className="u1-side">
      <Tree nodes={[{ id: "root", label: "Nachtzug", icon: "film", children: tree(undefined) }]} defaultExpanded={["root", "f-scout"]} selected={nav === "all" ? folder ?? "root" : undefined} onSelect={(id) => { setFolder(id === "root" ? undefined : id); setNav("all"); clear(); setQ(""); setTypes([]); }} />
      <SidebarNav value={nav} onChange={(id) => { if (id.startsWith("home")) return say("The account home: files that follow you into every project"); setNav(id); clear(); setView(id === "bin" ? "list" : view); }} sections={[
        { label: "Filters", items: [{ id: "q1", label: "Night interiors", icon: "filter" }, { id: "q2", label: "Shots without a picture", icon: "filter" }] },
        { items: [{ id: "bin", label: "Recycle bin", icon: "trash", count: files.filter((f) => f.binned).length }] },
        { label: "Ada’s home", items: [{ id: "home-dev", label: "Devices", icon: "mobile", count: 2 }, { id: "home-lay", label: "Camera layouts", icon: "camera-layout", count: 3 }] },
      ]} />
    </div>
  ) : (
    <SidebarNav value={nav} onChange={(id) => { setNav(id); clear(); }} sections={
      entry === "media" ? [{ items: [{ id: "all", label: "All media", icon: "image", count: count(["photo"]) }, { id: "collections", label: "Collections", icon: "layers", count: count(["collection"]) }, { id: "loose", label: "Not in a collection", icon: "file" }] }]
        : entry === "shots" ? [{ items: [{ id: "all", label: "All shots", icon: "slate", count: count(["shot"]) }, { id: "empty", label: "Without a picture", icon: "ban" }] }, { label: "Filters", items: [{ id: "q1", label: "Night interiors", icon: "filter" }] }]
          : [{ items: [{ id: "all", label: entry === "sets" ? "All sets" : "All locations", icon: entry === "sets" ? "home" : "location", count: count([entry === "sets" ? "set" : "location"]) }] }]
    } />
  );

  // Toolbar.
  const crumbs = () => { const out: { id: string; label: string }[] = []; let c = folder ? map.get(folder) : undefined; while (c) { out.unshift({ id: c.id, label: c.name }); c = c.parent ? map.get(c.parent) : undefined; } return [{ id: "root", label: "Nachtzug" }, ...out]; };
  const here = ENTRIES.find((e) => e.id === entry)!;
  const title = nav === "bin" ? "Recycle bin" : nav in QUERIES ? map.get(nav)!.name : null;
  const kinds = [...new Set(items.map((f) => f.type))];
  const boardable = PROPS.filter((p) => (p.type === "choice" || (p.type === "reference" && !p.many)) && kinds.some((k) => p.on.includes(k)));
  const views: View[] = nav === "bin" ? ["list"] : [...(["list", "grid"] as View[]), ...(boardable.length ? ["board" as View] : []), ...(entry === "locations" || (entry === "files" && items.some((f) => f.pos)) ? ["map" as View] : [])];
  const shown: View = views.includes(view) ? view : "list";
  const by = boardable.find((p) => p.id === boardBy) ?? boardable[0];
  const toolbar = (
    <Toolbar>
      {entry === "files" && !title ? <Breadcrumb items={crumbs()} onNavigate={(id) => { setFolder(id === "root" ? undefined : id); clear(); }} /> : <strong className="u1-title">{title ?? here.label}</strong>}
      {flat && entry === "files" && !title && <Badge>whole project</Badge>}
      <ToolbarSpacer />
      <SearchInput size="sm" value={q} onChange={setQ} placeholder="Names and properties" style={{ width: 190 }} />
      {entry === "files" && nav === "all" && <DropdownMenu size="sm" variant="quiet" icon="filter" label={types.length ? `${types.length} types` : "Types"} align="end" items={(["photo", "collection", "canvas", "shot", "set", "location", "timeline", "preset"] as FileType[]).map((t) => ({ id: t, label: TYPES[t].plural, checked: types.includes(t) }))} onSelect={(id) => setTypes(types.includes(id as FileType) ? types.filter((t) => t !== id) : [...types, id as FileType])} />}
      {entry === "media" && nav === "all" && shown !== "board" && <Segmented label="Collections" value={spread} onChange={setSpread} options={[{ value: "stack", icon: "layers", title: "Collections as one tile" }, { value: "spread", icon: "grid", title: "Collections spread out" }]} />}
      {shown === "board" && by && <Select size="sm" value={by.id} onChange={setBoardBy} options={boardable.map((p) => ({ value: p.id, label: `By ${p.name.toLowerCase()}` }))} />}
      {shown !== "board" && shown !== "map" && <Select size="sm" value={sort} onChange={setSort} options={[{ value: "name", label: "Name" }, { value: "created", label: "Created" }, { value: "type", label: "Type" }]} />}
      <Segmented label="View" value={shown} onChange={(v) => setView(v as View)} options={views.map((v) => ({ value: v, icon: (v === "board" ? "columns" : v === "map" ? "map" : v) as IconName, title: v[0].toUpperCase() + v.slice(1) }))} />
      {nav !== "bin" && <DropdownMenu size="sm" variant="primary" icon="plus" label="New" align="end" items={entry === "files" ? [{ id: "folder", label: "Folder", icon: "folder-plus" }, { id: "shot", label: "Shot", icon: "slate" }, { id: "canvas", label: "Canvas", icon: "brush" }, { id: "set", label: "Set", icon: "home" }, { id: "location", label: "Location", icon: "location" }, { separator: true }, { id: "import", label: "Import photos…", icon: "upload" }] : entry === "media" ? [{ id: "import", label: "Import photos…", icon: "upload" }, { id: "collection", label: "Collection from selection", icon: "layers", disabled: sel.length < 2 }] : here.types.length ? [{ id: here.types[0], label: TYPES[here.types[0]].label, icon: here.glyph }] : []} onSelect={(id) => say(id === "import" ? "Import: pick files or drop them here" : `New ${id}: named by the project’s pattern`)} />}
    </Toolbar>
  );

  // Main area.
  const collCell = (f: FileRec) => { const c = collOf(f, files); return c ? <span className="u1-tag"><i style={{ background: tintOf(c) }} />{c.name}</span> : f.type === "collection" ? <span className="u1-tag"><i style={{ background: tintOf(f) }} />{files.filter((x) => x.parent === f.id && !x.binned).length} photos</span> : <span className="u1-none">–</span>; };
  const cols = entry === "shots" ? ["scene", "no", "size", "set", "status"] : entry === "sets" ? ["intext", "daynight", "locations"] : entry === "locations" ? ["address"] : [];
  const listRows = items.map((f) => ({
    id: f.id,
    name: <span className="u1-name">{thumbOf(f, files) && PICTURE.includes(f.type) ? <img className="u1-mini" src={thumbOf(f, files)} alt="" /> : <AppIcon glyph={TYPES[f.type].glyph} color={TYPES[f.type].color} size={20} />}{f.name}{f.fixed && <Icon name="lock" size={12} label="Fixed folder" />}</span>,
    type: TYPES[f.type].label,
    where: f.parent ? map.get(f.parent)?.name ?? "" : "Top level",
    created: f.created,
    coll: collCell(f),
    ...Object.fromEntries(cols.map((c) => [c, <Value key={c} def={PROPS.find((p) => p.id === c)!} value={f.props[c]} files={files} />])),
    ...(nav === "bin" ? { act: <Button size="sm" variant="quiet" icon="history" onClick={() => { setFiles(files.map((x) => (x.id === f.id ? { ...x, binned: false } : x))); say(`Restored “${f.name}”, also everywhere it was used`); }}>Restore</Button> } : {}),
  }));
  const main = !items.length ? <EmptyState icon={q ? "search" : nav === "bin" ? "trash" : "folder-open"} title={q ? `Nothing matches “${q}”` : nav === "bin" ? "The bin is empty" : "Nothing here yet"}>{q ? "Search looks at names and at every property value." : nav === "bin" ? "" : "Drop files here, or use New."}</EmptyState>
    : shown === "list" ? (
      <Table selectable selected={sel} onSelect={setSel} cursor={cur ?? undefined} onCursor={setCur} onOpen={(id) => open(map.get(id)!)} sort={{ key: sort === "created" ? "created" : sort === "type" ? "type" : "name", dir: "asc" }} onSort={(s) => setSort(s.key === "created" ? "created" : s.key === "type" ? "type" : "name")}
        columns={[{ key: "name", label: "Name", sortable: true }, ...(entry === "media" ? [{ key: "coll", label: "Collection" }] : cols.length ? cols.map((c) => ({ key: c, label: PROPS.find((p) => p.id === c)!.name })) : [{ key: "type", label: "Type", sortable: true }, ...(flat ? [{ key: "where", label: "In" }] : [])]), { key: "created", label: "Created", sortable: true, mono: true }, ...(nav === "bin" ? [{ key: "act", label: "" }] : [])]} rows={listRows} />
    ) : shown === "grid" ? (
      <div className={cx("u1-grid", sel.length > 0 && "has-ticks")}>{items.map((f) => <Tile key={f.id} f={f} files={files} mark={markClass} selected={sel.includes(f.id)} current={cur === f.id} onClick={(e) => pick(f.id, e)} onTick={() => tick(f.id)} onOpen={() => open(f)} />)}</div>
    ) : shown === "map" ? <FakeMap items={items} sel={sel} cur={cur} pick={pick} />
      : by ? (
        <div className={cx("u1-board", sel.length > 0 && "has-ticks")}>
          {[...(by.type === "reference" ? live.filter((f) => f.type === by.target).map((f) => ({ value: f.id, label: f.name, color: 0 })) : by.options!.map((o) => ({ value: o.value, label: o.value, color: o.color }))), { value: "", label: `No ${by.name.toLowerCase()}`, color: 0 }].map((col) => {
            const inCol = items.filter((f) => by.on.includes(f.type) && text(f.props[by.id]) === col.value);
            return (
              <section key={col.value} className={cx("u1-col", over === col.value && "is-over")} onDragOver={(e) => { e.preventDefault(); setOver(col.value); }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer?.getData("text/plain"); if (!id) return; const ids = sel.includes(id) ? sel : [id]; setProp(ids, by.id, col.value); say(`${by.name} set to ${col.label} on ${ids.length === 1 ? map.get(id)!.name : ids.length + " files"}`); }}>
                <header><i style={{ background: col.color ? `var(--cat-${col.color})` : "var(--text-disabled)" }} />{col.label}<span className="oc-num">{inCol.length}</span></header>
                {inCol.map((f) => (
                  <button type="button" key={f.id} draggable className={cx("u1-card", sel.includes(f.id) && "is-selected", cur === f.id && "is-current", collOf(f, files) && `u1-card--${markClass}`)} style={collOf(f, files) ? { "--coll": tintOf(collOf(f, files)) } : undefined} title={collOf(f, files) ? `In the collection “${collOf(f, files)!.name}”` : undefined} onClick={(e) => pick(f.id, e)} onDblClick={() => open(f)} onDragStart={(e) => e.dataTransfer?.setData("text/plain", f.id)}>
                    <Tick on={sel.includes(f.id)} onTick={() => tick(f.id)} />
                    {cards === "picture" && (thumbOf(f, files) ? <span className="u1-card__art"><img src={thumbOf(f, files)} alt="" /></span> : <span className="u1-card__blank"><AppIcon glyph={TYPES[f.type].glyph} color={TYPES[f.type].color} size={24} /></span>)}
                    <span className="u1-card__name">{collOf(f, files) && (markClass === "dot" || cards === "compact") ? <i className="u1-tile__dot" /> : <AppIcon glyph={TYPES[f.type].glyph} color={TYPES[f.type].color} size={20} />}{f.name}</span>
                    <span className="u1-card__meta">{[text(f.props.scene) && `Sc. ${text(f.props.scene)}`, text(f.props.size), text(f.props.lens)].filter(Boolean).join(" · ") || collOf(f, files)?.name || TYPES[f.type].label}</span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      ) : null;

  // Properties panel: nothing selected, one file, or several (bulk edit).
  const chosen = (sel.length ? sel : cur ? [cur] : []).map((id) => map.get(id)).filter((f): f is FileRec => !!f);
  const one = chosen.length === 1 ? chosen[0] : null;
  const shared = chosen.length ? PROPS.filter((p) => chosen.every((f) => p.on.includes(f.type))) : [];
  const usedIn = one ? live.filter((f) => (f.content ?? []).includes(one.id) || Object.values(f.props).some((v) => (Array.isArray(v) ? v : [v]).includes(one.id))) : [];
  const editor = (p: PropDef): ComponentChildren => {
    const vals = chosen.map((f) => text(f.props[p.id])), mixed = new Set(vals).size > 1, v = mixed ? "" : vals[0] ?? "";
    const ids = chosen.map((f) => f.id);
    if (p.type === "choice") return <Select size="sm" value={v} onChange={(x) => setProp(ids, p.id, x)} options={[{ value: "", label: mixed ? "Mixed" : "–" }, ...p.options!.map((o) => ({ value: o.value, label: o.value }))]} />;
    if (p.type === "reference" && !p.many) return <Select size="sm" value={v} onChange={(x) => setProp(ids, p.id, x)} options={[{ value: "", label: mixed ? "Mixed" : "–" }, ...live.filter((f) => f.type === p.target).map((f) => ({ value: f.id, label: f.name }))]} />;
    if (p.type === "multi" || p.type === "reference") return mixed ? <span className="u1-none">Mixed</span> : <Value def={p} value={chosen[0].props[p.id]} files={files} />;
    if (p.type === "position") return one?.pos ? <span className="oc-num">53.54{one.pos[0]}° N, 9.9{one.pos[1]}° E</span> : <Button size="sm" variant="quiet" icon="pin" onClick={() => say("Place a pin on the map, or type coordinates")}>Set position</Button>;
    return <TextInput size="sm" value={v} placeholder={mixed ? "Mixed" : ""} onInput={(e) => setProp(ids, p.id, (e.target as HTMLInputElement).value)} />;
  };
  const sections = [...new Set(shared.map((p) => p.section ?? "Properties"))];
  const info = (
    <ResizablePanel key={panel} side={panel === "bottom" ? "bottom" : "right"} defaultSize={panel === "bottom" ? 240 : 320} min={panel === "bottom" ? 160 : 260} max={panel === "bottom" ? 480 : 560} className={cx("u1-info", `u1-info--${panel}`)} aria-label="Properties">
      {!chosen.length ? <EmptyState icon="info" title={title ?? (entry === "files" ? (folder ? map.get(folder)!.name : "Nachtzug") : here.label)}>{items.length} items. Click one to see its properties. Tick several to edit them together.</EmptyState> : (
        <>
          <header className="u1-info__head">
            {one ? (thumbOf(one, files) ? <img src={thumbOf(one, files)} alt="" /> : <span className="u1-info__icon"><AppIcon glyph={TYPES[one.type].glyph} color={TYPES[one.type].color} size={48} /></span>) : <span className="u1-info__icon"><Icon name="files" size={20} /> <strong>{chosen.length} files ticked</strong></span>}
            {one && <TextInput value={one.name} disabled={one.fixed} aria-label="Name" onInput={(e) => rename(one.id, (e.target as HTMLInputElement).value)} />}
            {one && <span className="u1-info__type"><AppIcon glyph={TYPES[one.type].glyph} color={TYPES[one.type].color} size={20} />{TYPES[one.type].label}{one.fixed && " · fixed folder"}<span style={{ flex: 1 }} /><Button size="sm" variant="quiet" onClick={() => open(one)}>Open</Button></span>}
            {!one && <span className="u1-info__type">{[...new Set(chosen.map((f) => TYPES[f.type].plural))].join(", ")} · changes apply to all</span>}
          </header>
          <PropertyList>
            {sections.map((s) => <PropertySection key={s} title={s} icon={s === "Camera" ? "camera" : s === "Script" ? "file-text" : "tag"}>{shared.filter((p) => (p.section ?? "Properties") === s).map((p) => <PropertyRow key={p.id} label={p.name}>{editor(p)}</PropertyRow>)}</PropertySection>)}
            {one?.type === "collection" && (
              <PropertySection title="Colour" icon="palette">
                <Swatches value={one.color} label="Collection colour" onChange={(c) => setColor(one.id, c)} />
                <p className="u1-hint">Given at random when the collection is made. Stored with the collection: everyone sees the same colour.</p>
              </PropertySection>
            )}
            {one?.facts && <PropertySection title={`${TYPES[one.type].label} facts`} icon="lock">{one.facts.map(([k, v]) => <PropertyRow key={k} label={k} value={v} />)}</PropertySection>}
            {one?.content && <PropertySection title={`Content · ${one.content.length}`} icon="files">{one.content.length ? one.content.map((id) => map.get(id)).filter((f): f is FileRec => !!f).map((f) => <PropertyRow key={f.id} label={TYPES[f.type].label} value={f.name} overflow="truncate" />) : <PropertyRow label="Nothing yet" value="Drop files onto it" />}</PropertySection>}
            {one && <PropertySection title="System" icon="info" defaultOpen={false}><PropertyRow label="Created" value={one.created} /><PropertyRow label="Created by" value={one.by} /><PropertyRow label="In" value={one.parent ? map.get(one.parent)?.name : "Top level"} /></PropertySection>}
            {one && usedIn.length > 0 && <PropertySection title={`Used in · ${usedIn.length}`} icon="link">{usedIn.map((f) => <PropertyRow key={f.id} label={TYPES[f.type].label} value={f.name} overflow="truncate" />)}</PropertySection>}
          </PropertyList>
        </>
      )}
    </ResizablePanel>
  );

  return (
    <div className="u1" data-theme={theme}>
      <header className="u1-proto">
        <strong>U1</strong><span className="u1-proto__note">prototype</span>
        <span className="u1-proto__apps" role="tablist" aria-label="Open as">
          {ENTRIES.map((e) => <button type="button" key={e.id} role="tab" aria-selected={entry === e.id} className={cx(entry === e.id && "is-on")} onClick={() => go(e.id)}><AppIcon glyph={e.glyph} color={e.color} size={20} />{e.label}</button>)}
        </span>
        <span style={{ flex: 1 }} />
        {entry !== "project" && <><label>Properties <Segmented label="Properties panel" value={panel} onChange={setPanel} options={[{ value: "right", label: "Right" }, { value: "bottom", label: "Bottom" }, { value: "off", label: "Off" }]} /></label>
        <label>Collection mark <Segmented label="Collection mark" value={mark} onChange={setMark} options={[{ value: "bar", label: "Bar" }, { value: "dot", label: "Dot" }, { value: "frame", label: "Frame" }]} />{mark === "bar" && <Segmented label="Bar position" value={barAt} onChange={setBarAt} options={[{ value: "bottom", label: "Bottom" }, { value: "left", label: "Left" }]} />}</label>
        <label>Board cards <Segmented label="Board cards" value={cards} onChange={setCards} options={[{ value: "picture", label: "Picture" }, { value: "compact", label: "Compact" }]} /></label></>}
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      {entry === "project" ? <div className="u1-body"><ProjectApp say={say} /></div> : <div className={cx("u1-body", `u1-body--${panel}`)}>
        <BrowserLayout className="u1-browser" sidebarWidth={220} sidebarMin={180} sidebarMax={420} toolbar={toolbar} sidebar={sidebar}
          statusBar={<StatusBar>{items.length} items{sel.length > 0 && <> · <strong>{sel.length} ticked</strong> <Chip icon="close" onToggle={() => setSel([])}>Clear</Chip></>}{nav in QUERIES && <> · a saved filter: lists what matches now</>}</StatusBar>}>
          {main}
        </BrowserLayout>
        {panel !== "off" && info}
      </div>}
      {toast && <Toast className="u1-toast" tone="info" onDismiss={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
}
