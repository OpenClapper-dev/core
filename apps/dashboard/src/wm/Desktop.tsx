import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FILE_RESOURCE_TYPES, FILE_TYPE_META } from "@fielder/vocab";
import type { DesktopItem } from "../api";
import { addShortcut, deleteEntry, moveShortcut, newFolder, removeFolder, removeShortcut, renameShortcut } from "../apps/fileOps";
import { emptyBin } from "../apps/trashOps";
import { useSettings } from "../settings";
import { openShortcut, shortcutView, useFileEntries } from "../apps/fileEntries";
import { APPS, launch, type AppId } from "../apps/registry";
import * as data from "../data";
import { FILE_DRAG, freeCell, matches, type FileDrag } from "../fileTree";
import { setTheme, useTheme } from "../theme";
import { Button, ContextMenu, cx, Icon, MenuItem, Modal, SearchInput, toast, useCtxMenu } from "../ui";
import * as wm from "./wm";

/** The icon grid: a cell per icon, column after column like a desktop. */
const CELL = { w: 96, h: 100 };
const PAD = 12;
/** Apps a fresh project's desktop starts with. */
const SEED: AppId[] = ["gallery", "timeline", "plan", "metadata", "files"];
const snap = (v: number, step: number) => Math.max(PAD, Math.round((v - PAD) / step) * step + PAD);
type Target = Pick<DesktopItem, "kind" | "resource_type" | "resource_id" | "folder_id" | "app_id">;
const appTarget = (app: AppId): Target => ({ kind: "app", app_id: app, resource_type: null, resource_id: null, folder_id: null });

/**
 * The layer behind the windows: the project's desktop shortcuts (desktop_items, server-side, so
 * they follow to another browser) to apps, folders and files. Clicking it takes focus from the
 * windows; files dragged from Files land here as shortcuts.
 */
