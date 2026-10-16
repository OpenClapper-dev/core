import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FILE_RESOURCE_TYPES, FILE_TYPE_META } from "@fielder/vocab";
import type { DesktopItem } from "../api";
import { addRows, addShortcut, binItems, pinItems, canRename, desktopFolderId, fileTarget, folderTarget, moveItems, moveShortcuts, newFolder, removeShortcuts, renameEntry, renameFolder, renameShortcut, setDesktopPlacer, type Item } from "../apps/fileOps";
import { emptyBin } from "../apps/trashOps";
import { useSettings } from "../settings";
import { openShortcut, shortcutView, useFileEntries, type FileEntry } from "../apps/fileEntries";
import { APPS, launch, type AppId } from "../apps/registry";
import * as data from "../data";
import { cellAt, cellKey, cellSpot, FILE_DRAG, matches, nearestFreeCell, placementOf, readDrag, type Cell, type FileDrag, type Grid } from "../fileTree";
import { bind, useKeys } from "../keys";
import { setTheme, useTheme } from "../theme";
import { Button, ContextMenu, cx, Icon, MenuItem, Modal, SearchInput, toast, useCtxMenu } from "../ui";
import { useOverlay } from "./overlays";
import * as wm from "./wm";

/** The icon grid: a whole cell per icon, column after column like a desktop; icons never stack. */
const CELL = { w: 96, h: 100 };
const PAD = 12;
/** Apps a fresh project's desktop starts with. */
const SEED: AppId[] = ["gallery", "timeline", "plan", "metadata", "files"];
const BIN = "bin";
type Target = Pick<DesktopItem, "kind" | "resource_type" | "resource_id" | "folder_id" | "app_id">;
const appTarget = (app: AppId): Target => ({ kind: "app", app_id: app, resource_type: null, resource_id: null, folder_id: null });
type Spot = { x: number; y: number };
interface Icon_ { item: DesktopItem; name: string; icon: string; thumb?: { image_url: string }; archived?: boolean; real: boolean; entry?: FileEntry }

/**
 * The layer behind the windows (epic #72, #90). Its icons are desktop_items rows (server-side, so
 * they follow to another browser): the files and folders of the project's Desktop folder (real
 * items, no arrow) and shortcuts to apps, files and folders elsewhere. Plus the recycle bin.
 * Clicking it takes focus from the windows. Files dragged here from Files move into the Desktop
 * folder; icons can be selected (click, Ctrl, Shift, a rubber band) and dragged together, onto a
 * folder icon or the bin; every placement lands on a free cell.
 */
