import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "../core/glyphs";
import { SearchInput } from "../forms/SearchInput";
import { cx } from "../util";
import { AppIcon } from "./AppIcon";

/** The app grid opened from the taskbar, with a search field and a section for extensions. */
export interface LauncherProps extends JSX.HTMLAttributes<HTMLDivElement> {
  apps: { id: string; label: string; glyph: IconName; color?: number }[];
  extensions?: { id: string; label: string; glyph: IconName; color?: number; enabled?: boolean }[];
  onOpen?: (id: string) => void;
  /** Right-click on an app (pin it to the taskbar). */
  onMenu?: (id: string, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
}

type LauncherApp = LauncherProps["apps"][number] & { enabled?: boolean };

export function Launcher({ apps = [], extensions = [], onOpen, onMenu, className, style, ...rest }: LauncherProps) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector("input")?.focus(); }, []);
  const match = (a: LauncherApp) => a.label.toLowerCase().includes(q.toLowerCase());
  const tile = (a: LauncherApp) => (
    <button key={a.id} type="button" className={cx("oc-launcher__app", a.enabled === false && "is-off")} onClick={() => onOpen && onOpen(a.id)} onContextMenu={onMenu && ((e) => { e.preventDefault(); onMenu(a.id, e); })}>
      <AppIcon glyph={a.glyph} color={a.color} size={32} off={a.enabled === false} />
      <span>{a.label}</span>
      {a.enabled === false && <span className="oc-launcher__off">Off</span>}
    </button>
  );
  const ext = extensions.filter(match);
  return (
    <div ref={box} role="dialog" aria-label="Launcher" className={cx("oc-launcher", className)} style={style} {...rest}>
      <SearchInput value={q} onChange={setQ} placeholder="Search apps" />
      <div className="oc-launcher__heading">Apps</div>
      <div className="oc-launcher__grid">{apps.filter(match).map(tile)}</div>
      {ext.length > 0 && <div className="oc-launcher__heading">Extensions</div>}
      {ext.length > 0 && <div className="oc-launcher__grid">{ext.map(tile)}</div>}
    </div>
  );
}
