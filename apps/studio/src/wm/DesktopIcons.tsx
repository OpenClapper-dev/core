import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AppIcon, Dialog, FileTile, List, ListRow, SearchInput } from "@openclapper/design";
import type { FileRec, Root } from "../api";
import { emptyBin } from "../apps/BinView";
import { apps, launch } from "../apps/registry";
import { kindOf, lookOf, targetOf } from "../fileKinds";
import * as ops from "../fileOps";
import * as store from "../files";
import { contextMenu, openDialog, toast, type MenuEntry } from "../hosts";
import { bind, useKeys } from "../keys";
import { setPrefs, usePrefs } from "../prefs";
import { cellAt, cellKey, cellSpot, layOut, nearestFreeCell, type Cell, type Grid } from "./grid";
import { useOverlay } from "./overlays";
import * as wm from "./wm";

const CELL = { w: 92, h: 96 };
const PAD = 12;
/** The recycle bin's icon: not a file, so it has an id of its own in the layout. */
const BIN = "bin";
const BIN_DRAG = "application/x-oc-bin-icon";

/** Pick what a new shortcut opens: an app, or a file or folder of the project. */
function ShortcutPicker({ files, onPick, close }: { files: readonly FileRec[]; onPick: (t: { app: string } | { file: FileRec }) => void; close: () => void }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector("input")?.focus(); }, []);
  const n = q.trim().toLowerCase();
  const map = store.byId(files);
  const hitApps = apps().filter((a) => !n || a.name.toLowerCase().includes(n));
  const hitFiles = files.filter((f) => !f.internal_of && f.type !== "shortcut" && f.fixed !== "desktop" && (!n || f.name.toLowerCase().includes(n))).slice(0, 40);
  return (
    <Dialog fixed title="New shortcut" onClose={close}>
      <div ref={box} className="st-pick">
        <SearchInput value={q} onChange={setQ} placeholder="Apps, folders and files" />
        <List className="st-pick__list">
          {hitApps.map((a) => <ListRow key={a.id} leading={<AppIcon glyph={a.glyph} color={a.color} size={20} />} meta="App" onClick={() => { close(); onPick({ app: a.id }); }}>{a.name}</ListRow>)}
          {hitFiles.map((f) => { const l = lookOf(f, map); return <ListRow key={f.id} leading={<AppIcon glyph={l.glyph} color={l.color} size={20} />} meta={kindOf(f.type).label} onClick={() => { close(); onPick({ file: f }); }}>{f.name}</ListRow>; })}
          {!hitApps.length && !hitFiles.length && <ListRow disabled>Nothing matches</ListRow>}
        </List>
      </div>
    </Dialog>
  );
}

/**
 * The desktop's icons: the files of the project's Desktop folder (real files and folders, and
 * shortcuts to apps and to files elsewhere) and the recycle bin. Where each icon sits is a
 * preference of the account, per project. `shellMenu` is what the shell adds to the desktop's own
 * right-click menu.
 */