export function Desktop({ projectId }: { projectId: string }) {
  const d = data.useData();
  const files = d.files?.projectId === projectId ? d.files : null;
  const entries = useFileEntries(projectId);
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [picker, setPicker] = useState<Spot | null>(null);
  const [drop, setDrop] = useState(false);
  const deskMenu = useCtxMenu<Spot>();
  const iconMenu = useCtxMenu<string>();
  const binMenu = useCtxMenu<null>();
  const [theme] = useTheme();
  const settings = useSettings();
  const focusedId = wm.useFocusedId();
  const overlay = useOverlay();
  const [binDrop, setBinDrop] = useState(false);
  const binFull = (d.trash?.projectId === projectId ? d.trash.entries.length : 0) > 0;

  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current!;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const grid: Grid = { w: CELL.w, h: CELL.h, pad: PAD, cols: Math.max(1, Math.floor((size.w - PAD) / CELL.w)), rows: Math.max(1, Math.floor((size.h - PAD) / CELL.h)) };

  // The bin's spot is per browser (it is not a desktop item); by default the bottom-right cell.
  const binKey = `desktop.bin.${projectId}`;
  const [binSaved, setBinSaved] = useState<Spot | null>(null);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(binKey) ?? "null") as Spot | null; setBinSaved(v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null); } catch { setBinSaved(null); } }, [binKey]);
  const binCell: Cell = binSaved ? cellAt(grid, Math.min(binSaved.x, size.w - CELL.w), Math.min(binSaved.y, size.h - CELL.h)) : { c: grid.cols - 1, r: grid.rows - 1 };
  const binAt = cellSpot(grid, binCell);
  const moveBin = (s: Spot) => { setBinSaved(s); try { localStorage.setItem(binKey, JSON.stringify(s)); } catch { /* a preference */ } };
  const showBin = settings.binOnDesktop;

  // A project's first visit (in this browser, with nothing on its desktop) gets the main apps.
  useEffect(() => {
    if (!files || files.desktop.some((x) => x.area !== "taskbar")) return;
    const flag = `desktop.seeded.${projectId}`;
    try { if (localStorage.getItem(flag)) return; localStorage.setItem(flag, "1"); } catch { return; }
    void (async () => { for (const [i, app] of SEED.entries()) await addShortcut(projectId, appTarget(app), cellSpot(grid, { c: 0, r: i })); })();
  }, [!!files, projectId]);

  const desk = files?.folders.find((f) => f.kind === "desktop") ?? null;
  const placed = useMemo(() => (files ? placementOf(files.items, files.folders) : () => null), [files]);
  const folderById = useMemo(() => new Map((files?.folders ?? []).map((f) => [f.id, f])), [files]);
  const icons = useMemo((): Icon_[] => {
    const out: Icon_[] = [];
    for (const item of files?.desktop ?? []) {
      if (item.area === "taskbar") continue;
      const v = shortcutView(item, entries, (id) => folderById.get(id)?.name ?? null);
      if (!v) continue;
      const real = !!desk && (item.kind === "folder" ? folderById.get(item.folder_id!)?.parent_id === desk.id : item.kind === "resource" && placed(item.resource_type!, item.resource_id!) === desk.id);
      const entry = item.kind === "resource" ? entries[item.resource_type!].find((e) => e.id === item.resource_id) : undefined;
      out.push({ item, ...v, real, entry });
    }
    return out;
  }, [files, entries, desk, placed, folderById]);
  const byId = useMemo(() => new Map(icons.map((i) => [i.item.id, i])), [icons]);

  // What is in the Desktop folder always has an icon: one missing (made in Files, another browser,
  // a restore) gets one on a free cell. Tried once per item so a failing server is not hammered.
  const healed = useRef(new Set<string>());
  useEffect(() => {
    if (!files || !desk) return;
    const want: Target[] = [
      ...files.items.filter((i) => i.folder_id === desk.id && entries[i.resource_type]?.some((e) => e.id === i.resource_id)).map((i) => fileTarget(i.resource_type, i.resource_id)),
      ...files.folders.filter((f) => f.parent_id === desk.id).map((f) => folderTarget(f.id)),
    ];
    const has = (t: Target) => files.desktop.some((r) => r.area !== "taskbar" && r.kind === t.kind && r.resource_id === t.resource_id && r.folder_id === t.folder_id && r.resource_type === t.resource_type);
    const missing = want.filter((t) => !has(t) && !healed.current.has(`${t.kind}:${t.resource_id ?? t.folder_id}`));
    if (!missing.length) return;
    for (const t of missing) healed.current.add(`${t.kind}:${t.resource_id ?? t.folder_id}`);
    void addRows(projectId, missing);
  }, [files, entries, desk]);

  // Every new icon goes through here: the free cell nearest to where it was asked for.
  const takenNow = () => {
    const t = new Set(icons.map((i) => cellKey(cellAt(grid, i.item.x, i.item.y))));
    if (showBin) t.add(cellKey(binCell));
    return t;
  };
  const placerRef = useRef<(n: number, near?: Spot) => Spot[]>(() => []);
  placerRef.current = (n, near) => {
    const taken = takenNow();
    const want = near ? cellAt(grid, near.x, near.y) : { c: 0, r: 0 };
    return Array.from({ length: n }, () => { const c = nearestFreeCell(taken, want, grid.cols, grid.rows); taken.add(cellKey(c)); return cellSpot(grid, c); });
  };
  useEffect(() => { setDesktopPlacer((n, near) => placerRef.current(n, near)); return () => setDesktopPlacer(null); }, []);

  /** A point in the desktop's own coordinates. */
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  /** Where an icon dropped at a pointer goes: the cell under the pointer. */
  const spotNear = (p: Spot): Spot => ({ x: p.x - CELL.w / 2, y: p.y - CELL.h / 3 });

  function arrange() {
    const order = [...icons].sort((a, b) => {
      const rank = (i: Icon_) => (i.item.kind === "app" ? 0 : i.item.kind === "folder" ? 1 : 2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
    const taken = new Set<string>(showBin ? [cellKey(binCell)] : []);
    const moves: { d: DesktopItem; x: number; y: number }[] = [];
    for (const i of order) {
      const s = cellSpot(grid, nearestFreeCell(taken, { c: 0, r: 0 }, grid.cols, grid.rows));
      taken.add(cellKey(cellAt(grid, s.x, s.y)));
      if (i.item.x !== s.x || i.item.y !== s.y) moves.push({ d: i.item, ...s });
    }
    void moveShortcuts(moves);
  }

  /** The files and folders an icon stands for (apps and the bin stand for none). */
  const itemOf = (i: Icon_): Item | null => (i.item.kind === "folder" ? { kind: "folder", id: i.item.folder_id! } : i.item.kind === "resource" ? { kind: "file", type: i.item.resource_type!, id: i.item.resource_id! } : null);
  const nameOfItem = (x: Item) => (x.kind === "folder" ? folderById.get(x.id)?.name ?? "Folder" : entries[x.type].find((e) => e.id === x.id)?.name ?? FILE_TYPE_META[x.type].label);

  /** Delete the selection: real items to the recycle bin, shortcuts only off the desktop. */
  async function removeIcons(ids: string[]) {
    const list = ids.map((id) => byId.get(id)).filter((i): i is Icon_ => !!i);
    const shortcuts = list.filter((i) => !i.real).map((i) => i.item);
    const real = list.filter((i) => i.real).map(itemOf).filter((x): x is Item => !!x);
    if (shortcuts.length) { await removeShortcuts(shortcuts); if (!real.length) toast(shortcuts.length === 1 ? "Shortcut removed" : `${shortcuts.length} shortcuts removed`); }
    if (real.length) await binItems(real.map((x) => ({ type: x.kind === "folder" ? "folder" : x.type, id: x.id, name: nameOfItem(x) })), projectId);
    setSel(new Set());
  }

  /** Icons dropped onto a folder icon: what they stand for moves in (shortcuts go, their target moves). */
  async function intoFolder(ids: string[], folderId: string) {
    const list = ids.map((id) => byId.get(id)).filter((i): i is Icon_ => !!i);
    if (list.some((i) => i.item.kind === "app")) toast("Apps stay on the desktop; only files and folders go into a folder", "info");
    const movable = list.filter((i) => i.item.kind !== "app" && !(i.item.kind === "folder" && i.item.folder_id === folderId));
    const items = movable.map(itemOf).filter((x): x is Item => !!x);
    if (!items.length) return;
    // A real item's icon goes with the move out of the Desktop folder; a shortcut's is removed here.
    await removeShortcuts(movable.filter((i) => !i.real).map((i) => i.item));
    await moveItems(items, folderId);
    toast(`${items.length === 1 ? `“${nameOfItem(items[0])}”` : `${items.length} items`} moved to “${folderById.get(folderId)?.name ?? "the folder"}”`);
    setSel(new Set());
  }

  /** The icon under the pointer that takes a drop (the bin, or a folder icon), outside the dragged ones. */
  const dropTargetAt = (e: { clientX: number; clientY: number }, dragged: Set<string>): { kind: "bin" } | { kind: "taskbar"; el: HTMLElement } | { kind: "folder"; id: string; el: HTMLElement } | null => {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const h = el as HTMLElement;
      // Onto the taskbar: pin what the icons stand for.
      const bar = h.closest?.<HTMLElement>("[data-taskbar-drop]");
      if (bar) return { kind: "taskbar", el: bar };
      const id = h.dataset?.iconId;
      if (!id || dragged.has(id)) continue;
      if (id === BIN) return showBin ? { kind: "bin" } : null;
      const i = byId.get(id);
      return i?.item.kind === "folder" ? { kind: "folder", id: i.item.folder_id!, el: h } : null;
    }
    return null;
  };

  /**
   * Press on an icon: Ctrl toggles it, Shift adds it; a drag moves the whole selection (or just
   * this icon), onto a free cell each, a folder icon or the bin; a press without movement selects it.
   */
  const onIconDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) { setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); setAnchor(id); return; }
    if (e.shiftKey) { setSel((s) => new Set([...s, id])); setAnchor(id); return; }
    const group = sel.has(id) ? [...sel] : [id];
    if (!sel.has(id)) setSel(new Set([id]));
    setAnchor(id);
    const dragged = new Set(group);
    const els = group.map((g) => box.current?.querySelector<HTMLElement>(`[data-icon-id="${g}"]`)).filter((x): x is HTMLElement => !!x);
    const lead = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let hover: HTMLElement | null = null;
    const binEl = () => box.current?.querySelector<HTMLElement>(`[data-icon-id="${BIN}"]`) ?? null;
    const mark = (el: HTMLElement | null) => { if (hover !== el) { hover?.classList.remove("is-drop"); el?.classList.add("is-drop"); hover = el; } };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      for (const el of els) { el.style.transform = `translate(${dx}px, ${dy}px)`; el.classList.add("is-dragging"); }
      const t = dropTargetAt(ev, dragged);
      mark(t?.kind === "bin" ? binEl() : t ? t.el : null);
    };
    const up = (ev: PointerEvent) => {
      lead.removeEventListener("pointermove", move);
      lead.removeEventListener("pointerup", up);
      for (const el of els) { el.style.transform = ""; el.classList.remove("is-dragging"); }
      mark(null);
      if (!moved) { setSel(new Set([id])); return; }
      const t = dropTargetAt(ev, dragged);
      const ids = group.filter((g) => g !== BIN);
      if (t?.kind === "bin") { void removeIcons(ids); return; }
      if (t?.kind === "taskbar") {
        const targets = ids.map((g) => byId.get(g)?.item).filter((x): x is DesktopItem => !!x).map(({ kind, resource_type, resource_id, folder_id, app_id }) => ({ kind, resource_type, resource_id, folder_id, app_id }));
        void pinItems(projectId, targets);
        return;
      }
      if (t?.kind === "folder") { void intoFolder(ids, t.id); return; }
      // Each icon to the free cell nearest to where it was dropped, the pressed one first.
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      const taken = new Set<string>();
      for (const i of icons) if (!dragged.has(i.item.id)) taken.add(cellKey(cellAt(grid, i.item.x, i.item.y)));
      if (showBin && !dragged.has(BIN)) taken.add(cellKey(binCell));
      const moves: { d: DesktopItem; x: number; y: number }[] = [];
      for (const g of [id, ...group.filter((x) => x !== id)]) {
        const from = g === BIN ? binAt : byId.get(g)?.item;
        if (!from) continue;
        const c = nearestFreeCell(taken, cellAt(grid, from.x + dx, from.y + dy), grid.cols, grid.rows);
        taken.add(cellKey(c));
        const s = cellSpot(grid, c);
        if (g === BIN) moveBin(s); else moves.push({ d: byId.get(g)!.item, ...s });
      }
      void moveShortcuts(moves);
    };
    lead.setPointerCapture(e.pointerId);
    lead.addEventListener("pointermove", move);
    lead.addEventListener("pointerup", up);
  };

  /** Press on the empty desktop: a drag draws a rubber band that selects what it touches (Ctrl adds). */
  const onDeskDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    wm.focusDesktop();
    const el = box.current!;
    const start = local(e);
    const base = e.ctrlKey || e.metaKey ? new Set(sel) : new Set<string>();
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      if (!moved && Math.abs(p.x - start.x) < 4 && Math.abs(p.y - start.y) < 4) return;
      moved = true;
      const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      setMarquee(r);
      const box0 = el.getBoundingClientRect();
      const hit = new Set(base);
      for (const ic of el.querySelectorAll<HTMLElement>("[data-icon-id]")) {
        const b = ic.getBoundingClientRect();
        const x = b.left - box0.left, y = b.top - box0.top;
        if (x < r.x + r.w && x + b.width > r.x && y < r.y + r.h && y + b.height > r.y) hit.add(ic.dataset.iconId!);
      }
      setSel(hit);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!moved) setSel(base);
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  /** Arrow keys: the nearest icon in that direction becomes the selection. */
  const step = (dx: number, dy: number) => {
    const all = [...icons.map((i) => ({ id: i.item.id, x: i.item.x, y: i.item.y })), ...(showBin ? [{ id: BIN, ...binAt }] : [])];
    if (!all.length) return;
    const from = all.find((a) => a.id === (anchor && sel.has(anchor) ? anchor : [...sel][0]));
    let next = from ? null : all.sort((a, b) => a.x - b.x || a.y - b.y)[0];
    if (from) {
      let best = Infinity;
      for (const a of all) {
        const vx = a.x - from.x, vy = a.y - from.y;
        if (a.id === from.id || vx * dx + vy * dy <= 0) continue;
        // Mostly in that direction: off-axis distance counts double.
        const score = Math.abs(vx * dx + vy * dy) + 2 * Math.abs(vx * dy - vy * dx);
        if (score < best) { best = score; next = a; }
      }
    }
    if (!next) return;
    setSel(new Set([next.id]));
    setAnchor(next.id);
    box.current?.querySelector<HTMLElement>(`[data-icon-id="${next.id}"]`)?.focus();
  };
  const single = sel.size === 1 ? [...sel][0] : null;
  useKeys(bind("desktop", {
    all: () => setSel(new Set([...icons.map((i) => i.item.id), ...(showBin ? [BIN] : [])])),
    clear: () => { if (!sel.size) return false; setSel(new Set()); },
    rename: () => { const i = single ? byId.get(single) : undefined; if (i) renameIcon(i); else return false; },
    remove: () => { const ids = [...sel].filter((x) => x !== BIN); if (!ids.length) return false; void removeIcons(ids); },
    left: () => step(-1, 0), right: () => step(1, 0), up: () => step(0, -1), down: () => step(0, 1),
  }), focusedId === null && !overlay);

  function renameIcon(i: Icon_) {
    if (!i.real) { void renameShortcut(i.item, i.name); return; }
    if (i.item.kind === "folder") { const f = folderById.get(i.item.folder_id!); if (f) void renameFolder(f); }
    else if (i.entry && canRename(i.entry.type)) void renameEntry(i.entry, projectId);
    else toast(`Rename it in ${i.entry ? FILE_TYPE_META[i.entry.type].label === "Field" ? "Fields" : APPS[FILE_TYPE_META[i.entry.type].app].name : "its app"}`, "info");
  }
  const openIcon = (id: string) => { if (id === BIN) launch({ app: "trash" }); else { const i = byId.get(id); if (i) openShortcut(i.item); } };

  /** Files and folders dragged from Files: onto the desktop they move into the Desktop folder. */
  const onDrop = (e: DragEvent) => {
    setDrop(false);
    const list = readDrag(e.dataTransfer);
    if (!list) return;
    e.preventDefault();
    const at = spotNear(local(e));
    if (desk) { void moveItems(list as Item[], desk.id, at); return; }
    // No Desktop folder loaded (yet): fall back to a shortcut.
    const p = list[0];
    void addShortcut(projectId, p.kind === "folder" ? folderTarget(p.id) : fileTarget(p.type, p.id), at);
  };
  const binDropProps = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes(FILE_DRAG)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setBinDrop(true); setDrop(false); } },
    onDragLeave: () => setBinDrop(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setBinDrop(false);
      const list = readDrag(e.dataTransfer);
      if (list) void binItems(list.map((x: FileDrag) => ({ type: x.kind === "folder" ? "folder" as const : x.type, id: x.id, name: nameOfItem(x as Item) })), projectId);
    },
  };

  const menuIcon = iconMenu.menu ? byId.get(iconMenu.menu.ctx) ?? null : null;
  const many = sel.size > 1 && iconMenu.menu && sel.has(iconMenu.menu.ctx);
  const realCount = [...sel].filter((x) => byId.get(x)?.real).length;
  return (
    <div ref={box} class={cx("wm-desktop", drop && "is-drop")} aria-label="Desktop"
      onPointerDown={onDeskDown}
      onContextMenu={(e) => { if (e.target === e.currentTarget) deskMenu.openMenu(e, local(e)); }}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes(FILE_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDrop(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDrop(false); }}
      onDrop={onDrop}>
      {icons.map((i) => (
        <button key={i.item.id} type="button" data-icon-id={i.item.id} data-folder={i.item.kind === "folder" ? i.item.folder_id! : undefined}
          class={cx("wm-icon", sel.has(i.item.id) && "is-selected", i.archived && "is-archived")}
          style={{ left: `${i.item.x}px`, top: `${i.item.y}px` }} title={i.real ? i.name : `${i.name} (shortcut)`} aria-pressed={sel.has(i.item.id)}
          onPointerDown={(e) => onIconDown(e, i.item.id)}
          onDblClick={() => openIcon(i.item.id)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openIcon(i.item.id); } }}
          onContextMenu={(e) => { if (!sel.has(i.item.id)) setSel(new Set([i.item.id])); iconMenu.openMenu(e, i.item.id); }}>
          <span class="wm-icon__glyph">
            {i.thumb ? <img src={i.thumb.image_url} alt="" draggable={false} /> : <Icon name={i.icon} size={34} />}
            {i.item.kind !== "app" && !i.real && <Icon name="arrow-top-right-thin" class="wm-icon__link" />}
          </span>
          <span class="wm-icon__label">{i.name}</span>
        </button>
      ))}
      {showBin && (
        <button type="button" data-icon-id={BIN} class={cx("wm-icon wm-icon--bin", sel.has(BIN) && "is-selected", binDrop && "is-drop")}
          style={{ left: `${binAt.x}px`, top: `${binAt.y}px` }} title={binFull ? "Recycle bin: open it, or drop files here" : "Recycle bin (empty)"} aria-label="Recycle bin" aria-pressed={sel.has(BIN)}
          onPointerDown={(e) => onIconDown(e, BIN)}
          onDblClick={() => openIcon(BIN)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openIcon(BIN); } }}
          onContextMenu={(e) => { setSel(new Set([BIN])); binMenu.openMenu(e, null); }}
          {...binDropProps}>
          <span class="wm-icon__glyph"><Icon name={binFull ? "delete" : "delete-empty-outline"} size={34} /></span>
          <span class="wm-icon__label">Recycle bin</span>
        </button>
      )}
      {marquee && <div class="wm-marquee" style={{ left: `${marquee.x}px`, top: `${marquee.y}px`, width: `${marquee.w}px`, height: `${marquee.h}px` }} />}
      {binMenu.menu && (
        <ContextMenu x={binMenu.menu.x} y={binMenu.menu.y} label="Recycle bin" onClose={binMenu.closeMenu}>
          <MenuItem icon="open-in-app" onClick={() => launch({ app: "trash" })}>Open</MenuItem>
          <MenuItem icon="delete-empty-outline" danger disabled={!binFull} onClick={() => void emptyBin(projectId)}>Empty the bin…</MenuItem>
          <div class="f-menu__sep" />
          <MenuItem icon="eye-off-outline" onClick={() => launch({ app: "settings" })}>Hide it (Settings › Desktop)…</MenuItem>
        </ContextMenu>
      )}
      {deskMenu.menu && (
        <ContextMenu x={deskMenu.menu.x + (box.current?.getBoundingClientRect().left ?? 0)} y={deskMenu.menu.y + (box.current?.getBoundingClientRect().top ?? 0)} label="Desktop" onClose={deskMenu.closeMenu}>
          <MenuItem icon="folder-plus-outline" onClick={() => {
            const at = spotNear(deskMenu.menu!.ctx);
            const deskId = desktopFolderId();
            if (deskId) void newFolder(projectId, deskId, at);
            else void newFolder(projectId, null).then((f) => f && addShortcut(projectId, folderTarget(f.id), at));
          }}>New folder</MenuItem>
          <MenuItem icon="link-variant-plus" onClick={() => setPicker(spotNear(deskMenu.menu!.ctx))}>New shortcut…</MenuItem>
          <MenuItem icon="dots-grid" onClick={arrange}>Arrange icons</MenuItem>
          {desk && <MenuItem icon="folder-open-outline" onClick={() => launch({ app: "files", state: { folderId: desk.id } })}>Open the Desktop folder</MenuItem>}
          <div class="f-menu__sep" />
          <MenuItem icon="cog-outline" onClick={() => launch({ app: "settings" })}>Settings</MenuItem>
          <MenuItem icon="theme-light-dark" onClick={() => setTheme(theme === "set" ? "sun" : "set")}>{theme === "set" ? "Sun theme" : "Set theme"}</MenuItem>
        </ContextMenu>
      )}
      {iconMenu.menu && (many ? (
        <ContextMenu x={iconMenu.menu.x} y={iconMenu.menu.y} label={`${sel.size} icons`} onClose={iconMenu.closeMenu}>
          <MenuItem icon="open-in-app" onClick={() => { for (const id of sel) openIcon(id); }}>Open all</MenuItem>
          <div class="f-menu__sep" />
          <MenuItem icon={realCount ? "delete-outline" : "close"} danger={realCount > 0} onClick={() => void removeIcons([...sel].filter((x) => x !== BIN))}>
            {realCount === 0 ? `Remove ${sel.size} shortcuts` : realCount === sel.size ? `Move ${sel.size} items to the recycle bin` : "Bin the files, remove the shortcuts"}
          </MenuItem>
        </ContextMenu>
      ) : menuIcon && (
        <ContextMenu x={iconMenu.menu.x} y={iconMenu.menu.y} label={menuIcon.name} onClose={iconMenu.closeMenu}>
          <MenuItem icon="open-in-app" onClick={() => openShortcut(menuIcon.item)}>Open</MenuItem>
          <MenuItem icon="pencil-outline" onClick={() => renameIcon(menuIcon)}>{menuIcon.real ? "Rename…" : "Rename shortcut…"}</MenuItem>
          {menuIcon.real && desk && <MenuItem icon="folder-search-outline" onClick={() => launch({ app: "files", state: { folderId: desk.id } })}>Show in Files</MenuItem>}
          <div class="f-menu__sep" />
          {menuIcon.real
            ? <MenuItem icon="delete-outline" danger onClick={() => void removeIcons([menuIcon.item.id])}>Move to the recycle bin</MenuItem>
            : <MenuItem icon="close" onClick={() => void removeIcons([menuIcon.item.id])}>Remove the shortcut</MenuItem>}
        </ContextMenu>
      ))}
      {picker && <ShortcutPicker projectId={projectId} at={picker} onClose={() => setPicker(null)} />}
    </div>
  );
}

