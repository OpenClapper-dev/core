import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AppIcon, Badge, Breadcrumb, BrowserLayout, Button, Chip, DropdownMenu, EmptyState, FileCard, FileGrid, Icon, PropertyList, PropertyRow, PropertySection, SearchInput, Segmented, SidebarNav,
  StatusBar, Table, TextInput, Toolbar, ToolbarSpacer, Tree, useDockLayout,
} from "@openclapper/design";
import { fileTypes } from "@openclapper/model";
import { fetchUses, type FileRec, type FileUse, type Root } from "../api";
import { kindOf, lookOf, targetOf } from "../fileKinds";
import * as ops from "../fileOps";
import * as store from "../files";
import { contextMenu, toastError } from "../hosts";
import { bind, useKeys } from "../keys";
import { usePeople } from "../people";
import { usePrefs, type Pin } from "../prefs";
import { pinsOf, togglePin as togglePinIn } from "../wm/Taskbar";
import { useProjects } from "../projects";
import { useUser } from "../user";
import { BinView } from "./BinView";
import { appDef, type AppProps } from "./registry";

type View = "list" | "grid";
type SortKey = "name" | "type" | "created";
interface Sort { key: SortKey; dir: "asc" | "desc" }
interface Launch { folder?: string | null; home?: boolean; bin?: boolean }

const remembered = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const remember = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const count = (n: number, one = "item") => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What follows `#/files` in the address bar, as a launch. */
export function filesFromRoute(rest: string): { state: Launch } {
  const [a, b] = rest.split("/");
  if (a === "bin") return { state: { bin: true } };
  if (a === "home") return { state: { home: true, folder: b || null } };
  return { state: { folder: a || null } };
}

/**
 * The Files app (docs/rewrite/ux-1-files.md): the folder tree of a project and of the account home,
 * the files of the open folder as a list or a grid, search across the whole root, and a properties
 * panel. Clicking makes a file the current one; ticking selects files for acting on several.
 */
