import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { Kbd } from "../core/Kbd";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** Search-and-run for every command and app (Ctrl+K). */
export interface CommandPaletteProps {
  items: { id: string; label: string; icon?: IconName; kbd?: string; group?: string }[];
  onSelect?: (id: string) => void;
  onClose?: () => void;
  placeholder?: string;
  fixed?: boolean;
  defaultQuery?: string;
}

export function CommandPalette({ items = [], onSelect, onClose, placeholder = "Type a command or search", fixed, defaultQuery = "" }: CommandPaletteProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [cursor, setCursor] = useState(0);
  const shown = items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && shown[cursor]) { e.preventDefault(); if (onSelect) onSelect(shown[cursor].id); }
    else if (e.key === "Escape" && onClose) onClose();
  };
  let group: string | undefined;
  return (
    <div className={cx("oc-scrim", "oc-scrim--top", fixed && "oc-scrim--fixed")} onPointerDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="oc-dialog oc-palette">
        <div className="oc-palette__input"><Icon name="search" /><input autoFocus value={query} placeholder={placeholder} onInput={(e) => { setQuery(e.currentTarget.value); setCursor(0); }} onKeyDown={onKey} /><Kbd keys="Esc" /></div>
        <div role="listbox" className="oc-palette__list">
          {shown.length === 0 && <div className="oc-menu__heading">No matches</div>}
          {shown.map((it, i) => {
            const head = it.group && it.group !== group ? <div key={`g${i}`} className="oc-menu__heading">{it.group}</div> : null;
            group = it.group;
            return (
              <Fragment key={it.id}>
                {head}
                <button type="button" role="option" aria-selected={i === cursor} className={cx("oc-menu__item", i === cursor && "is-cursor")} onMouseEnter={() => setCursor(i)} onClick={() => onSelect && onSelect(it.id)}>
                  {it.icon ? <Icon name={it.icon} /> : <span className="oc-menu__slot" />}<span className="oc-menu__label">{it.label}</span>{it.kbd && <Kbd keys={it.kbd} />}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
