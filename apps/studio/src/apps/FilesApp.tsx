import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AppIcon, Badge, Breadcrumb, BrowserLayout, Button, Chip, CollectionTag, colorCss, DropdownMenu, EmptyState, FileCard, FileGrid, Icon, PropertyList, PropertyRow, PropertySection, SearchInput, Segmented, SidebarNav,
  StatusBar, Table, TextInput, Toolbar, ToolbarSpacer, Tree, UploadBadge, moved, useDockLayout, useSort,
} from "@openclapper/design";
import { evaluate, fileTypes, matchesSearch, valueText, type FilterBody, type FilterGroup } from "@openclapper/model";
import { Board, BOARD_DEFAULT, type BoardLayout } from "../Board";
import { FilterBuilder, filterFields, ruleCount } from "../FilterBuilder";
import { PropertySections } from "../propertyEditors";
import { definitionsIn, type Definition } from "../props";
import { fetchUses, type FileRec, type FileUse, type Root } from "../api";
import { addToCollection, collectionOf, groupInto, photosOf, setOrder, takeOut, tintOf, ungroup } from "../collections";
import { kindOf, lookOf, targetOf } from "../fileKinds";
import * as ops from "../fileOps";
import * as store from "../files";
import { contextMenu, toast, toastError, type MenuEntry } from "../hosts";
import { bind, useKeys } from "../keys";
import { dropStuck, importFiles, imageUrl, retryUploads, useUploads } from "../media";
import { usePeople } from "../people";
import { CollectionSections, PhotoFactsSections, thumbOf } from "../photoParts";
import { CoverArt, coverOf } from "../shots/Cover";
import { MapView, positionOf } from "../places/map";
import { presetsIn } from "../optics";
import { usePrefs, type Pin } from "../prefs";
import { useProjects } from "../projects";
import { useUser } from "../user";
import { pinsOf, togglePin as togglePinIn } from "../wm/Taskbar";
import { BinView } from "./BinView";
import { appDef, launch, type AppProps } from "./registry";

type View = "list" | "grid" | "board" | "map";
type SortKey = "name" | "type" | "created" | "taken";
interface Sort { key: SortKey; dir: "asc" | "desc" }
/** Which of the browser's entries this window is (docs/rewrite/09-shells.md): the same browser, set to all files or to photos. */
export type Entry = "files" | "media" | "shots" | "sets" | "locations";
/** The entries set to one file type: the shot list, the sets, the locations. */
const TYPED: Partial<Record<Entry, string>> = { shots: "shot", sets: "set", locations: "location" };
/** Media's side bar: everything, the collections, the photos in none, or one collection's photos. */
type MediaNav = "all" | "collections" | "loose" | `coll:${string}`;
interface Launch { folder?: string | null; home?: boolean; bin?: boolean; collection?: string; filter?: string }
/** Files a person does not browse among the others: they live in Settings and are edited in the Project app. */
const SETTINGS_TYPES = ["property", "naming", "preferences"];

const remembered = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const remember = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const count = (n: number, one = "item") => `${n} ${one}${n === 1 ? "" : "s"}`;
const IMAGE_TYPES = "image/jpeg,image/png,image/webp";

/** What follows `#/files` in the address bar, as a launch. */
export function filesFromRoute(rest: string): { state: Launch } {
  const [a, b] = rest.split("/");
  if (a === "bin") return { state: { bin: true } };
  if (a === "home") return { state: { home: true, folder: b || null } };
  if (a === "filter" && b) return { state: { filter: b } };
  return { state: { folder: a || null } };
}
/** What follows `#/media`: a collection's id, or nothing. */
export const mediaFromRoute = (rest: string): { state: Launch } => ({ state: { collection: rest || undefined } });

/** The Media app: the one browser, set to photos and collections. */
export const MediaApp = (p: AppProps) => <FilesApp {...p} entry="media" />;
/** The Shots app: the one browser, set to shots. */
export const ShotsApp = (p: AppProps) => <FilesApp {...p} entry="shots" />;
/** The Sets app: the one browser, set to sets (the places in the story). */
export const SetsApp = (p: AppProps) => <FilesApp {...p} entry="sets" />;
/** The Locations app: the one browser, set to locations (the real places), with the map. */
export const LocationsApp = (p: AppProps) => <FilesApp {...p} entry="locations" />;

/**
 * The file browser (docs/rewrite/ux-1-files.md) in its entries: **Files**, the folder trees of a
 * project and of the account home; **Media**, the project's photos and collections. A list or a
 * grid, search, a properties panel; clicking makes a file the current one, ticking selects files
 * for acting on several. Photos are imported by dropping image files or with Import.
 */
