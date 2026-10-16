import { useEffect, useRef, useState } from "preact/hooks";
import { useData } from "../data";
import { switchProject } from "../project";
import { APPS, appDef, launch, type AppId } from "../apps/registry";
import { useTheme, type ThemeChoice } from "../theme";
import { ContextMenu, cx, Icon, IconButton, Mark, MenuItem, toast, useCtxMenu, useOutsideClick } from "../ui";
import { Launcher } from "./Launcher";
import { openOverlay } from "./overlays";
import { WindowMenu } from "./Window";
import * as wm from "./wm";

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { auto: "sun", sun: "set", set: "auto" };
const THEME_LABEL: Record<ThemeChoice, string> = { auto: "Theme: Auto (follows the system)", sun: "Theme: Sun", set: "Theme: Set" };
const THEME_ICON: Record<ThemeChoice, string> = { auto: "theme-light-dark", sun: "white-balance-sunny", set: "weather-night" };

function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [t, setT] = useState(fmt);
  useEffect(() => { const i = setInterval(() => setT(fmt()), 10_000); return () => clearInterval(i); }, []);
  return t;
}

/** Bottom taskbar: launcher, pinned apps, running windows, project switcher, ⌘K, theme, clock, reload. */
export function Taskbar({ projectId, onPalette }: { projectId: string; onPalette: () => void }) {
  const windows = wm.useWindows();
  const focusedId = wm.useFocusedId();
  const pins = wm.usePins();
  const [theme, setTheme] = useTheme();
  const [launcher, setLauncher] = useState(false);
  const { menu, openMenu, closeMenu } = useCtxMenu<string>();
  const wsMenu = useCtxMenu<null>();
  const spaces = wm.useWorkspaces();
  const activeWs = wm.useActiveWs();
  const clock = useClock();
  const running = windows; // insertion order: z churn must not shuffle the tasks
  const runningApps = new Set(windows.map((w) => w.app));
  const menuWin = menu ? windows.find((w) => w.id === menu.ctx) : null;
  return (
    <div class="wm-taskbar">
      <button type="button" class={cx("wm-task wm-task--launcher", launcher && "is-open")} aria-label="Apps" aria-haspopup="menu" aria-expanded={launcher} title="Apps" onClick={() => setLauncher(!launcher)}>
        <Mark size={20} />
      </button>
      <button type="button" class="wm-task wm-task--view" title={`Task view (⌘Alt V) · ${spaces.find((s) => s.id === activeWs)?.name ?? ""}`} aria-label="Task view"
        onClick={() => openOverlay("taskview")} onContextMenu={(e) => wsMenu.openMenu(e, null)}>
        <Icon name="view-dashboard-outline" />
        {spaces.length > 1 && <span class="wm-task__badge num">{spaces.findIndex((s) => s.id === activeWs) + 1}</span>}
      </button>
      <div class="wm-taskbar__tasks">
      {pins.filter((a) => !runningApps.has(a) && appDef(a)).map((a) => (
        <button key={`pin-${a}`} type="button" class="wm-task wm-task--pin" title={APPS[a as AppId].name} aria-label={`Open ${APPS[a as AppId].name}`} onClick={() => launch({ app: a as AppId })}>
          <Icon name={APPS[a as AppId].icon} />
        </button>
      ))}
      {running.map((w) => (
        <button key={w.id} type="button"
          class={cx("wm-task wm-task--win", w.id === focusedId && w.mode !== "min" && "is-active", w.mode === "min" && "is-min")}
          title={w.title} aria-label={w.title}
          onClick={() => (w.id === focusedId && w.mode !== "min" ? wm.minimize(w.id) : wm.focus(w.id))}
          onContextMenu={(e) => openMenu(e, w.id)}>
          <Icon name={appDef(w.app)?.icon ?? "application-outline"} />
          <span class="wm-task__txt">{w.title}</span>
        </button>
      ))}
      </div>
      <ProjectSwitch projectId={projectId} />
      <IconButton icon="magnify" label="Go to… (⌘K)" title="Go to… (⌘K)" onClick={onPalette} />
      <IconButton icon={THEME_ICON[theme]} label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => setTheme(THEME_NEXT[theme])} />
      <IconButton icon="refresh" label="Reload" title="Reload" onClick={() => location.reload()} />
      <span class="wm-taskbar__clock num">{clock}</span>
      {launcher && <Launcher onClose={() => setLauncher(false)} />}
      {menu && menuWin && (
        <WindowMenu win={menuWin} x={menu.x} y={menu.y} onClose={closeMenu} extra={<>
          <MenuItem icon={pins.includes(menuWin.app) ? "pin-off-outline" : "pin-outline"} onClick={() => wm.togglePin(menuWin.app)}>
            {pins.includes(menuWin.app) ? "Unpin app" : "Pin app to taskbar"}
          </MenuItem>
          <div class="f-menu__sep" />
        </>} />
      )}
      {wsMenu.menu && (
        <ContextMenu x={wsMenu.menu.x} y={wsMenu.menu.y} label="Workspaces" onClose={wsMenu.closeMenu}>
          {spaces.map((s, i) => (
            <MenuItem key={s.id} icon="monitor" selected={s.id === activeWs} count={i < 9 ? `⌘Alt${i + 1}` : undefined} onClick={() => wm.switchWorkspace(s.id)}>{s.name}</MenuItem>
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
      <button type="button" class={cx("wm-taskbar__project", open && "is-open")} aria-haspopup="menu" aria-expanded={open} title="Switch project" onClick={() => setOpen(!open)}>
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
