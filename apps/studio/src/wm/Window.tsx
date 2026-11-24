import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { AppIcon, AppWindow } from "@openclapper/design";
import type { AppDef } from "../apps/registry";
import { contextMenu, type MenuEntry } from "../hosts";
import { requestClose } from "./closeGuards";
import { WindowIdContext } from "./keyboard";
import { startSplitDrag } from "./SplitGrip";
import { HANDLE_DIRS, useWindowDrag } from "./useWindowDrag";
import * as wm from "./wm";
import type { Win } from "./wm";

/** Where a window shrinks to when minimised: its own taskbar button, else its app's pin. */
function taskButton(win: Win): DOMRect | undefined {
  const el = document.querySelector(`[data-task-id="${win.id}"]`) ?? document.querySelector(`[data-pin-id="app:${win.app}"]`);
  return el?.getBoundingClientRect();
}

/** A window's actions (title bar and taskbar right-click): sizes, snapping, desktops, close. */
export function windowMenu(win: Win, extra: MenuEntry[] = []): MenuEntry[] {
  const desks = wm.getDesks();
  return [
    ...extra,
    { id: "min", label: "Minimise", icon: "minus", run: () => wm.minimize(win.id) },
    { id: "max", label: win.mode === "max" ? "Restore" : "Maximise", icon: win.mode === "max" ? "restore" : "maximize", run: () => wm.toggleMax(win.id) },
    { id: "left", label: "Snap left", icon: "sidebar", kbd: "⌘Alt ←", run: () => wm.setSnap(win.id, "left") },
    { id: "right", label: "Snap right", icon: "columns", kbd: "⌘Alt →", run: () => wm.setSnap(win.id, "right") },
    { separator: true },
    { heading: "Move to" },
    ...desks.map((d, i): MenuEntry => ({ id: `desk-${d.id}`, label: d.name, icon: "desktop", checked: d.id === win.desk ? true : undefined, disabled: d.id === win.desk, kbd: i < 9 ? `⌘Alt⇧${i + 1}` : undefined, run: () => wm.moveToDesk(win.id, d.id) })),
    { id: "desk-new", label: "New desktop", icon: "plus", run: () => wm.moveToDesk(win.id, "new") },
    { separator: true },
    { id: "close", label: "Close window", icon: "close", danger: true, kbd: "⌘Alt W", run: () => void requestClose(win.id) },
  ];
}

/**
 * One window: the design system's frame, moved and sized by the window manager. Geometry comes
 * from the store (inline in normal mode, the frame's own classes for maximised, snapped and
 * minimised); during a drag the frame is written directly and committed once at the end. A window
 * of another desktop stays mounted but hidden, so its app keeps its state.
 */
export function Window({ win, def, focused, away, closing, onClosed, children }: { win: Win; def: AppDef; focused: boolean; away?: boolean; closing?: boolean; onClosed: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLElement>(null);
  const { onBarPointerDown, onHandlePointerDown } = useWindowDrag(win, ref);
  const normal = win.mode === "normal";
  const b = win.bounds;
  return (
    <AppWindow frameRef={ref} title={win.title} icon={<AppIcon glyph={def.glyph} color={def.color} size={16} />} focused={focused} resizable={false}
      state={win.mode === "snapped" ? `snap-${win.snap ?? "left"}` : win.mode} closing={closing} onClosed={onClosed} minimizeTarget={win.mode === "min" ? taskButton(win) : undefined}
      className={away ? "st-away" : undefined} aria-hidden={away || undefined} data-win-id={win.id}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: win.z }}
      onFocus={() => { if (wm.getFocusedId() !== win.id) wm.focus(win.id); }}
      onClose={() => void requestClose(win.id)} onMinimize={() => wm.minimize(win.id)} onMaximize={() => wm.toggleMax(win.id)}
      onBarPointerDown={onBarPointerDown} onBarContextMenu={(e) => { if (!(e.target as HTMLElement).closest("button")) contextMenu(e, windowMenu(win)); }}
      frame={<>
        {/* A snapped window keeps its inner edge, and it moves the split: the window beside follows. */}
        {win.mode === "snapped" && <div className={`st-handle st-handle--${win.snap === "left" ? "e" : "w"}`} onPointerDown={startSplitDrag} onDblClick={() => wm.setSplit(wm.SPLIT_DEFAULT)} />}
        {normal && HANDLE_DIRS.map((dir) => <div key={dir} className={`st-handle st-handle--${dir}`} onPointerDown={(e) => onHandlePointerDown(e, dir)} />)}
      </>}>
      <WindowIdContext.Provider value={win.id}>{children}</WindowIdContext.Provider>
    </AppWindow>
  );
}
