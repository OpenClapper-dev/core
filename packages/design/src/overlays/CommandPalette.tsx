import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { Kbd } from "../core/Kbd";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** One result: a label, and either a glyph or its own art (a thumbnail, an app icon). */
export interface PaletteItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Drawn instead of the icon: a file's thumbnail or its type's app icon. */
  art?: ComponentChildren;
  /** A second line: what it is and where. */
  meta?: string;
  kbd?: string;
  group?: string;
  /** Also searched, not shown (a file's property values). */
  keywords?: string;
}

/**
 * Search and open (Ctrl+K): apps, windows, files. A query keeps the items whose label (or keywords)
 * contains it and marks the matched part, so it is plain why each one is there. `large` is the
 * desktop's global search: wider, taller, a picture per result.
 */
export interface CommandPaletteProps {
  items: PaletteItem[];
  onSelect?: (id: string) => void;
  onClose?: () => void;
  placeholder?: string;
  fixed?: boolean;
  defaultQuery?: string;
  large?: boolean;
  /** At most this many results per group (items come in the order to keep: the newest files first). */
  limit?: number;
}

/** The label with every occurrence of the query marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const out: ComponentChildren[] = [];
  const low = text.toLowerCase();
  let at = 0;
  for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(<mark key={i} className="oc-match">{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

export function CommandPalette({ items = [], onSelect, onClose, placeholder = "Type a command or search", fixed, defaultQuery = "", large, limit }: CommandPaletteProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [cursor, setCursor] = useState(0);
  // Focused by hand: the autofocus attribute does nothing on an element added after the page loaded.
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const q = query.trim().toLowerCase();
  const perGroup = new Map<string, number>();
  const shown = items.filter((i) => {
    if (q && !i.label.toLowerCase().includes(q) && !i.keywords?.toLowerCase().includes(q)) return false;
    if (!limit) return true;
    const g = i.group ?? "", n = perGroup.get(g) ?? 0;
    perGroup.set(g, n + 1);
    return n < limit;
  });
  useEffect(() => { list.current?.querySelector(".is-cursor")?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && shown[cursor]) { e.preventDefault(); if (onSelect) onSelect(shown[cursor].id); }
    else if (e.key === "Escape" && onClose) onClose();
  };
  let group: string | undefined;
  return (
    <div className={cx("oc-scrim", "oc-scrim--top", fixed && "oc-scrim--fixed")} onPointerDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={large ? "Search" : "Command palette"} className={cx("oc-dialog", "oc-palette", large && "oc-palette--large")}>
        <div className="oc-palette__input"><Icon name="search" /><input ref={input} value={query} placeholder={placeholder} onInput={(e) => { setQuery(e.currentTarget.value); setCursor(0); }} onKeyDown={onKey} /><Kbd keys="Esc" /></div>
        <div ref={list} role="listbox" className="oc-palette__list">
          {shown.length === 0 && <div className="oc-menu__heading">No matches</div>}
          {shown.map((it, i) => {
            const head = it.group && it.group !== group ? <div key={`g${i}`} className="oc-menu__heading">{it.group}</div> : null;
            group = it.group;
            return (
              <Fragment key={it.id}>
                {head}
                <button type="button" role="option" aria-selected={i === cursor} className={cx("oc-menu__item", "oc-palette__item", i === cursor && "is-cursor")} onMouseEnter={() => setCursor(i)} onClick={() => onSelect && onSelect(it.id)}>
                  {it.art ? <span className="oc-palette__art">{it.art}</span> : it.icon ? <Icon name={it.icon} /> : <span className="oc-menu__slot" />}
                  <span className="oc-palette__text"><span className="oc-menu__label"><Highlight text={it.label} query={query} /></span>{it.meta && <span className="oc-palette__meta">{it.meta}</span>}</span>
                  {it.kbd && <Kbd keys={it.kbd} />}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
