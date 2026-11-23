// Picking files of the project to put into a content list or a progression. A collection is not referenced: it
// opens, and the photos chosen from it are added one by one. For a progression only pictures are offered, and a
// canvas with frames can be added whole or through one of its frames (docs/rewrite/i1-interjection.md).
import { useState } from "preact/hooks";
import { AppIcon, Button, Checkbox, Dialog, EmptyState, Icon, SearchInput, Segmented, cx } from "@openclapper/design";
import { TYPES, type FileRec, type FileType } from "../u1/data";
import { type Doc, type Ref } from "./model";
import { Pic, see } from "./Pic";

const key = (r: Ref) => `${r.file}|${r.frame ?? ""}`;

export default function AddFiles({ title, pictures, files, docs, onAdd, onClose }: { title: string; pictures: boolean; files: FileRec[]; docs: Record<string, Doc>; onAdd: (refs: Ref[]) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Ref[]>([]);
  const map = new Map(files.map((f) => [f.id, f]));
  const offered: FileType[] = pictures ? ["photo", "canvas", "collection"] : ["photo", "canvas", "collection", "timeline", "set", "location"];
  const want = (f: FileRec) => !f.binned && !f.internalOf && offered.includes(f.type) && (kind === "all" || f.type === kind || (kind === "photo" && f.type === "collection")) && (!q || f.name.toLowerCase().includes(q.toLowerCase()));
  const inColl = (f: FileRec) => f.parent != null && map.get(f.parent)?.type === "collection";
  const top = files.filter((f) => want(f) && !inColl(f)).sort((a, b) => TYPES[a.type].label.localeCompare(TYPES[b.type].label) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const has = (r: Ref) => chosen.some((c) => key(c) === key(r));
  const toggle = (rs: Ref[]) => setChosen(rs.every(has) ? chosen.filter((c) => !rs.some((r) => key(r) === key(c))) : [...chosen, ...rs.filter((r) => !has(r))]);
  const row = (r: Ref, label: string, meta: string, depth = 0, twist?: { id: string; n: number }) => (
    <li key={key(r) + depth} className={cx("u3-pickrow", has(r) && "is-on")} style={{ paddingLeft: 8 + depth * 28 }} onClick={() => toggle([r])}>
      <Checkbox checked={has(r)} onChange={() => toggle([r])} aria-label={`Choose ${label}`} />
      <span className="u3-pickrow__art"><Pic seen={see(r, map, docs)} /></span>
      <span className="u3-pickrow__name">{label}<small>{meta}</small></span>
      {twist && <Button size="sm" variant="quiet" iconAfter={open.includes(twist.id) ? "chevron-up" : "chevron-down"} onClick={(e) => { e.stopPropagation(); setOpen(open.includes(twist.id) ? open.filter((x) => x !== twist.id) : [...open, twist.id]); }}>{twist.n} frames</Button>}
    </li>
  );
  return (
    <Dialog fixed className="u3-pick" title={title} onClose={onClose}
      footer={<><span className="u3-hint">{pictures ? "Pictures only: photos, canvases, or one frame of a canvas." : "Any file of this project can be content. Nothing is copied: the list points at the files."}</span><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!chosen.length} onClick={() => onAdd(chosen)}>Add {chosen.length || ""}</Button></>}>
      <div className="u3-bar"><SearchInput size="sm" value={q} onChange={setQ} placeholder="Name" style={{ width: 220 }} /><span style={{ flex: 1 }} /><Segmented label="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "photo", label: "Photos" }, { value: "canvas", label: "Canvases" }]} /></div>
      {!top.length ? <EmptyState icon="search" title="Nothing matches" /> : (
        <ul className="u3-picklist">
          {top.map((f) => {
            if (f.type === "collection") {
              const kids = files.filter((c) => c.parent === f.id && !c.binned), refs = kids.map((c) => ({ file: c.id })), on = open.includes(f.id), n = refs.filter(has).length;
              return [
                <li key={f.id} className="u3-pickrow u3-pickrow--coll" onClick={() => setOpen(on ? open.filter((x) => x !== f.id) : [...open, f.id])}>
                  <Icon name={on ? "chevron-down" : "chevron-right"} size={12} /><AppIcon glyph="layers" color={4} size={24} />
                  <span className="u3-pickrow__name">{f.name}<small>Collection · {kids.length} photos{n > 0 && ` · ${n} chosen`}</small></span>
                  <Button size="sm" variant="quiet" onClick={(e) => { e.stopPropagation(); toggle(refs); }}>{refs.every(has) ? "None" : "All of them"}</Button>
                </li>,
                ...(on ? kids.map((c) => row({ file: c.id }, c.name, "Photo", 1)) : []),
              ];
            }
            const frames = pictures && f.type === "canvas" ? docs[f.id]?.frames ?? [] : [];
            return [row({ file: f.id }, f.name, frames.length ? "Canvas · as a whole (its picture)" : TYPES[f.type].label, 0, frames.length ? { id: f.id, n: frames.length } : undefined), ...(open.includes(f.id) ? frames.map((fr) => row({ file: f.id, frame: fr.id }, `${f.name} · ${fr.name}`, "One frame of the canvas", 1)) : [])];
          })}
        </ul>
      )}
    </Dialog>
  );
}