export function Desktop({ projectId }: { projectId: string }) {
  const d = data.useData();
  const files = d.files?.projectId === projectId ? d.files : null;
  const entries = useFileEntries(projectId);
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [drop, setDrop] = useState(false);
  const deskMenu = useCtxMenu<{ x: number; y: number }>();
  const iconMenu = useCtxMenu<{ item: DesktopItem; name: string }>();
  const [theme] = useTheme();
  const settings = useSettings();
  const binMenu = useCtxMenu<null>();
  const [binDrop, setBinDrop] = useState(false);
  const binEl = useRef<HTMLButtonElement>(null);
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
  // The bin's spot is per browser (it is not a desktop item); by default the bottom-right cell.
  const binKey = `desktop.bin.${projectId}`;
  const [binSaved, setBinSaved] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(binKey) ?? "null") as { x: number; y: number } | null; setBinSaved(v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null); } catch { setBinSaved(null); } }, [binKey]);
  const binAt = binSaved
    ? { x: Math.min(binSaved.x, Math.max(PAD, size.w - CELL.w)), y: Math.min(binSaved.y, Math.max(PAD, size.h - CELL.h)) }
    : { x: snap(Math.max(PAD, size.w - CELL.w - PAD), CELL.w / 2), y: snap(Math.max(PAD, size.h - CELL.h - PAD), CELL.h / 2) };
  const moveBin = (x: number, y: number) => { const v = { x: Math.max(PAD, Math.round(x)), y: Math.max(PAD, Math.round(y)) }; setBinSaved(v); try { localStorage.setItem(binKey, JSON.stringify(v)); } catch { /* a preference */ } };
  /** Is the pointer over the bin icon (under whatever is being dragged)? */
  const overBin = (e: { clientX: number; clientY: number }) => document.elementsFromPoint(e.clientX, e.clientY).some((el) => el === binEl.current);

  // A project's first visit (in this browser, with nothing on its desktop) gets the main apps.
  useEffect(() => {
    if (!files || files.desktop.length) return;
    const flag = `desktop.seeded.${projectId}`;
    try { if (localStorage.getItem(flag)) return; localStorage.setItem(flag, "1"); } catch { return; }
    void (async () => { for (const [i, app] of SEED.entries()) await addShortcut(projectId, appTarget(app), { x: PAD, y: PAD + i * CELL.h }); })();
  }, [!!files, projectId]);

  const folderName = (id: string) => files?.folders.find((f) => f.id === id)?.name ?? null;
  const icons = useMemo(() => (files?.desktop ?? []).map((item) => ({ item, view: shortcutView(item, entries, folderName) })).filter((x): x is { item: DesktopItem; view: NonNullable<ReturnType<typeof shortcutView>> } => !!x.view), [files, entries]);

  /** A point in the desktop's own coordinates. */
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const rows = () => Math.max(1, Math.floor(((box.current?.clientHeight ?? 600) - PAD) / CELL.h));
  const spotNear = (p: { x: number; y: number }) => ({ x: snap(p.x - CELL.w / 2, CELL.w / 2), y: snap(p.y - CELL.h / 3, CELL.h / 2) });

  function arrange() {
    const order = [...icons].sort((a, b) => {
      const rank = (i: DesktopItem) => (i.kind === "app" ? 0 : i.kind === "folder" ? 1 : 2);
      return rank(a.item) - rank(b.item) || a.view.name.localeCompare(b.view.name, undefined, { sensitivity: "base", numeric: true });
    });
    const placed: { x: number; y: number }[] = [];
    for (const { item } of order) {
      const c = freeCell(placed, CELL, rows());
      placed.push(c);
      if (item.x !== c.x + PAD || item.y !== c.y + PAD) void moveShortcut(item, c.x + PAD, c.y + PAD);
    }
  }

  /** Drag an icon to a new spot (pointer capture, like a window); a press without movement is a click. */
  const onIconDown = (e: PointerEvent, item: DesktopItem) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.classList.add("is-dragging");
      binEl.current?.classList.toggle("is-drop", overBin(ev));
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.style.transform = "";
      el.classList.remove("is-dragging");
      binEl.current?.classList.remove("is-drop");
      if (!moved) return;
      // Onto the bin: a shortcut is only removed, never what it points at.
      if (overBin(ev)) { void removeShortcut(item).then(() => toast("Shortcut removed", "ok")); return; }
      void moveShortcut(item, snap(item.x + ev.clientX - start.x, CELL.w / 2), snap(item.y + ev.clientY - start.y, CELL.h / 2));
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  /** The bin moves like an icon; a press without movement is a click. */
  const onBinDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.classList.add("is-dragging");
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.style.transform = "";
      el.classList.remove("is-dragging");
      if (moved) moveBin(snap(binAt.x + ev.clientX - start.x, CELL.w / 2), snap(binAt.y + ev.clientY - start.y, CELL.h / 2));
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  /** A file or folder dragged from Files onto the bin goes to the recycle bin. */
  const binDropProps = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes(FILE_DRAG)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setBinDrop(true); setDrop(false); } },
    onDragLeave: () => setBinDrop(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setBinDrop(false);
      let p: FileDrag | null = null;
      try { p = JSON.parse(e.dataTransfer?.getData(FILE_DRAG) || "null") as FileDrag | null; } catch { /* not ours */ }
      if (p?.kind === "folder") { const f = files?.folders.find((x) => x.id === p!.id); if (f) void removeFolder(f); }
      else if (p) { const entry = entries[p.type].find((x) => x.id === p!.id); if (entry) void deleteEntry(entry, projectId); }
    },
  };

  return (
    <div ref={box} class={cx("wm-desktop", drop && "is-drop")} aria-label="Desktop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) { wm.focusDesktop(); setSel(null); } }}
      onContextMenu={(e) => { if (e.target === e.currentTarget) deskMenu.openMenu(e, local(e)); }}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes(FILE_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDrop(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDrop(false); }}
      onDrop={(e) => {
        setDrop(false);
        let p: FileDrag | null = null;
        try { p = JSON.parse(e.dataTransfer?.getData(FILE_DRAG) || "null") as FileDrag | null; } catch { /* not ours */ }
        if (!p) return;
        e.preventDefault();
        const target: Target = p.kind === "folder" ? { kind: "folder", folder_id: p.id, resource_type: null, resource_id: null, app_id: null } : { kind: "resource", resource_type: p.type, resource_id: p.id, folder_id: null, app_id: null };
        void addShortcut(projectId, target, spotNear(local(e)));
      }}>
      {icons.map(({ item, view }) => (
        <button key={item.id} type="button" data-icon-id={item.id} class={cx("wm-icon", sel === item.id && "is-selected", view.archived && "is-archived")}
          style={{ left: `${item.x}px`, top: `${item.y}px` }} title={view.name}
          onPointerDown={(e) => { setSel(item.id); onIconDown(e, item); }}
          onDblClick={() => openShortcut(item)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openShortcut(item); } }}
          onFocus={() => setSel(item.id)}
          onContextMenu={(e) => { setSel(item.id); iconMenu.openMenu(e, { item, name: view.name }); }}>
          <span class="wm-icon__glyph">
            {view.thumb ? <img src={view.thumb.image_url} alt="" draggable={false} /> : <Icon name={view.icon} size={34} />}
            {item.kind !== "app" && <Icon name="arrow-top-right-thin" class="wm-icon__link" />}
          </span>
          <span class="wm-icon__label">{view.name}</span>
        </button>
      ))}
      {settings.binOnDesktop && (
        <button ref={binEl} type="button" data-icon-id="bin" class={cx("wm-icon wm-icon--bin", sel === "bin" && "is-selected", binDrop && "is-drop")}
          style={{ left: `${binAt.x}px`, top: `${binAt.y}px` }} title={binFull ? "Recycle bin: open it, or drop files here" : "Recycle bin (empty)"} aria-label="Recycle bin"
          onPointerDown={(e) => { setSel("bin"); onBinDown(e); }}
          onDblClick={() => launch({ app: "trash" })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); launch({ app: "trash" }); } }}
          onFocus={() => setSel("bin")}
          onContextMenu={(e) => { setSel("bin"); binMenu.openMenu(e, null); }}
          {...binDropProps}>
          <span class="wm-icon__glyph"><Icon name={binFull ? "delete" : "delete-empty-outline"} size={34} /></span>
          <span class="wm-icon__label">Recycle bin</span>
        </button>
      )}
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
            void newFolder(projectId, null).then((f) => f && addShortcut(projectId, { kind: "folder", folder_id: f.id, resource_type: null, resource_id: null, app_id: null }, at));
          }}>New folder</MenuItem>
          <MenuItem icon="link-variant-plus" onClick={() => setPicker(spotNear(deskMenu.menu!.ctx))}>New shortcut…</MenuItem>
          <MenuItem icon="dots-grid" onClick={arrange}>Arrange icons</MenuItem>
          <div class="f-menu__sep" />
          <MenuItem icon="cog-outline" onClick={() => launch({ app: "settings" })}>Settings</MenuItem>
          <MenuItem icon="theme-light-dark" onClick={() => setTheme(theme === "set" ? "sun" : "set")}>{theme === "set" ? "Sun theme" : "Set theme"}</MenuItem>
        </ContextMenu>
      )}
      {iconMenu.menu && (
        <ContextMenu x={iconMenu.menu.x} y={iconMenu.menu.y} label={iconMenu.menu.ctx.name} onClose={iconMenu.closeMenu}>
          <MenuItem icon="open-in-app" onClick={() => openShortcut(iconMenu.menu!.ctx.item)}>Open</MenuItem>
          <MenuItem icon="pencil-outline" onClick={() => void renameShortcut(iconMenu.menu!.ctx.item, iconMenu.menu!.ctx.name)}>Rename shortcut…</MenuItem>
          <div class="f-menu__sep" />
          <MenuItem icon="close" onClick={() => void removeShortcut(iconMenu.menu!.ctx.item)}>Remove from the desktop</MenuItem>
        </ContextMenu>
      )}
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
