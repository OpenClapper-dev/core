import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";
import { AppIcon } from "./AppIcon";

const FILE_KIND: Record<string, [IconName, number]> = { folder: ["folder", 5], file: ["file", 0], bin: ["trash", 0], app: ["window", 6] };

/** A file or folder on the desktop or in a file browser, at icon, list or grid size. */
export interface FileTileProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "name" | "icon" | "selected"> {
  name: string;
  kind?: "file" | "folder" | "image" | "bin" | "app";
  view?: "icon" | "list" | "grid";
  /** Overrides the default icon. */
  icon?: ComponentChildren;
  /** Picture for kind='image'. */
  src?: string;
  meta?: ComponentChildren;
  selected?: boolean;
  shortcut?: boolean;
  dropTarget?: boolean;
  dragging?: boolean;
}

export function FileTile({ name, kind = "file", view = "icon", icon, src, meta, selected, shortcut, dropTarget, dragging, className, ...rest }: FileTileProps) {
  const px = view === "list" ? 16 : view === "grid" ? 56 : 36;
  const k = FILE_KIND[kind] || FILE_KIND.file;
  const art = kind === "image"
    ? <span className="oc-file__pic">{src ? <img src={src} alt="" /> : null}</span>
    : (icon || <AppIcon glyph={k[0]} color={k[1]} size={px} />);
  return (
    <button type="button" aria-pressed={selected == null ? undefined : !!selected} className={cx("oc-file", `oc-file--${view}`, selected && "is-selected", dropTarget && "is-drop", dragging && "is-dragging", className)} {...rest}>
      <span className="oc-file__icon">{art}{shortcut && <span className="oc-file__shortcut" title="Shortcut" aria-label="Shortcut"><Icon name="shortcut" size={10} /></span>}</span>
      <span className="oc-file__name" title={typeof name === "string" ? name : undefined}>{name}</span>
      {meta && <span className="oc-file__meta">{meta}</span>}
    </button>
  );
}
