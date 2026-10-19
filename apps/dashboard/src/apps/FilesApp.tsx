import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FILE_RESOURCE_TYPES, FILE_TYPE_META, type FileResourceType } from "@fielder/vocab";
import type { Folder } from "../api";
import * as data from "../data";
import { childFolders, FILE_DRAG, folderPath, matches, moveTargets, placementOf, readDrag, subtree, type FileDrag } from "../fileTree";
import { bind, useKeys } from "../keys";
import { useProjectId } from "../project";
import { parseRoute } from "../router";
import { Button, Checkbox, ContextMenu, cx, Empty, Highlight, Icon, IconButton, MenuItem, Modal, Panel, PanelBody, SearchInput, Seg, Select, Toolbar, ToolbarSpacer, useCtxMenu } from "@fielder/ui";
import { addShortcut, binItems, canRename, desktopFolderId, fileTarget, folderTarget, moveItems, newFolder, renameEntry, renameFolder, type Item } from "./fileOps";
import { openResource, useFileEntries, type FileEntry } from "./fileEntries";
import { launch, type AppProps } from "./registry";

/** What a launch hands Files: the folder to show (#/files/<folderId>; a folder shortcut). */
export interface FilesLaunch { folderId?: string | null }

/** Where Files looks: a folder (null = the project's top level), or every file of one type. */
type Place = { kind: "folder"; id: string | null } | { kind: "type"; type: FileResourceType };
/** A row: a folder or a file. */
type Row = { kind: "folder"; folder: Folder } | { kind: "file"; entry: FileEntry; folderId: string | null };
type Sort = "name" | "date" | "type";


const rowKey = (r: Row) => (r.kind === "folder" ? `folder:${r.folder.id}` : `${r.entry.type}:${r.entry.id}`);
function pref<T extends string>(key: string, ok: readonly T[], fallback: T): T { try { const v = localStorage.getItem(key) as T | null; return v && ok.includes(v) ? v : fallback; } catch { return fallback; } }
function setPref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* a preference */ } }
const when = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

const itemOf = (r: Row): Item => (r.kind === "folder" ? { kind: "folder", id: r.folder.id } : { kind: "file", type: r.entry.type, id: r.entry.id });
const nameOf = (r: Row) => (r.kind === "folder" ? r.folder.name : r.entry.name);
const folderIcon = (f: Folder, open = false) => (f.kind === "desktop" ? "monitor" : open ? "folder-open-outline" : "folder-outline");

/**
 * Files (#/files/<folderId>): the project's shots, timelines, days, views, locations and fields
 * in folders. A view over what is already loaded plus the folders from /api/files: no list query
 * of its own. Opening a file opens the app that shows it; folders, placements and desktop
 * shortcuts change through fileOps.
 */
