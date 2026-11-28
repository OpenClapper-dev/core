import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";
import { clickSelect } from "./useMarquee";

/** A column of a Table. */
export interface TableColumn {
  key: string;
  label: string;
  /** Right-aligned, tabular figures in the sans. */
  numeric?: boolean;
  /** Mono for codes, IDs, hashes and timecode. */
  mono?: boolean;
  sortable?: boolean;
  width?: number | string;
}

/** A dense data table: sticky header, sortable columns, row selection, numeric columns right-aligned with tabular figures. */
export interface TableProps extends Omit<JSX.HTMLAttributes<HTMLTableElement>, "onSelect" | "onResize"> {
  columns: TableColumn[];
  rows: ({ id: string } & Record<string, ComponentChildren>)[];
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (sort: { key: string; dir: "asc" | "desc" }) => void;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  /** Row with the keyboard cursor. */
  cursor?: string;
  /** Several rows can be selected, as in an OS file manager: a click selects the row, Ctrl/⌘-click adds or removes it, Shift-click selects the range from the cursor. */
  selectable?: boolean;
  /** The row last clicked (the anchor of a Shift-click). */
  onCursor?: (id: string) => void;
  /** A row was double-clicked. */
  onOpen?: (id: string) => void;
  /** More for one row's element: dragging it, dropping onto it, its context menu, a class. */
  rowProps?: (id: string) => JSX.HTMLAttributes<HTMLTableRowElement> | undefined;
  /**
   * Columns can be resized by dragging a header's right edge (#426); called with the new width when the drag ends.
   * The table then lays its columns out at fixed widths (a column without one gets 160 px) with an empty column
   * after them taking the rest, so a drag moves only that edge.
   */
  onResize?: (key: string, width: number) => void;
  /** Columns can be put in another order by dragging their header (#426); called with the keys in the new order. */
  onReorder?: (keys: string[]) => void;
}

/** A column's width when the table is resizable and the column names none. */
const COL_W = 160;

/** A header's right edge: dragging it sizes the column, live; the width is reported once at the end. */
function Grip({ th, onDone }: { th: () => HTMLTableCellElement | null; onDone: (w: number) => void }) {
  const down = (e: JSX.TargetedPointerEvent<HTMLSpanElement>) => {
    const el = th();
    if (!el || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const grip = e.currentTarget, x0 = e.clientX, w0 = el.getBoundingClientRect().width;
    let w = w0;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { w = Math.max(48, Math.min(1200, Math.round(w0 + ev.clientX - x0))); el.style.width = `${w}px`; };
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); if (w !== w0) onDone(w); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };
  return <span className="oc-table__grip" role="separator" aria-orientation="vertical" title="Drag to resize the column" onPointerDown={down} onClick={(e) => e.stopPropagation()} />;
}

export function Table({ columns = [], rows = [], sort, onSort, selected = [], onSelect, cursor, selectable, onCursor, onOpen, rowProps, onResize, onReorder, className, ...rest }: TableProps) {
  const emit = (ids: string[]) => onSelect && onSelect(ids);
  const ths = useRef(new Map<string, HTMLTableCellElement>());
  // A header being dragged to another place: which, and before which column it would go (columns.length: at the end).
  const [moving, setMoving] = useState<{ key: string; at: number } | null>(null);
  const reorder = (key: string) => (e: JSX.TargetedPointerEvent<HTMLTableCellElement>) => {
    if (!onReorder || e.button !== 0 || (e.target as Element).closest(".oc-table__grip")) return;
    const x0 = e.clientX;
    let at: number | null = null;
    const move = (m: PointerEvent) => {
      if (at === null && Math.abs(m.clientX - x0) < 6) return;
      // Before the first column whose middle lies right of the pointer.
      const mids = columns.map((c) => { const r = ths.current.get(c.key)?.getBoundingClientRect(); return r ? r.left + r.width / 2 : 0; });
      const i = mids.findIndex((x) => m.clientX < x);
      at = i < 0 ? columns.length : i;
      setMoving({ key, at });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      setMoving(null);
      if (at === null) return;
      // The click that ends a drag does not sort.
      addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
      const from = columns.findIndex((c) => c.key === key), keys = columns.map((c) => c.key);
      const to = at > from ? at - 1 : at;
      if (to === from) return;
      keys.splice(from, 1); keys.splice(to, 0, key);
      onReorder(keys);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };
  const fixed = !!onResize;
  return (
    <table role="grid" className={cx("oc-table", fixed && "is-fixed", moving && "is-moving", className)} {...rest}>
      <thead><tr>
        {columns.map((c, i) => {
          const dir = sort && sort.key === c.key ? sort.dir : null;
          return (
            <th key={c.key} ref={(el) => { if (el) ths.current.set(c.key, el); else ths.current.delete(c.key); }} style={{ width: fixed ? c.width ?? COL_W : c.width }}
              className={cx(c.numeric && "is-num", c.mono && "is-mono", onResize && "is-resizable", onReorder && "is-movable", moving?.key === c.key && "is-moved", moving && moving.at === i && "is-drop-before", moving && i === columns.length - 1 && moving.at === columns.length && "is-drop-after")}
              title={onReorder ? "Drag to move the column" : undefined} onPointerDown={onReorder ? reorder(c.key) : undefined} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}>
              {c.sortable
                ? <button type="button" className="oc-table__sort" onClick={() => onSort && onSort({ key: c.key, dir: dir === "asc" ? "desc" : "asc" })}>{c.label}<Icon name={dir === "desc" ? "arrow-down" : dir === "asc" ? "arrow-up" : "sort"} size={12} /></button>
                : c.label}
              {onResize && <Grip th={() => ths.current.get(c.key) ?? null} onDone={(w) => onResize(c.key, w)} />}
            </th>
          );
        })}
        {fixed && <th className="oc-table__fill" aria-hidden="true" />}
      </tr></thead>
      <tbody>
        {rows.map(r => {
          const sel = selected.includes(r.id);
          const { className: rowClass, ...more } = rowProps?.(r.id) ?? {};
          return (
            <tr key={r.id} {...more} data-row-id={r.id} aria-selected={sel} className={cx(cursor === r.id && "is-cursor", rowClass as string | undefined)} onClick={selectable ? (e) => { emit(clickSelect(rows.map(x => x.id), selected, cursor ?? null, r.id, e)); onCursor?.(r.id); } : () => emit([r.id])} onDblClick={onOpen ? () => onOpen(r.id) : undefined}>
              {columns.map(c => <td key={c.key} className={cx(c.numeric && "is-num", c.mono && "is-mono")}>{r[c.key]}</td>)}
              {fixed && <td className="oc-table__fill" />}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
