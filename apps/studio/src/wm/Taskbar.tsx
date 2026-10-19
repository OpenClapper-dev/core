import { useEffect, useRef, useState } from "preact/hooks";
import type { DesktopItem } from "../api";
import { appTarget, fileTarget, folderTarget, pinItems, pinnedApp, reorderPins, taskbarRows, togglePinApp, unpin } from "../apps/fileOps";
import { openShortcut, shortcutView, useFileEntries } from "../apps/fileEntries";
import { useData } from "../data";
import { FILE_DRAG, readDrag } from "../fileTree";
import { useSettings } from "../settings";
import { switchProject } from "../project";
import { appDef, launch, type AppId } from "../apps/registry";
import { ContextMenu, cx, Icon, IconButton, Img, Mark, MenuItem, THEME_CYCLE, THEME_ICON, THEME_LABEL, toast, useCtxMenu, useOutsideClick, useTheme } from "@fielder/ui";
import { signOut, useUser } from "../user";
import { requestClose } from "./closeGuards";
import { Launcher } from "./Launcher";
import { openOverlay } from "./overlays";
import { WindowMenu } from "./Window";
import { goToWorkspace } from "./switchWorkspace";
import * as wm from "./wm";
import type { Win } from "./wm";


function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [t, setT] = useState(fmt);
  useEffect(() => { const i = setInterval(() => setT(fmt()), 10_000); return () => clearInterval(i); }, []);
  return t;
}

/** Pins dragged to a new place on the taskbar carry their row id. */
const PIN_DRAG = "application/x-fielder-pin";
/** Apps a project's taskbar starts with (unless this browser had pins of its own before). */
const SEED: AppId[] = ["gallery", "timeline", "plan", "files"];

/**
 * The taskbar (bottom or top, items left or centred: Settings › Desktop): launcher, task view,
 * the pins (apps, folders and files, kept on the server so they follow to another browser), the
 * active workspace's windows, then project, Go to…, theme, reload and clock. An app's pin and its
 * windows are one button. Drag files from Files or icons from the desktop here to pin them; drag
 * pins to reorder them.
 */