/** New shortcut…: an app, a folder or a file, searched like Go to…. */
function ShortcutPicker({ projectId, at, onClose }: { projectId: string; at: { x: number; y: number }; onClose: () => void }) {
  const [q, setQ] = useState("");
  const d = data.useData();
  const entries = useFileEntries(projectId);
  const take = (t: Target) => { onClose(); void addShortcut(projectId, t, at); };
  const apps = Object.values(APPS).filter((a) => a.id !== "shot" && matches(q, a.name));
  const folders = (d.files?.folders ?? []).filter((f) => matches(q, f.name)).slice(0, 8);
  return (
    <Modal title="New shortcut" width="520px" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div class="f-modal__body wm-picker">
        <SearchInput autoFocus value={q} placeholder="An app, a folder, a shot, a timeline…" aria-label="Search" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <div class="wm-picker__list">
          {apps.length > 0 && <div class="f-menu__label">Apps</div>}
          {apps.map((a) => <MenuItem key={a.id} icon={a.icon} onClick={() => take(appTarget(a.id))}>{a.name}</MenuItem>)}
          {folders.length > 0 && <div class="f-menu__label">Folders</div>}
          {folders.map((f) => <MenuItem key={f.id} icon="folder-outline" onClick={() => take({ kind: "folder", folder_id: f.id, resource_type: null, resource_id: null, app_id: null })}>{f.name}</MenuItem>)}
          {FILE_RESOURCE_TYPES.map((t) => {
            const hits = entries[t].filter((e) => matches(q, e.name, e.sub)).slice(0, q ? 8 : 3);
            return hits.length ? (
              <div key={t}>
                <div class="f-menu__label">{FILE_TYPE_META[t].plural}</div>
                {hits.map((e) => <MenuItem key={e.id} icon={FILE_TYPE_META[t].icon} count={e.sub} onClick={() => take({ kind: "resource", resource_type: t, resource_id: e.id, folder_id: null, app_id: null })}>{e.name}</MenuItem>)}
              </div>
            ) : null;
          })}
        </div>
      </div>
      <div class="f-modal__foot"><span class="f-grow" /><Button kind="ghost" kbd="Esc" onClick={onClose}>Cancel</Button></div>
    </Modal>
  );
}
