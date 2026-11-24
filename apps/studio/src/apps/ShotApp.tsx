// The Shot, Set and Location apps (docs/features/shots.md, docs/rewrite/ux-3-shot.md): one window per file. A stage
// with the chosen picture, the file's properties beside it, and below the content list and, for a shot, its
// progression (a small timeline with timing, a default frame, an overlay and the zoom generator). A canvas is edited
// in place: the canvas tool takes the stage. What is made inside a shot is an internal file of it.
import "../shots/shots.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AppIcon, Badge, Banner, Button, Checkbox, Dock, DropdownMenu, EmptyState, Icon, NumberInput, PropertyList, PropertyRow, PropertySection, Segmented, Select, Slider, Spinner, StatusBar, TextInput, Toolbar, ToolbarSpacer,
  cx, dockCollapse, moved, useDockLayout, useSort, type DockLayout, type DockPanel,
} from "@openclapper/design";
import { DEFAULT_ITEM_MS, emptyCanvas, itemTimes, newProgression, type CanvasBody, type ItemData, type PresetBody } from "@openclapper/model";
import * as api from "../api";
import type { FileRec, FileUse } from "../api";
import { kindOf } from "../fileKinds";
import { duplicateFile, openFile } from "../fileOps";
import * as store from "../files";
import { confirm, toast, toastError } from "../hosts";
import { presetsIn } from "../optics";
import { usePeople } from "../people";
import { PhotoFactsSections } from "../photoParts";
import { definitionsIn } from "../props";
import { PropertySections } from "../propertyEditors";
import { useProjects } from "../projects";
import { useUser } from "../user";
import { useEditLock, type EditLock } from "../lock";
import { AddFiles } from "../shots/AddFiles";
import { itemKey, useDoc, type Doc, type Item } from "../shots/doc";
import { Generator, type Made } from "../shots/Generator";
import { Pic } from "../shots/Pic";
import { see, type Mode, type PicCtx, type PicRef, type Seen } from "../shots/picture";
import { DefaultFrame, clock } from "../shots/progressionParts";
import { Editing } from "./CanvasApp";
import type { AppProps } from "./registry";

const SCALE = 80; // px per second in the progression strip
const SOURCE = { own: "its own frame", default: "the default frame", picture: "the canvas's picture", none: "no frame" } as const;
type Pick = { list: "prog" | "content"; i: number };
const PANELS: DockLayout = { right: { tabs: ["props"] }, bottom: { dir: "col", kids: [{ tabs: ["prog"] }, { tabs: ["content"] }] } };
const PLACE_PANELS: DockLayout = { right: { tabs: ["props"] }, bottom: { tabs: ["content"] } };
/** Mounted in a timeline the room is smaller: the progression and the content share the lower place as tabs. */
const HOSTED_PANELS: DockLayout = { right: { tabs: ["props"] }, bottom: { tabs: ["prog", "content"] } };
const isPicture = (f: FileRec | undefined) => !!f && (f.type === "photo" || f.type === "canvas");

export function ShotApp({ win, resource, projectId, setTitle, setRoute, focused }: AppProps) {
  const id = resource?.id ?? "";
  const { files, bin } = store.useRoot({ project: projectId });
  const f = files?.find((x) => x.id === id);
  useEffect(() => { setTitle(f?.name ?? kindOf(resource?.type ?? "shot").label); setRoute(id); }, [f?.name, id]);
  void win;
  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  if (!f) return <div className="oc-app"><EmptyState icon={kindOf(resource?.type ?? "shot").glyph} title="This file is gone">It was deleted or moved to the recycle bin.</EmptyState></div>;
  return <ShotWindow key={f.id} f={f} files={files} bin={bin ?? []} projectId={projectId} active={focused} />;
}