export function FilesApp({ win, focused, setTitle, replaceRoute }: AppProps) {
  const projectId = useProjectId()!;
  const d = data.useData();
  const folders = d.files?.folders ?? [];
  const items = d.files?.items ?? [];
  const entries = useFileEntries(projectId, focused);
  const [place, setPlace] = useState<Place>(() => {
    const st = win.state as FilesLaunch | undefined;
    if (st && "folderId" in st) return { kind: "folder", id: st.folderId ?? null };
    const r = win.route ? parseRoute(win.route) : null;
    return { kind: "folder", id: r?.page === "files" ? r.folderId : null };
  });
  useEffect(() => {
    const st = win.state as FilesLaunch | undefined;
    if (win.stateSeq && st && "folderId" in st) setPlace({ kind: "folder", id: st.folderId ?? null });
  }, [win.stateSeq]);
  // A folder that was deleted (here or in another window) falls back to the top level.
  const folderGone = place.kind === "folder" && place.id !== null && d.files !== null && !folders.some((f) => f.id === place.id);
  useEffect(() => { if (folderGone) setPlace({ kind: "folder", id: null }); }, [folderGone]);

  const [q, setQ] = useState("");
  const hq = q.trim().toLowerCase(); // what matches() looks for, so the mark and the filter agree
  const [deep, setDeep] = useState(false);
  const [sort, setSortState] = useState<Sort>(() => pref("files.sort", ["name", "date", "type"] as const, "name"));
  const [layout, setLayoutState] = useState<"list" | "grid">(() => pref("files.layout", ["list", "grid"] as const, "list"));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picker, setPicker] = useState<Row[] | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const rowMenu = useCtxMenu<Row[]>();
  const bgMenu = useCtxMenu<null>();

  const at = useMemo(() => placementOf(items, folders), [items, folders]);
  const path = place.kind === "folder" ? folderPath(folders, place.id) : [];
  const projectName = d.projects?.find((p) => p.id === projectId)?.name ?? "Project";
  const placeName = place.kind === "type" ? `All ${FILE_TYPE_META[place.type].plural.toLowerCase()}` : path.at(-1)?.name ?? projectName;
  useEffect(() => { setTitle(place.kind === "folder" && place.id === null ? "Files" : `Files · ${placeName}`); }, [placeName]);
  useEffect(() => { replaceRoute({ page: "files", folderId: place.kind === "folder" ? place.id : null }); }, [place.kind === "folder" ? place.id : `type:${place.type}`]);
  useEffect(() => { setSel(new Set()); }, [place]);

  const rows = useMemo((): Row[] => {
    const all = FILE_RESOURCE_TYPES.flatMap((t) => entries[t]);
    let out: Row[];
    if (place.kind === "type") {
      out = entries[place.type].filter((e) => matches(q, e.name, e.sub)).map((e) => ({ kind: "file", entry: e, folderId: at(e.type, e.id) }));
    } else {
      const scope = deep && q.trim() ? (place.id ? subtree(folders, place.id) : null) : new Set([place.id ?? ""]);
      const inScope = (folderId: string | null) => (scope === null ? true : scope.has(folderId ?? ""));
      const fs = deep && q.trim() ? folders.filter((f) => f.id !== place.id && (scope === null || (f.parent_id !== null && scope.has(f.parent_id)))) : childFolders(folders, place.id);
      out = [
        ...fs.filter((f) => matches(q, f.name)).map((f): Row => ({ kind: "folder", folder: f })),
        ...all.map((e) => ({ e, fid: at(e.type, e.id) })).filter(({ e, fid }) => inScope(fid) && matches(q, e.name, e.sub)).map(({ e, fid }): Row => ({ kind: "file", entry: e, folderId: fid })),
      ];
    }
    const name = (r: Row) => (r.kind === "folder" ? r.folder.name : r.entry.name);
    const cmp = (a: Row, b: Row) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      if (a.kind === "folder" && b.kind === "folder" && a.folder.kind !== b.folder.kind) return a.folder.kind === "desktop" ? -1 : 1;
      if (sort === "date" && a.kind === "file" && b.kind === "file") return (b.entry.date ?? "").localeCompare(a.entry.date ?? "");
      if (sort === "type" && a.kind === "file" && b.kind === "file" && a.entry.type !== b.entry.type) return FILE_RESOURCE_TYPES.indexOf(a.entry.type) - FILE_RESOURCE_TYPES.indexOf(b.entry.type);
      return name(a).localeCompare(name(b), undefined, { sensitivity: "base", numeric: true });
    };
    return out.sort(cmp);
  }, [place, entries, folders, at, q, deep, sort]);

  const go = (p: Place) => { setQ(""); setPlace(p); };
  const open = (r: Row) => { if (r.kind === "folder") go({ kind: "folder", id: r.folder.id }); else openResource(r.entry.type, r.entry.id); };
  const picked = rows.filter((r) => sel.has(rowKey(r)));
  const selRow = picked.length === 1 ? picked[0] : null;
  const rename = (r: Row) => { if (r.kind === "folder") void renameFolder(r.folder); else if (canRename(r.entry.type)) void renameEntry(r.entry, projectId); };
  /** The Desktop folder never goes; everything else to the recycle bin in one toast. */
  const remove = (list: Row[]) => { if (list.length) void binItems(list.map((r) => ({ type: r.kind === "folder" ? "folder" as const : r.entry.type, id: itemOf(r).id, name: nameOf(r) })), projectId); };
  const deskId = desktopFolderId();
  /** Click selects, Ctrl/Cmd toggles, Shift extends from the last clicked row. */
  const clickRow = (r: Row, e: MouseEvent) => {
    const k = rowKey(r);
    if (e.shiftKey && anchor) {
      const a = rows.findIndex((x) => rowKey(x) === anchor), b = rows.findIndex((x) => rowKey(x) === k);
      if (a >= 0 && b >= 0) { setSel((s) => { const n = new Set(s); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(rowKey(rows[i])); return n; }); return; }
    }
    if (e.ctrlKey || e.metaKey) setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    else setSel(new Set([k]));
    setAnchor(k);
  };
  /** A row and the rest of the selection, when it is part of it. */
  const withSel = (r: Row) => (sel.has(rowKey(r)) && picked.length > 1 ? picked : [r]);
  /** Files and folders dropped onto the recycle bin go there. */
  const binDrop = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes(FILE_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropOn("bin"); } },
    onDragLeave: () => setDropOn((k) => (k === "bin" ? null : k)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropOn(null);
      const list = readDrag(e.dataTransfer);
      if (list) void binItems(list.map((p: FileDrag) => ({ type: p.kind === "folder" ? "folder" as const : p.type, id: p.id, name: p.kind === "folder" ? folders.find((f) => f.id === p.id)?.name ?? "Folder" : entries[p.type].find((x) => x.id === p.id)?.name ?? "File" })), projectId);
    },
  };
  const binCount = d.trash?.projectId === projectId ? d.trash.entries.length : 0;
  const toDesktop = (r: Row) => void addShortcut(projectId, r.kind === "folder" ? folderTarget(r.folder.id) : fileTarget(r.entry.type, r.entry.id));
  const moveToDesktop = (list: Row[]) => { if (deskId) void moveItems(list.filter((r) => !(r.kind === "folder" && r.folder.id === deskId)).map(itemOf), deskId); };
  const here = place.kind === "folder" ? place.id : null;
  const step = (dir: 1 | -1) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => rowKey(r) === (anchor && sel.has(anchor) ? anchor : [...sel][0]));
    const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + dir))];
    setSel(new Set([rowKey(next)]));
    setAnchor(rowKey(next));
    list.current?.querySelector(`[data-key="${rowKey(next)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  useKeys(bind("files", {
    search: () => search.current?.focus(),
    down: () => step(1),
    up: () => step(-1),
    open: () => { if (selRow) open(selRow); else return false; },
    parent: () => { if (place.kind === "folder" && place.id) go({ kind: "folder", id: path.at(-2)?.id ?? null }); else return false; },
    rename: () => { if (selRow) rename(selRow); },
    remove: () => { if (picked.length) remove(picked); else return false; },
    all: () => setSel(new Set(rows.map(rowKey))),
    newFolder: () => { if (place.kind === "folder") void newFolder(projectId, here); },
  }), !picker);

  /** Drop files or folders onto a folder (null = the top level). */
  const dropProps = (target: string | null, key: string) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes(FILE_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropOn(key); } },
    onDragLeave: () => setDropOn((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropOn(null);
      const list = readDrag(e.dataTransfer);
      if (!list) return;
      // A folder cannot go into itself or below itself; moveItems skips those (with a note).
      void moveItems(list.filter((p) => !(p.kind === "folder" && (p.id === target || (target && subtree(folders, p.id).has(target))))) as Item[], target);
    },
  });
  const dragProps = (r: Row) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      // Dragging a selected row takes the whole selection along (the Desktop folder stays put).
      const list = withSel(r).filter((x) => !(x.kind === "folder" && x.folder.kind === "desktop"));
      if (!list.length) { e.preventDefault(); return; }
      const payload: FileDrag[] = list.map(itemOf);
      e.dataTransfer?.setData(FILE_DRAG, JSON.stringify(payload));
      e.dataTransfer?.setData("text/plain", list.map(nameOf).join("\n"));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
    },
  });

  const counts = Object.fromEntries(FILE_RESOURCE_TYPES.map((t) => [t, entries[t].length])) as Record<FileResourceType, number>;
  return (
    <div class="f-app__body">
      <Panel left width="248px" label="Places">
        <PanelBody flush>
          <div class="files-side" role="tree" aria-label="Folders">
            <div class="files-side__label">Folders</div>
            <button type="button" role="treeitem" class={cx("files-node", place.kind === "folder" && place.id === null && "is-current", dropOn === "root" && "is-drop")}
              onClick={() => go({ kind: "folder", id: null })} {...dropProps(null, "root")}>
              <Icon name="folder-home-outline" /><span>{projectName}</span>
            </button>
            <FolderTree folders={folders} parentId={null} depth={1} current={place.kind === "folder" ? place.id : null} openPath={new Set(path.map((f) => f.id))}
              onPick={(id) => go({ kind: "folder", id })} dropOn={dropOn} dropProps={dropProps} dragProps={(f) => dragProps({ kind: "folder", folder: f })}
              onMenu={(e, f) => rowMenu.openMenu(e, [{ kind: "folder", folder: f }])} />
            <div class="files-side__label">All files</div>
            {FILE_RESOURCE_TYPES.map((t) => (
              <button key={t} type="button" class={cx("files-node", place.kind === "type" && place.type === t && "is-current")} onClick={() => go({ kind: "type", type: t })}>
                <Icon name={FILE_TYPE_META[t].icon} /><span>{FILE_TYPE_META[t].plural}</span><span class="files-node__n num">{counts[t]}</span>
              </button>
            ))}
            <div class="files-side__sep" />
            <button type="button" class={cx("files-node", dropOn === "bin" && "is-drop")} title="Open the recycle bin; drop files here to delete them" onClick={() => launch({ app: "trash" })} {...binDrop}>
              <Icon name={binCount ? "delete" : "delete-empty-outline"} /><span>Recycle bin</span>{binCount > 0 && <span class="files-node__n num">{binCount}</span>}
            </button>
          </div>
        </PanelBody>
      </Panel>
      <div class="files-main">
        <Toolbar>
          <nav class="files-crumbs" aria-label="Path">
            {place.kind === "type" ? <span class="files-crumb is-current">{placeName}</span> : (
              <>
                <button type="button" class={cx("files-crumb", path.length === 0 && "is-current")} onClick={() => go({ kind: "folder", id: null })} {...dropProps(null, "crumb-root")}>{projectName}</button>
                {path.map((f, i) => (
                  <Fragment key={f.id}>
                    <Icon name="chevron-right" />
                    <button type="button" class={cx("files-crumb", i === path.length - 1 && "is-current")} onClick={() => go({ kind: "folder", id: f.id })} {...dropProps(f.id, `crumb-${f.id}`)}>{f.name}</button>
                  </Fragment>
                ))}
              </>
            )}
          </nav>
          <ToolbarSpacer />
          {place.kind === "folder" && <Button size="sm" kind="secondary" icon="folder-plus-outline" kbd="⇧N" onClick={() => void newFolder(projectId, here)}>New folder</Button>}
          <SearchInput inputRef={search} value={q} placeholder={place.kind === "type" ? "Search" : "Search this folder"} aria-label="Search" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          {place.kind === "folder" && <Checkbox checked={deep} onClick={() => setDeep(!deep)} title="Search in the folders below this one too">Subfolders</Checkbox>}
          <Select label="Sort" prefix="Sort" width="150px" value={sort} onChange={(v) => { setSortState(v as Sort); setPref("files.sort", v); }}
            options={[{ value: "name", label: "Name" }, { value: "date", label: "Date" }, { value: "type", label: "Type" }]} />
          <Seg label="Layout" value={layout} onChange={(v) => { setLayoutState(v); setPref("files.layout", v); }} options={[{ id: "list", icon: "view-list-outline", label: "List" }, { id: "grid", icon: "view-grid-outline", label: "Grid" }]} />
        </Toolbar>
        <div ref={list} class={cx("f-scroll files-list", layout === "grid" && "files-list--grid")} role="listbox" aria-label={placeName}
          onContextMenu={(e) => { if (place.kind === "folder" && (e.target as HTMLElement).closest("[data-key]") === null) bgMenu.openMenu(e, null); }}
          onClick={(e) => { if ((e.target as HTMLElement).closest("[data-key]") === null) setSel(new Set()); }}>
          {d.files === null && <Empty icon="folder-alert-outline" title="Folders not loaded">Files and folders need the server's folders; reload to try again.</Empty>}
          {d.files !== null && rows.length === 0 && (q ? <Empty icon="magnify" title="Nothing found">{deep ? "Nothing in this folder or below matches." : "Nothing in this folder matches. Tick Subfolders to search below it."}</Empty>
            : <Empty icon="folder-outline" title="Empty">Drag files here from another folder, or use Move to… in their menu.</Empty>)}
          {rows.map((r) => {
            const k = rowKey(r);
            const isFolder = r.kind === "folder";
            const e = r.kind === "file" ? r.entry : null;
            const name = isFolder ? r.folder.name : e!.name;
            const sub = isFolder ? (r.folder.kind === "desktop" ? "What is on the desktop" : "Folder") : e!.sub;
            return (
              <div key={k} data-key={k} role="option" aria-selected={sel.has(k)} tabIndex={-1}
                class={cx("files-row", sel.has(k) && "is-selected", e?.archived && "is-archived", dropOn === k && "is-drop")}
                onClick={(ev) => clickRow(r, ev)} onDblClick={() => open(r)} onContextMenu={(ev) => { if (!sel.has(k)) { setSel(new Set([k])); setAnchor(k); } rowMenu.openMenu(ev, withSel(r)); }}
                {...dragProps(r)} {...(isFolder ? dropProps(r.folder.id, k) : {})}>
                <span class="files-row__icon">
                  {e?.thumb ? <img src={e.thumb.image_url} alt="" loading="lazy" /> : <Icon name={isFolder ? folderIcon(r.folder) : FILE_TYPE_META[e!.type].icon} size={layout === "grid" ? 36 : 20} />}
                </span>
                <span class="files-row__main">
                  <b title={name}><Highlight text={name} q={hq} /></b>
                  <small title={sub}>{isFolder ? sub : <Highlight text={sub} q={hq} />}</small>
                </span>
                {layout === "list" && <span class="files-row__type">{isFolder ? "Folder" : FILE_TYPE_META[e!.type].label}{e?.archived ? " · archived" : ""}</span>}
                {layout === "list" && <span class="files-row__date num">{e ? when(e.date) : ""}</span>}
                {layout === "list" && (deep || place.kind === "type") && r.kind === "file" && <span class="files-row__where">{r.folderId ? folderPath(folders, r.folderId).map((f) => f.name).join(" › ") : "Top level"}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {rowMenu.menu && <RowMenu rows={rowMenu.menu.ctx} x={rowMenu.menu.x} y={rowMenu.menu.y} onClose={rowMenu.closeMenu} deskId={deskId} placedIn={(r) => (r.kind === "file" ? r.folderId : r.folder.parent_id)}
        onOpen={open} onRename={rename} onMove={setPicker} onTop={(list) => void moveItems(list.map(itemOf), null)}
        onShortcut={toDesktop} onToDesktop={moveToDesktop} onDelete={remove} onNewFolder={(r) => r.kind === "folder" && void newFolder(projectId, r.folder.id)} />}
      {bgMenu.menu && (
        <ContextMenu x={bgMenu.menu.x} y={bgMenu.menu.y} label="Folder" onClose={bgMenu.closeMenu}>
          <MenuItem icon="folder-plus-outline" onClick={() => void newFolder(projectId, here)}>New folder here</MenuItem>
          {here && here !== deskId && <MenuItem icon="monitor-shimmer" onClick={() => void addShortcut(projectId, folderTarget(here))}>Create a shortcut to this folder on the desktop</MenuItem>}
        </ContextMenu>
      )}
      {picker && <FolderPicker folders={folders} rows={picker} rootName={projectName} onClose={() => setPicker(null)}
        onPick={(target) => { const list = picker; setPicker(null); void moveItems(list.map(itemOf), target); }} />}
    </div>
  );
}

function FolderTree({ folders, parentId, depth, current, openPath, onPick, dropOn, dropProps, dragProps, onMenu }: {
  folders: Folder[]; parentId: string | null; depth: number; current: string | null; openPath: Set<string>; onPick: (id: string) => void; dropOn: string | null;
  dropProps: (target: string | null, key: string) => Record<string, unknown>; dragProps: (f: Folder) => Record<string, unknown>; onMenu: (e: MouseEvent, f: Folder) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const kids = childFolders(folders, parentId);
  if (!kids.length) return null;
  return (
    <div role="group">
      {kids.map((f) => {
        const hasKids = folders.some((x) => x.parent_id === f.id);
        const expanded = open.has(f.id) || openPath.has(f.id);
        const key = `tree-${f.id}`;
        return (
          <div key={f.id}>
            <div role="treeitem" aria-expanded={hasKids ? expanded : undefined} aria-selected={current === f.id}
              class={cx("files-node", current === f.id && "is-current", dropOn === key && "is-drop")} style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => onPick(f.id)} onContextMenu={(e) => onMenu(e, f)} {...dropProps(f.id, key)} {...dragProps(f)}>
              {hasKids ? <IconButton icon={expanded ? "chevron-down" : "chevron-right"} label={expanded ? "Collapse" : "Expand"} style={{ width: "20px", height: "20px" }}
                onClick={(e: MouseEvent) => { e.stopPropagation(); setOpen((s) => { const n = new Set(s); if (expanded) n.delete(f.id); else n.add(f.id); return n; }); }} /> : <span style={{ width: "20px", flex: "none" }} />}
              <Icon name={folderIcon(f, current === f.id)} /><span>{f.name}</span>
            </div>
            {expanded && <FolderTree folders={folders} parentId={f.id} depth={depth + 1} current={current} openPath={openPath} onPick={onPick} dropOn={dropOn} dropProps={dropProps} dragProps={dragProps} onMenu={onMenu} />}
          </div>
        );
      })}
    </div>
  );
}

function RowMenu({ rows, x, y, deskId, placedIn, onClose, onOpen, onRename, onMove, onTop, onShortcut, onToDesktop, onDelete, onNewFolder }: {
  rows: Row[]; x: number; y: number; deskId: string | null; placedIn: (r: Row) => string | null; onClose: () => void; onOpen: (r: Row) => void; onRename: (r: Row) => void; onMove: (rows: Row[]) => void;
  onTop: (rows: Row[]) => void; onShortcut: (r: Row) => void; onToDesktop: (rows: Row[]) => void; onDelete: (rows: Row[]) => void; onNewFolder: (r: Row) => void;
}) {
  const isDesk = (r: Row) => r.kind === "folder" && r.folder.kind === "desktop";
  const movable = rows.filter((r) => !isDesk(r));
  const offDesk = movable.filter((r) => placedIn(r) !== deskId);
  if (rows.length > 1) {
    return (
      <ContextMenu x={x} y={y} label={`${rows.length} items`} onClose={onClose}>
        <MenuItem icon="folder-move-outline" disabled={!movable.length} onClick={() => onMove(movable)}>Move to…</MenuItem>
        {movable.some((r) => placedIn(r) !== null) && <MenuItem icon="arrow-up-bold-outline" onClick={() => onTop(movable)}>Move to the top level</MenuItem>}
        {deskId && offDesk.length > 0 && <MenuItem icon="monitor-arrow-down" onClick={() => onToDesktop(offDesk)}>Move to the desktop</MenuItem>}
        <div class="f-menu__sep" />
        <MenuItem icon="delete-outline" danger disabled={!movable.length} onClick={() => onDelete(movable)}>Move {movable.length} to the recycle bin</MenuItem>
      </ContextMenu>
    );
  }
  const row = rows[0];
  const type = row.kind === "file" ? row.entry.type : null;
  const desk = isDesk(row);
  const renameOk = (row.kind === "folder" && !desk) || (type !== null && canRename(type));
  const ownApp = type === "timeline" ? "Timeline" : type === "day" ? "Plan" : type === "field" ? "Fields" : "";
  const where = placedIn(row);
  return (
    <ContextMenu x={x} y={y} label={row.kind === "folder" ? "Folder" : FILE_TYPE_META[type!].label} onClose={onClose}>
      <MenuItem icon="open-in-app" onClick={() => onOpen(row)}>{row.kind === "folder" ? "Open folder" : "Open"}</MenuItem>
      <MenuItem icon="pencil-outline" disabled={!renameOk} title={renameOk ? undefined : desk ? "The Desktop folder keeps its name" : `Rename it in ${ownApp}`} onClick={() => onRename(row)}>Rename…</MenuItem>
      <MenuItem icon="folder-move-outline" disabled={desk} onClick={() => onMove([row])}>Move to…</MenuItem>
      {where && !desk && <MenuItem icon="arrow-up-bold-outline" onClick={() => onTop([row])}>Move to the top level</MenuItem>}
      {deskId && !desk && where !== deskId && <MenuItem icon="monitor-arrow-down" onClick={() => onToDesktop([row])}>Move to the desktop</MenuItem>}
      {!desk && where !== deskId && <MenuItem icon="monitor-shimmer" onClick={() => onShortcut(row)}>Create shortcut on the desktop</MenuItem>}
      {row.kind === "folder" && <MenuItem icon="folder-plus-outline" onClick={() => onNewFolder(row)}>New folder inside</MenuItem>}
      <div class="f-menu__sep" />
      <MenuItem icon="delete-outline" danger disabled={desk} title={desk ? "The Desktop folder stays" : undefined} onClick={() => onDelete([row])}>Move to the recycle bin</MenuItem>
    </ContextMenu>
  );
}

/** Move to…: the folder tree as a flat list; a folder cannot go into itself or below itself. */
function FolderPicker({ folders, rows, rootName, onPick, onClose }: { folders: Folder[]; rows: Row[]; rootName: string; onPick: (id: string | null) => void; onClose: () => void }) {
  // A target must take every folder moved (not itself, not below itself).
  let allowedList = folders;
  for (const r of rows) if (r.kind === "folder") { const ok = new Set(moveTargets(folders, r.folder.id).map((f) => f.id)); allowedList = allowedList.filter((f) => ok.has(f.id)); }
  const allowed = new Set(allowedList.map((f) => f.id));
  const wheres = new Set(rows.map((r) => (r.kind === "folder" ? r.folder.parent_id : r.folderId)));
  const current = wheres.size === 1 ? [...wheres][0] : undefined;
  const row = rows[0];
  const flat: { f: Folder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => { for (const f of childFolders(folders, parent)) { flat.push({ f, depth }); walk(f.id, depth + 1); } };
  walk(null, 1);
  return (
    <Modal title={rows.length > 1 ? `Move ${rows.length} items to…` : `Move “${row.kind === "folder" ? row.folder.name : row.entry.name}” to…`} width="420px" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div class="f-modal__body files-picker">
        <MenuItem icon="folder-home-outline" disabled={current === null} selected={current === null} onClick={() => onPick(null)}>{rootName} (top level)</MenuItem>
        {flat.map(({ f, depth }) => (
          <div key={f.id} style={{ paddingLeft: `${depth * 14}px` }}>
            <MenuItem icon="folder-outline" disabled={!allowed.has(f.id) || current === f.id} selected={current === f.id} onClick={() => onPick(f.id)}>{f.name}</MenuItem>
          </div>
        ))}
        {flat.length === 0 && <span class="meta">No folders yet: make one with New folder.</span>}
      </div>
      <div class="f-modal__foot"><span class="f-grow" /><Button kind="ghost" kbd="Esc" onClick={onClose}>Cancel</Button></div>
    </Modal>
  );
}
