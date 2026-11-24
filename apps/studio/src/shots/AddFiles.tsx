// Picking files of the project for a content list or a progression (docs/features/shots.md). A collection is never
// referenced: it opens, and the photos chosen from it are added one by one. For a progression only pictures are
// offered, and a canvas with frames is added whole or through one of its frames.
import { useState } from "preact/hooks";
import { AppIcon, Button, Checkbox, Dialog, EmptyState, Icon, SearchInput, Segmented, cx } from "@openclapper/design";
import type { CanvasBody } from "@openclapper/model";
import type { FileRec } from "../api";
import { photosOf } from "../collections";
import { kindOf } from "../fileKinds";
import { Pic } from "./Pic";
import { see, type PicCtx, type PicRef } from "./picture";

const key = (r: PicRef) => `${r.to}|${r.frame ?? ""}`;
/** What is never offered: the project's settings, and what only exists for another file. */
const HIDDEN = new Set(["property", "naming", "preferences", "shortcut", "folder", "filter", "preset"]);

export function AddFiles({ title, pictures, files, ctx, self, onAdd, onClose }: { title: string; pictures: boolean; files: readonly FileRec[]; ctx: PicCtx; self: string; onAdd: (refs: PicRef[]) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState<string[]>([]);
  const [chosen, setChosen] = useState<PicRef[]>([]);
  const offered = (t: string) => (pictures ? t === "photo" || t === "canvas" || t === "collection" : !HIDDEN.has(t));
  const inColl = (f: FileRec) => !!f.container && ctx.files.get(f.container)?.type === "collection";
  const want = (f: FileRec) => !f.deleted_at && !f.internal_of && !f.fixed && f.id !== self && offered(f.type) && !inColl(f)
    && (kind === "all" || f.type === kind || (kind === "photo" && f.type === "collection")) && (!q || f.name.toLowerCase().includes(q.toLowerCase()));
  const top = files.filter(want).sort((a, b) => kindOf(a.type).label.localeCompare(kindOf(b.type).label) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const has = (r: PicRef) => chosen.some((c) => key(c) === key(r));
  const toggle = (rs: PicRef[]) => setChosen(rs.every(has) ? chosen.filter((c) => !rs.some((r) => key(r) === key(c))) : [...chosen, ...rs.filter((r) => !has(r))]);
  const twist = (id: string) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
  const row = (r: PicRef, label: string, meta: string, depth = 0, frames = 0) => (
    <li key={key(r)} className={cx("sh-pickrow", has(r) && "is-on")} style={{ paddingLeft: 8 + depth * 28 }} onClick={() => toggle([r])}>
      <Checkbox checked={has(r)} onChange={() => toggle([r])} aria-label={`Choose ${label}`} />
      <span className="sh-pickrow__art sh-box"><Pic seen={see(r, ctx)} /></span>
      <span className="sh-pickrow__name">{label}<small>{meta}</small></span>
      {frames > 0 && <Button size="sm" variant="quiet" iconAfter={open.includes(r.to) ? "chevron-up" : "chevron-down"} onClick={(e) => { e.stopPropagation(); twist(r.to); }}>{frames} frames</Button>}
    </li>
  );
  return (
    <Dialog fixed className="sh-pick" title={title} onClose={onClose}
      footer={<><span className="sh-hint">{pictures ? "Pictures only: photos, canvases, or one frame of a canvas." : "Any file of the project can be content. Nothing is copied: the list points at the files."}</span><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!chosen.length} onClick={() => onAdd(chosen)}>Add {chosen.length || ""}</Button></>}>
      <div className="sh-bar"><SearchInput size="sm" value={q} onChange={setQ} placeholder="Name" style={{ width: 220 }} /><span style={{ flex: 1 }} /><Segmented label="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "photo", label: "Photos" }, { value: "canvas", label: "Canvases" }]} /></div>
      {!top.length ? <EmptyState icon="search" title="Nothing matches" /> : (
        <ul className="sh-picklist">
          {top.flatMap((f) => {
            if (f.type === "collection") {
              const kids = photosOf(f, files), refs = kids.map((c) => ({ to: c.id })), on = open.includes(f.id), n = refs.filter(has).length;
              return [
                <li key={f.id} className="sh-pickrow sh-pickrow--coll" onClick={() => twist(f.id)}>
                  <Icon name={on ? "chevron-down" : "chevron-right"} size={12} /><AppIcon glyph="layers" color={4} size={24} />
                  <span className="sh-pickrow__name">{f.name}<small>Collection · {kids.length} photos{n > 0 && ` · ${n} chosen`}</small></span>
                  <Button size="sm" variant="quiet" disabled={!refs.length} onClick={(e) => { e.stopPropagation(); toggle(refs); }}>{refs.length && refs.every(has) ? "None" : "All of them"}</Button>
                </li>,
                ...(on ? kids.map((c) => row({ to: c.id }, c.name, "Photo", 1)) : []),
              ];
            }
            const frames = pictures && f.type === "canvas" ? ((f.body as unknown as CanvasBody | undefined)?.frames ?? []) : [];
            return [row({ to: f.id }, f.name, frames.length ? "Canvas · as a whole" : kindOf(f.type).label, 0, frames.length), ...(open.includes(f.id) ? frames.map((fr) => row({ to: f.id, frame: fr.id }, `${f.name} · ${fr.name}`, "One frame of the canvas", 1)) : [])];
          })}
        </ul>
      )}
    </Dialog>
  );
}
