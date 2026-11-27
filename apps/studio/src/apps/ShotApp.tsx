// The Shot, Set and Location apps (docs/features/shots.md, docs/rewrite/ux-3-shot.md): one window per file. A stage
// with the picture at the progression's playhead (or a content entry looked at), the file's properties beside it,
// and below the progression editor (shots only: one of the shot's progressions as a small timeline) and the content
// list. A canvas is edited in place: the canvas tool takes the stage. What is made inside a shot is an internal file
// of it; a progression is one too (#426 feedback 4), and the canvases made for it (its zooms, its overlay) are its own.
import { takenFrame } from "../canvas/geometry";
import { getPrefs } from "../prefs";
import "../shots/shots.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AppIcon, Badge, Banner, Button, Checkbox, Dock, DropdownMenu, EmptyState, Icon, NumberInput, PropertyList, PropertyRow, PropertySection, Segmented, Select, Slider, Spinner, StatusBar, TextInput, Toolbar, ToolbarSpacer,
  cx, dockCollapse, moved, useDockLayout, useSort, type DockLayout, type DockPanel, type SortOut,
} from "@openclapper/design";
import { DEFAULT_ITEM_MS, ITEM_MS, emptyCanvas, itemUnits, newProgression, type CanvasBody, type ItemData, type PresetBody, type Progression } from "@openclapper/model";
import * as api from "../api";
import type { FileRec, FileUse } from "../api";
import { kindOf } from "../fileKinds";
import { duplicateFile, openFile } from "../fileOps";
import * as store from "../files";
import { confirm, contextMenu, prompt, toast, toastError, type MenuEntry } from "../hosts";
import { presetsIn } from "../optics";
import { usePeople } from "../people";
import { PhotoFactsSections } from "../photoParts";
import { addStarter, definitionsIn } from "../props";
import { PropertySections } from "../propertyEditors";
import { useProjects } from "../projects";
import { useUser } from "../user";
import { useEditLock, type EditLock } from "../lock";
import { AddFiles } from "../shots/AddFiles";
import { progChange, useDoc, useProgDoc, type Item, type ProgDoc } from "../shots/doc";
import { coverOf, frameIdsOf, pictureOf, progressionsOf, timesOf } from "../shots/progression";
import { Generator, type Made } from "../shots/Generator";
import { Pic } from "../shots/Pic";
import { see, type Mode, type PicCtx, type PicRef } from "../shots/picture";
import { itemFor, itemKind, itemKindLabel, useProgressionEditor } from "../shots/ProgressionEditor";
import { clock } from "../shots/progressionParts";
import { Editing } from "./CanvasApp";
import { StartScreen } from "./StartScreen";
import type { AppProps } from "./registry";

const SOURCE = { own: "its own frame", default: "the default frame", picture: "the canvas's picture", none: "no frame" } as const;
const PANELS: DockLayout = { right: { tabs: ["props"] }, bottom: { dir: "col", kids: [{ tabs: ["prog"] }, { tabs: ["content"] }] } };
const PLACE_PANELS: DockLayout = { right: { tabs: ["props"] }, bottom: { tabs: ["content"] } };
/** Mounted in a timeline the room is smaller: the progression and the content share the lower place as tabs. */
const HOSTED_PANELS: DockLayout = { right: { tabs: ["props"] }, bottom: { tabs: ["prog", "content"] } };
const isPicture = (f: FileRec | undefined) => !!f && (f.type === "photo" || f.type === "canvas");
const COVER_TYPES = new Set(["photo", "canvas", "progression"]);
const EMPTY: ProgDoc = { body: newProgression(), items: [], overlay: null };

/** A shot, set or location (by the window's app); opened without one, the start screen of that type (#426). */
export function ShotApp(p: AppProps) {
  return p.resource ? <ShotView {...p} /> : <StartScreen winId={p.win.id} projectId={p.projectId} type={p.win.app} setTitle={p.setTitle} setRoute={p.setRoute} />;
}

