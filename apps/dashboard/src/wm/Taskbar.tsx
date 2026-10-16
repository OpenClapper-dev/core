import { useEffect, useState } from "preact/hooks";
import { APPS, appDef, launch, type AppId } from "../apps/registry";
import { useTheme, type ThemeChoice } from "../theme";
import { ContextMenu, cx, Icon, IconButton, Mark, MenuItem, toast, useCtxMenu } from "../ui";
import { Launcher } from "./Launcher";
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

/** Bottom taskbar: launcher, pinned apps, running windows, project indicator, ⌘K, theme, clock, reload. */
export function Taskbar() {
  const windows = wm.useWindows();
  const focusedId = wm.useFocusedId();
  const pins = wm.usePins();
  const [theme, setTheme] = useTheme();
  const [launcher, setLauncher] = useState(false);
  const { menu, openMenu, closeMenu } = useCtxMenu<string>();
  const clock = useClock();
  const running = windows; // insertion order: z churn must not shuffle the tasks
  const runningApps = new Set(windows.map((w) => w.app));
  const menuWin = menu ? windows.find((w) => w.id === menu.ctx) : null;
  return (
    <div class="wm-taskbar">
      <button type="button" class={cx("wm-task wm-task--launcher", launcher && "is-open")} aria-label="Apps" aria-haspopup="menu" aria-expanded={launcher} title="Apps" onClick={() => setLauncher(!launcher)}>
        <Mark size={20} />
      </button>
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
      <span class="wm-taskbar__sp" />
      <span class="wm-taskbar__project" title="Project switching arrives with phase 2"><Icon name="folder-outline" /><span>Project</span></span>
      <IconButton icon="magnify" label="Go to… (⌘K)" title="Go to… (⌘K)" onClick={() => toast("Go to… arrives with phase 2", "info")} />
      <IconButton icon={THEME_ICON[theme]} label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => setTheme(THEME_NEXT[theme])} />
      <IconButton icon="refresh" label="Reload" title="Reload" onClick={() => location.reload()} />
      <span class="wm-taskbar__clock num">{clock}</span>
      {launcher && <Launcher onClose={() => setLauncher(false)} />}
      {menu && menuWin && (
        <ContextMenu x={menu.x} y={menu.y} label="Window actions" onClose={closeMenu}>
          <MenuItem icon={pins.includes(menuWin.app) ? "pin-off-outline" : "pin-outline"} onClick={() => wm.togglePin(menuWin.app)}>
            {pins.includes(menuWin.app) ? "Unpin app" : "Pin app to taskbar"}
          </MenuItem>
          <MenuItem icon="dock-left" onClick={() => wm.setSnap(menuWin.id, "left")}>Snap left</MenuItem>
          <MenuItem icon="dock-right" onClick={() => wm.setSnap(menuWin.id, "right")}>Snap right</MenuItem>
          <div class="f-menu__sep" />
          <MenuItem icon="close" danger onClick={() => wm.close(menuWin.id)}>Close window</MenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
