import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** The taskbar: launcher button, pinned items, running windows, system area. Sits on any edge. */
export interface TaskbarProps extends JSX.HTMLAttributes<HTMLDivElement> {
  edge?: "bottom" | "top" | "left" | "right";
  launcherOpen?: boolean;
  onLauncher?: () => void;
  /** Pinned apps, folders and files. A pin whose app has windows shows it: running, active, and how many. */
  pinned?: { id: string; title: string; icon: ComponentChildren; state?: "active" | "running"; count?: number }[];
  tasks?: { id: string; title: string; icon: ComponentChildren; state?: "active" | "running" | "minimized" }[];
  onTask?: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  /** Right-click on a pin or a window's button. */
  onTaskMenu?: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  /** Between the launcher and the pins: the task view button. */
  leading?: ComponentChildren;
  /** Where the launcher, pins and windows sit along the bar. */
  align?: "start" | "center";
  /** Spread on the group of pins and window buttons: a shell's drop handling. */
  groupProps?: JSX.HTMLAttributes<HTMLDivElement>;
  /** Pins can be dragged (the shell reorders them from the group's drag events; each carries `data-pin-id`). */
  pinsDraggable?: boolean;
  /** Window buttons can be dragged to reorder them (each carries `data-task-id` and `data-task-index`). */
  tasksDraggable?: boolean;
  /** Where a dragged pin or window button would land: a line before that pin or button (its index; the length for the end). */
  dropAt?: { group: "pins" | "tasks"; index: number } | null;
  /** System area: project, search, theme, clock, environment. */
  children?: ComponentChildren;
}

export function Taskbar({ edge = "bottom", launcherOpen, onLauncher, pinned = [], tasks = [], onTask, onTaskMenu, leading, align = "start", groupProps, pinsDraggable, tasksDraggable, dropAt, children, className, ...rest }: TaskbarProps) {
  const dropClass = (group: "pins" | "tasks", i: number, n: number) => dropAt?.group === group && (dropAt.index === i ? "is-drop-before" : dropAt.index === n && i === n - 1 ? "is-drop-after" : undefined);
  return (
    <div role="toolbar" aria-label="Taskbar" aria-orientation={edge === "left" || edge === "right" ? "vertical" : "horizontal"} className={cx("oc-taskbar", `oc-taskbar--${edge}`, align === "center" && "oc-taskbar--center", className)} {...rest}>
      {align === "center" && <span className="oc-taskbar__spacer" />}
      <button type="button" className={cx("oc-task", "oc-task--icon", launcherOpen && "is-active")} aria-label="Launcher" aria-expanded={!!launcherOpen} onClick={onLauncher}><Icon name="grid" /></button>
      {leading}
      <span className="oc-taskbar__sep" />
      <div className="oc-taskbar__group" {...groupProps}>
        {pinned.map((t, i) => (
          <button key={t.id} type="button" data-pin-id={t.id} data-pin-index={i} draggable={pinsDraggable} className={cx("oc-task", "oc-task--icon", t.state === "active" && "is-active", t.state === "running" && "is-running", dropClass("pins", i, pinned.length))} aria-label={t.title} title={t.title}
            onClick={(e) => onTask && onTask(t.id, e)} onContextMenu={onTaskMenu && ((e) => { e.preventDefault(); onTaskMenu(t.id, e); })}>
            {t.icon}{t.count != null && t.count > 1 && <span className="oc-task__count">{t.count}</span>}
          </button>
        ))}
        {pinned.length > 0 && tasks.length > 0 && <span className="oc-taskbar__sep" />}
        {tasks.map((t, i) => (
          <button key={t.id} type="button" data-task-id={t.id} data-task-index={i} draggable={tasksDraggable} title={t.title} className={cx("oc-task", t.state === "active" && "is-active", t.state === "running" && "is-running", t.state === "minimized" && "is-minimized", dropClass("tasks", i, tasks.length))} aria-pressed={t.state === "active"} onClick={(e) => onTask && onTask(t.id, e)} onContextMenu={onTaskMenu && ((e) => { e.preventDefault(); onTaskMenu(t.id, e); })}>
            {t.icon}<span className="oc-task__label">{t.title}</span>
          </button>
        ))}
      </div>
      <span className="oc-taskbar__spacer" />
      <div className="oc-taskbar__group oc-taskbar__group--system">{children}</div>
    </div>
  );
}

/** A button in the taskbar's system area; icon-only without children. */
export interface TaskbarButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "label"> {
  icon?: IconName;
  label?: string;
  active?: boolean;
  /** A small number in the corner (the active desktop's). */
  count?: number;
  children?: ComponentChildren;
}

export function TaskbarButton({ icon, label, active, count, children, ...rest }: TaskbarButtonProps) {
  return <button type="button" className={cx("oc-task", !children && "oc-task--icon", active && "is-active")} aria-label={label} title={label} {...rest}>{icon && <Icon name={icon} />}{children && <span className="oc-task__label">{children}</span>}{count != null && <span className="oc-task__count">{count}</span>}</button>;
}

/** The clock in the taskbar's system area. */
export function TaskbarClock({ children }: { children?: ComponentChildren }) { return <span className="oc-taskbar__clock">{children}</span>; }
