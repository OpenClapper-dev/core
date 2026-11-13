import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** The taskbar: launcher button, pinned items, running windows, system area. Sits on any edge. */
export interface TaskbarProps extends JSX.HTMLAttributes<HTMLDivElement> {
  edge?: "bottom" | "top" | "left" | "right";
  launcherOpen?: boolean;
  onLauncher?: () => void;
  pinned?: { id: string; title: string; icon: ComponentChildren }[];
  tasks?: { id: string; title: string; icon: ComponentChildren; state?: "active" | "running" | "minimized" }[];
  onTask?: (id: string) => void;
  /** System area: project, search, theme, clock, environment. */
  children?: ComponentChildren;
}

export function Taskbar({ edge = "bottom", launcherOpen, onLauncher, pinned = [], tasks = [], onTask, children, className, ...rest }: TaskbarProps) {
  return (
    <div role="toolbar" aria-label="Taskbar" aria-orientation={edge === "left" || edge === "right" ? "vertical" : "horizontal"} className={cx("oc-taskbar", `oc-taskbar--${edge}`, className)} {...rest}>
      <button type="button" className={cx("oc-task", "oc-task--icon", launcherOpen && "is-active")} aria-label="Launcher" aria-expanded={!!launcherOpen} onClick={onLauncher}><Icon name="grid" /></button>
      <span className="oc-taskbar__sep" />
      <div className="oc-taskbar__group">
        {pinned.map((t) => <button key={t.id} type="button" className="oc-task oc-task--icon" aria-label={t.title} title={t.title} onClick={() => onTask && onTask(t.id)}>{t.icon}</button>)}
        {pinned.length > 0 && tasks.length > 0 && <span className="oc-taskbar__sep" />}
        {tasks.map((t) => (
          <button key={t.id} type="button" title={t.title} className={cx("oc-task", t.state === "active" && "is-active", t.state === "running" && "is-running", t.state === "minimized" && "is-minimized")} aria-pressed={t.state === "active"} onClick={() => onTask && onTask(t.id)}>
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
  children?: ComponentChildren;
}

export function TaskbarButton({ icon, label, active, children, ...rest }: TaskbarButtonProps) {
  return <button type="button" className={cx("oc-task", !children && "oc-task--icon", active && "is-active")} aria-label={label} title={label} {...rest}>{icon && <Icon name={icon} />}{children && <span className="oc-task__label">{children}</span>}</button>;
}

/** The clock in the taskbar's system area. */
export function TaskbarClock({ children }: { children?: ComponentChildren }) { return <span className="oc-taskbar__clock">{children}</span>; }
