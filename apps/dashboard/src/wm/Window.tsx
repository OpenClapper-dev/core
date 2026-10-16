import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { ContextMenu, cx, Icon, IconButton, MenuItem, useCtxMenu } from "../ui";
import { requestClose } from "./closeGuards";
import { WindowIdContext } from "./keyboard";
import { HANDLE_DIRS, useWindowDrag } from "./useWindowDrag";
import * as wm from "./wm";
import type { Win } from "./wm";

/**
 * One window frame: title bar (drag, double-click maximizes), the min/max/close buttons, eight
 * resize handles, and the content area the app renders into. Geometry comes from the store:
 * inline left/top/width/height in normal mode, CSS classes for max/snapped/min. A window of
 * another workspace stays mounted but hidden (`away`), so its app keeps its state.
 */
export function Window({ win, icon, focused, away, children }: { win: Win; icon: string; focused: boolean; away?: boolean; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const barMenu = useCtxMenu<null>();
  const { onBarPointerDown, onHandlePointerDown } = useWindowDrag(win, ref);
  const normal = win.mode === "normal";
  return (
    <div
      ref={ref}
      class={cx("wm-window", focused && "is-focused", away && "wm-window--away", win.mode === "max" && "wm-window--max", win.mode === "min" && "wm-window--min", win.mode === "snapped" && `wm-window--snap-${win.snap}`)}
      style={normal ? { left: `${win.bounds.x}px`, top: `${win.bounds.y}px`, width: `${win.bounds.w}px`, height: `${win.bounds.h}px`, zIndex: win.z } : { zIndex: win.z }}
      role="group"
      aria-label={win.title}
      aria-hidden={away || undefined}
      onMouseDownCapture={() => { if (wm.getFocusedId() !== win.id) wm.focus(win.id); }}
    >
      <div class="wm-window__bar" onPointerDown={onBarPointerDown} onContextMenu={(e) => { if (!(e.target as HTMLElement).closest("button")) barMenu.openMenu(e, null); }} onDblClick={(e) => { if (!(e.target as HTMLElement).closest("button")) wm.toggleMax(win.id); }}>
        <Icon name={icon} />
        <span class="wm-window__title">{win.title}</span>
        <div class="wm-window__btns">
          <IconButton icon="window-minimize" label="Minimize" onClick={() => wm.minimize(win.id)} />
          <IconButton icon={win.mode === "max" ? "window-restore" : "window-maximize"} label={win.mode === "max" ? "Restore" : "Maximize"} onClick={() => wm.toggleMax(win.id)} />
          <IconButton icon="close" label="Close" class="wm-window__close" onClick={() => void requestClose(win.id)} />
        </div>
      </div>
      <div class="wm-window__content"><WindowIdContext.Provider value={win.id}>{children}</WindowIdContext.Provider></div>
      {barMenu.menu && <WindowMenu win={win} x={barMenu.menu.x} y={barMenu.menu.y} onClose={barMenu.closeMenu} />}
      {normal && HANDLE_DIRS.map((dir) => (
        <div key={dir} class={`wm-handle wm-handle--${dir}`} onPointerDown={(e) => onHandlePointerDown(e, dir)} />
      ))}
    </div>
  );
}

/** A window's actions (title bar and taskbar right-click): sizes, snapping, workspaces, close. */
export function WindowMenu({ win, x, y, onClose, extra }: { win: Win; x: number; y: number; onClose: () => void; extra?: ComponentChildren }) {
  const spaces = wm.getWorkspaces();
  return (
    <ContextMenu x={x} y={y} label={win.title} onClose={onClose}>
      {extra}
      <MenuItem icon="window-minimize" onClick={() => wm.minimize(win.id)}>Minimize</MenuItem>
      <MenuItem icon={win.mode === "max" ? "window-restore" : "window-maximize"} onClick={() => wm.toggleMax(win.id)}>{win.mode === "max" ? "Restore" : "Maximize"}</MenuItem>
      <MenuItem icon="dock-left" onClick={() => wm.setSnap(win.id, "left")}>Snap left</MenuItem>
      <MenuItem icon="dock-right" onClick={() => wm.setSnap(win.id, "right")}>Snap right</MenuItem>
      <div class="f-menu__sep" />
      <div class="f-menu__label">Move to</div>
      {spaces.map((s, i) => (
        <MenuItem key={s.id} icon="monitor" disabled={s.id === win.ws} selected={s.id === win.ws} count={i < 9 ? `⌘Alt⇧${i + 1}` : undefined} onClick={() => wm.moveToWorkspace(win.id, s.id)}>{s.name}</MenuItem>
      ))}
      <MenuItem icon="monitor-multiple" onClick={() => wm.moveToWorkspace(win.id, "new")}>New workspace</MenuItem>
      <div class="f-menu__sep" />
      <MenuItem icon="close" danger onClick={() => void requestClose(win.id)}>Close window</MenuItem>
    </ContextMenu>
  );
}