/** The window of one shot, set or location; a timeline mounts it in place (`hosted`). */
export function ShotWindow({ f, files, bin, projectId, active, hosted }: { f: FileRec; files: FileRec[]; bin: FileRec[]; projectId: string; active: boolean; hosted?: boolean }) {
  const shot = f.type === "shot", kind = kindOf(f.type);
  const lockRef = useRef<EditLock | null>(null);
  const { doc, change, flush, reset } = useDoc(f, shot ? lockRef : undefined);
  const map = useMemo(() => new Map([...bin, ...files].map((x) => [x.id, x])), [files, bin]);
  const presetList = presetsIn(files);
  const ctx: PicCtx = { files: map, presets: new Map(presetList.map((p) => [p.id, p.body as PresetBody])) };
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  const nameOf = (u: string) => (u === me?.id ? "You" : people.get(u) ?? "Someone");
  // A shot is edited by one window at a time (one lock per file, whichever window edits it); others watch.
  const lock = useEditLock(f, nameOf, (x) => reset(x), () => void flush(), { off: !shot, realtime: project?.canvas_live === "realtime", onRemote: (d) => reset({ body: d.body, refs: d.refs as FileRec["refs"] }) });
  lockRef.current = lock;
  const readonly = shot && !lock.editing;
  const ro = readonly ? { inert: true, className: "sh-readonly" } : {};

  const [picked, setPick] = useState<Pick | null>(null);
  const [mode, setMode] = useState<Mode>("crop");
  const [tab, setTab] = useState("file");
  const [t, setT] = useState<number | null>(null);
  const [scrub, setScrub] = useState(0);
  const [adding, setAdding] = useState<"content" | "prog" | null>(null);
  const [gen, setGen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [lines, setLines] = useState("cards");
  const [name, setName] = useState(f.name);
  const [uses, setUses] = useState<FileUse[]>([]);
  useEffect(() => { setName(f.name); }, [f.name]);
  useEffect(() => { void api.fetchUses(f.id).then(setUses, () => setUses([])); }, [f.id, f.updated_at]);
  const [panels, setPanels, resetPanels] = useDockLayout(`place-${shot ? "shot" : "place"}${hosted ? "-hosted" : ""}`, hosted ? HOSTED_PANELS : shot ? PANELS : PLACE_PANELS);

  const prog = shot ? doc.progression : null;
  const items = prog ? doc.items : [];
  const times = prog ? itemTimes(prog.timing, items.map((i) => i.data)) : [];
  const total = times.reduce((a, b) => a + b, 0);
  const starts = times.map((_, i) => times.slice(0, i).reduce((a, b) => a + b, 0));
  const playing = t != null && prog ? Math.max(0, starts.findIndex((s, i) => t < s + times[i])) : null;
  const fallback: Pick | null = items.length ? { list: "prog", i: 0 } : doc.content.length ? { list: "content", i: 0 } : null;
  const sel: Pick | null = playing != null ? { list: "prog", i: playing } : picked && (picked.list === "prog" ? picked.i < items.length : picked.i < doc.content.length) ? picked : fallback;
  const item: Item | null = sel?.list === "prog" ? items[sel.i] : null;
  const ref: PicRef | null = !sel ? null : item ? { to: item.to, frame: item.data.frame, move: item.data.move } : { to: doc.content[sel.i] };
  const u = playing != null && t != null ? Math.min(1, (t - starts[playing]) / times[playing]) : scrub;
  const seen = ref ? see(ref, ctx, item ? prog!.frame : null, u) : null;
  const entry = seen?.file && !seen.missing ? seen.file : null;
  const overlayFile = prog && doc.overlay ? map.get(doc.overlay) : undefined;
  const overlaySrc = overlayFile && !overlayFile.deleted_at && overlayFile.updated_at !== overlayFile.created_at ? api.renderUrl(overlayFile, "render") : null;
  const over = item && prog?.overlayShown ? overlaySrc : null;
  const internal = files.filter((x) => x.internal_of === f.id);
  const coverRef: PicRef | null = items[0] ? { to: items[0].to, frame: items[0].data.frame } : (() => { const c = doc.content.find((x) => isPicture(map.get(x)) && !map.get(x)!.deleted_at); return c ? { to: c } : null; })();

  // Playback runs on the clock, so a smooth move takes the time it says.
  const on = t != null;
  useEffect(() => {
    if (!on) return;
    const t0 = performance.now() - (t ?? 0); let raf = 0;
    const tick = () => { const now = performance.now() - t0; if (now >= total) setT(null); else { setT(now); raf = requestAnimationFrame(tick); } };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, total]);

  const choose = (p: Pick) => { setT(null); setScrub(0); setPick(p); const id = p.list === "prog" ? items[p.i]?.to : doc.content[p.i]; if (editing) { if (map.get(id ?? "")?.type === "canvas") setEditing(id!); else done(); } };
  // The canvas tool needs the room: the lists fold away while it is mounted and can be pulled up again.
  const fold = (c: boolean) => setPanels(dockCollapse(dockCollapse(panels, "prog", c), "content", c));
  const edit = (id: string) => { setT(null); if (!editing) fold(true); setEditing(id); };
  const done = () => { if (editing) fold(false); setEditing(null); };
  const open = (x: FileRec) => openFile(x, map);
  const setItems = (next: Item[]) => change((d) => ({ ...d, items: next }));
  const setProg = (p: Partial<NonNullable<Doc["progression"]>>) => change((d) => ({ ...d, progression: { ...(d.progression ?? newProgression()), ...p } }));
  const patchItem = (key: string, data: Partial<ItemData>) => setItems(items.map((i) => (i.key === key ? { ...i, data: { ...i.data, ...data } } : i)));
  const toItem = (r: PicRef): Item => ({ key: itemKey(), to: r.to, data: { ms: DEFAULT_ITEM_MS, ...(r.frame ? { frame: r.frame } : {}), ...(r.move ? { move: r.move } : {}) } });

  /** An internal file no list of this shot points at any more goes to the bin. */
  const dropIfUnused = (id: string, d: Doc) => { const x = map.get(id); if (x?.internal_of === f.id && !d.content.includes(id) && !d.items.some((i) => i.to === id) && d.overlay !== id) void store.bin({ project: projectId }, [id]).catch(toastError); };
  const removeAt = (p: Pick) => {
    const next: Doc = p.list === "prog" ? { ...doc, items: items.filter((_, i) => i !== p.i) } : { ...doc, content: doc.content.filter((_, i) => i !== p.i) };
    const id = p.list === "prog" ? items[p.i].to : doc.content[p.i];
    change(next); setPick(null); dropIfUnused(id, next);
  };
  const addRefs = (refs: PicRef[]) => {
    if (adding === "content") {
      const ids = [...new Set(refs.map((r) => r.to))].filter((x) => !doc.content.includes(x));
      change({ ...doc, content: [...doc.content, ...ids] });
      toast(ids.length ? `${ids.length} added to the content` : "Already in the content", { tone: "info" });
    } else {
      change({ ...doc, progression: doc.progression ?? newProgression(), items: [...doc.items, ...refs.map(toItem)] });
      setPick({ list: "prog", i: items.length });
    }
    setAdding(null);
  };
  /** A new canvas made inside this file (blank, or on a photo), put into its content after `after`, and edited here. */
  const newCanvas = async (photo?: FileRec, afterIndex?: number) => {
    try {
      const id = crypto.randomUUID();
      const body = photo ? { ...emptyCanvas(), surface: { kind: "photo" } } : emptyCanvas();
      await api.createFile({ project: projectId }, id, { type: "canvas", internal_of: f.id, body, ...(photo ? { refs: [{ kind: "base", to: photo.id }] } : {}) });
      const at = afterIndex == null ? doc.content.length : afterIndex + 1;
      change({ ...doc, content: [...doc.content.slice(0, at), id, ...doc.content.slice(at)] });
      await store.loadRoot({ project: projectId });
      setPick({ list: "content", i: at }); edit(id);
    } catch (e) { toastError(e); }
  };
  const addOverlay = async () => {
    try {
      const id = crypto.randomUUID(), aspect = seen?.rect ? (seen.rect.w * seen.aspect) / seen.rect.h : seen?.aspect ?? 16 / 9;
      const body: CanvasBody = { ...emptyCanvas(Math.min(10, Math.max(0.1, aspect))), surface: { kind: "blank", aspect: Math.min(10, Math.max(0.1, aspect)), color: null } };
      await api.createFile({ project: projectId }, id, { type: "canvas", name: "Overlay", internal_of: f.id, body });
      change((d) => ({ ...d, overlay: id, progression: { ...(d.progression ?? newProgression()), overlayShown: true } }));
      await store.loadRoot({ project: projectId });
      edit(id);
    } catch (e) { toastError(e); }
  };
  const generate = async (m: Made) => {
    try {
      const id = crypto.randomUUID();
      const body: CanvasBody = { ...emptyCanvas(), surface: { kind: "photo" }, frames: m.frames, picture: m.frames[0]?.id ?? null };
      await api.createFile({ project: projectId }, id, { type: "canvas", name: m.name, internal_of: f.id, body, refs: [{ kind: "base", to: m.photo }] });
      const made = m.items.map((it): Item => ({ key: itemKey(), to: id, data: it }));
      change((d) => ({ ...d, progression: m.add && d.progression ? d.progression : { ...(d.progression ?? newProgression()), timing: { mode: "each" } }, items: m.add ? [...d.items, ...made] : made }));
      await store.loadRoot({ project: projectId });
      setPick({ list: "prog", i: m.add ? items.length : 0 }); setGen(false);
      toast(m.items[0]?.move ? `One moving picture from one internal canvas, “${m.name}”` : `${made.length} pictures from one internal canvas, “${m.name}”`, { tone: "info" });
    } catch (e) { toastError(e); }
  };
  const release = async (x: FileRec) => {
    if (!(await confirm({ title: `Make “${x.name}” a project file?`, message: `It appears in the file browser and in search, and other files can use it. ${f.name} keeps pointing at it. This cannot be turned back.`, confirmLabel: "Make it a project file" }))) return;
    try { await api.releaseFile(x.id); await store.loadRoot({ project: projectId }); toast(`“${x.name}” is now a file of the project`, { tone: "info" }); } catch (e) { toastError(e); }
  };
  const binIt = async () => {
    if (!(await confirm({ danger: true, title: `Move “${f.name}” to the recycle bin?`, confirmLabel: "Move to the bin", message: internal.length ? `Its ${internal.length} internal files (${internal.map((x) => x.name).join(", ")}) go with it. The files in its content stay where they are.` : "The files in its content stay where they are." }))) return;
    await flush();
    try { await store.bin({ project: projectId }, [f.id]); } catch (e) { toastError(e); }
  };
  const commitName = () => { const to = name.trim(); if (!to || to === f.name) { setName(f.name); return; } void store.rename(f, to).catch((e) => { toastError(e); setName(f.name); }); };
  const stretch = (i: number) => (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, orig = items[i].data.ms, key = items[i].key;
    const move = (m: PointerEvent) => change((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, data: { ...it.data, ms: Math.min(600_000, Math.max(100, Math.round((orig + ((m.clientX - sx) / SCALE) * 1000) / 100) * 100)) } } : it)) }));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const sortC = useSort("x", (a, b) => { change({ ...doc, content: moved(doc.content, a, b) }); setPick({ list: "content", i: b }); });
  const sortL = useSort("y", (a, b) => { change({ ...doc, content: moved(doc.content, a, b) }); setPick({ list: "content", i: b }); });
  const sortP = useSort("x", (a, b) => { setItems(moved(items, a, b)); setPick({ list: "prog", i: b }); });

  // ---------- The stage ----------
  const editFile = editing ? map.get(editing) : undefined;
  const stage = !sel || !seen ? (
    <EmptyState icon={kind.glyph} title={shot ? "A shot with a name only" : `Nothing gathered for this ${kind.label.toLowerCase()} yet`}
      action={<span className="sh-bar"><Button icon="plus" onClick={() => setAdding("content")}>Add files</Button><Button icon="brush" onClick={() => void newCanvas()}>Draw a canvas</Button></span>}>
      {shot ? "It exists on its own. Add photos or canvases when there is a picture for it." : "Add photos, floor plans and other files that belong to it."}
    </EmptyState>
  ) : seen.missing ? (
    <EmptyState icon="warning" title={seen.file ? `“${seen.file.name}” is in the recycle bin` : "This file no longer exists"}
      action={<span className="sh-bar">{seen.file && <Button icon="history" onClick={() => void store.restore({ project: projectId }, [seen.file!.id]).then(() => toast(`Restored “${seen.file!.name}”, also everywhere else it was used`, { tone: "info" }), toastError)}>Restore it</Button>}<Button variant="quiet" icon="close" onClick={() => removeAt(sel)}>Remove the entry</Button></span>}>
      The entry stays in its place until the file is restored or the entry is removed.
    </EmptyState>
  ) : (
    <>
      <div className="sh-box" onDblClick={() => entry && (entry.type === "canvas" ? edit(entry.id) : open(entry))}>{isPicture(entry ?? undefined) ? <Pic seen={seen} mode={mode} overlay={over} label /> : <Pic seen={seen} />}</div>
      <span className="sh-caption"><AppIcon glyph={kindOf(entry!.type).glyph} color={kindOf(entry!.type).color} size={20} />{entry!.name}{seen.name && <> · {seen.name} <small>({SOURCE[seen.source]})</small></>}{entry!.internal_of && <Badge icon="lock">internal</Badge>}</span>
      <span className="sh-stageacts">
        <Button size="sm" variant="quiet" icon="external" title={`Open in the ${kindOf(entry!.type).label} app, in a window of its own`} onClick={() => open(entry!)}>Open</Button>
        {entry!.type === "canvas" ? <Button size="sm" icon="edit" title="Edit in this window: the canvas tool takes the place of the stage" onClick={() => edit(entry!.id)}>Edit here</Button>
          : entry!.type === "photo" && !readonly && <Button size="sm" icon="brush" title="A canvas on this photo, made inside this file: draw on it, give it a look, frame it" onClick={() => void newCanvas(entry!, sel.list === "content" ? sel.i : undefined)}>Draw or frame</Button>}
      </span>
    </>
  );

  // ---------- Side panel: the file of this window ----------
  const defs = definitionsIn(files);
  const pointsHere = (type: string) => files.filter((x) => x.type === type && !x.internal_of && defs.some((d) => d.def.field === "reference" && (d.def.targets ?? []).includes(f.type) && d.def.attached.some((a) => a.type === type) && ((v) => (Array.isArray(v) ? v : [v]).includes(f.id))(x.values?.[d.id])));
  const role = (x: FileRec) => (doc.overlay === x.id ? "The progression's overlay" : [items.some((i) => i.to === x.id) && ((n) => `${n} ${n === 1 ? "picture" : "pictures"} of the progression`)(items.filter((i) => i.to === x.id).length), doc.content.includes(x.id) && "in the content"].filter(Boolean).join(", ") || "Not used any more");
  const usedBy = uses.filter((x) => x.id !== f.id);
  const fileTab = (
    <>
      <header className="sh-head">
        <span className="sh-head__art sh-box">{coverRef ? <Pic seen={see(coverRef, ctx, items[0] ? prog!.frame : null)} /> : <AppIcon glyph={kind.glyph} color={kind.color} size={48} />}</span>
        <TextInput size="sm" value={name} aria-label="Name" maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(f.name); e.currentTarget.blur(); } }} />
        <span className="sh-head__type"><AppIcon glyph={kind.glyph} color={kind.color} size={20} />{kind.label}<small>{coverRef ? (items[0] ? " · thumbnail: the progression's first picture" : " · thumbnail: the content's first picture") : ""}</small></span>
      </header>
      <PropertyList key={f.id}>
        <PropertySections projectId={projectId} targets={[f]} defs={defs} files={files} />
        {f.type === "set" && <PropertySection title={`Shots that play here · ${pointsHere("shot").length}`} icon="slate">{pointsHere("shot").length ? <div className="sh-chips">{pointsHere("shot").map((x) => <Chip key={x.id} f={x} onOpen={open} />)}</div> : <p className="sh-note">No shot names this set yet. A shot's Set property points here.</p>}</PropertySection>}
        {f.type === "location" && <PropertySection title={`Sets filmed here · ${pointsHere("set").length}`} icon="home">{pointsHere("set").length ? <div className="sh-chips">{pointsHere("set").map((x) => <Chip key={x.id} f={x} onOpen={open} />)}</div> : <p className="sh-note">No set names this location yet. A set's Locations property points here.</p>}</PropertySection>}
        {internal.length > 0 && (
          <PropertySection title={`Internal files · ${internal.length}`} icon="lock">
            <ul className="sh-internal">{internal.map((x) => (
              <li key={x.id}><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={20} /><span className="sh-internal__name">{x.name}<small>{role(x)}</small></span>
                {x.type === "canvas" && <Button size="sm" variant="quiet" icon="edit" label={`Edit ${x.name} here`} onClick={() => edit(x.id)} />}
                {!readonly && <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "release", label: "Make it a project file…", icon: "external" }, { id: "delete", label: "Delete", icon: "trash", danger: true, disabled: role(x) !== "Not used any more" }]}
                  onSelect={(a) => (a === "release" ? void release(x) : void store.bin({ project: projectId }, [x.id]).catch(toastError))} />}
              </li>
            ))}</ul>
            <p className="sh-note">Made inside this {kind.label.toLowerCase()}. Not in the file browser or in search; copied and deleted with it.</p>
          </PropertySection>
        )}
        {usedBy.length > 0 && <PropertySection title={`Used in · ${usedBy.length}`} icon="link" defaultOpen={false}><div className="sh-chips">{usedBy.map((x) => { const r = map.get(x.id); return r ? <Chip key={x.id + x.kind} f={r} onOpen={open} /> : null; })}</div></PropertySection>}
        <PropertySection title="System" icon="info" defaultOpen={false}><PropertyRow label="Created" value={new Date(f.created_at).toLocaleString()} /><PropertyRow label="Created by" value={f.created_by ? nameOf(f.created_by) : "–"} />{f.updated_at && <PropertyRow label="Changed" value={new Date(f.updated_at).toLocaleString()} />}</PropertySection>
      </PropertyList>
    </>
  );

  // ---------- Side panel: the chosen entry, its app's inspector mounted here ----------
  const frames = entry?.type === "canvas" ? ((entry.body as unknown as CanvasBody | undefined)?.frames ?? []) : [];
  const entryTab = !entry ? <EmptyState icon="info" title="Nothing chosen">Click a picture in the content or the progression.</EmptyState> : (
    <>
      <header className="sh-head">
        <span className="sh-head__art sh-box"><Pic seen={seen!} overlay={over} /></span>
        <strong>{entry.name}</strong>
        <span className="sh-head__type"><AppIcon glyph={kindOf(entry.type).glyph} color={kindOf(entry.type).color} size={20} />{kindOf(entry.type).label}<span style={{ flex: 1 }} /><Button size="sm" variant="quiet" icon="external" onClick={() => open(entry)}>Open</Button>{entry.type === "canvas" && <Button size="sm" icon="edit" onClick={() => edit(entry.id)}>Edit here</Button>}</span>
      </header>
      {entry.internal_of === f.id && <Banner tone="info" icon="lock" action={<Button size="sm" variant="quiet" onClick={() => void release(entry)}>Make it a project file</Button>}>An internal file of this {kind.label.toLowerCase()}.</Banner>}
      <PropertyList key={entry.id + (item ? item.key : "c")}>
        {item && prog && (
          <div {...ro}><PropertySection title="In the progression" icon="timeline">
            <PropertyRow label="Holds">{prog.timing.mode === "each" ? <NumberInput size="sm" value={item.data.ms / 1000} unit="s" min={0.1} max={600} step={0.1} onChange={(v) => patchItem(item.key, { ms: Math.min(600_000, Math.max(100, Math.round(v * 10) * 100)) })} /> : <span className="oc-num">{clock(times[sel!.i])} of {clock(total)}</span>}</PropertyRow>
            {item.data.move && <PropertyRow label="Moves"><Checkbox checked={item.data.move.ease} onChange={(c) => patchItem(item.key, { move: { ...item.data.move!, ease: c } })}>Ease in and out</Checkbox></PropertyRow>}
            {item.data.move && <PropertyRow label="Look through"><span className="sh-bar" style={{ flex: 1 }}><Slider min={0} max={100} value={Math.round(u * 100)} onChange={(v) => { setT(null); setScrub(v / 100); }} /><b className="oc-num">{seen!.name}</b></span></PropertyRow>}
            {!item.data.move && frames.length > 0 && <PropertyRow label="Shows"><Select size="sm" value={item.data.frame ?? ""} onChange={(v) => patchItem(item.key, { frame: v || undefined })} options={[{ value: "", label: "The canvas as a whole" }, ...frames.map((x) => ({ value: x.id, label: `Frame ${x.name}` }))]} /></PropertyRow>}
            <PropertyRow label="Seen through" value={seen!.source === "none" ? (seen!.optics ? "No frame" : "No frame: it has no angle of view") : SOURCE[seen!.source]} />
          </PropertySection></div>
        )}
        {entry.type === "photo" && <PhotoFactsSections f={entry} map={map} />}
        <PropertySections projectId={projectId} targets={[entry]} defs={defs} files={files} />
      </PropertyList>
    </>
  );

  // ---------- The progression ----------
  const progActions = shot && (prog ? (
    <div className="sh-row" {...ro}>
      <span className="sh-count oc-num">{items.length} {items.length === 1 ? "picture" : "pictures"} · {clock(total)}</span>
      <Button size="sm" variant="quiet" icon={t != null ? "pause" : "play"} label={t != null ? "Pause" : "Play the progression"} disabled={!items.length} onClick={() => setT(t != null ? null : 0)} />
      <Select size="sm" value={prog.timing.mode} onChange={(v) => setProg({ timing: v === "each" ? { mode: "each" } : { mode: v as "even" | "ends", total: Math.max(100, Math.round(total / 100) * 100 || 4000) } })}
        options={[{ value: "each", label: "Each picture its own time" }, { value: "even", label: "One length, split evenly" }, { value: "ends", label: "One length, first and last longer" }]} />
      {prog.timing.mode !== "each" && <NumberInput size="sm" value={prog.timing.total / 1000} unit="s" min={0.1} max={3600} step={0.5} style={{ width: 92 }} aria-label="Total length" onChange={(v) => setProg({ timing: { mode: (prog.timing as { mode: "even" | "ends" }).mode, total: Math.min(3_600_000, Math.max(100, Math.round(v * 10) * 100)) } })} />}
      <span className="sh-sep" />
      <DefaultFrame value={prog.frame} presets={presetList} onChange={(fr) => setProg({ frame: fr })} />
      {doc.overlay ? <span className="sh-bar"><Checkbox checked={prog.overlayShown} onChange={(c) => setProg({ overlayShown: c })}>Overlay</Checkbox><Button size="sm" variant="quiet" icon="edit" label="Edit the overlay here" onClick={() => edit(doc.overlay!)} /></span>
        : <Button size="sm" variant="quiet" icon="brush" title="One drawing shown over every picture" onClick={() => void addOverlay()}>Add an overlay</Button>}
      <span style={{ flex: 1 }} />
      <Button size="sm" variant="quiet" icon="frame" onClick={() => setGen(true)}>Generate…</Button>
      <Button size="sm" icon="plus" onClick={() => setAdding("prog")}>Add pictures</Button>
      <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "content", label: "Put its files into the content too", icon: "files" }, { id: "remove", label: "Remove the progression", icon: "trash", danger: true }]}
        onSelect={(x) => {
          if (x === "content") { change({ ...doc, content: [...new Set([...doc.content, ...items.map((i) => i.to)])] }); return; }
          const next: Doc = { ...doc, progression: null, items: [], overlay: null };
          change(next); setPick(null); setT(null);
          for (const id of new Set([...items.map((i) => i.to), ...(doc.overlay ? [doc.overlay] : [])])) dropIfUnused(id, next);
        }} />
    </div>
  ) : (
    <div className="sh-row" {...ro}>
      <span className="sh-count">None: the shot stands as one picture.</span><span style={{ flex: 1 }} />
      <Button size="sm" variant="quiet" icon="frame" onClick={() => setGen(true)}>Generate a zoom…</Button>
      <Button size="sm" icon="plus" onClick={() => setAdding("prog")}>From pictures…</Button>
    </div>
  ));
  const progBody = shot && prog && (items.length ? (
    <div className="sh-strip sh-strip--prog">
      {items.map((it, i) => {
        const on2 = playing === i || (playing == null && sel?.list === "prog" && sel.i === i);
        const s = see({ to: it.to, frame: it.data.frame, move: it.data.move }, ctx, prog.frame, on2 ? u : 0);
        return (
          <div key={it.key} data-sort role="button" tabIndex={0} className={cx("sh-item", sel?.list === "prog" && sel.i === i && "is-current", s.missing && "is-missing", it.data.move && "is-move")} style={{ width: Math.max(44, (times[i] / 1000) * SCALE), ...sortP.style(i) }}
            title={`${s.file?.name ?? "Missing"}${s.name ? ` · ${s.name}` : ""}`} onPointerDown={readonly ? undefined : sortP.start(i)} onClick={() => choose({ list: "prog", i })} onDblClick={() => s.file?.type === "canvas" && edit(s.file.id)}>
            <span className="sh-item__art sh-box"><Pic seen={s} overlay={prog.overlayShown ? overlaySrc : null} /></span>
            <span className="sh-item__label"><b>{s.source === "own" && s.name ? s.name : s.file?.name ?? "Missing"}</b><i className="oc-num">{clock(times[i])}</i></span>
            {i === 0 && <span className="sh-item__flag" title="The shot's thumbnail"><Icon name="star" size={10} /></span>}
            {it.data.move && <span className="sh-item__move" title="A smooth move from one frame to another"><Icon name="arrow-right" size={10} />smooth</span>}
            {!readonly && <button type="button" data-nodrag className="sh-item__x" aria-label="Remove from the progression" onClick={(e) => { e.stopPropagation(); removeAt({ list: "prog", i }); }}><Icon name="close" size={10} /></button>}
            {prog.timing.mode === "each" && !readonly && <i data-nodrag className="sh-item__grip" title="Drag to change how long it holds" onPointerDown={stretch(i)} />}
            {t != null && t >= starts[i] && t < starts[i] + times[i] && <i className="sh-playhead" style={{ left: `${((t - starts[i]) / times[i]) * 100}%` }} />}
          </div>
        );
      })}
      {sortP.ghost((i) => <div className="sh-item is-current" style={{ width: "100%" }}><span className="sh-item__art sh-box"><Pic seen={see({ to: items[i].to, frame: items[i].data.frame }, ctx, prog.frame)} /></span></div>)}
    </div>
  ) : <p className="sh-note">An empty progression. Add pictures, or generate a zoom from one photo.</p>);

  // ---------- The content ----------
  const menuOf = (id: string, i: number) => {
    const s = see({ to: id }, ctx), x = s.file;
    return (
      readonly ? null : <DropdownMenu size="sm" variant="quiet" icon="more" align="end" className="sh-tile__menu" items={s.missing ? [{ id: "remove", label: "Remove the entry", icon: "close" }] : [
        ...(x!.type === "canvas" ? [{ id: "edit", label: "Edit here", icon: "edit" as const }] : []),
        { id: "open", label: `Open in the ${kindOf(x!.type).label} app`, icon: "external" as const },
        ...(x!.type === "photo" ? [{ id: "draw", label: "Draw or frame", icon: "brush" as const }] : []),
        ...(shot && isPicture(x) ? [{ id: "prog", label: "Add to the progression", icon: "timeline" as const }] : []),
        ...(x!.internal_of === f.id ? [{ id: "release", label: "Make it a project file…", icon: "unlock" as const }] : []),
        { separator: true as const },
        { id: "remove", label: x!.internal_of === f.id ? "Remove and delete" : "Remove from the content", icon: "close" as const, danger: x!.internal_of === f.id },
      ]} onSelect={(a) => {
        if (a === "edit") { choose({ list: "content", i }); edit(id); }
        else if (a === "open") open(x!);
        else if (a === "draw") void newCanvas(x!, i);
        else if (a === "release") void release(x!);
        else if (a === "prog") { change({ ...doc, progression: doc.progression ?? newProgression(), items: [...doc.items, toItem({ to: id })] }); toast(`“${x!.name}” added to the progression`, { tone: "info" }); }
        else removeAt({ list: "content", i });
      }} />
    );
  };
  const openEntry = (id: string) => { const x = map.get(id); if (x && !x.deleted_at) { if (x.type === "canvas") edit(id); else open(x); } };
  const missingName = (s: Seen) => (s.file ? `${s.file.name} · in the bin` : "Missing file");
  const contentActions = (
    <div className="sh-row" {...ro}>
      <span className="sh-count oc-num">{doc.content.length} {doc.content.length === 1 ? "file" : "files"}</span>
      <span style={{ flex: 1 }} />
      <Segmented label="Content as" value={lines} onChange={setLines} options={[{ value: "cards", icon: "grid", title: "Cards" }, { value: "list", icon: "list", title: "Rows" }]} />
      <Button size="sm" variant="quiet" icon="brush" title={`A new canvas, made inside this ${kind.label.toLowerCase()}`} onClick={() => void newCanvas()}>New canvas</Button>
      <Button size="sm" icon="plus" onClick={() => setAdding("content")}>Add files</Button>
    </div>
  );
  const contentBody = !doc.content.length ? <p className="sh-note">Nothing yet. Any file of the project can be content: photos, canvases, later documents and flows.</p> : lines === "list" ? (
    <ul className="sh-lines">
      {doc.content.map((id, i) => {
        const s = see({ to: id }, ctx), x = s.file;
        return (
          <li key={id} data-sort role="button" tabIndex={0} className={cx("sh-line", sel?.list === "content" && sel.i === i && "is-current", s.missing && "is-missing")} style={sortL.style(i)} onPointerDown={readonly ? undefined : sortL.start(i)} onClick={() => choose({ list: "content", i })} onDblClick={() => openEntry(id)}>
            <Icon name="grip" size={12} /><span className="sh-line__art sh-box"><Pic seen={s} /></span>
            <span className="sh-line__name">{s.missing ? missingName(s) : x!.name}</span>
            <span className="sh-line__type">{x && !s.missing && <><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={20} />{kindOf(x.type).label}{x.internal_of && <Badge icon="lock">internal</Badge>}</>}</span>
            {menuOf(id, i)}
          </li>
        );
      })}
      {sortL.ghost((i) => <div className="sh-line is-current"><Icon name="grip" size={12} /><span className="sh-line__art sh-box"><Pic seen={see({ to: doc.content[i] }, ctx)} /></span><span className="sh-line__name">{map.get(doc.content[i])?.name}</span></div>)}
    </ul>
  ) : (
    <div className="sh-strip">
      {doc.content.map((id, i) => {
        const s = see({ to: id }, ctx), x = s.file;
        return (
          <div key={id} data-sort role="button" tabIndex={0} className={cx("sh-tile", sel?.list === "content" && sel.i === i && "is-current", s.missing && "is-missing")} style={sortC.style(i)} onPointerDown={readonly ? undefined : sortC.start(i)} onClick={() => choose({ list: "content", i })} onDblClick={() => openEntry(id)}>
            <span className="sh-tile__art sh-box"><Pic seen={s} />{x && !s.missing && x.type !== "photo" && <span className="sh-tile__type"><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={20} /></span>}{x?.internal_of && <span className="sh-tile__lock" title="An internal file"><Icon name="lock" size={10} /></span>}</span>
            <span className="sh-tile__name">{s.missing ? missingName(s) : x!.name}</span>
            {menuOf(id, i)}
          </div>
        );
      })}
      {sortC.ghost((i) => <div className="sh-tile is-current"><span className="sh-tile__art sh-box"><Pic seen={see({ to: doc.content[i] }, ctx)} /></span><span className="sh-tile__name">{map.get(doc.content[i])?.name}</span></div>)}
    </div>
  );

  const dockPanels: DockPanel[] = [
    { id: "props", title: "Properties", icon: "info", body: <div className="sh-side"><div className="sh-tabs"><Segmented label="Side panel" value={entry ? tab : "file"} onChange={setTab} options={[{ value: "file", label: kind.label, icon: kind.glyph }, ...(entry ? [{ value: "entry", label: entry.name, icon: kindOf(entry.type).glyph }] : [])]} /></div>{tab === "entry" && entry ? entryTab : fileTab}</div> },
    ...(shot ? [{ id: "prog", title: "Progression", icon: "timeline" as const, actions: progActions, body: progBody || null }] : []),
    { id: "content", title: "Content", icon: "files", actions: contentActions, body: contentBody },
  ];

  return (
    <div className="oc-app">
      <Toolbar>
        <AppIcon glyph={kind.glyph} color={kind.color} size={24} /><strong className="st-title">{f.name}</strong>
        {shot && (lock.editing
          ? <Button size="sm" variant="quiet" icon="eye" title="Save, let the shot go and keep watching it: someone else can edit it now" onClick={() => void lock.stop(flush)}>Stop editing</Button>
          : <span className="sh-viewing"><Icon name="eye" size={14} /><span>{lock.by === "You" ? "Editing in another window of yours" : lock.by ? `${lock.by} is editing` : "Nobody is editing"}</span><Button size="sm" variant="primary" icon="edit" disabled={!!lock.by} onClick={() => void lock.edit()}>Edit</Button></span>)}
        <ToolbarSpacer />
        {!editing && <Segmented label="View mode" value={mode} disabled={!seen?.rect} onChange={(v) => setMode(v as Mode)} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} />}
        <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "panels", label: "Panels back to their places", icon: "refresh" }, { separator: true }, { id: "dup", label: "Duplicate", icon: "copy" }, { id: "bin", label: "Move to the recycle bin…", icon: "trash", danger: true }]}
          onSelect={(x) => (x === "panels" ? resetPanels() : x === "bin" ? void binIt() : void flush().then(() => duplicateFile(f)))} />
      </Toolbar>
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zones={editing ? ["bottom"] : undefined} zoneSizes={{ left: 320, right: hosted ? 300 : 340, bottom: hosted ? 200 : shot ? 420 : 220 }}>
        {editing && editFile ? (
          <div className="sh-edit">
            <div className="sh-host">
              <Button size="sm" icon="arrow-left" onClick={done}>Back to {f.name}</Button>
              <span className="sh-host__crumb"><AppIcon glyph={kind.glyph} color={kind.color} size={20} />{f.name}<Icon name="chevron-right" size={12} /><AppIcon glyph="brush" color={7} size={20} /><strong>{editFile.name}</strong></span>
              <span className="sh-host__note">{editFile.internal_of === f.id ? <><Icon name="lock" size={12} /> Internal file of this {kind.label.toLowerCase()}</> : <><Icon name="link" size={12} /> A project file: changes show everywhere it is used</>}</span>
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="primary" icon="check" onClick={done}>Done</Button>
            </div>
            <Editing key={editFile.id} file={editFile} files={files} projectId={projectId} active={active} hosted live={project?.canvas_live}
              me={{ id: me?.id ?? "", name: me?.name ?? me?.email ?? "You" }} nameOf={nameOf} />
          </div>
        ) : <div className={cx("sh-stage", (!sel || seen?.missing) && "is-empty")}>{stage}</div>}
      </Dock>
      <StatusBar>{doc.content.length} in the content{prog && <> · progression of {items.length} {items.length === 1 ? "picture" : "pictures"}, {clock(total)}</>}{internal.length > 0 && <> · {internal.length} internal files</>}{t != null && <> · playing <strong className="oc-num">{clock(t)}</strong></>}{editing && <> · editing <strong>{editFile?.name}</strong> in place</>}{readonly && <> · read-only{lock.live ? ", live" : ", read again every 5 s"}</>}</StatusBar>
      {adding && <AddFiles title={adding === "prog" ? "Add pictures to the progression" : `Add files to the content of ${f.name}`} pictures={adding === "prog"} files={files} ctx={ctx} self={f.id} onAdd={addRefs} onClose={() => setAdding(null)} />}
      {gen && <Generator files={files} presets={presetList} ctx={ctx} start={entry?.type === "photo" ? entry.id : undefined} has={items.length > 0} onMake={(m) => void generate(m)} onClose={() => setGen(false)} />}
    </div>
  );
}

/** A file as a chip that opens it. */
function Chip({ f, onOpen }: { f: FileRec; onOpen: (f: FileRec) => void }) {
  const k = kindOf(f.type);
  return <button type="button" className="st-tag" title={`Open ${f.name}`} onClick={() => onOpen(f)}><AppIcon glyph={k.glyph} color={k.color} size={16} />{f.name}</button>;
}
