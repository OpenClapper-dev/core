import type { JSX } from "preact";
import { Button } from "../actions/Button";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** A vertical strip of tool buttons on the left of a canvas; one tool is selected at a time. */
export interface ToolRailProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange" | "value"> {
  tools: ({ id: string; icon: IconName; label: string; kbd?: string } | { separator: true })[];
  value?: string;
  onChange?: (id: string) => void;
}

export function ToolRail({ tools = [], value, onChange, className, ...rest }: ToolRailProps) {
  return (
    <div role="toolbar" aria-orientation="vertical" className={cx("oc-toolrail", className)} {...rest}>
      {tools.map((t, i) => "separator" in t
        ? <span key={"s" + i} className="oc-toolrail__sep" />
        : <Button key={t.id} variant="quiet" icon={t.icon} label={t.label + (t.kbd ? " (" + t.kbd + ")" : "")} selected={t.id === value} onClick={() => onChange && onChange(t.id)} />)}
    </div>
  );
}