export function FilesApp({ win, projectId, setTitle, setRoute, entry = "files" }: AppProps & { entry?: Entry }) {
  const media = entry === "media";
  // Shots, Sets, Locations: the browser set to one type, flat, with that type's properties as columns.
  const only = TYPED[entry] ?? null;
  const shotsOnly = !!only;
  const onlyKind = only ? kindOf(only) : null;
  const asked = win.state as Launch | undefined;
  const [home, setHome] = useState(!media && !!asked?.home);
  const [folder, setFolder] = useState<string | null>(asked?.folder ?? null);
  const [nav, setNav] = useState<"all" | "bin">(asked?.bin ? "bin" : "all");
  const [mnav, setMnav] = useState<MediaNav>(asked?.collection ? `coll:${asked.collection}` : "all");
  useEffect(() => {
    if (!asked || !win.stateSeq) return;
    if (media) setMnav(asked.collection ? `coll:${asked.collection}` : "all");
    else { setHome(!!asked.home); setFolder(asked.folder ?? null); setNav(asked.bin ? "bin" : "all"); setFilterFile(asked.filter ?? null); }
    clear();
  }, [win.stateSeq]);

  const root: Root = home ? "home" : { project: projectId };
  const { files, bin, error } = store.useRoot(root);
  const uploads = useUploads();
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  const prefs = usePrefs();
  const homeLabel = `${me?.name ?? me?.email ?? "My"}’s home`;
  const rootLabel = home ? homeLabel : project?.name ?? "Project";

  const [q, setQ] = useState("");
  // A filter: built here, or a filter file opened (its body, editable and saved back).
  const [filterFile, setFilterFile] = useState<string | null>(asked?.filter ?? null);
  const [filter, setFilter] = useState<FilterGroup>({ match: "all", rules: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const [board, setBoardState] = useState<BoardLayout>(() => remembered(`${entry}.board`, BOARD_DEFAULT));
  const setBoard = (b: BoardLayout) => { setBoardState(b); remember(`${entry}.board`, b); };
  const [types, setTypes] = useState<string[]>([]);
  const [sort, setSortState] = useState<Sort>(() => remembered(`${entry}.sort`, media ? { key: "taken", dir: "desc" } : { key: "name", dir: "asc" }));
  const [view, setViewState] = useState<View>(() => remembered(`${entry}.view`, media ? "grid" : entry === "locations" ? "map" : "list"));
  const defs: Definition[] = useMemo(() => definitionsIn(files), [files]);
  const [spread, setSpreadState] = useState<boolean>(() => remembered("media.spread", false));
  const setSort = (s: Sort) => { setSortState(s); remember(`${entry}.sort`, s); };
  const setView = (v: View) => { setViewState(v); remember(`${entry}.view`, v); };
  const setSpread = (v: boolean) => { setSpreadState(v); remember("media.spread", v); };
  // Two different things: the current file (one click; what the panel shows) and the ticked files (for acting on several).
  const [cur, setCur] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const clear = () => { setSel([]); setCur(null); };
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [panels, setPanels, resetPanels] = useDockLayout(entry, { left: { tabs: ["nav"] }, right: { tabs: ["info"] } });
  const search = useRef<HTMLSpanElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const all = files ?? [];
  const map = useMemo(() => store.byId(all), [files]);
  // A folder or collection that is gone (binned elsewhere) leaves the window at the top level.
  const here = !media && folder && map.get(folder) && kindOf(map.get(folder)!.type).holds ? folder : null;
  useEffect(() => { if (files && folder && !here && !media) setFolder(null); }, [files, folder, here]);
  const openColl = mnav.startsWith("coll:") ? map.get(mnav.slice(5)) : undefined;
  useEffect(() => { if (files && mnav.startsWith("coll:") && !openColl) setMnav("all"); }, [files, mnav, openColl]);
  const path = store.pathOf(all, here);
  const savedFilter = filterFile ? map.get(filterFile) ?? null : null;
  useEffect(() => { if (savedFilter) { const b = savedFilter.body as unknown as FilterBody; setFilter({ match: b.match, rules: b.rules }); setTypes(b.types ?? []); setQ(b.q ?? ""); setFilterOpen(true); } }, [savedFilter?.id, savedFilter?.updated_at]);
  useEffect(() => { if (files && filterFile && !savedFilter) setFilterFile(null); }, [files, filterFile, savedFilter]);
  const filtering = ruleCount(filter) > 0;
  const flat = q !== "" || types.length > 0 || filtering || shotsOnly;
  /** What search reads of a file: its name and its property values as text. */
  const texts = (f: FileRec) => [f.name, ...defs.filter((d) => f.values?.[d.id] !== undefined).map((d) => valueText(d.def, f.values![d.id], (id) => map.get(id)?.name))];
  const matches = (f: FileRec) => evaluate(filter, { name: f.name, type: f.type, created_at: f.created_at, updated_at: f.updated_at ?? f.created_at, container: f.container, taken: f.photo?.taken_at ?? null, aov: f.photo?.angle_of_view?.horizontal ?? null, values: f.values ?? {} });
  const mark = prefs.collectionMark;

  useEffect(() => {
    if (shotsOnly) { setTitle(`${onlyKind!.plural} · ${savedFilter ? savedFilter.name : rootLabel}`); setRoute(savedFilter ? `filter/${savedFilter.id}` : ""); return; }
    if (savedFilter && !media) { setTitle(`Files · ${savedFilter.name}`); setRoute(`filter/${savedFilter.id}`); return; }
    if (media) { setTitle(`Media · ${openColl ? openColl.name : mnav === "collections" ? "Collections" : mnav === "loose" ? "Not in a collection" : rootLabel}`); setRoute(openColl ? openColl.id : ""); return; }
    setTitle(nav === "bin" ? "Files · Recycle bin" : `Files · ${path.length ? path[path.length - 1].name : rootLabel}`);
    setRoute(nav === "bin" ? "bin" : `${home ? "home" : ""}${home && here ? "/" : ""}${here ?? ""}`);
  }, [media, mnav, openColl?.name, nav, home, here, rootLabel, path.map((f) => f.name).join("/"), savedFilter?.name]);

  const takenOf = (f: FileRec) => f.photo?.taken_at ?? f.created_at;
  const items = useMemo(() => {
    let out: FileRec[];
    if (media) {
      const photos = all.filter((f) => f.type === "photo" && !f.internal_of);
      const loose = photos.filter((f) => !collectionOf(f, map));
      if (openColl) return photosOf(openColl, all).filter((f) => (!q || matchesSearch(q, texts(f))) && matches(f));
      out = mnav === "collections" ? all.filter((f) => f.type === "collection" && !f.internal_of)
        : mnav === "loose" ? loose
        : spread || q ? photos : [...all.filter((f) => f.type === "collection" && !f.internal_of), ...loose];
    } else if (shotsOnly) out = all.filter((f) => f.type === only && !f.internal_of);
    else out = all.filter((f) => !f.internal_of && (flat ? !f.fixed && !SETTINGS_TYPES.includes(f.type) : f.container === here));
    if (types.length) out = out.filter((f) => types.includes(f.type));
    if (q) out = out.filter((f) => matchesSearch(q, texts(f)));
    if (filtering) out = out.filter(matches);
    // A collection is as old as its newest photo, so it sits among them by time.
    const newest = (f: FileRec) => (f.type === "collection" ? photosOf(f, all).map(takenOf).sort().pop() ?? f.created_at : takenOf(f));
    const k = (f: FileRec) => (sort.key === "type" ? kindOf(f.type).label : sort.key === "created" ? f.created_at : sort.key === "taken" ? newest(f) : "") + "\u0000" + f.name;
    const dir = sort.dir === "asc" ? 1 : -1;
    // Folders first, whatever the order: a folder is where one goes, not what one looks for.
    const first = (f: FileRec) => Number(f.type !== "photo" && kindOf(f.type).holds && !media);
    return [...out].sort((a, b) => first(b) - first(a) || dir * k(a).localeCompare(k(b), undefined, { numeric: true, sensitivity: "base" }));
  }, [files, here, q, types.join(), sort.key, sort.dir, flat, media, mnav, spread, openColl, JSON.stringify(filter)]);
  const ids = items.map((f) => f.id);
  const chosen = (sel.length ? sel : cur ? [cur] : []).map((id) => map.get(id)).filter((f): f is FileRec => !!f);
  const one = chosen.length === 1 ? chosen[0] : null;
  const photosIn = (list: FileRec[]) => list.filter((f) => f.type === "photo");

  const resetFilter = () => { setFilter({ match: "all", rules: [] }); setFilterFile(null); setFilterOpen(false); };
  const go = (to: { home?: boolean; folder?: string | null }) => { if (to.home !== undefined) setHome(to.home); setFolder(to.folder ?? null); setNav("all"); setQ(""); setTypes([]); resetFilter(); clear(); };
  /** The filter as a file's body. */
  const filterBody = (): FilterBody => ({ ...filter, ...(types.length ? { types } : {}), ...(q ? { q } : {}) });
  const saveFilter = async () => {
    try {
      if (savedFilter) { await store.saveBody(savedFilter, filterBody() as unknown as Record<string, unknown>); toast(`“${savedFilter.name}” saved`); return; }
      const id = crypto.randomUUID();
      await store.create(root, "filter", { id, container: shotsOnly || media ? null : here, body: filterBody() as unknown as Record<string, unknown> });
      setFilterFile(id);
      toast("Saved as a filter: open it again from where it sits");
    } catch (e) { toastError(e); }
  };
  /** A new shot, set or location, named by its pattern; current at once (double-click opens it). */
  const newOf = async (type: string) => { try { const id = crypto.randomUUID(); await store.create(root, type, { id, container: shotsOnly ? null : here }); setCur(id); } catch (e) { toastError(e); } };
  const newShot = () => newOf("shot");
  const open = (f: FileRec) => {
    if (f.type === "collection" && media) { setMnav(`coll:${f.id}`); setQ(""); clear(); return; }
    if (kindOf(f.type).holds && !media) { go({ folder: f.id }); return; }
    if (f.type === "filter") { setQ(""); setTypes([]); setFilterFile(f.id); clear(); return; }
    if (f.type === "photo") { launch({ app: "photo", resource: { type: "photo", id: f.id }, title: f.name, state: { list: ids.filter((id) => map.get(id)?.type === "photo") } }); return; }
    ops.openFile(f, map);
  };
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

  // ---- Import: image files dropped from the computer, or chosen with Import, go into what is open.
  const importTo = () => (media ? openColl?.id ?? null : here);
  const importAll = (list: FileList | File[]) => {
    if (home) { toast("Photos belong to a project; open the project to import them", { tone: "info" }); return; }
    const { queued, refused } = importFiles(root, list, importTo());
    if (queued.length) toast(`Importing ${count(queued.length, "photo")}`);
    if (refused.length) toast(refused.length === 1 ? `“${refused[0].name}”: ${refused[0].why}` : `${refused.length} files left out: ${refused[0].why}`, { tone: "warning" });
  };
  const fromComputer = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files") && !ops.hasDrag(e);

  // ---- Menus.
  const collectionEntries = (list: FileRec[]): (MenuEntry | false)[] => {
    const photos = photosIn(list);
    if (home || !photos.length) return [];
    return [
      { separator: true },
      { id: "group", label: photos.length > 1 ? `Group ${photos.length} into a collection…` : "Make a collection of it…", icon: "layers", run: () => void groupInto(root, all, photos).then(clear) },
      { id: "addto", label: "Add to collection…", icon: "plus", run: () => addToCollection(root, all, photos) },
      photos.some((f) => collectionOf(f, map)) && { id: "out", label: "Take out of the collection", icon: "arrow-up", run: () => void takeOut(root, all, photos).then(clear) },
    ];
  };
  const fileMenu = (f: FileRec, e: MouseEvent) => {
    if (!sel.includes(f.id)) setCur(f.id);
    const list = group(f), many = list.length > 1;
    const t = targetOf(f, map);
    const pinned = pins.some((p) => "file" in p && p.file === f.id);
    contextMenu(e, [
      !many && { id: "open", label: "Open", icon: "external", kbd: "↵", run: () => open(f) },
      !many && f.type === "shortcut" && t && "file" in t && { id: "reveal", label: "Show what it points at", icon: "folder-open", run: () => { go({ folder: t.file.container }); setCur(t.file.id); } },
      !many && f.type === "photo" && !home && { id: "canvas", label: "Make a canvas", icon: "brush", run: () => void ops.canvasFromPhoto(f, map) },
      !many && f.type === "photo" && !!f.photo?.stored.original && { id: "orig", label: "Download the original", icon: "download", run: () => { const a = document.createElement("a"); a.href = imageUrl(f.id, "original"); a.download = f.name; a.click(); } },
      !many && { id: "rename", label: "Rename…", icon: "edit", kbd: "F2", disabled: !!f.fixed, run: () => void ops.renameFile(f) },
      !many && { id: "copy", label: "Duplicate", icon: "copy", disabled: !!f.fixed, run: () => void ops.duplicateFile(f) },
      !many && f.type === "folder" && { id: "newin", label: "New folder inside", icon: "folder-plus", run: () => void ops.newFolder(root, f.id) },
      !many && f.type === "collection" && { id: "ungroup", label: "Ungroup", icon: "layers", run: () => void ungroup(root, all, f) },
      ...collectionEntries(list),
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
      !home && { id: "import", label: "Import photos…", icon: "upload", run: () => picker.current?.click() },
      !media && !shotsOnly && { id: "new", label: "New folder", icon: "folder-plus", kbd: "⇧N", run: () => void ops.newFolder(root, here) },
      !media && !home && (!only || only === "shot") && { id: "newshot", label: "New shot", icon: "slate", run: () => void newShot() },
      !media && !home && (!only || only === "set") && { id: "newset", label: "New set", icon: "home", run: () => void newOf("set") },
      !media && !home && (!only || only === "location") && { id: "newlocation", label: "New location", icon: "location", run: () => void newOf("location") },
      !media && !home && !shotsOnly && { id: "newcanvas", label: "New canvas", icon: "brush", run: () => void ops.newCanvas(root, here) },
      { separator: true },
      { id: "all", label: "Select everything listed", icon: "check", kbd: "⌘A", disabled: !ids.length, run: () => setSel(ids) },
    ]);
  };

  // ---- Dragging: rows and cards carry the ticked files (or themselves); folders, collections, the tree and the path take them.
  const dragStart = (f: FileRec) => (e: DragEvent) => ops.setDrag(e, group(f).map((x) => x.id));
  const dropTarget = (key: string, container: string | null, toHome = home) => ({
    onDragOver: (e: DragEvent) => {
      if (fromComputer(e) && !toHome) { e.preventDefault(); e.stopPropagation(); e.dataTransfer!.dropEffect = "copy"; if (dropOn !== key) setDropOn(key); return; }
      if (!ops.hasDrag(e)) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer!.dropEffect = "move"; if (dropOn !== key) setDropOn(key);
    },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropOn((d) => (d === key ? null : d)); },
    onDrop: (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDropOn(null);
      if (fromComputer(e)) {
        if (toHome) return;
        const { queued, refused } = importFiles(root, e.dataTransfer!.files, container);
        if (queued.length) toast(`Importing ${count(queued.length, "photo")}`);
        if (refused.length) toast(refused.length === 1 ? `“${refused[0].name}”: ${refused[0].why}` : `${refused.length} files left out: ${refused[0].why}`, { tone: "warning" });
        return;
      }
      const dragged = (ops.readDrag(e) ?? []).map((id) => map.get(id)).filter((f): f is FileRec => !!f);
      if (toHome !== home) return; // nothing crosses between a project and an account home
      if (dragged.length) void ops.moveFiles(root, all, dragged, container).then((ok) => ok && clear());
    },
  });
  // A collection opened with its order set by hand: its photos are reordered by dragging them.
  const handOrder = !!openColl && (openColl.body as { order?: string } | undefined)?.order === "manual" && !q;
  const sort_ = useSort("x", (from, to) => { if (openColl) void setOrder(openColl, all, "manual", moved(ids, from, to)); });
  const rowDrag = (f: FileRec, i?: number) => ({
    ...(handOrder && i !== undefined ? { "data-sort": true, style: sort_.style(i), onPointerDown: sort_.start(i), draggable: false } : { draggable: !f.fixed, onDragStart: dragStart(f) }),
    onContextMenu: (e: MouseEvent) => fileMenu(f, e),
    ...(kindOf(f.type).holds ? dropTarget(f.id, f.id) : {}),
    className: dropOn === f.id ? "is-drop" : undefined,
  });

  useKeys(bind("files", {
    search: () => search.current?.querySelector("input")?.focus(),
    down: () => { const i = cur ? ids.indexOf(cur) : -1; if (ids.length) setCur(ids[Math.min(ids.length - 1, i + 1)]); },
    up: () => { const i = cur ? ids.indexOf(cur) : ids.length; if (ids.length) setCur(ids[Math.max(0, i - 1)]); },
    open: () => { if (one) open(one); else return false; },
    parent: () => { if (here) go({ folder: map.get(here)?.container ?? null }); else if (openColl) setMnav("all"); else return false; },
    rename: () => { if (one) void ops.renameFile(one); else return false; },
    remove: () => { if (chosen.length) { void ops.binFiles(root, chosen); clear(); } else return false; },
    newFolder: () => { if (!media) void ops.newFolder(root, here); else return false; },
    all: () => setSel(ids),
    clear: () => { if (sel.length || cur) clear(); else return false; },
  }), nav === "all");

  // The map is offered where it can show something: Locations always, elsewhere once a file here has a position.
  const mapped = !home && (entry === "locations" || items.some((f) => positionOf(f, defs)));
  const shownView: View = view === "map" && !mapped ? "list" : view;
  // ---- Sidebar.
  const collections = all.filter((f) => f.type === "collection" && !f.internal_of).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  // Saved filters of the project: opened in this window, where they list what matches now.
  const filters = home ? [] : all.filter((f) => f.type === "filter" && !f.internal_of).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const filterNav = filters.length ? [{ label: "Filters", items: filters.map((f) => ({ id: `filter:${f.id}`, label: f.name, icon: "filter" as const })) }] : [];
  const pickFilter = (id: string) => { const fid = id.slice(7); setQ(""); setTypes([]); setFilterFile(fid); setNav("all"); clear(); };
  const sidebar = shotsOnly ? (
    <div className="st-side">
      <SidebarNav value={savedFilter ? `filter:${savedFilter.id}` : "all"} onChange={(id) => (id === "all" ? (resetFilter(), clear()) : pickFilter(id))} sections={[
        { items: [{ id: "all", label: `All ${onlyKind!.plural.toLowerCase()}`, icon: onlyKind!.glyph, count: all.filter((f) => f.type === only && !f.internal_of).length }] },
        ...filterNav,
      ]} />
    </div>
  ) : media ? (
    <div className="st-side">
      <SidebarNav value={mnav} onChange={(id) => { setMnav(id as MediaNav); clear(); }} sections={[
        { items: [{ id: "all", label: "All media", icon: "image", count: all.filter((f) => f.type === "photo").length }, { id: "collections", label: "Collections", icon: "layers", count: collections.length }, { id: "loose", label: "Not in a collection", icon: "file" }] },
        ...(collections.length ? [{ label: "Collections", items: collections.map((c) => ({ id: `coll:${c.id}`, label: c.name, icon: "layers" as const, count: photosOf(c, all).length })) }] : []),
      ]} />
    </div>
  ) : (
    <div className="st-side">
      <Tree nodes={[{ id: "root", label: project?.name ?? "Project", icon: "slate", children: ops.folderNodes(home ? [] : all, null) }]} defaultExpanded={["root"]} expanded={home ? [] : ["root", ...path.map((f) => f.id)]}
        selected={nav === "all" && !home ? here ?? "root" : undefined} onSelect={(id) => go({ home: false, folder: id === "root" ? null : id })}
        rowProps={(id) => (home ? undefined : { ...dropTarget(`tree-${id}`, id === "root" ? null : id), className: dropOn === `tree-${id}` ? "is-drop" : undefined })} />
      <Tree nodes={[{ id: "home", label: homeLabel, icon: "home", children: ops.folderNodes(home ? all : [], null) }]} defaultExpanded={[]} expanded={home ? ["home", ...path.map((f) => f.id)] : []}
        selected={nav === "all" && home ? here ?? "home" : undefined} onSelect={(id) => go({ home: true, folder: id === "home" ? null : id })}
        rowProps={(id) => (home ? { ...dropTarget(`tree-${id}`, id === "home" ? null : id), className: dropOn === `tree-${id}` ? "is-drop" : undefined } : undefined)} />
      <SidebarNav value={nav === "bin" ? "bin" : savedFilter ? `filter:${savedFilter.id}` : undefined} onChange={(id) => { if (id === "bin") { setNav("bin"); clear(); } else pickFilter(id); }}
        sections={[...filterNav, { items: [{ id: "bin", label: "Recycle bin", icon: "trash", count: bin?.length || undefined }] }]} />
    </div>
  );

  // ---- Toolbar.
  const allTypes = fileTypes().filter((t) => all.some((f) => f.type === t.type && !f.fixed));
  const crumbs = media
    ? [{ id: "all", label: "Media" }, ...(openColl ? [{ id: openColl.id, label: openColl.name }] : mnav === "collections" ? [{ id: "collections", label: "Collections" }] : mnav === "loose" ? [{ id: "loose", label: "Not in a collection" }] : [])]
    : [{ id: "root", label: rootLabel }, ...path.map((f) => ({ id: f.id, label: f.name }))];
  const toolbar = nav === "bin" ? null : (
    <Toolbar>
      <Breadcrumb items={crumbs} onNavigate={(id) => (media ? (id === "all" ? setMnav("all") : undefined) : go({ folder: id === "root" ? null : id }))}
        itemProps={(id) => (media ? undefined : { ...dropTarget(`crumb-${id}`, id === "root" ? null : id), className: dropOn === `crumb-${id}` ? "is-drop" : undefined })} />
      {flat && !media && !shotsOnly && <Badge>{home ? "whole home" : "whole project"}</Badge>}
      <ToolbarSpacer />
      <span ref={search}><SearchInput size="sm" value={q} onChange={setQ} placeholder={home ? "Names" : "Names and properties"} style={{ width: 190 }} /></span>
      {!home && <Button size="sm" variant={filterOpen || filtering ? "secondary" : "quiet"} icon="filter" selected={filterOpen} onClick={() => setFilterOpen(!filterOpen)}>{savedFilter ? savedFilter.name : filtering ? `Filter · ${ruleCount(filter)}` : "Filter"}</Button>}
      {!media && !shotsOnly && allTypes.length > 1 && <DropdownMenu size="sm" variant="quiet" icon="filter" label={types.length ? count(types.length, "type") : "Types"} align="end"
        items={allTypes.map((t) => ({ id: t.type, label: t.plural, checked: types.includes(t.type) }))} onSelect={(id) => setTypes(types.includes(id) ? types.filter((t) => t !== id) : [...types, id])} />}
      {media && mnav === "all" && !q && <Segmented label="Collections" value={spread ? "spread" : "stack"} onChange={(v) => setSpread(v === "spread")} options={[{ value: "stack", icon: "layers", title: "Collections as one tile" }, { value: "spread", icon: "grid", title: "Collections spread out" }]} />}
      <Segmented label="View" value={shownView} onChange={(v) => setView(v as View)} options={[{ value: "list", icon: "list", title: "List" }, { value: "grid", icon: "grid", title: "Grid" }, ...(!home ? [{ value: "board", icon: "columns" as const, title: "Board: lanes by a property" }] : []), ...(mapped ? [{ value: "map", icon: "pin" as const, title: "Map: the files with a position" }] : [])]} />
      {!home && !shotsOnly && <Button size="sm" variant={media ? "primary" : "secondary"} icon="upload" onClick={() => picker.current?.click()}>Import</Button>}
      {shotsOnly && <Button size="sm" variant="primary" icon="plus" onClick={() => void newOf(only!)}>New {onlyKind!.label.toLowerCase()}</Button>}
      {!media && !shotsOnly && <DropdownMenu size="sm" variant="primary" icon="plus" label="New" align="end" items={[{ id: "folder", label: "Folder", icon: "folder-plus", kbd: "⇧N" }, ...(!home ? [{ id: "shot", label: "Shot", icon: "slate" as const }, { id: "set", label: "Set", icon: "home" as const }, { id: "location", label: "Location", icon: "location" as const }, { id: "canvas", label: "Canvas", icon: "brush" as const }, { id: "timeline", label: "Timeline", icon: "timeline" as const }] : [])]} onSelect={(id) => void (id === "shot" || id === "set" || id === "location" || id === "timeline" ? newOf(id) : id === "canvas" ? ops.newCanvas(root, here) : ops.newFolder(root, here))} />}
      <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "panels", label: "Panels back to their places", icon: "refresh" }]} onSelect={resetPanels} />
      <input ref={picker} type="file" accept={IMAGE_TYPES} multiple hidden onChange={(e) => { const t = e.currentTarget; if (t.files?.length) importAll(t.files); t.value = ""; }} />
    </Toolbar>
  );

  // ---- Main area.
  const icon = (f: FileRec, size: number) => { const l = lookOf(f, map); return <AppIcon glyph={l.glyph} color={l.color} size={size} off={l.broken} />; };
  const where = (f: FileRec) => (f.container ? map.get(f.container)?.name ?? "" : "Top level");
  const facts = (f: FileRec) => {
    if (f.type === "collection") return count(photosOf(f, all).length, "photo");
    if (f.type === "photo") { const c = collectionOf(f, map); return c && (media ? !openColl : true) ? c.name : f.photo ? new Date(f.photo.taken_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Photo"; }
    if (kindOf(f.type).holds) return count(all.filter((c) => c.container === f.id).length);
    if (f.type === "filter") return `Filter · ${ruleCount(f.body as unknown as FilterGroup)} rules`;
    if (f.type === "shortcut") { const t = targetOf(f, map); return !t ? "Points at something that is gone" : "app" in t ? `Opens ${appDef(t.app)?.name}` : `To ${kindOf(t.file.type).label.toLowerCase()} “${t.file.name}”`; }
    return kindOf(f.type).label;
  };
  const uploadOf = (f: FileRec) => uploads.get(f.id)?.state ?? (f.type === "photo" && f.photo && !f.photo.stored.original ? (f.photo.stored.preview ? "preview" : "waiting") : undefined);
  const presetMap = new Map(presetsIn(all).map((p) => [p.id, p.body]));
  const card = (f: FileRec, i: number) => {
    const thumb = thumbOf(f, all);
    const coll = f.type === "collection" ? f : collectionOf(f, map);
    const stack = f.type === "collection" ? photosOf(f, all) : null;
    return (
      <FileCard key={f.id} name={f.name} meta={facts(f)} art={thumb ? (coverOf(f, map) ? <CoverArt f={f} files={map} presets={presetMap} /> : <img src={thumb} alt="" draggable={false} loading="lazy" />) : icon(f, 48)} picture={!!thumb}
        badge={lookOf(f, map).shortcut ? <Icon name="shortcut" size={12} /> : thumb && f.type !== "photo" ? icon(f, 20) : undefined}
        stack={stack ? { srcs: stack.filter((p) => p.photo?.stored.thumbnail).slice(0, 40).map((p) => imageUrl(p.id, "thumbnail")), count: stack.length } : undefined}
        tint={coll && !(openColl && f.type === "photo") ? tintOf(coll) : undefined} mark={mark} upload={uploadOf(f)}
        title={f.type === "photo" && coll && f.type !== coll.type ? `In the collection “${coll.name}”` : undefined}
        selected={sel.includes(f.id)} current={cur === f.id} dropTarget={dropOn === f.id} onClick={(e) => pick(f.id, e)} onTick={() => tick(f.id)} onOpen={() => open(f)} {...rowDrag(f, i)} />
    );
  };
  const nameCell = (f: FileRec) => {
    const thumb = thumbOf(f, all);
    const up = uploadOf(f);
    return <span className="st-name">{thumb ? <img className="st-mini" src={thumb} alt="" loading="lazy" /> : icon(f, 20)}{f.name}{lookOf(f, map).shortcut && <Icon name="shortcut" size={12} label="Shortcut" />}{up && <UploadBadge state={up} />}</span>;
  };
  // The Shots list shows the shot properties as columns: the shot list as a table.
  const columnDefs = shotsOnly ? defs.filter((d) => d.def.attached.some((a) => a.type === only && !a.hidden)) : [];
  const valueCell = (d: Definition, f: FileRec) => {
    const v = f.values?.[d.id];
    if (v === undefined) return <span className="st-note">–</span>;
    if (d.def.field === "choice" || d.def.field === "multi") return <span className="st-tags">{(Array.isArray(v) ? v : [v]).map((id) => { const o = d.def.options?.find((x) => x.id === id); return o ? <span key={o.id} className="st-tag st-tag--static"><i style={{ background: colorCss(o.color) }} />{o.label}</span> : null; })}</span>;
    return valueText(d.def, v, (id) => map.get(id)?.name);
  };
  const collCell = (f: FileRec) => { const c = f.type === "collection" ? f : collectionOf(f, map); return c ? <CollectionTag tint={tintOf(c)!}>{f.type === "collection" ? count(photosOf(f, all).length, "photo") : c.name}</CollectionTag> : <span className="st-note">–</span>; };
  const empty = media
    ? <EmptyState icon={q ? "search" : "image"} title={q ? "Nothing matches" : openColl ? "This collection is empty" : "No photos yet"} action={!q ? <Button variant="primary" icon="upload" onClick={() => picker.current?.click()}>Import photos</Button> : undefined}>{q ? "" : "Drop image files here (JPEG, PNG, WebP), or use Import. The original is kept as it is."}</EmptyState>
    : <EmptyState icon={q ? "search" : "folder-open"} title={q || types.length ? "Nothing matches" : "Nothing here yet"} action={!flat ? <Button icon="folder-plus" onClick={() => void ops.newFolder(root, here)}>New folder</Button> : undefined}>{q ? "Search looks at names, in every folder." : !flat ? "Drop files or images here, or make a folder." : ""}</EmptyState>;
  const main = error && !files ? <EmptyState icon="cloud-off" title="Could not load the files" action={<Button onClick={() => void store.loadRoot(root).catch(toastError)}>Try again</Button>}>{error}</EmptyState>
    : !files ? null
    : !items.length ? empty
    : shownView === "map" ? <MapView items={items} defs={defs} current={cur} onCurrent={setCur} onOpen={open} />
    : shownView === "board" && !home ? <Board projectId={projectId} items={items} defs={defs} layout={board} onLayout={setBoard} selected={sel} card={card} />
    : shownView === "list" ? (
      <Table selectable selected={sel} onSelect={setSel} cursor={cur ?? undefined} onCursor={setCur} onOpen={(id) => open(map.get(id)!)} sort={openColl ? undefined : sort} onSort={(s) => setSort(s as Sort)} rowProps={(id) => rowDrag(map.get(id)!)}
        columns={media
          ? [{ key: "name", label: "Name", sortable: true }, { key: "coll", label: "Collection" }, { key: "taken", label: "Taken", sortable: true, mono: true, width: 130 }, { key: "size", label: "Size", numeric: true, width: 110 }]
          : shotsOnly ? [{ key: "name", label: "Name", sortable: true }, ...columnDefs.map((d) => ({ key: `p:${d.id}`, label: d.name })), { key: "created", label: "Created", sortable: true, mono: true, width: 130 }]
          : [{ key: "name", label: "Name", sortable: true }, { key: "type", label: "Type", sortable: true, width: 140 }, ...(flat ? [{ key: "where", label: "In" }] : []), { key: "created", label: "Created", sortable: true, mono: true, width: 130 }]}
        rows={items.map((f) => ({
          ...Object.fromEntries(columnDefs.map((d) => [`p:${d.id}`, valueCell(d, f)])),
          id: f.id, name: nameCell(f), type: kindOf(f.type).label, where: where(f), created: day(f.created_at), coll: collCell(f),
          taken: f.photo ? day(f.photo.taken_at) : "", size: f.photo ? `${f.photo.width} × ${f.photo.height}` : "",
        }))} />
    ) : <FileGrid ticking={sel.length > 0}>{items.map(card)}{handOrder && sort_.ghost((from) => <div className="st-ghost">{card(items[from], -1)}</div>)}</FileGrid>;

  // ---- Properties: nothing chosen, one file, or several.
  const info = (
    <div className="st-info">
      {!chosen.length ? <EmptyState icon="info" title={media ? (openColl?.name ?? "Media") : path.length ? path[path.length - 1].name : rootLabel}>{count(items.length)}. Click one to see its properties. Tick several to act on them together.</EmptyState>
        : one ? <OneFile key={one.id} f={one} files={all} map={map} facts={facts(one)} where={where(one)} who={(id) => (id === me?.id ? "You" : (id && people.get(id)) || "Someone else")} onOpen={() => open(one)} icon={icon(one, 48)}
          props={!home ? <PropertySections projectId={projectId} targets={[one]} defs={defs} files={all} /> : null} />
        : (
          <>
            <header className="st-info__head">
              <span className="st-info__icon"><Icon name="files" size={20} /><strong>{count(chosen.length, "file")} ticked</strong></span>
              <span className="st-note">{[...new Set(chosen.map((f) => kindOf(f.type).plural))].join(", ")}</span>
            </header>
            <div className="st-info__acts">
              {!home && photosIn(chosen).length > 0 && <Button size="sm" icon="layers" onClick={() => void groupInto(root, all, photosIn(chosen)).then(clear)}>Group into a collection…</Button>}
              {!home && photosIn(chosen).length > 0 && <Button size="sm" icon="plus" onClick={() => addToCollection(root, all, photosIn(chosen))}>Add to collection…</Button>}
              <Button size="sm" icon="folder" onClick={() => ops.moveFilesTo(root, all, chosen, rootLabel)}>Move to…</Button>
              <Button size="sm" variant="danger" icon="trash" onClick={() => { void ops.binFiles(root, chosen); clear(); }}>To the recycle bin</Button>
            </div>
            {!home && <PropertyList><PropertySections projectId={projectId} targets={chosen} defs={defs} files={all} /></PropertyList>}
          </>
        )}
    </div>
  );

  const waiting = [...uploads.values()];
  const stuck = waiting.filter((u) => u.state === "stuck");
  return (
    <BrowserLayout toolbar={toolbar}
      dock={{ layout: panels, onLayoutChange: setPanels, zoneSizes: { left: 220, right: 300, bottom: 220 }, panels: [{ id: "nav", title: media ? "Media" : "Folders", icon: media ? "image" : "folder", body: sidebar }, ...(nav === "all" ? [{ id: "info", title: "Properties", icon: "info" as const, body: info }] : [])] }}
      statusBar={nav === "bin" ? undefined : (
        <StatusBar>
          {count(items.length)}{sel.length > 0 && <> · <strong>{sel.length} ticked</strong> <Chip icon="close" onToggle={() => setSel([])}>Clear</Chip></>}
          {waiting.length > 0 && <> · {count(waiting.length - stuck.length, "upload")} running</>}
          {stuck.length > 0 && <> · <strong>{stuck.length} stuck</strong> ({stuck[0].error}) <Chip icon="refresh" onToggle={retryUploads}>Try again</Chip> <Chip icon="close" onToggle={dropStuck}>Give up</Chip></>}
          {handOrder && <> · drag photos to set their order</>}
        </StatusBar>
      )}>
      {nav === "bin" ? <BinView root={root} /> : (
        <div className={`st-scroll${dropOn === "here" ? " is-drop" : ""}`} {...dropTarget("here", importTo())} onContextMenu={emptyMenu} onClick={(e) => { if (e.target === e.currentTarget) clear(); }}>
          {filterOpen && !home && (
            <div className="st-filterbar">
              <FilterBuilder group={filter} fields={filterFields(defs, all)} onChange={setFilter} />
              <div className="st-filterbar__foot">
                <span className="st-note">{count(items.length, "file")} match{savedFilter ? ` · the filter “${savedFilter.name}”` : ""}</span>
                <span style={{ flex: 1 }} />
                <Button size="sm" variant="quiet" disabled={!filtering && !savedFilter} onClick={resetFilter}>{savedFilter ? "Close the filter" : "Clear"}</Button>
                <Button size="sm" variant="primary" icon="save" disabled={!filtering && !q && !types.length} onClick={() => void saveFilter()}>{savedFilter ? "Save" : "Save as a filter"}</Button>
              </div>
            </div>
          )}
          {main}
        </div>
      )}
    </BrowserLayout>
  );
}

/** The properties of one file: its name (editable), what it is, its facts or settings, its system properties, and where it is used. */
function OneFile({ f, files, map, facts, where, who, onOpen, icon, props }: { f: FileRec; files: readonly FileRec[]; map: ReadonlyMap<string, FileRec>; facts: string; where: string; who: (id: string | null) => string; onOpen: () => void; icon: preact.ComponentChildren; props?: preact.ComponentChildren }) {
  const [name, setName] = useState(f.name);
  const [uses, setUses] = useState<FileUse[] | null>(null);
  useEffect(() => { setName(f.name); }, [f.name]);
  useEffect(() => { let on = true; void fetchUses(f.id).then((u) => { if (on) setUses(u); }, () => {}); return () => { on = false; }; }, [f.id, f.updated_at]);
  const commit = () => { const to = name.trim(); if (!to || to === f.name) { setName(f.name); return; } void store.rename(f, to).catch((e) => { toastError(e); setName(f.name); }); };
  const k = kindOf(f.type);
  const thumb = f.type === "photo" && f.photo?.stored.preview ? imageUrl(f.id, "preview") : thumbOf(f, files);
  return (
    <>
      <header className="st-info__head">
        {thumb ? <img className="st-info__pic" src={thumb} alt="" onDblClick={onOpen} /> : <span className="st-info__icon">{icon}</span>}
        <TextInput value={name} disabled={!!f.fixed} aria-label="Name" maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(f.name); e.currentTarget.blur(); } }} />
        <span className="st-info__type"><AppIcon glyph={k.glyph} color={k.color} size={20} />{k.label}{f.fixed && " · fixed folder"}<span style={{ flex: 1 }} /><Button size="sm" variant="quiet" onClick={onOpen}>Open</Button></span>
      </header>
      <PropertyList>
        {f.type === "photo" ? <PhotoFactsSections f={f} map={map} /> : f.type === "collection" ? <CollectionSections c={f} files={files} /> : (
          <PropertySection title={k.label} icon="info">
            <PropertyRow label={k.holds ? "Holds" : f.type === "shortcut" ? "Opens" : "Kind"} value={facts} />
          </PropertySection>
        )}
        {props}
        <PropertySection title="System" icon="clock" defaultOpen={f.type !== "photo"}>
          <PropertyRow label="In" value={where} overflow="truncate" />
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