export function FilesApp({ win, projectId, setTitle, setRoute }: AppProps) {
  const asked = win.state as Launch | undefined;
  const [home, setHome] = useState(!!asked?.home);
  const [folder, setFolder] = useState<string | null>(asked?.folder ?? null);
  const [nav, setNav] = useState<"all" | "bin">(asked?.bin ? "bin" : "all");
  useEffect(() => { if (asked && win.stateSeq) { setHome(!!asked.home); setFolder(asked.folder ?? null); setNav(asked.bin ? "bin" : "all"); clear(); } }, [win.stateSeq]);

  const root: Root = home ? "home" : { project: projectId };
  const { files, bin, error } = store.useRoot(root);
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  const prefs = usePrefs();
  const homeLabel = `${me?.name ?? me?.email ?? "My"}’s home`;
  const rootLabel = home ? homeLabel : project?.name ?? "Project";

  const [q, setQ] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [sort, setSortState] = useState<Sort>(() => remembered("files.sort", { key: "name", dir: "asc" }));
  const [view, setViewState] = useState<View>(() => remembered("files.view", "list"));
  const setSort = (s: Sort) => { setSortState(s); remember("files.sort", s); };
  const setView = (v: View) => { setViewState(v); remember("files.view", v); };
  // Two different things: the current file (one click; what the panel shows) and the ticked files (for acting on several).
  const [cur, setCur] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const clear = () => { setSel([]); setCur(null); };
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [panels, setPanels, resetPanels] = useDockLayout("files", { left: { tabs: ["nav"] }, right: { tabs: ["info"] } });
  const search = useRef<HTMLSpanElement>(null);

  const all = files ?? [];
  const map = useMemo(() => store.byId(all), [files]);
  // A folder that is gone (binned elsewhere) leaves the window at the top level.
  const here = folder && map.get(folder) && kindOf(map.get(folder)!.type).holds ? folder : null;
  useEffect(() => { if (files && folder && !here) setFolder(null); }, [files, folder, here]);
  const path = store.pathOf(all, here);
  const flat = q !== "" || types.length > 0;

  useEffect(() => {
    setTitle(nav === "bin" ? "Files · Recycle bin" : `Files · ${path.length ? path[path.length - 1].name : rootLabel}`);
    setRoute(nav === "bin" ? "bin" : `${home ? "home" : ""}${home && here ? "/" : ""}${here ?? ""}`);
  }, [nav, home, here, rootLabel, path.map((f) => f.name).join("/")]);

  const items = useMemo(() => {
    let out = all.filter((f) => !f.internal_of && (flat ? !f.fixed : f.container === here));
    if (types.length) out = out.filter((f) => types.includes(f.type));
    if (q) { const n = q.toLowerCase(); out = out.filter((f) => f.name.toLowerCase().includes(n)); }
    const k = (f: FileRec) => (sort.key === "type" ? kindOf(f.type).label : sort.key === "created" ? f.created_at : "") + "\u0000" + f.name;
    const dir = sort.dir === "asc" ? 1 : -1;
    // Containers first, whatever the order: a folder is where one goes, not what one looks for.
    return [...out].sort((a, b) => Number(kindOf(b.type).holds) - Number(kindOf(a.type).holds) || dir * k(a).localeCompare(k(b), undefined, { numeric: true, sensitivity: "base" }));
  }, [files, here, q, types.join(), sort.key, sort.dir, flat]);
  const ids = items.map((f) => f.id);
  const chosen = (sel.length ? sel : cur ? [cur] : []).map((id) => map.get(id)).filter((f): f is FileRec => !!f);
  const one = chosen.length === 1 ? chosen[0] : null;

  const go = (to: { home?: boolean; folder?: string | null }) => { if (to.home !== undefined) setHome(to.home); setFolder(to.folder ?? null); setNav("all"); setQ(""); setTypes([]); clear(); };
  const open = (f: FileRec) => { if (kindOf(f.type).holds) go({ folder: f.id }); else ops.openFile(f, map); };
  const tick = (id: string) => setSel((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const pick = (id: string, e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey) tick(id);
    else if (e.shiftKey && (cur || sel.length)) { const a = ids.indexOf(cur ?? sel[sel.length - 1]), b = ids.indexOf(id); setSel([...new Set([...sel, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])]); }
    else setCur(id);
  };
  /** What an action on `f` acts on: every ticked file when `f` is one of them, else `f` alone. */
  const group = (f: FileRec) => (sel.includes(f.id) ? chosen : [f]);
  const desktop = store.fixedFolder(all, "desktop");
  const pins = pinsOf(projectId, prefs.pins);
  const togglePin = (f: FileRec) => togglePinIn(projectId, prefs.pins, { file: f.id } as Pin);

  const fileMenu = (f: FileRec, e: MouseEvent) => {
    if (!sel.includes(f.id)) setCur(f.id);
    const list = group(f), many = list.length > 1;
    const t = targetOf(f, map);
    const pinned = pins.some((p) => "file" in p && p.file === f.id);
    contextMenu(e, [
      !many && { id: "open", label: "Open", icon: "external", kbd: "↵", run: () => open(f) },
      !many && f.type === "shortcut" && t && "file" in t && { id: "reveal", label: "Show what it points at", icon: "folder-open", run: () => { go({ folder: t.file.container }); setCur(t.file.id); } },
      !many && { id: "rename", label: "Rename…", icon: "edit", kbd: "F2", disabled: !!f.fixed, run: () => void ops.renameFile(f) },
      !many && { id: "copy", label: "Duplicate", icon: "copy", disabled: !!f.fixed, run: () => void ops.duplicateFile(f) },
      !many && kindOf(f.type).holds && { id: "newin", label: "New folder inside", icon: "folder-plus", run: () => void ops.newFolder(root, f.id) },
      { separator: true },
      { id: "move", label: "Move to…", icon: "folder", run: () => ops.moveFilesTo(root, all, list, rootLabel) },
      { id: "top", label: "Move to the top level", icon: "arrow-up", disabled: list.every((x) => x.container === null), run: () => void ops.moveFiles(root, all, list, null) },
      !home && desktop && { id: "desk", label: "Move to the desktop", icon: "desktop", disabled: list.every((x) => x.container === desktop.id), run: () => void ops.moveFiles(root, all, list, desktop.id) },
      !home && desktop && !many && f.type !== "shortcut" && { id: "short", label: "Create shortcut on the desktop", icon: "shortcut", run: () => void ops.makeShortcut(root, all, { file: f }, desktop.id) },
      !home && !many && { id: "pin", label: pinned ? "Unpin from taskbar" : "Pin to taskbar", icon: pinned ? "pinned" : "pin", run: () => togglePin(f) },
      { separator: true },
      { id: "bin", label: "Move to the recycle bin", icon: "trash", danger: true, kbd: "Del", disabled: list.every((x) => !!x.fixed), run: () => { void ops.binFiles(root, list); clear(); } },
    ]);
  };
  const emptyMenu = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("tr, .oc-filecard")) return;
    contextMenu(e, [
      { id: "new", label: "New folder", icon: "folder-plus", kbd: "⇧N", run: () => void ops.newFolder(root, here) },
      { separator: true },
      { id: "all", label: "Select everything listed", icon: "check", kbd: "⌘A", disabled: !ids.length, run: () => setSel(ids) },
    ]);
  };

  // Dragging: rows and cards carry the ticked files (or themselves); folders, the tree and the path take them.
  const dragStart = (f: FileRec) => (e: DragEvent) => ops.setDrag(e, group(f).map((x) => x.id));
  const dropTarget = (key: string, container: string | null, toHome = home) => ({
    onDragOver: (e: DragEvent) => { if (!ops.hasDrag(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer!.dropEffect = "move"; if (dropOn !== key) setDropOn(key); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropOn((d) => (d === key ? null : d)); },
    onDrop: (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDropOn(null);
      const moved = (ops.readDrag(e) ?? []).map((id) => map.get(id)).filter((f): f is FileRec => !!f);
      if (toHome !== home) return; // nothing crosses between a project and an account home
      if (moved.length) void ops.moveFiles(root, all, moved, container).then((ok) => ok && clear());
    },
  });
  const rowDrag = (f: FileRec) => ({
    draggable: !f.fixed, onDragStart: dragStart(f), onContextMenu: (e: MouseEvent) => fileMenu(f, e),
    ...(kindOf(f.type).holds ? dropTarget(f.id, f.id) : {}),
    className: dropOn === f.id ? "is-drop" : undefined,
  });

  useKeys(bind("files", {
    search: () => search.current?.querySelector("input")?.focus(),
    down: () => { const i = cur ? ids.indexOf(cur) : -1; if (ids.length) setCur(ids[Math.min(ids.length - 1, i + 1)]); },
    up: () => { const i = cur ? ids.indexOf(cur) : ids.length; if (ids.length) setCur(ids[Math.max(0, i - 1)]); },
    open: () => { if (one) open(one); else return false; },
    parent: () => { if (here) go({ folder: map.get(here)?.container ?? null }); else return false; },
    rename: () => { if (one) void ops.renameFile(one); else return false; },
    remove: () => { if (chosen.length) { void ops.binFiles(root, chosen); clear(); } else return false; },
    newFolder: () => void ops.newFolder(root, here),
    all: () => setSel(ids),
    clear: () => { if (sel.length || cur) clear(); else return false; },
  }), nav === "all");

  // ---- Sidebar: the two roots as trees, then the bin.
  const sidebar = (
    <div className="st-side">
      <Tree nodes={[{ id: "root", label: project?.name ?? "Project", icon: "slate", children: ops.folderNodes(home ? [] : all, null) }]} defaultExpanded={["root"]} expanded={home ? [] : ["root", ...path.map((f) => f.id)]}
        selected={nav === "all" && !home ? here ?? "root" : undefined} onSelect={(id) => go({ home: false, folder: id === "root" ? null : id })}
        rowProps={(id) => (home ? undefined : { ...dropTarget(`tree-${id}`, id === "root" ? null : id), className: dropOn === `tree-${id}` ? "is-drop" : undefined })} />
      <Tree nodes={[{ id: "home", label: homeLabel, icon: "home", children: ops.folderNodes(home ? all : [], null) }]} defaultExpanded={[]} expanded={home ? ["home", ...path.map((f) => f.id)] : []}
        selected={nav === "all" && home ? here ?? "home" : undefined} onSelect={(id) => go({ home: true, folder: id === "home" ? null : id })}
        rowProps={(id) => (home ? { ...dropTarget(`tree-${id}`, id === "home" ? null : id), className: dropOn === `tree-${id}` ? "is-drop" : undefined } : undefined)} />
      <SidebarNav value={nav === "bin" ? "bin" : undefined} onChange={() => { setNav("bin"); clear(); }} sections={[{ items: [{ id: "bin", label: "Recycle bin", icon: "trash", count: bin?.length || undefined }] }]} />
    </div>
  );

  // ---- Toolbar.
  const allTypes = fileTypes().filter((t) => all.some((f) => f.type === t.type && !f.fixed));
  const toolbar = nav === "bin" ? null : (
    <Toolbar>
      <Breadcrumb items={[{ id: "root", label: rootLabel }, ...path.map((f) => ({ id: f.id, label: f.name }))]} onNavigate={(id) => go({ folder: id === "root" ? null : id })}
        itemProps={(id) => ({ ...dropTarget(`crumb-${id}`, id === "root" ? null : id), className: dropOn === `crumb-${id}` ? "is-drop" : undefined })} />
      {flat && <Badge>{home ? "whole home" : "whole project"}</Badge>}
      <ToolbarSpacer />
      <span ref={search}><SearchInput size="sm" value={q} onChange={setQ} placeholder="Names" style={{ width: 170 }} /></span>
      {allTypes.length > 1 && <DropdownMenu size="sm" variant="quiet" icon="filter" label={types.length ? count(types.length, "type") : "Types"} align="end"
        items={allTypes.map((t) => ({ id: t.type, label: t.plural, checked: types.includes(t.type) }))} onSelect={(id) => setTypes(types.includes(id) ? types.filter((t) => t !== id) : [...types, id])} />}
      <Segmented label="View" value={view} onChange={(v) => setView(v as View)} options={[{ value: "list", icon: "list", title: "List" }, { value: "grid", icon: "grid", title: "Grid" }]} />
      <DropdownMenu size="sm" variant="primary" icon="plus" label="New" align="end" items={[{ id: "folder", label: "Folder", icon: "folder-plus", kbd: "⇧N" }]} onSelect={() => void ops.newFolder(root, here)} />
      <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "panels", label: "Panels back to their places", icon: "refresh" }]} onSelect={resetPanels} />
    </Toolbar>
  );

  // ---- Main area.
  const icon = (f: FileRec, size: number) => { const l = lookOf(f, map); return <AppIcon glyph={l.glyph} color={l.color} size={size} off={l.broken} />; };
  const where = (f: FileRec) => (f.container ? map.get(f.container)?.name ?? "" : "Top level");
  const facts = (f: FileRec) => {
    if (kindOf(f.type).holds) return count(all.filter((c) => c.container === f.id).length);
    if (f.type === "shortcut") { const t = targetOf(f, map); return !t ? "Points at something that is gone" : "app" in t ? `Opens ${appDef(t.app)?.name}` : `To ${kindOf(t.file.type).label.toLowerCase()} “${t.file.name}”`; }
    return kindOf(f.type).label;
  };
  const main = error && !files ? <EmptyState icon="cloud-off" title="Could not load the files" action={<Button onClick={() => void store.loadRoot(root).catch(toastError)}>Try again</Button>}>{error}</EmptyState>
    : !files ? null
    : !items.length ? <EmptyState icon={q ? "search" : "folder-open"} title={q || types.length ? "Nothing matches" : "Nothing here yet"} action={!flat ? <Button icon="folder-plus" onClick={() => void ops.newFolder(root, here)}>New folder</Button> : undefined}>{q ? "Search looks at names, in every folder." : !flat ? "Drop files here, or make a folder." : ""}</EmptyState>
    : view === "list" ? (
      <Table selectable selected={sel} onSelect={setSel} cursor={cur ?? undefined} onCursor={setCur} onOpen={(id) => open(map.get(id)!)} sort={sort} onSort={(s) => setSort(s as Sort)} rowProps={(id) => rowDrag(map.get(id)!)}
        columns={[{ key: "name", label: "Name", sortable: true }, { key: "type", label: "Type", sortable: true, width: 140 }, ...(flat ? [{ key: "where", label: "In" }] : []), { key: "created", label: "Created", sortable: true, mono: true, width: 130 }]}
        rows={items.map((f) => ({
          id: f.id,
          name: <span className="st-name">{icon(f, 20)}{f.name}{f.fixed && <Icon name="lock" size={12} label="Fixed folder" />}{lookOf(f, map).shortcut && <Icon name="shortcut" size={12} label="Shortcut" />}</span>,
          type: kindOf(f.type).label, where: where(f), created: day(f.created_at),
        }))} />
    ) : (
      <FileGrid ticking={sel.length > 0}>
        {items.map((f) => (
          <FileCard key={f.id} name={f.name} meta={facts(f)} art={icon(f, 48)} badge={f.fixed ? <Icon name="lock" size={12} /> : lookOf(f, map).shortcut ? <Icon name="shortcut" size={12} /> : undefined}
            selected={sel.includes(f.id)} current={cur === f.id} dropTarget={dropOn === f.id} onClick={(e) => pick(f.id, e)} onTick={() => tick(f.id)} onOpen={() => open(f)} {...rowDrag(f)} className={undefined} />
        ))}
      </FileGrid>
    );

  // ---- Properties: nothing chosen, one file, or several.
  const info = (
    <div className="st-info">
      {!chosen.length ? <EmptyState icon="info" title={path.length ? path[path.length - 1].name : rootLabel}>{count(items.length)}. Click one to see its properties. Tick several to act on them together.</EmptyState>
        : one ? <OneFile key={one.id} f={one} map={map} facts={facts(one)} where={where(one)} who={(id) => (id === me?.id ? "You" : (id && people.get(id)) || "Someone else")} onOpen={() => open(one)} icon={icon(one, 48)} />
        : (
          <>
            <header className="st-info__head">
              <span className="st-info__icon"><Icon name="files" size={20} /><strong>{count(chosen.length, "file")} ticked</strong></span>
              <span className="st-note">{[...new Set(chosen.map((f) => kindOf(f.type).plural))].join(", ")}</span>
            </header>
            <div className="st-info__acts">
              <Button size="sm" icon="folder" onClick={() => ops.moveFilesTo(root, all, chosen, rootLabel)}>Move to…</Button>
              <Button size="sm" variant="danger" icon="trash" onClick={() => { void ops.binFiles(root, chosen); clear(); }}>To the recycle bin</Button>
            </div>
          </>
        )}
    </div>
  );

  return (
    <BrowserLayout toolbar={toolbar}
      dock={{ layout: panels, onLayoutChange: setPanels, zoneSizes: { left: 220, right: 300, bottom: 220 }, panels: [{ id: "nav", title: "Folders", icon: "folder", body: sidebar }, ...(nav === "all" ? [{ id: "info", title: "Properties", icon: "info" as const, body: info }] : [])] }}
      statusBar={nav === "bin" ? undefined : <StatusBar>{count(items.length)}{sel.length > 0 && <> · <strong>{sel.length} ticked</strong> <Chip icon="close" onToggle={() => setSel([])}>Clear</Chip></>}</StatusBar>}>
      {nav === "bin" ? <BinView root={root} /> : <div className="st-scroll" {...dropTarget("here", here)} onContextMenu={emptyMenu} onClick={(e) => { if (e.target === e.currentTarget) clear(); }}>{main}</div>}
    </BrowserLayout>
  );
}