export function Taskbar({ projectId, onPalette }: { projectId: string; onPalette: () => void }) {
  const windows = wm.useWindows();
  const focusedId = wm.useFocusedId();
  const d = useData();
  const files = d.files?.projectId === projectId ? d.files : null;
  const entries = useFileEntries(projectId);
  const settings = useSettings();
  const [theme, setTheme] = useTheme();
  const [launcher, setLauncher] = useState(false);
  const { menu, openMenu, closeMenu } = useCtxMenu<string>();
  const wsMenu = useCtxMenu<null>();
  const pinMenu = useCtxMenu<DesktopItem>();
  const group = useCtxMenu<string>();
  const [dropAt, setDropAt] = useState<number | null>(null);
  const spaces = wm.useWorkspaces();
  const activeWs = wm.useActiveWs();
  const clock = useClock();
  const pins = files ? taskbarRows() : [];
  const pinnedApps = new Set(pins.filter((p) => p.kind === "app").map((p) => p.app_id));
  const running = windows.filter((w) => !pinnedApps.has(w.app as AppId)); // insertion order: z churn must not shuffle the tasks
  const menuWin = menu ? windows.find((w) => w.id === menu.ctx) : null;
  const folderName = (id: string) => files?.folders.find((f) => f.id === id)?.name ?? null;

  // A project's first taskbar: the pins this browser had before they moved to the server, else the main apps.
  useEffect(() => {
    if (!files || files.desktop.some((x) => x.area === "taskbar")) return;
    const flag = `taskbar.seeded.${projectId}`;
    try { if (localStorage.getItem(flag)) return; localStorage.setItem(flag, "1"); } catch { return; }
    const legacy = wm.getLegacyPins().filter((a): a is AppId => !!appDef(a));
    void pinItems(projectId, (legacy.length ? legacy : SEED).map(appTarget));
  }, [!!files, projectId]);

  const toggleWin = (w: Win) => (w.id === focusedId && w.mode !== "min" ? wm.minimize(w.id) : wm.focus(w.id));
  const clickPin = (p: DesktopItem, e: MouseEvent) => {
    const wins = p.kind === "app" ? windows.filter((w) => w.app === p.app_id) : [];
    if (wins.length === 1) toggleWin(wins[0]);
    else if (wins.length > 1) group.openMenu(e, p.app_id!);
    else openShortcut(p);
  };
  /** Where a drop lands among the pins: before the pin under the pointer, else at the end. */
  const indexAt = (e: DragEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-pin-index]");
    return el ? Number(el.dataset.pinIndex) : pins.length;
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      const t = e.dataTransfer?.types;
      if (!t || (!t.includes(FILE_DRAG) && !t.includes(PIN_DRAG))) return;
      e.preventDefault();
      // Files allows copy or move; a pin is a copy of the reference.
      e.dataTransfer!.dropEffect = t.includes(PIN_DRAG) ? "move" : "copy";
      setDropAt(indexAt(e));
    },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropAt(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropAt(null);
      const at = indexAt(e);
      const pinId = e.dataTransfer?.getData(PIN_DRAG);
      if (pinId) {
        const moving = pins.find((p) => p.id === pinId);
        if (!moving) return;
        const order = pins.filter((p) => p.id !== pinId);
        order.splice(Math.min(at > pins.indexOf(moving) ? at - 1 : at, order.length), 0, moving);
        void reorderPins(order);
        return;
      }
      const list = readDrag(e.dataTransfer);
      if (list) void pinItems(projectId, list.map((x) => (x.kind === "folder" ? folderTarget(x.id) : fileTarget(x.type, x.id))), at);
    },
  };

  const viewBtn = (
    <button type="button" class="wm-task wm-task--view" title={`Task view (⌘Alt V) · ${spaces.find((s) => s.id === activeWs)?.name ?? ""}`} aria-label="Task view"
      onClick={() => openOverlay("taskview")} onContextMenu={(e) => wsMenu.openMenu(e, null)}>
      <Icon name="view-dashboard-outline" />
      {spaces.length > 1 && <span class="wm-task__badge num">{spaces.findIndex((s) => s.id === activeWs) + 1}</span>}
    </button>
  );
  const center = settings.taskbarAlign === "center";
  return (
    <div class={cx("wm-taskbar", center && "wm-taskbar--center")} data-taskbar-drop>
      {center && <span class="wm-taskbar__spacer" />}
      <div class="wm-taskbar__main">
        <button type="button" class={cx("wm-task wm-task--launcher", launcher && "is-open")} aria-label="Apps" aria-haspopup="menu" aria-expanded={launcher} title="Apps" onClick={() => setLauncher(!launcher)}>
          <Mark size={20} />
        </button>
        {viewBtn}
        <div class="wm-taskbar__tasks" {...dropProps}>
          {pins.map((p, i) => {
            const v = shortcutView(p, entries, folderName);
            if (!v) return null;
            const wins = p.kind === "app" ? windows.filter((w) => w.app === p.app_id) : [];
            const active = wins.some((w) => w.id === focusedId && w.mode !== "min");
            return (
              <button key={p.id} type="button" data-pin-index={i} draggable
                class={cx("wm-task wm-task--pin", wins.length > 0 && "is-running", active && "is-active", dropAt === i && "is-drop-before")}
                title={wins.length > 1 ? `${v.name} · ${wins.length} windows` : wins.length === 1 ? wins[0].title : v.name} aria-label={wins.length ? `${v.name} (open)` : `Open ${v.name}`}
                onClick={(e) => clickPin(p, e)}
                onContextMenu={(e) => pinMenu.openMenu(e, p)}
                onDragStart={(e) => { e.dataTransfer?.setData(PIN_DRAG, p.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}>
                {v.thumb ? <Img class="wm-task__thumb" src={v.thumb.image_url} alt="" draggable={false} /> : <Icon name={v.icon} />}
                {wins.length > 1 && <span class="wm-task__count num">{wins.length}</span>}
              </button>
            );
          })}
          {dropAt === pins.length && <span class="wm-task__dropend" />}
          {running.map((w) => (
            <button key={w.id} type="button"
              class={cx("wm-task wm-task--win", w.id === focusedId && w.mode !== "min" && "is-active", w.mode === "min" && "is-min")}
              title={w.title} aria-label={w.title}
              onClick={() => toggleWin(w)}
              onContextMenu={(e) => openMenu(e, w.id)}>
              <Icon name={appDef(w.app)?.icon ?? "application-outline"} />
              <span class="wm-task__txt">{w.title}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="wm-taskbar__tray">
        <ProjectSwitch projectId={projectId} />
        <IconButton icon="magnify" label="Go to… (⌘K)" title="Go to… (⌘K)" onClick={onPalette} />
        <IconButton icon={THEME_ICON[theme]} label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => setTheme(THEME_CYCLE[theme])} />
        <IconButton icon="refresh" label="Reload" title="Reload" onClick={() => location.reload()} />
        <UserMenu />
        <span class="wm-taskbar__clock num">{clock}</span>
      </div>
      {launcher && <Launcher onClose={() => setLauncher(false)} />}
      {menu && menuWin && (
        <WindowMenu win={menuWin} x={menu.x} y={menu.y} onClose={closeMenu} extra={<>
          <MenuItem icon={pinnedApp(menuWin.app) ? "pin-off-outline" : "pin-outline"} onClick={() => void togglePinApp(projectId, menuWin.app as AppId)}>
            {pinnedApp(menuWin.app) ? "Unpin app" : "Pin app to taskbar"}
          </MenuItem>
          <div class="f-menu__sep" />
        </>} />
      )}
      {pinMenu.menu && (() => {
        const p = pinMenu.menu.ctx;
        const wins = p.kind === "app" ? windows.filter((w) => w.app === p.app_id) : [];
        const name = shortcutView(p, entries, folderName)?.name ?? "Pin";
        return (
          <ContextMenu x={pinMenu.menu.x} y={pinMenu.menu.y} label={name} onClose={pinMenu.closeMenu}>
            {wins.map((w) => <MenuItem key={w.id} icon={appDef(w.app)?.icon ?? "application-outline"} selected={w.id === focusedId} onClick={() => wm.focus(w.id)}>{w.title}</MenuItem>)}
            {wins.length > 0 && <div class="f-menu__sep" />}
            <MenuItem icon="open-in-app" onClick={() => openShortcut(p)}>{wins.length ? "Open again" : "Open"}</MenuItem>
            <MenuItem icon="pin-off-outline" onClick={() => void unpin(p)}>Unpin from taskbar</MenuItem>
            {wins.length > 0 && <MenuItem icon="close" danger onClick={() => { for (const w of wins) void requestClose(w.id); }}>{wins.length > 1 ? `Close ${wins.length} windows` : "Close window"}</MenuItem>}
          </ContextMenu>
        );
      })()}
      {group.menu && (
        <ContextMenu x={group.menu.x} y={group.menu.y} label="Windows" onClose={group.closeMenu}>
          {windows.filter((w) => w.app === group.menu!.ctx).map((w) => (
            <MenuItem key={w.id} icon={appDef(w.app)?.icon ?? "application-outline"} selected={w.id === focusedId} onClick={() => wm.focus(w.id)}>{w.title}</MenuItem>
          ))}
        </ContextMenu>
      )}
      {wsMenu.menu && (
        <ContextMenu x={wsMenu.menu.x} y={wsMenu.menu.y} label="Workspaces" onClose={wsMenu.closeMenu}>
          {spaces.map((s, i) => (
            <MenuItem key={s.id} icon="monitor" selected={s.id === activeWs} count={i < 9 ? `⌘Alt${i + 1}` : undefined} onClick={() => goToWorkspace(s.id)}>{s.name}</MenuItem>
          ))}
          <div class="f-menu__sep" />
          <MenuItem icon="monitor-multiple" onClick={() => { wm.addWorkspace({ go: true }); }}>New workspace</MenuItem>
          <MenuItem icon="view-dashboard-outline" onClick={() => openOverlay("taskview")}>Task view…</MenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

/**
 * The active project and its switcher (opens upwards): switching swaps the whole desktop, after
 * every app with unsaved edits had its say (beforeProjectSwitch).
 */
/** The signed-in account (epic #107): who you are, your workspaces and members, signing out. */
function UserMenu() {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(() => box.current, () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [open]);
  if (user.status !== "signed-in") return null;
  const { email, name } = user.me.user;
  return (
    <div ref={box} class="wm-project wm-user">
      <IconButton icon="account-circle-outline" label={`Account · ${email}`} title={`Account · ${email}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div class="f-menu wm-project__menu" role="menu" aria-label="Account" data-overlay>
          <div class="f-menu__label">{name ? `${name} · ${email}` : email}</div>
          <MenuItem icon="account-group-outline" onClick={() => { setOpen(false); launch({ app: "settings", state: { tab: "account" } }); }}>Account and workspaces…</MenuItem>
          <div class="f-menu__sep" />
          <MenuItem icon="logout" onClick={() => { setOpen(false); void signOut(); }}>Sign out</MenuItem>
        </div>
      )}
    </div>
  );
}

function ProjectSwitch({ projectId }: { projectId: string }) {
  const { projects } = useData();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(() => box.current, () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>(".f-menu .is-sel")?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [open]);
  const name = projects?.find((p) => p.id === projectId)?.name ?? "—";
  const take = async (id: string) => {
    setOpen(false);
    const p = projects?.find((x) => x.id === id);
    if (await switchProject(id)) toast(`Now working on ${p?.name ?? "the project"}`);
  };
  return (
    <div ref={box} class="wm-project">
      <button type="button" class={cx("wm-taskbar__project", open && "is-open")} aria-haspopup="menu" aria-expanded={open} title={`Switch project · ${name}`} onClick={() => setOpen(!open)}>
        <Icon name="folder-outline" /><span class="wm-taskbar__projname">{name}</span><Icon name="unfold-more-horizontal" />
      </button>
      {open && (
        <div class="f-menu wm-project__menu" role="menu" aria-label="Projects" data-overlay>
          <div class="f-menu__label">Project</div>
          {(projects ?? []).map((p) => (
            <MenuItem key={p.id} role="menuitemradio" aria-checked={p.id === projectId} icon={p.id === projectId ? "check" : "folder-outline"} selected={p.id === projectId} count={`${p.shot_count}`} onClick={() => void take(p.id)}>{p.name}</MenuItem>
          ))}
          <div class="f-menu__sep" />
          <MenuItem icon="cog-outline" onClick={() => { setOpen(false); launch({ app: "projects" }); }}>Manage projects…</MenuItem>
        </div>
      )}
    </div>
  );
}
