// The board view of the file browser (docs/rewrite/07-organisation.md, "Finding and bulk editing"): the
// files listed, in lanes by the value of one single-choice property; dragging a file (or the ticked ones)
// to another lane sets it. It replaces the first app's Metadata board and works on every file type, with
// its layouts: lanes as columns or rows, S · M · L, or Fit (every lane shares the board, nothing scrolls).
import { useState } from "preact/hooks";
import { colorCss, cx, Segmented, Select } from "@openclapper/design";
import { allowedOptions, type PropertyDef } from "@openclapper/model";
import type { FileRec } from "./api";
import * as ops from "./fileOps";
import { toastError } from "./hosts";
import { setValues, type Definition } from "./props";

export type BoardLayout = { by: string | null; dir: "columns" | "rows"; size: "s" | "m" | "l" | "fit" };
export const BOARD_DEFAULT: BoardLayout = { by: null, dir: "columns", size: "m" };

interface Props {
  projectId: string;
  items: readonly FileRec[];
  defs: readonly Definition[];
  layout: BoardLayout;
  onLayout: (l: BoardLayout) => void;
  selected: readonly string[];
  /** A file as a card (the browser's own, with its picture, tick and menu). */
  card: (f: FileRec, i: number) => preact.ComponentChildren;
}

/** The single choices that can make lanes: shown on at least one of the listed files' types. */
export const laneProperties = (defs: readonly Definition[], items: readonly FileRec[]) => {
  const types = new Set(items.map((f) => f.type));
  return defs.filter((d) => d.def.field === "choice" && d.def.attached.some((a) => types.has(a.type) && !a.hidden));
};

export function Board({ projectId, items, defs, layout, onLayout, selected, card }: Props) {
  const lanesFrom = laneProperties(defs, items);
  const by = lanesFrom.find((d) => d.id === layout.by) ?? lanesFrom[0] ?? null;
  const [over, setOver] = useState<string | null>(null);
  if (!by) return <p className="st-note st-board__none">The board needs a single-choice property on these files. Add one in the Project app, under Properties.</p>;
  const def: PropertyDef = by.def;
  const carries = (f: FileRec) => def.attached.some((a) => a.type === f.type);
  const shown = items.filter(carries);
  const lanes = [...(def.options ?? []).map((o) => ({ id: o.id, label: o.label, color: o.color })), { id: "", label: "No value", color: 0 }];
  const inLane = (id: string) => shown.filter((f) => (typeof f.values?.[by.id] === "string" ? f.values[by.id] : "") === id);
  const drop = (lane: string) => (e: DragEvent) => {
    e.preventDefault(); setOver(null);
    const ids = (ops.readDrag(e) ?? []).filter((id) => shown.some((f) => f.id === id));
    const moving = ids.filter((id) => (shown.find((f) => f.id === id)!.values?.[by.id] ?? "") !== lane);
    if (!moving.length) return;
    // A lane a dependent choice does not allow for a file's parent value is refused by the server, with the reason.
    if (def.dependsOn && lane) {
      const bad = moving.find((id) => !allowedOptions(def, shown.find((f) => f.id === id)!.values?.[def.dependsOn!.property]).some((o) => o.id === lane));
      if (bad) { toastError(new Error(`“${shown.find((f) => f.id === bad)!.name}”: this ${by.name.toLowerCase()} does not fit the property it depends on`)); return; }
    }
    void setValues(projectId, moving, { [by.id]: lane || null }).catch(toastError);
  };
  return (
    <div className="st-board-wrap">
      <div className="st-board__bar">
        <span className="st-note">Lanes by</span>
        <Select size="sm" value={by.id} onChange={(v) => onLayout({ ...layout, by: v })} options={lanesFrom.map((d) => ({ value: d.id, label: d.name }))} aria-label="Lanes by" />
        <span style={{ flex: 1 }} />
        <Segmented label="Lanes" value={layout.dir} onChange={(v) => onLayout({ ...layout, dir: v as BoardLayout["dir"] })} options={[{ value: "columns", icon: "columns", title: "Lanes side by side" }, { value: "rows", icon: "rows", title: "Lanes stacked" }]} />
        <Segmented label="Size" value={layout.size} onChange={(v) => onLayout({ ...layout, size: v as BoardLayout["size"] })} options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }, { value: "fit", label: "Fit" }]} />
      </div>
      {shown.length < items.length && <p className="st-note st-board__note">{items.length - shown.length} listed files do not carry “{by.name}” and are not on the board.</p>}
      <div className={cx("st-board", `st-board--${layout.dir}`, `st-board--${layout.size}`)}>
        {lanes.map((l) => {
          const list = inLane(l.id);
          return (
            <section key={l.id || "none"} className={cx("st-lane", over === l.id && "is-drop")}
              onDragOver={(e) => { if (!ops.hasDrag(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = "move"; if (over !== l.id) setOver(l.id); }}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver((o) => (o === l.id ? null : o)); }}
              onDrop={drop(l.id)}>
              <header className="st-lane__head"><i style={{ background: colorCss(l.color) }} /><strong>{l.label}</strong><span className="st-note">{list.length}</span>{selected.length > 0 && list.some((f) => selected.includes(f.id)) && <span className="st-note">· {list.filter((f) => selected.includes(f.id)).length} ticked</span>}</header>
              <div className="st-lane__cards">{list.map((f, i) => card(f, i))}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
