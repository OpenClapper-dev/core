import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** A window as the task view draws it. */
export interface TaskViewWindow {
  id: string;
  title: string;
  icon?: ComponentChildren;
  /** Where it sits on its desktop, as fractions of the desktop (0 to 1); absent draws a stacked stand-in, null a minimised window. */
  box?: { x: number; y: number; w: number; h: number } | null;
  minimized?: boolean;
}

const WIN_DRAG = "application/x-oc-window";

/**
 * Virtual desktops with window miniatures. The desktops are tiles with a small picture of their
 * windows; the windows of the tile under the pointer show as cards. With the optional handlers a
 * desktop can be renamed (double-click its name) and removed, a window closed, and a card dragged
 * onto a tile to move the window there. Arrow keys move between cards, Enter brings one up,
 * Delete closes it, Escape leaves.
 */
export interface TaskViewProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onClose"> {
  desks: { id: string; label: string; hint?: string; windows: TaskViewWindow[] }[];
  current?: string;
  /** Height over width of a desktop, for the tiles (default 0.57). */
  aspect?: number;
  onDesk?: (id: string) => void;
  onWindow?: (id: string) => void;
  onAdd?: () => void;
  onRename?: (id: string, name: string) => void;
  onRemove?: (id: string) => void;
  onCloseWindow?: (id: string) => void;
  /** A card was dropped on a desktop tile, or on "new". */
  onMoveWindow?: (windowId: string, deskId: string | "new") => void;
  onClose?: () => void;
  /** What a window shows, small: drawn in its card and in its desktop's tile. */
  preview?: (windowId: string, where: "card" | "tile") => ComponentChildren;
}

