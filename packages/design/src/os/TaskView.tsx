import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** Virtual desktops with window miniatures. */
export interface TaskViewProps extends JSX.HTMLAttributes<HTMLDivElement> {
  desks: { id: string; label: string; windows: { id: string; title: string; icon?: ComponentChildren }[] }[];
  current?: string;
  onDesk?: (id: string) => void;
  onWindow?: (id: string) => void;
  onAdd?: () => void;
}

export function TaskView({ desks = [], current, onDesk, onWindow, onAdd, className, ...rest }: TaskViewProps) {
  const cur = desks.find((d) => d.id === current) || desks[0] || { id: undefined, windows: [] };
  return (
    <div role="dialog" aria-label="Task view" className={cx("oc-taskview", className)} {...rest}>
      <div className="oc-taskview__desks">
        {desks.map((d) => (
          <button key={d.id} type="button" className={cx("oc-taskview__desk", d.id === cur.id && "is-current")} aria-pressed={d.id === cur.id} onClick={() => onDesk && onDesk(d.id)}>
            <span className="oc-taskview__mini">{d.windows.map((w, i) => <i key={w.id} style={{ left: 8 + i * 22, top: 8 + i * 9, width: 52, height: 34 }} />)}</span>
            <span>{d.label}</span>
          </button>
        ))}
        {onAdd && <button type="button" className="oc-taskview__desk oc-taskview__desk--add" onClick={onAdd}><span className="oc-taskview__mini"><Icon name="plus" /></span><span>New desktop</span></button>}
      </div>
      <div className="oc-taskview__windows">
        {cur.windows.map((w) => (
          <button key={w.id} type="button" className="oc-taskview__win" onClick={() => onWindow && onWindow(w.id)}>
            <span className="oc-taskview__bar">{w.icon}{w.title}</span><span className="oc-taskview__body" />
          </button>
        ))}
      </div>
    </div>
  );
}