/** The properties of one file: its name (editable), what it is, its system properties, and where it is used. */
function OneFile({ f, map, facts, where, who, onOpen, icon }: { f: FileRec; map: ReadonlyMap<string, FileRec>; facts: string; where: string; who: (id: string | null) => string; onOpen: () => void; icon: preact.ComponentChildren }) {
  const [name, setName] = useState(f.name);
  const [uses, setUses] = useState<FileUse[] | null>(null);
  useEffect(() => { setName(f.name); }, [f.name]);
  useEffect(() => { let on = true; void fetchUses(f.id).then((u) => { if (on) setUses(u); }, () => {}); return () => { on = false; }; }, [f.id, f.updated_at]);
  const commit = () => { const to = name.trim(); if (!to || to === f.name) { setName(f.name); return; } void store.rename(f, to).catch((e) => { toastError(e); setName(f.name); }); };
  const k = kindOf(f.type);
  return (
    <>
      <header className="st-info__head">
        <span className="st-info__icon">{icon}</span>
        <TextInput value={name} disabled={!!f.fixed} aria-label="Name" maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(f.name); e.currentTarget.blur(); } }} />
        <span className="st-info__type"><AppIcon glyph={k.glyph} color={k.color} size={20} />{k.label}{f.fixed && " · fixed folder"}<span style={{ flex: 1 }} /><Button size="sm" variant="quiet" onClick={onOpen}>Open</Button></span>
      </header>
      <PropertyList>
        <PropertySection title={k.label} icon="info">
          <PropertyRow label={k.holds ? "Holds" : f.type === "shortcut" ? "Opens" : "Kind"} value={facts} />
          <PropertyRow label="In" value={where} overflow="truncate" />
        </PropertySection>
        <PropertySection title="System" icon="clock">
          <PropertyRow label="Created" value={day(f.created_at)} />
          <PropertyRow label="Created by" value={who(f.created_by)} />
          {f.updated_at && <PropertyRow label="Changed" value={day(f.updated_at)} />}
        </PropertySection>
        {uses && uses.length > 0 && (
          <PropertySection title={`Used in · ${uses.length}`} icon="link">
            {uses.map((u) => <PropertyRow key={`${u.id}-${u.kind}`} label={kindOf(u.type).label} value={map.get(u.id)?.name ?? u.name} overflow="truncate" />)}
          </PropertySection>
        )}
      </PropertyList>
    </>
  );
}
