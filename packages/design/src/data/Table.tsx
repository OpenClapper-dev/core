import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { Checkbox } from "../forms/Checkbox";
import { cx } from "../util";

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
export interface TableProps extends Omit<JSX.HTMLAttributes<HTMLTableElement>, "onSelect"> {
  columns: TableColumn[];
  rows: ({ id: string } & Record<string, ComponentChildren>)[];
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (sort: { key: string; dir: "asc" | "desc" }) => void;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  /** Row with the keyboard cursor. */
  cursor?: string;
  /** Adds a checkbox column. */
  selectable?: boolean;
}

export function Table({ columns = [], rows = [], sort, onSort, selected = [], onSelect, cursor, selectable, className, ...rest }: TableProps) {
  const all = rows.length > 0 && rows.every(r => selected.includes(r.id));
  const emit = (ids: string[]) => onSelect && onSelect(ids);
  return (
    <table role="grid" className={cx("oc-table", className)} {...rest}>
      <thead><tr>
        {selectable && <th className="oc-table__check"><Checkbox checked={all} indeterminate={!all && selected.length > 0} onChange={() => emit(all ? [] : rows.map(r => r.id))} aria-label="Select all" /></th>}
        {columns.map(c => {
          const dir = sort && sort.key === c.key ? sort.dir : null;
          return (
            <th key={c.key} style={{ width: c.width }} className={cx(c.numeric && "is-num", c.mono && "is-mono")} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}>
              {c.sortable
                ? <button type="button" className="oc-table__sort" onClick={() => onSort && onSort({ key: c.key, dir: dir === "asc" ? "desc" : "asc" })}>{c.label}<Icon name={dir === "desc" ? "arrow-down" : dir === "asc" ? "arrow-up" : "sort"} size={12} /></button>
                : c.label}
            </th>
          );
        })}
      </tr></thead>
      <tbody>
        {rows.map(r => {
          const sel = selected.includes(r.id);
          return (
            <tr key={r.id} aria-selected={sel} className={cx(cursor === r.id && "is-cursor")} onClick={selectable ? undefined : () => emit([r.id])}>
              {selectable && <td className="oc-table__check"><Checkbox checked={sel} onChange={() => emit(sel ? selected.filter(i => i !== r.id) : selected.concat(r.id))} aria-label="Select row" /></td>}
              {columns.map(c => <td key={c.key} className={cx(c.numeric && "is-num", c.mono && "is-mono")}>{r[c.key]}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