function ShotView({ win, resource, projectId, setTitle, setRoute, focused }: AppProps) {
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
  const { doc, change, flush: flushDoc, reset } = useDoc(f, shot ? lockRef : undefined);
  const map = useMemo(() => new Map([...bin, ...files].map((x) => [x.id, x])), [files, bin]);
  const contentRefs = doc.content.map((to) => ({ kind: "content", to, data: null }));
  // The shot's progressions: files inside it that its content lists (#426 feedback 4); one at a time in the panel.
  const progs = shot ? progressionsOf({ refs: contentRefs }, map) : [];
  const [activeId, setActive] = useState<string | null>(null);
  const progFile = progs.find((x) => x.id === activeId) ?? progs[0];
  const pd = useProgDoc(progFile, lockRef);
  const flush = async () => { await flushDoc(); await pd.flush(); };
  const presetList = presetsIn(files);
  const ctx: PicCtx = { files: map, presets: new Map(presetList.map((p) => [p.id, p.body as PresetBody])) };
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  const nameOf = (u: string) => (u === me?.id ? "You" : people.get(u) ?? "Someone");
  // A shot is edited by one window at a time (one lock per file, whichever window edits it); others watch.
  const lock = useEditLock(f, nameOf, (x) => { reset(x); void store.loadRoot({ project: projectId }); }, () => void flush(), { off: !shot, realtime: project?.canvas_live === "realtime", onRemote: (d) => reset({ body: d.body, refs: d.refs as FileRec["refs"] }) });
  lockRef.current = lock;
  const readonly = shot && !lock.editing;
  const ro = readonly ? { inert: true, className: "sh-readonly" } : {};

  const [mode, setMode] = useState<Mode>("crop");
  const [tab, setTab] = useState("file");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  /** A content entry looked at on the stage instead of the playhead's picture. */
  const [preview, setPreview] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ to: "content" } | { to: "prog"; gap: number } | null>(null);
  const [gen, setGen] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [lines, setLines] = useState("cards");
  const [name, setName] = useState(f.name);
  const [uses, setUses] = useState<FileUse[]>([]);
  useEffect(() => { setName(f.name); }, [f.name]);
  useEffect(() => { void api.fetchUses(f.id).then(setUses, () => setUses([])); }, [f.id, f.updated_at]);
  const [panels, setPanels, resetPanels] = useDockLayout(`place-${shot ? "shot" : "place"}${hosted ? "-hosted" : ""}`, hosted ? HOSTED_PANELS : shot ? PANELS : PLACE_PANELS);

  const pdoc: ProgDoc | null = shot && progFile && pd.doc ? pd.doc : null;
  const prog: Progression | null = pdoc?.body ?? null;
  const items = pdoc?.items ?? [];
  const times = prog ? timesOf(prog, items, map) : [];
  const total = times.reduce((a, b) => a + b, 0);
  const starts = times.map((_, i) => times.slice(0, i).reduce((a, b) => a + b, 0));
  const tt = Math.min(t, total);
  const atI = items.length ? Math.max(0, starts.findIndex((s, i) => tt < s + times[i] || i === items.length - 1)) : -1;
  const atU = atI >= 0 && times[atI] ? Math.min(1, (tt - starts[atI]) / times[atI]) : 0;

  // ---------- Undo for the progression (Ctrl+Z), one history per progression ----------
  const hist = useRef<{ id: string | null; past: ProgDoc[]; future: ProgDoc[]; merge: string | null }>({ id: null, past: [], future: [], merge: null });
  if (hist.current.id !== (progFile?.id ?? null)) hist.current = { id: progFile?.id ?? null, past: [], future: [], merge: null };
  const [, bump] = useState(0);
  const editProg = (fn: (d: ProgDoc) => ProgDoc, merge?: string) => {
    if (!pdoc || readonly) return;
    const h = hist.current;
    if (!merge || merge !== h.merge) { h.past.push(pdoc); if (h.past.length > 100) h.past.shift(); }
    h.merge = merge ?? null; h.future = [];
    pd.change(fn); bump((n) => n + 1);
  };
  const jump = (from: "past" | "future") => {
    const h = hist.current, d = h[from].pop();
    if (!d || !pdoc || readonly) return;
    h[from === "past" ? "future" : "past"].push(pdoc); h.merge = null;
    pd.change(() => d); setSel([]); bump((n) => n + 1);
  };

  // Playback runs on the clock from the playhead, so a smooth move takes the time it says.
  const totalRef = useRef(total);
  totalRef.current = total;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      setT((x) => { const n = x + dt; if (n >= totalRef.current) { setPlaying(false); return totalRef.current; } return n; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const seek = (ms: number) => { setPreview(null); setT(Math.max(0, Math.min(ms, total))); };
  const togglePlay = () => { if (!items.length) return; setPreview(null); if (!playing && tt >= total - 1) setT(0); setPlaying(!playing); };
  const pickProgression = (id: string) => { setActive(id); setSel([]); setT(0); setPlaying(false); setPreview(null); };

  // ---------- What the stage shows ----------
  /** What a content entry shows: a progression its first picture. */
  const entryRef = (id: string): { ref: PicRef; def: Progression["frame"] } => {
    const x = map.get(id);
    if (x?.type !== "progression") return { ref: { to: id }, def: null };
    const c = coverOf({ type: "shot", refs: [{ kind: "content", to: id, data: null }] }, map);
    return c ? { ref: c.ref, def: c.def } : { ref: { to: id }, def: null };
  };
  const previewing = preview != null && doc.content.includes(preview) ? preview : null;
  const fromProg = !previewing && atI >= 0;
  const item: Item | null = fromProg ? items[atI] : null;
  const pic = item ? pictureOf(item, map, atU) : null;
  const shown = previewing ? entryRef(previewing) : pic ? { ref: pic.ref, def: prog!.frame } : doc.content.length && !pdoc ? entryRef(doc.content[0]) : null;
  const seen = shown ? see(shown.ref, ctx, shown.def, pic?.u ?? 0) : null;
  const entry = seen?.file && !seen.missing ? seen.file : null;
  const overlayFile = prog && pdoc?.overlay ? map.get(pdoc.overlay) : undefined;
  const overlaySrc = overlayFile && !overlayFile.deleted_at && overlayFile.updated_at !== overlayFile.created_at ? api.renderUrl(overlayFile, "render") : null;
  const over = item && prog?.overlayShown ? overlaySrc : null;
  const internal = files.filter((x) => x.internal_of === f.id);
  const cover = coverOf({ type: f.type, refs: contentRefs }, map);
  const thumbAt = doc.content.findIndex((id) => { const x = map.get(id); return !!x && !x.deleted_at && COVER_TYPES.has(x.type); });
  const isThumb = !!progFile && doc.content[thumbAt] === progFile.id;

  // The canvas tool needs the room: the lists fold away while it is mounted and can be pulled up again.
  const fold = (c: boolean) => setPanels(dockCollapse(dockCollapse(panels, "prog", c), "content", c));
  const edit = (id: string) => { setPlaying(false); if (!editing) fold(true); setEditing(id); };
  const done = () => { if (editing) fold(false); setEditing(null); };
  const open = (x: FileRec) => openFile(x, map);
  const patchItem = (key: string, data: Partial<ItemData>) => editProg((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, data: { ...i.data, ...data } } : i)) }));

  /** Whether anything of this shot still points at a file: its content, or an item or the overlay of one of its progressions. */
  const usedHere = (id: string, content: readonly string[]) => content.includes(id)
    || progs.some((p) => (p.id === progFile?.id && pdoc ? [...pdoc.items.map((i) => i.to), ...(pdoc.overlay ? [pdoc.overlay] : [])] : (p.refs ?? []).map((r) => r.to)).includes(id));
  /** Moves a file to the top of the content (adding it when it is not listed): the shot's thumbnail now. */
  const toTop = (id: string) => {
    change((x) => ({ content: [id, ...x.content.filter((c) => c !== id)] }));
    toast(`“${map.get(id)?.name ?? "It"}” is the shot's thumbnail now${map.get(id)?.type === "progression" ? ": its first picture" : ""}`, { tone: "info" });
  };
  const removeEntry = (i: number) => {
    const id = doc.content[i], x = map.get(id), content = doc.content.filter((_, j) => j !== i);
    // A progression lives only inside this shot: it goes with its entry, after asking.
    if (x?.type === "progression" && !x.deleted_at) { void removeProgression(x); return; }
    change({ content }); setPreview(null);
    if (x && x.internal_of === f.id && !usedHere(id, content)) void store.bin({ project: projectId }, [id]).catch(toastError);
  };
  /** A new progression inside this shot, at the end of its content, with what it starts with; it opens in the panel. */
  const newProgressionFile = async (start: Partial<ProgDoc> = {}, named?: string) => {
    const id = crypto.randomUUID();
    let n = progs.length + 1;
    while (progs.some((p) => p.name === `Progression ${n}`)) n++;
    const d: ProgDoc = { ...EMPTY, ...start };
    await api.putFileLocked(id, { type: "progression", project_id: projectId, internal_of: f.id, name: named ?? `Progression ${n}`, ...progChange(d) }, lock.holder);
    change((x) => ({ content: [...x.content, id] }));
    await store.loadRoot({ project: projectId });
    pickProgression(id);
    return id;
  };
  /** Files (or one frame of a canvas) as new items at `gap`; without a progression they start one. */
  const insertFiles = (refs: { to: string; frame?: string }[], gap: number) => {
    const made = refs.map((r) => itemFor(r, DEFAULT_ITEM_MS));
    if (pdoc) editor.insertItems(made, gap);
    else void newProgressionFile({ items: made }).catch(toastError);
  };
  const addRefs = (refs: PicRef[]) => {
    if (adding?.to === "content") {
      const ids = [...new Set(refs.map((r) => r.to))].filter((x) => !doc.content.includes(x));
      change({ content: [...doc.content, ...ids] });
      toast(ids.length ? `${ids.length} added to the content` : "Already in the content", { tone: "info" });
    } else if (adding) insertFiles(refs, adding.gap);
    setAdding(null);
  };
  /** A new canvas made inside this file (blank, or on a photo), put into its content after `after`, and edited here. */
  const newCanvas = async (photo?: FileRec, afterIndex?: number) => {
    try {
      const id = crypto.randomUUID();
      const body = photo ? { ...emptyCanvas(), surface: { kind: "photo" }, ...takenFrame(photo, new Set([...files].filter((x) => x.type === "preset" && !x.deleted_at).map((x) => x.id)), getPrefs().canvasTakesFrame) } : emptyCanvas();
      await api.createFile({ project: projectId }, id, { type: "canvas", internal_of: f.id, body, ...(photo ? { refs: [{ kind: "base", to: photo.id }] } : {}) });
      const at = afterIndex == null ? doc.content.length : afterIndex + 1;
      change({ content: [...doc.content.slice(0, at), id, ...doc.content.slice(at)] });
      await store.loadRoot({ project: projectId });
      setPreview(id); edit(id);
    } catch (e) { toastError(e); }
  };
  const addOverlay = async () => {
    if (!progFile) return;
    try {
      const id = crypto.randomUUID(), aspect = seen?.rect ? (seen.rect.w * seen.aspect) / seen.rect.h : seen?.aspect ?? 16 / 9;
      const body: CanvasBody = { ...emptyCanvas(Math.min(10, Math.max(0.1, aspect))), surface: { kind: "blank", aspect: Math.min(10, Math.max(0.1, aspect)), color: null } };
      await api.createFile({ project: projectId }, id, { type: "canvas", name: "Overlay", internal_of: progFile.id, body });
      editProg((d) => ({ ...d, overlay: id, body: { ...d.body, overlayShown: true } }));
      await store.loadRoot({ project: projectId });
      edit(id);
    } catch (e) { toastError(e); }
  };
  /** The generator's zoom: one canvas inside the progression and one zoom block, inserted at `gen`. */
  const generate = async (m: Made) => {
    const gap = gen ?? items.length;
    setGen(null);
    try {
      const pid = progFile?.id ?? await newProgressionFile();
      const id = crypto.randomUUID();
      const body: CanvasBody = { ...emptyCanvas(), surface: { kind: "photo" }, frames: m.frames, picture: m.frames[0]?.id ?? null };
      await api.createFile({ project: projectId }, id, { type: "canvas", name: m.name, internal_of: pid, body, refs: [{ kind: "base", to: m.photo }] });
      await store.loadRoot({ project: projectId });
      const made: Item = { key: `z${id}`, to: id, data: m.item };
      if (pdoc && progFile?.id === pid) editor.insertItems([made], Math.min(gap, items.length));
      else await api.putFileLocked(pid, progChange({ ...EMPTY, items: [made] }), lock.holder).then(() => store.loadRoot({ project: projectId }));
      toast(`A zoom from one internal canvas, “${m.name}”${doc.content.includes(m.photo) ? "" : `; ${map.get(m.photo)?.name ?? "its photo"} counts as content of this shot through it`}`, { tone: "info" });
    } catch (e) { toastError(e); }
  };
  const removeProgression = async (p: FileRec) => {
    if (!(await confirm({ danger: true, title: `Delete “${p.name}”?`, confirmLabel: "Delete", message: `Its zooms and its overlay go with it. Photos and canvases it shows stay in the project.${doc.content[thumbAt] === p.id ? " It is the shot's thumbnail: the next entry takes over." : ""}` }))) return;
    await pd.flush();
    change((x) => ({ content: x.content.filter((c) => c !== p.id) }));
    setActive(null); setSel([]); setT(0); setPlaying(false);
    try { await store.bin({ project: projectId }, [p.id]); toast(`“${p.name}” deleted`, { tone: "info" }); } catch (e) { toastError(e); }
  };
  const renameProgression = async (p: FileRec) => {
    const to = await prompt({ title: "Rename the progression", label: "Name", value: p.name, confirmLabel: "Rename", check: (v) => (!v.trim() ? "Type a name" : null) });
    if (!to || to.trim() === p.name) return;
    try { await api.putFileLocked(p.id, { name: to.trim() }, lock.holder); await store.loadRoot({ project: projectId }); } catch (e) { toastError(e); }
  };
  const duplicateProgression = async (p: FileRec) => {
    try {
      await pd.flush();
      const id = crypto.randomUUID();
      await api.duplicateFile(p.id, { id, name: `${p.name} (copy)` });
      change((x) => ({ content: [...x.content, id] }));
      await store.loadRoot({ project: projectId });
      pickProgression(id);
      toast(`“${p.name} (copy)” added to the end of the content`, { tone: "info" });
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

  // ---------- The progression editor ----------
  const editor = useProgressionEditor({
    file: progFile ?? f, doc: pdoc ?? EMPTY, progs, files: map, ctx, presets: presetList, readonly,
    keys: active && shot && !hosted && !!pdoc && !editing && !adding && gen == null,
    overlaySrc, overlayEditing: !!pdoc?.overlay && editing === pdoc.overlay,
    times, starts, total, t: tt, seek, playing, togglePlay, sel, setSel: (k) => { setSel(k); if (k.length) { setPreview(null); setTab("entry"); } },
    edit: editProg, undo: () => jump("past"), redo: () => jump("future"), canUndo: hist.current.past.length > 0, canRedo: hist.current.future.length > 0,
    isThumb, useAsThumb: () => progFile && toTop(progFile.id),
    pick: pickProgression, addNew: () => void newProgressionFile().catch(toastError),
    rename: () => progFile && void renameProgression(progFile), duplicate: () => progFile && void duplicateProgression(progFile), remove: () => progFile && void removeProgression(progFile),
    generate: (gap) => setGen(gap), addPictures: (gap) => setAdding({ to: "prog", gap }),
    addOverlay: () => void addOverlay(), editOverlay: () => pdoc?.overlay && (editing === pdoc.overlay ? done() : edit(pdoc.overlay)),
    editCanvas: edit, thumbFile: toTop, insertFiles,
  });
  // A content card dragged out of its list onto the track becomes an item there (or starts a progression).
  const noProg = useRef<HTMLDivElement>(null);
  const overNoProg = (e: PointerEvent) => { const r = noProg.current?.getBoundingClientRect(); return !!r && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom; };
  const toTrack: SortOut | undefined = shot && !readonly ? {
    over: (from, e) => { if (!isPicture(map.get(doc.content[from]))) return false; if (!pdoc) return overNoProg(e); const g = editor.gapAt(e.clientX, e.clientY); editor.setInsert(g); return g != null; },
    drop: (from, e) => {
      const id = doc.content[from];
      if (!isPicture(map.get(id))) return false;
      if (!pdoc) { if (!overNoProg(e)) return false; insertFiles([{ to: id }], 0); return true; }
      const g = editor.gapAt(e.clientX, e.clientY); editor.setInsert(null);
      if (g == null) return false;
      insertFiles([{ to: id }], g); return true;
    },
  } : undefined;
  const sortC = useSort("x", (a, b) => change({ content: moved(doc.content, a, b) }), toTrack);
  const sortL = useSort("y", (a, b) => change({ content: moved(doc.content, a, b) }), toTrack);

  // ---------- The stage ----------
  const editFile = editing ? map.get(editing) : undefined;
  const stage = !seen ? (
    pdoc ? <EmptyState icon="slideshow" title={`${progFile!.name} is empty`}>Drag photos or canvases onto its track, or generate a zoom.</EmptyState>
    : <EmptyState icon={kind.glyph} title={shot ? "A shot with a name only" : `Nothing gathered for this ${kind.label.toLowerCase()} yet`}
      action={<span className="sh-bar"><Button icon="plus" onClick={() => setAdding({ to: "content" })}>Add files</Button><Button icon="brush" onClick={() => void newCanvas()}>Draw a canvas</Button></span>}>
      {shot ? "It exists on its own. Add photos or canvases when there is a picture for it." : "Add photos, floor plans and other files that belong to it."}
    </EmptyState>
  ) : seen.missing ? (
    <EmptyState icon="warning" title={seen.file ? `“${seen.file.name}” is in the recycle bin` : "This file no longer exists"}
      action={<span className="sh-bar">{seen.file && <Button icon="history" onClick={() => void store.restore({ project: projectId }, [seen.file!.id]).then(() => toast(`Restored “${seen.file!.name}”, also everywhere else it was used`, { tone: "info" }), toastError)}>Restore it</Button>}
        {previewing && <Button variant="quiet" icon="close" onClick={() => removeEntry(doc.content.indexOf(previewing))}>Remove the entry</Button>}</span>}>
      {previewing ? "The entry stays in its place until the file is restored or the entry is removed." : "The item stays in its place until the file is restored or the item is deleted."}
    </EmptyState>
  ) : (
    <>
      <div className="sh-box" onDblClick={() => entry && (entry.type === "canvas" ? edit(entry.id) : open(entry))}>{isPicture(entry ?? undefined) ? <Pic seen={seen} mode={mode} overlay={over} label /> : <Pic seen={seen} />}</div>
      <span className="sh-caption">
        {fromProg && <><span className="sh-rec" />{progFile!.name} · <span className="oc-num">{clock(tt)}</span> ·</>}
        <AppIcon glyph={kindOf(entry!.type).glyph} color={kindOf(entry!.type).color} size={20} />{entry!.name}{seen.name && <> · {seen.name} <small>({SOURCE[seen.source]})</small></>}{entry!.internal_of && <Badge icon="lock">internal</Badge>}
      </span>
      <span className="sh-stageacts">
        {previewing && pdoc && <Button size="sm" icon="slideshow" title="Show the picture at the progression's playhead again" onClick={() => setPreview(null)}>Back to the playhead</Button>}
        <Button size="sm" variant="quiet" icon="external" title={`Open in the ${kindOf(entry!.type).label} app, in a window of its own`} onClick={() => open(entry!)}>Open</Button>
        {entry!.type === "canvas" ? <Button size="sm" icon="edit" title="Edit in this window: the canvas tool takes the place of the stage" onClick={() => edit(entry!.id)}>Edit here</Button>
          : entry!.type === "photo" && !readonly && <Button size="sm" icon="brush" title="A canvas on this photo, made inside this file: draw on it, give it a look, frame it" onClick={() => void newCanvas(entry!, previewing ? doc.content.indexOf(previewing) : undefined)}>Draw or frame</Button>}
      </span>
    </>
  );

  // ---------- Side panel: the file of this window ----------
  const defs = definitionsIn(files);
  // Who points here: a reference property of the other type that targets this one. A project starts without one (#426), so the section offers to add it.
  const pointers = (type: string) => defs.filter((d) => d.def.field === "reference" && (d.def.targets ?? []).includes(f.type) && d.def.attached.some((a) => a.type === type));
  const pointsHere = (type: string) => files.filter((x) => x.type === type && !x.internal_of && pointers(type).some((d) => ((v) => (Array.isArray(v) ? v : [v]).includes(f.id))(x.values?.[d.id])));
  const offer = (which: "set" | "locations", label: string) => (
    <p className="sh-note">No {which === "set" ? "shot" : "set"} property points at {which === "set" ? "sets" : "locations"} yet.{" "}<Button size="sm" icon="plus" onClick={() => void addStarter(projectId, files, which).catch(toastError)}>Add a {label} property</Button></p>
  );
  const role = (x: FileRec) => {
    if (x.type === "progression") return doc.content.includes(x.id) ? "A progression, in the content" : "A progression, not in the content";
    const inProgs = progs.filter((p) => (p.refs ?? []).some((r) => r.to === x.id)).map((p) => p.name);
    return [inProgs.length && `in ${inProgs.join(", ")}`, doc.content.includes(x.id) && "in the content"].filter(Boolean).join(", ") || "Not used any more";
  };
  const usedBy = uses.filter((x) => x.id !== f.id);
  const fileTab = (
    <>
      <header className="sh-head">
        <span className="sh-head__art sh-box">{cover ? <Pic seen={see(cover.ref, ctx, cover.def)} /> : <AppIcon glyph={kind.glyph} color={kind.color} size={48} />}</span>
        <TextInput size="sm" value={name} aria-label="Name" maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(f.name); e.currentTarget.blur(); } }} />
        <span className="sh-head__type"><AppIcon glyph={kind.glyph} color={kind.color} size={20} />{kind.label}<small>{cover ? (cover.progression ? ` · thumbnail: the first picture of ${map.get(cover.progression)?.name ?? "its progression"} (the first entry of the content)` : " · thumbnail: the first entry of the content") : thumbAt >= 0 ? " · thumbnail: an empty progression, a placeholder" : ""}</small></span>
      </header>
      <PropertyList key={f.id}>
        <PropertySections projectId={projectId} targets={[f]} defs={defs} files={files} />
        {f.type === "set" && <PropertySection title={`Shots that play here · ${pointsHere("shot").length}`} icon="slate">{pointsHere("shot").length ? <div className="sh-chips">{pointsHere("shot").map((x) => <Chip key={x.id} f={x} onOpen={open} />)}</div> : !pointers("shot").length ? offer("set", "Set") : <p className="sh-note">No shot names this set yet. A shot's {pointers("shot").map((d) => d.name).join(" or ")} property points here.</p>}</PropertySection>}
        {f.type === "location" && <PropertySection title={`Sets filmed here · ${pointsHere("set").length}`} icon="home">{pointsHere("set").length ? <div className="sh-chips">{pointsHere("set").map((x) => <Chip key={x.id} f={x} onOpen={open} />)}</div> : !pointers("set").length ? offer("locations", "Locations") : <p className="sh-note">No set names this location yet. A set's {pointers("set").map((d) => d.name).join(" or ")} property points here.</p>}</PropertySection>}
        {internal.length > 0 && (
          <PropertySection title={`Internal files · ${internal.length}`} icon="lock">
            <ul className="sh-internal">{internal.map((x) => (
              <li key={x.id}><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={20} /><span className="sh-internal__name">{x.name}<small>{role(x)}</small></span>
                {x.type === "canvas" && <Button size="sm" variant="quiet" icon="edit" label={`Edit ${x.name} here`} onClick={() => edit(x.id)} />}
                {x.type === "progression" && <Button size="sm" variant="quiet" icon="slideshow" label={`Open ${x.name} in the panel`} onClick={() => pickProgression(x.id)} />}
                {!readonly && x.type !== "progression" && <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "release", label: "Make it a project file…", icon: "external" }, { id: "delete", label: "Delete", icon: "trash", danger: true, disabled: role(x) !== "Not used any more" }]}
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

  // ---------- Side panel: the chosen items, or the entry looked at ----------
  const chosen = items.filter((i) => sel.includes(i.key));
  const focusItem = !previewing ? (chosen.length === 1 ? chosen[0] : !chosen.length ? item : null) : null;
  const fi = focusItem ? items.indexOf(focusItem) : -1;
  const focusPic = focusItem ? (focusItem === item ? pic! : pictureOf(focusItem, map, 0)) : null;
  const focusSeen = focusItem && focusPic ? see(focusPic.ref, ctx, prog!.frame, focusPic.u) : null;
  const tabFile = previewing ? entry : focusSeen?.file && !focusSeen.missing ? focusSeen.file : null;
  const canvasFrames = (x: FileRec | null | undefined) => (x?.type === "canvas" ? ((x.body as unknown as CanvasBody | undefined)?.frames ?? []) : []);
  const itemSection = (it: Item, i: number) => {
    const k = itemKind(it, map), n = itemUnits(it.data, frameIdsOf(map, it.to).length), frames = canvasFrames(map.get(it.to));
    const each = prog!.timing.mode === "each";
    const base = map.get(map.get(it.to)?.refs?.find((r) => r.kind === "base")?.to ?? "");
    return (
      <div {...ro}><PropertySection title={`In ${progFile!.name}`} icon="slideshow">
        <PropertyRow label="Kind" value={itemKindLabel(k)} />
        <PropertyRow label="Starts at"><span className="oc-num">{clock(starts[i])}</span></PropertyRow>
        <PropertyRow label={n > 1 ? "Each step holds" : "Holds"}>{each
          ? <span className="sh-bar"><NumberInput size="sm" value={it.data.ms / n / 1000} unit="s" min={0.1} max={600 / n} step={0.1} onChange={(v) => patchItem(it.key, { ms: Math.min(Math.floor(ITEM_MS.max / n / 100) * 100, Math.max(100, Math.round(v * 10) * 100)) * n })} />{n > 1 && <small className="oc-num">{clock(it.data.ms)} in all</small>}</span>
          : <span className="oc-num">{clock(times[i])} of {clock(total)}</span>}</PropertyRow>
        {k === "zoom" && <PropertyRow label="Zoom" value={it.data.zoom!.mode === "steps" ? `In steps: ${frames.map((x) => x.name).join(", ")}` : `Smooth, ${frames[0]?.name ?? "?"} → ${frames[frames.length - 1]?.name ?? "?"}${it.data.zoom!.ease ? ", eased" : ""}`} />}
        {k === "zoom" && base && <PropertyRow label="Made from" value={base.name} />}
        {it.data.move && <PropertyRow label="Moves"><Checkbox checked={it.data.move.ease} onChange={(c) => patchItem(it.key, { move: { ...it.data.move!, ease: c } })}>Ease in and out</Checkbox></PropertyRow>}
        {(it.data.move || it.data.zoom?.mode === "smooth") && <PropertyRow label="Look through"><span className="sh-bar" style={{ flex: 1 }}><Slider min={0} max={100} value={Math.round((i === atI ? atU : 0) * 100)} onChange={(v) => { setPlaying(false); seek(starts[i] + (v / 100) * times[i] * 0.999); }} /><b className="oc-num">{focusSeen?.name}</b></span></PropertyRow>}
        {k !== "zoom" && !it.data.move && frames.length > 0 && <PropertyRow label="Shows"><Select size="sm" value={it.data.frame ?? ""} onChange={(v) => patchItem(it.key, { frame: v || undefined })} options={[{ value: "", label: "The canvas as a whole" }, ...frames.map((x) => ({ value: x.id, label: `Frame ${x.name}` }))]} /></PropertyRow>}
        <PropertyRow label="Seen through" value={!focusSeen ? "–" : focusSeen.source === "none" ? (focusSeen.optics ? "No frame" : "No frame: it has no angle of view") : SOURCE[focusSeen.source]} />
        <PropertyRow label="In the shot" value={doc.content.includes(it.to) ? "An entry of the content" : `Counts as content through ${progs.filter((p) => (p.id === progFile!.id ? items.some((x) => x.to === it.to) : (p.refs ?? []).some((r) => r.to === it.to))).map((p) => p.name).join(", ")}`} />
      </PropertySection></div>
    );
  };
  const entryTab = chosen.length > 1 && !previewing ? (
    <>
      <header className="sh-head"><strong>{chosen.length} items chosen</strong><span className="sh-head__type">Together <span className="oc-num">{clock(chosen.reduce((a, it) => a + (times[items.indexOf(it)] ?? 0), 0))}</span> in {progFile?.name}</span></header>
      <div className="sh-row" {...ro}><Button size="sm" icon="trash" variant="quiet" onClick={() => { editProg((d) => ({ ...d, items: d.items.filter((x) => !sel.includes(x.key)) })); setSel([]); }}>Delete them</Button></div>
      <p className="sh-note">Drag them along the track to move them together; Ctrl+D duplicates, Delete removes them from the progression. The files stay in the project.</p>
    </>
  ) : !tabFile ? <EmptyState icon="info" title="Nothing chosen">Click an item of the progression or an entry of the content.</EmptyState> : (
    <>
      <header className="sh-head">
        <span className="sh-head__art sh-box"><Pic seen={(focusSeen ?? seen)!} overlay={focusItem && prog?.overlayShown ? overlaySrc : null} /></span>
        <strong>{tabFile.name}</strong>
        <span className="sh-head__type"><AppIcon glyph={kindOf(tabFile.type).glyph} color={kindOf(tabFile.type).color} size={20} />{kindOf(tabFile.type).label}<span style={{ flex: 1 }} /><Button size="sm" variant="quiet" icon="external" onClick={() => open(tabFile)}>Open</Button>{tabFile.type === "canvas" && <Button size="sm" icon="edit" onClick={() => edit(tabFile.id)}>Edit here</Button>}</span>
      </header>
      {tabFile.internal_of && <Banner tone="info" icon="lock" action={tabFile.internal_of === f.id ? <Button size="sm" variant="quiet" onClick={() => void release(tabFile)}>Make it a project file</Button> : undefined}>An internal file of {tabFile.internal_of === f.id ? `this ${kind.label.toLowerCase()}` : map.get(tabFile.internal_of)?.name ?? "this shot"}.</Banner>}
      <PropertyList key={tabFile.id + (focusItem ? focusItem.key : "c")}>
        {focusItem && prog && itemSection(focusItem, fi)}
        {tabFile.type === "photo" && <PhotoFactsSections f={tabFile} map={map} />}
        <PropertySections projectId={projectId} targets={[tabFile]} defs={defs} files={files} />
      </PropertyList>
    </>
  );
  const entryLabel = chosen.length > 1 && !previewing ? `${chosen.length} items` : tabFile?.name;

  // ---------- The progression panel ----------
  const progBody = shot && (pdoc ? editor.body : (
    <div ref={noProg} className="sh-noprog" {...ro}>
      <p className="sh-note">This shot has no progression. Drop a photo or canvas of the content here to start one, or:</p>
      <span className="sh-bar"><Button size="sm" icon="plus" onClick={() => void newProgressionFile().catch(toastError)}>New progression</Button><Button size="sm" variant="quiet" icon="frame" onClick={() => setGen(0)}>Generate a zoom…</Button></span>
    </div>
  ));

  // ---------- The content ----------
  /** A content entry: the picture standing for it (a progression's first picture) and its own file. */
  const entryOf = (id: string) => {
    const own = map.get(id), r = entryRef(id), s = see(r.ref, ctx, r.def);
    return own?.type === "progression" ? { s, x: own as FileRec | undefined, missing: !!own.deleted_at } : { s, x: s.file, missing: !!s.missing };
  };
  const insertHere = (id: string) => insertFiles([{ to: id }], pdoc ? editor.playheadGap() : 0);
  const menuItems = (id: string, i: number) => {
    const { x, missing } = entryOf(id), first = i === thumbAt;
    const thumb = { id: "thumb", label: first ? "Is the thumbnail" : "Use as thumbnail", icon: "image" as const, disabled: first || readonly || missing };
    if (missing || !x) return [{ id: "remove", label: "Remove the entry", icon: "close" as const }];
    if (x.type === "progression") return [thumb, { id: "show", label: "Open in the progression panel", icon: "slideshow" as const }, { id: "rename", label: "Rename…", icon: "edit" as const }, { id: "dup", label: "Duplicate", icon: "copy" as const }, { separator: true as const }, { id: "remove", label: "Delete…", icon: "trash" as const, danger: true }];
    return [
      thumb,
      ...(x.type === "canvas" ? [{ id: "edit", label: "Edit here", icon: "edit" as const }] : []),
      { id: "open", label: `Open in the ${kindOf(x.type).label} app`, icon: "external" as const },
      ...(x.type === "photo" ? [{ id: "draw", label: "Draw or frame", icon: "brush" as const }] : []),
      ...(shot && isPicture(x) ? [{ id: "prog", label: pdoc ? `Insert into ${progFile!.name} at the playhead` : "Start a progression with it", icon: "slideshow" as const }] : []),
      ...(x.internal_of === f.id ? [{ id: "release", label: "Make it a project file…", icon: "unlock" as const }] : []),
      { separator: true as const },
      { id: "remove", label: x.internal_of === f.id && !usedHere(id, doc.content.filter((c) => c !== id)) ? "Remove and delete" : "Remove from the content", icon: "close" as const, danger: x.internal_of === f.id },
    ];
  };
  const runMenu = (id: string, i: number) => (a: string) => {
    const x = map.get(id);
    if (a === "thumb") toTop(id);
    else if (a === "show") pickProgression(id);
    else if (a === "rename" && x) void renameProgression(x);
    else if (a === "dup" && x) void duplicateProgression(x);
    else if (a === "edit") { setPreview(id); edit(id); }
    else if (a === "open" && x) open(x);
    else if (a === "draw" && x) void newCanvas(x, i);
    else if (a === "release" && x) void release(x);
    else if (a === "prog") insertHere(id);
    else if (a === "remove") removeEntry(i);
  };
  const menuOf = (id: string, i: number) => readonly ? null : <DropdownMenu size="sm" variant="quiet" icon="more" align="end" className="sh-tile__menu" items={menuItems(id, i)} onSelect={runMenu(id, i)} />;
  const rightMenu = (id: string, i: number) => (e: MouseEvent) => {
    if (readonly) return;
    e.preventDefault();
    contextMenu(e, menuItems(id, i).map((m): MenuEntry => ("id" in m && m.id ? { ...m, run: () => runMenu(id, i)(m.id) } : { separator: true })));
  };
  const clickEntry = (id: string) => {
    setPlaying(false);
    const x = map.get(id);
    if (x?.type === "progression" && !x.deleted_at) { pickProgression(id); return; }
    setPreview(id); setSel([]); setTab("entry");
    if (editing) { if (x?.type === "canvas") setEditing(id); else done(); }
  };
  const openEntry = (id: string) => { const x = map.get(id); if (x && !x.deleted_at) { if (x.type === "progression") pickProgression(id); else if (x.type === "canvas") edit(id); else open(x); } };
  const missingName = (x?: FileRec) => (x ? `${x.name} · in the bin` : "Missing file");
  const metaOf = (x: FileRec | undefined) => {
    if (!x) return "";
    if (x.type === "progression") { const p = x.id === progFile?.id ? pdoc : null, its = p?.items ?? (x.refs ?? []).filter((r) => r.kind === "item"), ms = x.id === progFile?.id ? total : timesOf({ ...newProgression(), ...(x.body as Partial<Progression>) }, (x.refs ?? []).filter((r) => r.kind === "item").map((r) => ({ to: r.to, data: r.data as unknown as ItemData })), map).reduce((a, b) => a + b, 0); return `${its.length} items · ${clock(ms)}`; }
    const ps = progs.filter((p) => (p.id === progFile?.id && pdoc ? pdoc.items.some((it) => it.to === x.id) : (p.refs ?? []).some((r) => r.to === x.id))).map((p) => p.name);
    return `${kindOf(x.type).label}${x.internal_of ? " · internal" : ""}${ps.length ? ` · in ${ps.join(", ")}` : ""}`;
  };
  // Files the progressions show that the list does not hold: they count as the shot's content all the same.
  const through = shot ? [...new Set(progs.flatMap((p) => (p.id === progFile?.id && pdoc ? pdoc.items.map((i) => i.to) : (p.refs ?? []).filter((r) => r.kind === "item").map((r) => r.to))))].filter((id) => !doc.content.includes(id) && map.get(id) && !map.get(id)!.deleted_at) : [];
  const contentActions = (
    <div className="sh-row" {...ro}>
      <span className="sh-count oc-num">{doc.content.length} {doc.content.length === 1 ? "entry" : "entries"}{through.length ? ` · ${through.length} more through progressions` : ""}</span>
      <span style={{ flex: 1 }} />
      <Segmented label="Content as" value={lines} onChange={setLines} options={[{ value: "cards", icon: "grid", title: "Cards" }, { value: "list", icon: "list", title: "Rows" }]} />
      {shot && <Button size="sm" variant="quiet" icon="slideshow" title="A new progression, made inside this shot" onClick={() => void newProgressionFile().catch(toastError)}>Progression</Button>}
      <Button size="sm" variant="quiet" icon="brush" title={`A new canvas, made inside this ${kind.label.toLowerCase()}`} onClick={() => void newCanvas()}>New canvas</Button>
      <Button size="sm" icon="plus" onClick={() => setAdding({ to: "content" })}>Add files</Button>
    </div>
  );
  const throughList = through.length > 0 && (
    <details className="sh-through"><summary>{through.length} {through.length === 1 ? "file counts" : "files count"} as content through a progression without being listed</summary>
      <div className="sh-chips">{through.map((id) => { const x = map.get(id)!; return <button key={id} type="button" className="st-tag" title="Click to look at it; the menu lists it in the content" onClick={() => { setPreview(null); setPlaying(false); const i = items.findIndex((it) => it.to === id); if (i >= 0) { seek(starts[i]); setSel([items[i].key]); } }}
        onContextMenu={(e) => { e.preventDefault(); if (!readonly) contextMenu(e, [{ id: "list", label: "List it in the content", icon: "plus", run: () => change((c) => ({ content: [...c.content, id] })) }, { id: "thumb", label: "Use as thumbnail", icon: "image", run: () => toTop(id) }]); }}><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={16} />{x.name}</button>; })}</div>
    </details>
  );
  const isCur = (id: string) => (map.get(id)?.type === "progression" ? id === progFile?.id : previewing === id);
  const contentBody = !doc.content.length && !through.length ? <p className="sh-note">Nothing yet. Any file of the project can be content: photos, canvases, progressions, later documents and flows.</p> : lines === "list" ? (
    <>
      <ul className="sh-lines">
        {doc.content.map((id, i) => {
          const { s, x, missing } = entryOf(id);
          return (
            <li key={id} data-sort role="button" tabIndex={0} className={cx("sh-line", isCur(id) && "is-current", missing && "is-missing")} style={sortL.style(i)} onPointerDown={readonly ? undefined : sortL.start(i)} onClick={() => clickEntry(id)} onDblClick={() => openEntry(id)} onContextMenu={rightMenu(id, i)}>
              <Icon name="grip" size={12} /><span className="sh-line__art sh-box"><Pic seen={s} /></span>
              <span className="sh-line__name">{missing ? missingName(x) : x!.name}{i === thumbAt && <> <Badge tone="accent">Thumbnail</Badge></>}</span>
              <span className="sh-line__type">{x && !missing && <><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={20} />{metaOf(x)}</>}</span>
              {menuOf(id, i)}
            </li>
          );
        })}
        {sortL.ghost((i) => <div className="sh-line is-current"><Icon name="grip" size={12} /><span className="sh-line__art sh-box"><Pic seen={entryOf(doc.content[i]).s} /></span><span className="sh-line__name">{map.get(doc.content[i])?.name}</span></div>)}
      </ul>
      {throughList}
    </>
  ) : (
    <>
      <div className="sh-strip">
        {doc.content.map((id, i) => {
          const { s, x, missing } = entryOf(id);
          return (
            <div key={id} data-sort role="button" tabIndex={0} className={cx("sh-tile", isCur(id) && "is-current", id === progFile?.id && "is-active", missing && "is-missing")} style={sortC.style(i)} onPointerDown={readonly ? undefined : sortC.start(i)} onClick={() => clickEntry(id)} onDblClick={() => openEntry(id)} onContextMenu={rightMenu(id, i)}
              title={x?.type === "progression" ? "A progression: click to open it in the panel above" : isPicture(x) ? "Click to look at it on the stage; drag it onto the progression's track" : undefined}>
              <span className="sh-tile__art sh-box"><Pic seen={s} />{x && !missing && x.type !== "photo" && <span className="sh-tile__type"><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={20} /></span>}{x?.internal_of && <span className="sh-tile__lock" title="An internal file"><Icon name="lock" size={10} /></span>}{i === thumbAt && <span className="sh-tile__thumb">Thumbnail</span>}</span>
              <span className="sh-tile__name">{missing ? missingName(x) : x!.name}</span>
              <span className="sh-tile__meta">{!missing && metaOf(x)}</span>
              {menuOf(id, i)}
            </div>
          );
        })}
        {sortC.ghost((i) => <div className="sh-tile is-current"><span className="sh-tile__art sh-box"><Pic seen={entryOf(doc.content[i]).s} /></span><span className="sh-tile__name">{map.get(doc.content[i])?.name}</span></div>)}
      </div>
      {throughList}
    </>
  );

  const dockPanels: DockPanel[] = [
    { id: "props", title: "Properties", icon: "info", body: <div className="sh-side"><div className="sh-tabs"><Segmented label="Side panel" value={entryLabel ? tab : "file"} onChange={setTab} options={[{ value: "file", label: kind.label, icon: kind.glyph }, ...(entryLabel ? [{ value: "entry", label: entryLabel, icon: tabFile ? kindOf(tabFile.type).glyph : "slideshow" as const }] : [])]} /></div>{tab === "entry" && entryLabel ? entryTab : fileTab}</div> },
    ...(shot ? [{ id: "prog", title: "Progression", icon: "slideshow" as const, actions: pdoc ? <div {...(readonly ? { className: "sh-readonly" } : {})}>{editor.head}</div> : undefined, body: progBody || null }] : []),
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
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zones={editing ? ["bottom"] : undefined} zoneSizes={{ left: 320, right: hosted ? 300 : 340, bottom: hosted ? 200 : shot ? 480 : 220 }}>
        {editing && editFile ? (
          <div className="sh-edit">
            <div className="sh-host">
              <Button size="sm" icon="arrow-left" onClick={done}>Back to {f.name}</Button>
              <span className="sh-host__crumb"><AppIcon glyph={kind.glyph} color={kind.color} size={20} />{f.name}{editFile.internal_of && editFile.internal_of !== f.id && <><Icon name="chevron-right" size={12} /><AppIcon glyph="slideshow" color={10} size={20} />{map.get(editFile.internal_of)?.name}</>}<Icon name="chevron-right" size={12} /><AppIcon glyph="brush" color={7} size={20} /><strong>{editFile.id === pdoc?.overlay ? "Overlay" : editFile.name}</strong></span>
              <span className="sh-host__note">{editFile.internal_of ? <><Icon name="lock" size={12} /> Internal file of this {kind.label.toLowerCase()}</> : <><Icon name="link" size={12} /> A project file: changes show everywhere it is used</>}</span>
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="primary" icon="check" onClick={done}>Done</Button>
            </div>
            <Editing key={editFile.id} file={editFile} files={files} projectId={projectId} active={active} hosted live={project?.canvas_live}
              me={{ id: me?.id ?? "", name: me?.name ?? me?.email ?? "You" }} nameOf={nameOf} />
          </div>
        ) : <div className={cx("sh-stage", (!seen || seen.missing) && "is-empty")}>{stage}</div>}
      </Dock>
      <StatusBar>{doc.content.length} in the content{through.length > 0 && <>, {through.length} more through progressions</>}{progFile && pdoc && <> · {progFile.name}: {items.length} {items.length === 1 ? "item" : "items"}, {clock(total)}{sel.length > 0 && <>, {sel.length} chosen</>}</>}{internal.length > 0 && <> · {internal.length} internal files</>}{playing && <> · playing <strong className="oc-num">{clock(tt)}</strong></>}{editing && <> · editing <strong>{editFile?.name}</strong> in place</>}{readonly && <> · read-only{lock.live ? ", live" : ", read again every 5 s"}</>}</StatusBar>
      {adding && <AddFiles title={adding.to === "prog" ? `Add pictures to ${progFile?.name ?? "a new progression"}` : `Add files to the content of ${f.name}`} pictures={adding.to === "prog"} files={files} ctx={ctx} self={f.id} onAdd={addRefs} onClose={() => setAdding(null)} />}
      {gen != null && <Generator files={files} presets={presetList} ctx={ctx} start={entry?.type === "photo" ? entry.id : undefined} has={false} onMake={(m) => void generate(m)} onClose={() => setGen(null)} />}
    </div>
  );
}

/** A file as a chip that opens it. */
function Chip({ f, onOpen }: { f: FileRec; onOpen: (f: FileRec) => void }) {
  const k = kindOf(f.type);
  return <button type="button" className="st-tag" title={`Open ${f.name}`} onClick={() => onOpen(f)}><AppIcon glyph={k.glyph} color={k.color} size={16} />{f.name}</button>;
}
