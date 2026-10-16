import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { cx, Icon, IconButton } from "../ui";
import { requestClose } from "./closeGuards";
import { WindowIdContext } from "./keyboard";
import { HANDLE_DIRS, useWindowDrag } from "./useWindowDrag";
import * as wm from "./wm";
import type { Win } from "./wm";

/**
 * One window frame: title bar (drag, double-click maximizes), the min/max/close buttons, eight
 * resize handles, and the content area the app renders into. Geometry comes from the store:
 * inline left/top/width/height in normal mode, CSS classes for max/snapped/min.
 */
export function Window({ win, icon, focused, children }: { win: Win; icon: string; focused: boolean; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onBarPointerDown, onHandlePointerDown } = useWindowDrag(win, ref);
  const normal = win.mode === "normal";
  return (
    <div
      ref={ref}
      class={cx("wm-window", focused && "is-focused", win.mode === "max" && "wm-window--max", win.mode === "min" && "wm-window--min", win.mode === "snapped" && `wm-window--snap-${win.snap}`)}
      style={normal ? { left: `${win.bounds.x}px`, top: `${win.bounds.y}px`, width: `${win.bounds.w}px`, height: `${win.bounds.h}px`, zIndex: win.z } : { zIndex: win.z }}
      role="group"
      aria-label={win.title}
      onMouseDownCapture={() => { if (wm.getFocusedId() !== win.id) wm.focus(win.id); }}
    >
      <div class="wm-window__bar" onPointerDown={onBarPointerDown} onDblClick={(e) => { if (!(e.target as HTMLElement).closest("button")) wm.toggleMax(win.id); }}>
        <Icon name={icon} />
        <span class="wm-window__title">{win.title}</span>
        <div class="wm-window__btns">
          <IconButton icon="window-minimize" label="Minimize" onClick={() => wm.minimize(win.id)} />
          <IconButton icon={win.mode === "max" ? "window-restore" : "window-maximize"} label={win.mode === "max" ? "Restore" : "Maximize"} onClick={() => wm.toggleMax(win.id)} />
          <IconButton icon="close" label="Close" class="wm-window__close" onClick={() => void requestClose(win.id)} />
        </div>
      </div>
      <div class="wm-window__content"><WindowIdContext.Provider value={win.id}>{children}</WindowIdContext.Provider></div>
      {normal && HANDLE_DIRS.map((dir) => (
        <div key={dir} class={`wm-handle wm-handle--${dir}`} onPointerDown={(e) => onHandlePointerDown(e, dir)} />
      ))}
    </div>
  );
}