export function TaskView({ desks = [], current, aspect = 0.57, onDesk, onWindow, onAdd, onRename, onRemove, onCloseWindow, onMoveWindow, onClose, preview, className, ...rest }: TaskViewProps) {
  const [shown, setShown] = useState(current);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  // While a card is dragged the cards stay as they are: re-rendering the source cancels the drop.
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const cur = desks.find((d) => d.id === shown) || desks.find((d) => d.id === current) || desks[0] || { id: undefined, label: "", windows: [] };
  const cards = cur.windows;
  useEffect(() => { root.current?.focus(); }, []);
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, cards.length - 1))); }, [cards.length]);
  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (renaming || (e.target as HTMLElement).tagName === "INPUT") return;
    const focusCard = (i: number) => { setCursor(i); root.current?.querySelectorAll<HTMLElement>(".oc-taskview__win")[i]?.focus(); };
    if (e.key === "Escape" && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusCard(Math.min(cards.length - 1, cursor + 1)); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusCard(Math.max(0, cursor - 1)); }
    else if (e.key === "Enter" && cards[cursor] && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); onWindow?.(cards[cursor].id); }
    else if (e.key === "Delete" && cards[cursor] && onCloseWindow) { e.preventDefault(); onCloseWindow(cards[cursor].id); }
  };
  const dropProps = (id: string) => onMoveWindow ? {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes(WIN_DRAG)) { e.preventDefault(); setDropOn(id); } },
    onDragLeave: () => setDropOn((d) => (d === id ? null : d)),
    onDrop: (e: DragEvent) => { e.preventDefault(); setDropOn(null); const w = e.dataTransfer?.getData(WIN_DRAG); if (w) onMoveWindow(w, id); },
  } : {};
  const miniW = 168, miniH = Math.round(miniW * aspect);
  return (
    <div ref={root} role="dialog" aria-label="Task view" tabIndex={-1} className={cx("oc-taskview", className)} onKeyDown={onKey}
      onPointerDown={(e) => { if (onClose && (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("oc-taskview__windows"))) onClose(); }} {...rest}>
      <div className="oc-taskview__desks" role="list" aria-label="Desktops">
        {desks.map((d) => (
          <div key={d.id} role="listitem" className={cx("oc-taskview__desk", d.id === current && "is-current", d.id === cur.id && "is-shown", dropOn === d.id && "is-drop")}
            onMouseEnter={(e) => { if (!dragging && e.buttons === 0) setShown(d.id); }} {...dropProps(d.id)}>
            <button type="button" className="oc-taskview__mini" style={{ width: miniW, height: miniH }} aria-label={`Go to ${d.label}`} aria-pressed={d.id === current} onClick={() => onDesk && onDesk(d.id)}>
              {d.windows.map((w, i) => {
                if (w.box === null || w.minimized) return null;
                const b = w.box ? { left: `${w.box.x * 100}%`, top: `${w.box.y * 100}%`, width: `${Math.max(5, w.box.w * 100)}%`, height: `${Math.max(8, w.box.h * 100)}%` } : { left: 8 + i * 22, top: 8 + i * 9, width: 52, height: 34 };
                return <i key={w.id} style={b}>{preview?.(w.id, "tile")}</i>;
              })}
            </button>
            <span className="oc-taskview__label">
              {renaming === d.id ? (
                <input className="oc-taskview__rename" autoFocus defaultValue={d.label} aria-label="Desktop name" maxLength={40}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { onRename?.(d.id, e.currentTarget.value); setRenaming(null); } if (e.key === "Escape") setRenaming(null); }}
                  onBlur={(e) => { onRename?.(d.id, e.currentTarget.value); setRenaming(null); }} />
              ) : (
                <span title={onRename ? "Double-click to rename" : undefined} onDblClick={() => onRename && setRenaming(d.id)}>{d.label}{d.hint && <small> {d.hint}</small>}</span>
              )}
              {onRemove && desks.length > 1 && <button type="button" className="oc-taskview__x" aria-label={`Remove ${d.label}`} title={`Remove ${d.label}: its windows go to the desktop before`} onClick={() => onRemove(d.id)}><Icon name="close" size={12} /></button>}
            </span>
          </div>
        ))}
        {onAdd && (
          <div role="listitem" className={cx("oc-taskview__desk", "oc-taskview__desk--add", dropOn === "new" && "is-drop")} {...dropProps("new")}>
            <button type="button" className="oc-taskview__mini" style={{ width: miniW, height: miniH }} aria-label="New desktop" onClick={onAdd}><Icon name="plus" /></button>
            <span className="oc-taskview__label">New desktop</span>
          </div>
        )}
      </div>
      <div className="oc-taskview__windows" role="list" aria-label={`Windows on ${cur.label}`}>
        {cards.length === 0 && <p className="oc-taskview__empty">No windows on {cur.label}.</p>}
        {cards.map((w, i) => (
          <div key={w.id} role="listitem" className="oc-taskview__card">
            {/* A div, not a button: browsers do not start a drag from a <button>. */}
            <div role="button" tabIndex={0} className={cx("oc-taskview__win", i === cursor && "is-cursor", w.minimized && "is-minimized")} draggable={!!onMoveWindow} title={w.minimized ? `${w.title} (minimised)` : w.title}
              onDragStart={(e) => { e.dataTransfer?.setData(WIN_DRAG, w.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; setDragging(true); }} onDragEnd={() => setDragging(false)}
              onFocus={() => setCursor(i)} onClick={() => onWindow && onWindow(w.id)}>
              <span className="oc-taskview__bar">{w.icon}<span className="oc-taskview__title">{w.title}</span></span>
              <span className="oc-taskview__body">{preview?.(w.id, "card")}</span>
            </div>
            {onCloseWindow && <button type="button" className="oc-taskview__x oc-taskview__x--card" aria-label={`Close ${w.title}`} title={`Close ${w.title}`} onClick={() => onCloseWindow(w.id)}><Icon name="close" size={12} /></button>}
          </div>
        ))}
      </div>
      {(onMoveWindow || onRename) && <p className="oc-taskview__hint">{onMoveWindow && "Drag a window onto a desktop to move it · "}{onRename && "double-click a name to rename · "}Esc to leave</p>}
    </div>
  );
}