export function DesktopIcons({ projectId, shellMenu }: { projectId: string; shellMenu: MenuEntry[] }) {
  const root: Root = { project: projectId };
  const { files, bin } = store.useRoot(root);
  const prefs = usePrefs();
  const focused = wm.useFocusedId();
  const overlay = useOverlay();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [sel, setSel] = useState<string[]>([]);
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const grab = useRef<{ dx: number; dy: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = box.current!;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = files ?? [];
  const map = useMemo(() => store.byId(all), [files]);
  const desktop = store.fixedFolder(all, "desktop");
  // A shortcut whose target is gone is not shown; it comes back with its target.
  const icons = all.filter((f) => desktop && f.container === desktop.id && !(f.type === "shortcut" && !targetOf(f, map))).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const grid: Grid = { w: CELL.w, h: CELL.h, pad: PAD, cols: Math.max(1, Math.floor((size.w - PAD) / CELL.w)), rows: Math.max(1, Math.floor((size.h - PAD) / CELL.h)) };
  const saved = prefs.icons[projectId] ?? {};
  const showBin = prefs.binOnDesktop;
  const ids = [...icons.map((f) => f.id), ...(showBin ? [BIN] : [])];
  const cells = useMemo(() => layOut(ids, saved, grid, (id) => (id === BIN ? { c: grid.cols - 1, r: grid.rows - 1 } : undefined)), [ids.join(), JSON.stringify(saved), grid.cols, grid.rows]);
  const save = (next: Record<string, Cell>) => setPrefs({ icons: { ...prefs.icons, [projectId]: { ...Object.fromEntries(cells), ...next } } });
  const chosen = sel.map((id) => map.get(id)).filter((f): f is FileRec => !!f && icons.includes(f));
  useEffect(() => { setSel((s) => s.filter((id) => ids.includes(id))); }, [ids.join()]);

  const here = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const open = (f: FileRec) => ops.openFile(f, map);
  const openBin = () => { launch({ app: "bin" }); };
  const remove = (list: FileRec[]) => { if (list.length) { void ops.binFiles(root, list); setSel([]); } };

  /** Put icons on the free cells nearest to where each is wanted, leaving the others where they are. */
  const place = (wanted: [string, Cell][]) => {
    const moving = new Set(wanted.map(([id]) => id));
    const taken = new Set([...cells].filter(([id]) => !moving.has(id)).map(([, c]) => cellKey(c)));
    const next: Record<string, Cell> = {};
    for (const [id, want] of wanted) { const c = nearestFreeCell(taken, want, grid.cols, grid.rows); taken.add(cellKey(c)); next[id] = c; }
    save(next);
  };
  const arrange = () => {
    const rank = (f: FileRec) => { const t = targetOf(f, map); return t && "app" in t ? 0 : kindOf(f.type).holds || (t && "file" in t && kindOf(t.file.type).holds) ? 1 : 2; };
    const order = [...icons].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })).map((f) => f.id);
    const next: Record<string, Cell> = {};
    order.forEach((id, i) => { next[id] = { c: Math.floor(i / grid.rows), r: i % grid.rows }; });
    if (showBin) next[BIN] = { c: grid.cols - 1, r: grid.rows - 1 };
    setPrefs({ icons: { ...prefs.icons, [projectId]: next } });
  };

  // ---- Selecting: click, Ctrl-click, Shift-click, and a rubber band on the empty desktop.
  const pick = (id: string, e: MouseEvent) => {
    wm.focusDesktop();
    if (e.ctrlKey || e.metaKey) setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else if (e.shiftKey) setSel((s) => (s.includes(id) ? s : [...s, id]));
    else setSel([id]);
  };
  const startBand = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    wm.focusDesktop();
    const from = here(e), keep = e.ctrlKey || e.metaKey ? sel : [];
    if (!keep.length) setSel([]);
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => {
      const p = here(ev);
      const r = { x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y) };
      if (r.w < 4 && r.h < 4) return;
      setBand(r);
      const hit = [...cells].filter(([id, c]) => { const s = cellSpot(grid, c); return id !== BIN && s.x < r.x + r.w && s.x + CELL.w > r.x && s.y < r.y + r.h && s.y + CELL.h > r.y; }).map(([id]) => id);
      setSel([...new Set([...keep, ...hit])]);
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); setBand(null); };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // ---- Dragging: icons move as files do, so a folder icon, the bin, Files and the taskbar all take them.
  const dragStart = (id: string) => (e: DragEvent) => {
    const p = here(e), s = cellSpot(grid, cells.get(id)!);
    grab.current = { dx: p.x - s.x, dy: p.y - s.y, x: p.x, y: p.y };
    if (id === BIN) { e.dataTransfer?.setData(BIN_DRAG, "1"); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; return; }
    const group = sel.includes(id) ? sel : [id];
    if (!sel.includes(id)) setSel([id]);
    ops.setDrag(e, group);
  };
  const ours = (e: DragEvent) => ops.hasDrag(e) || !!e.dataTransfer?.types.includes(BIN_DRAG);
  const dropOnDesk = (e: DragEvent) => {
    if (!ours(e)) return;
    e.preventDefault();
    setDropOn(null);
    const p = here(e), g = grab.current;
    grab.current = null;
    if (e.dataTransfer?.types.includes(BIN_DRAG)) { place([[BIN, cellAt(grid, p.x - (g?.dx ?? CELL.w / 2), p.y - (g?.dy ?? CELL.h / 2))]]); return; }
    const dragged = ops.readDrag(e) ?? [];
    const onDesk = dragged.filter((id) => cells.has(id));
    if (onDesk.length === dragged.length && g) {
      // Icons of the desktop: each goes to the free cell nearest to its own drop spot.
      const dx = p.x - g.x, dy = p.y - g.y;
      place(onDesk.map((id) => { const s = cellSpot(grid, cells.get(id)!); return [id, cellAt(grid, s.x + dx, s.y + dy)]; }));
      return;
    }
    // Files from elsewhere move into the Desktop folder; their icons land around the drop point.
    const moved = dragged.map((id) => map.get(id)).filter((f): f is FileRec => !!f);
    if (!desktop || !moved.length) return;
    const want = cellAt(grid, p.x - CELL.w / 2, p.y - CELL.h / 3);
    void ops.moveFiles(root, all, moved, desktop.id).then((ok) => { if (ok) place(moved.map((f) => [f.id, want])); });
  };
  const dropInto = (target: FileRec | typeof BIN) => ({
    onDragOver: (e: DragEvent) => { if (!ops.hasDrag(e)) return; e.preventDefault(); e.stopPropagation(); setDropOn(target === BIN ? BIN : target.id); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropOn(null); },
    onDrop: (e: DragEvent) => {
      if (!ops.hasDrag(e)) return;
      e.preventDefault(); e.stopPropagation(); setDropOn(null);
      const moved = (ops.readDrag(e) ?? []).map((id) => map.get(id)).filter((f): f is FileRec => !!f && (target === BIN || f.id !== target.id));
      if (!moved.length) return;
      if (target === BIN) remove(moved);
      else void ops.moveFiles(root, all, moved, target.id).then((ok) => ok && setSel([]));
    },
  });

  // ---- Menus.
  const iconMenu = (f: FileRec, e: MouseEvent) => {
    const list = sel.includes(f.id) && chosen.length > 1 ? chosen : [f];
    if (!sel.includes(f.id)) setSel([f.id]);
    const t = targetOf(f, map);
    contextMenu(e, list.length > 1 ? [
      { id: "open", label: `Open all ${list.length}`, icon: "external", run: () => list.forEach(open) },
      { separator: true },
      { id: "bin", label: "Move to the recycle bin", icon: "trash", danger: true, kbd: "Del", run: () => remove(list) },
    ] : [
      { id: "open", label: "Open", icon: "external", kbd: "↵", run: () => open(f) },
      { id: "rename", label: f.type === "shortcut" ? "Rename shortcut…" : "Rename…", icon: "edit", kbd: "F2", run: () => void ops.renameFile(f) },
      { id: "files", label: f.type === "shortcut" && t && "file" in t ? "Show what it points at" : "Show in Files", icon: "folder-open", disabled: f.type === "shortcut" && !!t && "app" in t,
        run: () => ops.openFolder(f.type === "shortcut" && t && "file" in t ? t.file.container : desktop?.id ?? null) },
      { separator: true },
      { id: "bin", label: "Move to the recycle bin", icon: "trash", danger: true, kbd: "Del", run: () => remove([f]) },
    ]);
  };
  const deskMenu = (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const p = here(e);
    const want = cellAt(grid, p.x - CELL.w / 2, p.y - CELL.h / 3);
    contextMenu(e, [
      { id: "folder", label: "New folder", icon: "folder-plus", disabled: !desktop, run: () => void ops.newFolder(root, desktop!.id).then((f) => f && place([[f.id, want]])) },
      { id: "shortcut", label: "New shortcut…", icon: "shortcut", disabled: !desktop, run: () => openDialog((close) => <ShortcutPicker files={all} close={close} onPick={(t) => void ops.makeShortcut(root, all, t, desktop!.id).then((f) => f && place([[f.id, want]]))} />) },
      { id: "arrange", label: "Arrange icons", icon: "grid", disabled: !icons.length, run: arrange },
      { id: "open", label: "Open the Desktop folder", icon: "folder-open", disabled: !desktop, run: () => ops.openFolder(desktop!.id) },
      { separator: true },
      ...shellMenu,
    ]);
  };
  const binMenu = (e: MouseEvent) => contextMenu(e, [
    { id: "open", label: "Open", icon: "external", run: openBin },
    { id: "empty", label: "Empty the bin", icon: "trash", danger: true, disabled: !bin?.length, run: () => void emptyBin(root, bin?.length ?? 0) },
    { separator: true },
    { id: "hide", label: "Take the bin off the desktop", icon: "eye-off", run: () => { setPrefs({ binOnDesktop: false }); toast("The recycle bin is in Files and the launcher. Settings › Appearance brings its icon back."); } },
  ]);

  // ---- Keys, while the desktop itself has the focus.
  const step = (dc: number, dr: number) => () => {
    const from = cells.get(sel[sel.length - 1] ?? "") ?? { c: dc < 0 ? grid.cols : -1, r: dr < 0 ? grid.rows : -1 };
    const ahead = [...cells].filter(([, c]) => (dc ? Math.sign(c.c - from.c) === dc : Math.sign(c.r - from.r) === dr));
    const best = ahead.sort(([, a], [, b]) => (a.c - from.c) ** 2 + (a.r - from.r) ** 2 - ((b.c - from.c) ** 2 + (b.r - from.r) ** 2))[0];
    if (best) setSel([best[0]]);
  };
  useKeys(bind("desktop", {
    open: () => { if (sel.includes(BIN)) openBin(); else if (chosen.length) chosen.forEach(open); else return false; },
    all: () => setSel(icons.map((f) => f.id)),
    clear: () => { if (sel.length) setSel([]); else return false; },
    rename: () => { if (chosen.length === 1) void ops.renameFile(chosen[0]); else return false; },
    remove: () => { if (chosen.length) remove(chosen); else return false; },
    left: step(-1, 0), right: step(1, 0), up: step(0, -1), down: step(0, 1),
  }), focused === null && !overlay);

  const at = (id: string) => { const s = cellSpot(grid, cells.get(id) ?? { c: 0, r: 0 }); return { left: s.x, top: s.y, width: CELL.w }; };
  return (
    <div ref={box} className="st-desk" onPointerDown={startBand} onContextMenu={deskMenu} onDragOver={(e) => { if (ours(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = "move"; } }} onDrop={dropOnDesk}>
      {icons.map((f) => {
        const l = lookOf(f, map);
        const folderLike = kindOf(f.type).holds;
        return (
          <div key={f.id} className="st-icon" style={at(f.id)} draggable onDragStart={dragStart(f.id)} onDragEnd={() => { grab.current = null; }} {...(folderLike ? dropInto(f) : {})}>
            <FileTile name={f.name} icon={<AppIcon glyph={l.glyph} color={l.color} size={36} />} shortcut={l.shortcut} selected={sel.includes(f.id)} dropTarget={dropOn === f.id}
              onClick={(e) => pick(f.id, e)} onDblClick={() => open(f)} onContextMenu={(e) => iconMenu(f, e)} />
          </div>
        );
      })}
      {showBin && (
        <div className="st-icon" style={at(BIN)} draggable onDragStart={dragStart(BIN)} onDragEnd={() => { grab.current = null; }} {...dropInto(BIN)}>
          <FileTile name="Recycle bin" kind="bin" meta={bin?.length ? String(bin.length) : undefined} selected={sel.includes(BIN)} dropTarget={dropOn === BIN} className={bin?.length ? "st-bin-full" : undefined}
            onClick={(e) => pick(BIN, e)} onDblClick={openBin} onContextMenu={binMenu} title={bin?.length ? `${bin.length} in the bin` : "Empty"} />
        </div>
      )}
      {band && <div className="oc-marquee" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
    </div>
  );
}
