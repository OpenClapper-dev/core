import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { IconName } from "../core/glyphs";
import { SearchInput } from "../forms/SearchInput";
import { cx } from "../util";
import { AppIcon } from "./AppIcon";

/** The app grid opened from the taskbar, with a search field and a section for extensions. */
export interface LauncherProps extends JSX.HTMLAttributes<HTMLDivElement> {
  apps: { id: string; label: string; glyph: IconName; color?: number }[];
  extensions?: { id: string; label: string; glyph: IconName; color?: number; enabled?: boolean }[];
  onOpen?: (id: string) => void;
}

type LauncherApp = LauncherProps["apps"][number] & { enabled?: boolean };

export function Launcher({ apps = [], extensions = [], onOpen, className, style, ...rest }: LauncherProps) {
  const [q, setQ] = useState("");
  const match = (a: LauncherApp) => a.label.toLowerCase().includes(q.toLowerCase());
  const tile = (a: LauncherApp) => (
    <button key={a.id} type="button" className={cx("oc-launcher__app", a.enabled === false && "is-off")} onClick={() => onOpen && onOpen(a.id)}>
      <AppIcon glyph={a.glyph} color={a.color} size={32} off={a.enabled === false} />
      <span>{a.label}</span>
      {a.enabled === false && <span className="oc-launcher__off">Off</span>}
    </button>
  );
  const ext = extensions.filter(match);
  return (
    <div role="dialog" aria-label="Launcher" className={cx("oc-launcher", className)} style={style} {...rest}>
      <SearchInput value={q} onChange={setQ} placeholder="Search apps" />
      <div className="oc-launcher__heading">Apps</div>
      <div className="oc-launcher__grid">{apps.filter(match).map(tile)}</div>
      {ext.length > 0 && <div className="oc-launcher__heading">Extensions</div>}
      {ext.length > 0 && <div className="oc-launcher__grid">{ext.map(tile)}</div>}
    </div>
  );
}
