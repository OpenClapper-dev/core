// The Timeline app (docs/features/timeline.md, docs/rewrite/ux-4-timeline.md): one window per timeline. The stage
// plays the cut under the playhead; below it the strip (a ruler, the chapters, the clips, each as wide as it lasts);
// around it the project's files, the files in use, the chapters and the chosen clips. One person edits a timeline
// at a time (the edit lock); others watch it read-only. Edits save on their own and can be undone.
import "../shots/shots.css";
import "../timeline/timeline.css";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AppIcon, Badge, Banner, Button, Checkbox, ColorChooser, colorCss, Dock, DropdownMenu, EmptyState, Icon, NumberInput, Popover, PropertyList, PropertyRow, PropertySection, SearchInput, Segmented, Slider, Spinner, StatusBar, Switch, TextInput, Toolbar, ToolbarSpacer,
  cx, dockShow, useDockLayout, useSort, type DockPanel,
} from "@openclapper/design";
import { emptyCanvas, HOLD_MS, timelineRefs, type CanvasBody, type Clip, type PresetBody, type TimelineBody } from "@openclapper/model";
import * as api from "../api";
import type { FileRec, FileUse } from "../api";
import { photosOf } from "../collections";
import { kindOf } from "../fileKinds";
import { openFile } from "../fileOps";
import * as store from "../files";
import { toast, toastError } from "../hosts";
import { bind, useKeys } from "../keys";
import { useEditLock } from "../lock";
import { presetsIn } from "../optics";
import { usePeople } from "../people";
import { setPrefs, usePrefs } from "../prefs";
import { definitionsIn } from "../props";
import { PropertySections } from "../propertyEditors";
import { useProjects } from "../projects";
import { useUser } from "../user";
import { Pic } from "../shots/Pic";
import { see, type Mode, type PicCtx } from "../shots/picture";
import { clock } from "../shots/progressionParts";
import { at as atTime, blocksOf, chaptersOf, moveClips, type Block, type Seg } from "../timeline/cut";
import type { AppProps } from "./registry";

const SAVE_AFTER_MS = 600;
const HISTORY = 100;
const STEP_MS = 500;
let n = 0;
const uid = () => `c${Date.now().toString(36)}${(++n).toString(36)}`;
const clampHold = (ms: number) => Math.min(HOLD_MS.max, Math.max(HOLD_MS.min, Math.round(ms / 100) * 100));
const bodyOf = (f: FileRec): TimelineBody => ({ clips: [], holdMs: null, ...(f.body as Partial<TimelineBody> | undefined) });

/** `#/timeline/<id>?t=12.5`: the timeline and where the playhead was. */
export function timelineFromRoute(rest: string) {
  const [id, q] = rest.split("?");
  const t = Number(new URLSearchParams(q ?? "").get("t"));
  return { resource: id ? { type: "timeline", id } : null, state: Number.isFinite(t) && t > 0 ? { t: t * 1000 } : undefined };
}

export function TimelineApp({ win, resource, projectId, setTitle, setRoute, focused }: AppProps) {
  const id = resource?.id ?? "";
  const { files, bin } = store.useRoot({ project: projectId });
  const f = files?.find((x) => x.id === id);
  useEffect(() => { setTitle(f?.name ?? "Timeline"); }, [f?.name]);
  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  if (!f || f.type !== "timeline") return <div className="oc-app"><EmptyState icon="timeline" title="This timeline is gone">It was deleted or moved to the recycle bin.</EmptyState></div>;
  return <Cut key={f.id} f={f} files={files} bin={bin ?? []} projectId={projectId} active={focused} startAt={(win.state as { t?: number } | undefined)?.t ?? 0} setRoute={setRoute} />;
}

function Cut({ f, files, bin, projectId, active, startAt, setRoute }: { f: FileRec; files: FileRec[]; bin: FileRec[]; projectId: string; active: boolean; startAt: number; setRoute: (r: string) => void }) {
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  const nameOf = (u: string) => (u === me?.id ? "You" : people.get(u) ?? "Someone");
  const prefs = usePrefs();
  const map = useMemo(() => new Map([...bin, ...files].map((x) => [x.id, x])), [files, bin]);
  const presetList = presetsIn(files);
  const ctx: PicCtx = { files: map, presets: new Map(presetList.map((p) => [p.id, p.body as PresetBody])) };

  // ---------- The document, its history, saving under the lock ----------
  const [body, setBody] = useState<TimelineBody>(() => bodyOf(f));
  const latest = useRef(body);
  latest.current = body;
  const history = useRef<{ past: TimelineBody[]; future: TimelineBody[]; at: number }>({ past: [], future: [], at: 0 });
  const [, tick] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"saved" | "waiting" | "saving" | "failed">("saved");
  const lock = useEditLock(f, nameOf, (x) => { const b = bodyOf(x); latest.current = b; setBody(b); }, () => { if (pending.current) { clearTimeout(pending.current); void save(); } });
  const readonly = !lock.editing;
  async function save() {
    pending.current = null;
    if (!lock.held()) return;
    const b = latest.current;
    setStatus("saving");
    try {
      await api.putFileLocked(f.id, { body: b, refs: timelineRefs(b) }, lock.holder);
      setStatus(pending.current ? "waiting" : "saved");
      void store.loadRoot({ project: projectId });
    } catch (e) {
      setStatus("failed");
      if (e instanceof api.ApiError && e.status === 423) lock.lost(); else toastError(e);
    }
  }
  const flush = async () => { if (pending.current) { clearTimeout(pending.current); await save(); } };
  /** A change to the cut: shown at once, one step of the history (changes close together are one), saved a moment later. */
  const change = (next: TimelineBody | ((b: TimelineBody) => TimelineBody)) => {
    if (readonly) return;
    const b = typeof next === "function" ? next(latest.current) : next;
    const h = history.current, now = Date.now();
    if (now - h.at > 600) { h.past = [...h.past, latest.current].slice(-HISTORY); h.future = []; }
    h.at = now;
    latest.current = b; setBody(b); tick((x) => x + 1);
    setStatus("waiting");
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };
  const jump = (from: "past" | "future") => {
    if (readonly) return;
    const h = history.current, list = h[from];
    if (!list.length) return;
    const to = list[list.length - 1];
    h[from] = list.slice(0, -1);
    h[from === "past" ? "future" : "past"] = [...h[from === "past" ? "future" : "past"], latest.current];
    h.at = 0;
    latest.current = to; setBody(to); tick((x) => x + 1);
    setStatus("waiting");
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };
  const clips = body.clips;
  const setClips = (list: Clip[]) => change((b) => ({ ...b, clips: list }));
  const patch = (ids: readonly string[], c: Partial<Clip> | ((x: Clip) => Clip)) => setClips(clips.map((x) => (ids.includes(x.id) ? (typeof c === "function" ? c(x) : { ...x, ...c }) : x)));
  const hold = body.holdMs ?? prefs.clipHoldMs;

  // ---------- The clock ----------
  const blocks = useMemo(() => blocksOf(clips, map), [clips, map]);
  const total = blocks.length ? blocks[blocks.length - 1].start + blocks[blocks.length - 1].len : 0;
  const [t, setT] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string[]>(() => (clips[0] ? [clips[0].id] : []));
  const here = atTime(blocks, t);
  const chosen = blocks.filter((b) => sel.includes(b.clip.id));
  const one = chosen.length === 1 ? chosen[0] : null;
  const chapters = chaptersOf(blocks);
  const chapterAt = [...chapters].reverse().find((c) => here && c.start <= t);
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now() - t; let raf = 0;
    const step = () => { const now = performance.now() - t0; if (now >= total) { setPlaying(false); setT(0); } else { setT(now); raf = requestAnimationFrame(step); } };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
  // The address says where the playhead is when it stops.
  useEffect(() => { if (!playing) setRoute(`${f.id}${t > 0 ? `?t=${(t / 1000).toFixed(1)}` : ""}`); }, [playing, t > 0 ? Math.round(t / 100) : 0, f.id]);
  const seek = (time: number) => { setPlaying(false); const x = Math.max(0, Math.min(total, time)); setT(x); const b = atTime(blocks, x)?.block; if (b) setSel([b.clip.id]); };
  const pick = (b: Block<FileRec>, e?: MouseEvent | KeyboardEvent, time = b.start) => {
    setPlaying(false); setT(time);
    if (e && (e.ctrlKey || e.metaKey)) { setSel(sel.includes(b.clip.id) ? sel.filter((x) => x !== b.clip.id) : [...sel, b.clip.id]); return; }
    if (e?.shiftKey && sel.length) {
      const a = blocks.findIndex((x) => x.clip.id === sel[sel.length - 1]), z = blocks.indexOf(b);
      const [lo, hi] = a < z ? [a, z] : [z, a];
      setSel(blocks.slice(lo, hi + 1).map((x) => x.clip.id));
      return;
    }
    setSel([b.clip.id]);
  };

  // ---------- Changing the cut ----------
  const insertAt = () => { const last = clips.map((c) => c.id).filter((x) => sel.includes(x)).pop(); return last ? clips.findIndex((c) => c.id === last) + 1 : clips.length; };
  const insert = (refs: { file: string; frame?: string }[], index = insertAt()) => {
    if (readonly || !refs.length) return;
    const made: Clip[] = refs.map((r) => ({ id: uid(), file: r.file, ...(r.frame ? { frame: r.frame } : {}), ms: hold }));
    setClips([...clips.slice(0, index), ...made, ...clips.slice(index)]);
    setSel(made.map((c) => c.id));
  };
  /** A placeholder gets the file and keeps its time and chapter. */
  const fill = (clipId: string, r: { file: string; frame?: string }) => { patch([clipId], (c) => { const { title: _t, ...rest } = c; void _t; return { ...rest, file: r.file, ...(r.frame ? { frame: r.frame } : {}) }; }); setSel([clipId]); };
  const placeholder = () => { if (readonly) return; const c: Clip = { id: uid(), file: null, ms: hold, title: "Placeholder" }, i = insertAt(); setClips([...clips.slice(0, i), c, ...clips.slice(i)]); setSel([c.id]); setPanels(dockShow(panels, "clip")); };
  const remove = (ids: readonly string[]) => { if (readonly || !ids.length) return; setClips(clips.filter((c) => !ids.includes(c.id))); setSel([]); };
  const nudge = (d: number) => patch(sel, (c) => ({ ...c, ms: clampHold(c.ms + d) }));
  const shift = (d: -1 | 1) => {
    if (readonly || !sel.length) return;
    const idx = clips.map((c, i) => (sel.includes(c.id) ? i : -1)).filter((i) => i >= 0);
    const to = d < 0 ? Math.max(0, idx[0] - 1) : Math.min(clips.length, idx[idx.length - 1] + 2);
    setClips(moveClips(clips, sel, to));
  };
  const chapter = () => { if (!one) return; patch([one.clip.id], (c) => (c.chapter ? (({ chapter: _c, ...rest }) => (void _c, rest))(c) : { ...c, chapter: { title: "New chapter", color: 3 } })); };
  const makeCanvas = async (b: Block<FileRec>) => {
    const photo = b.file;
    if (!photo || readonly) return;
    try {
      const id = crypto.randomUUID();
      await api.createFile({ project: projectId }, id, { type: "canvas", container: photo.container && map.get(photo.container)?.type === "collection" ? map.get(photo.container)!.container : photo.container, body: { ...emptyCanvas(), surface: { kind: "photo" } }, refs: [{ kind: "base", to: photo.id }] });
      await store.loadRoot({ project: projectId });
      patch([b.clip.id], { file: id, frame: undefined });
      toast(`“${photo.name}” is now a canvas in this clip: draw on it, give it a look, frame it`, { tone: "info" });
    } catch (e) { toastError(e); }
  };

  // ---------- Keys ----------
  const holdInput = useRef<HTMLDivElement>(null);
  const idx = one ? blocks.indexOf(one) : -1;
  useKeys(bind("timeline", {
    play: () => setPlaying(!playing),
    prev: () => { if (blocks[idx - 1]) pick(blocks[idx - 1]); else if (idx < 0 && blocks.length) pick(blocks[0]); },
    next: () => { if (blocks[idx + 1]) pick(blocks[idx + 1]); else if (idx < 0 && blocks.length) pick(blocks[0]); },
    first: () => { if (blocks.length) pick(blocks[0]); },
    last: () => { if (blocks.length) pick(blocks[blocks.length - 1]); },
    moveEarlier: () => shift(-1), moveLater: () => shift(1),
    shorter: () => nudge(-STEP_MS), longer: () => nudge(STEP_MS),
    hold: () => { holdInput.current?.querySelector("input")?.focus(); },
    placeholder, chapter,
    remove: () => remove(sel),
    all: () => setSel(clips.map((c) => c.id)),
    undo: () => jump("past"), redo: () => jump("future"),
  }), active);

  // ---------- Panels and view ----------
  const [panels, setPanels, resetPanels] = useDockLayout("timeline", { left: { tabs: ["files", "used", "chapters"] }, right: { tabs: ["clip"] }, bottom: { tabs: ["strip"] } });
  const [spread, setSpread] = useState("spread");
  const [scale, setScale] = useState(56);
  const [mode, setMode] = useState<Mode>("crop");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState<string[]>([]);
  const [uses, setUses] = useState<FileUse[]>([]);
  const useFile = one?.file && !one.file.deleted_at ? one.file : null;
  useEffect(() => { if (useFile) void api.fetchUses(useFile.id).then(setUses, () => setUses([])); else setUses([]); }, [useFile?.id]);
  const track = useRef<HTMLDivElement>(null), view = useRef<HTMLDivElement>(null);
  const defs = definitionsIn(files);
  const overlaySrc = (id: string | null | undefined) => { const o = id ? map.get(id) : undefined; return o && !o.deleted_at && o.updated_at !== o.created_at ? api.renderUrl(o, "render") : null; };
  const labelOf = (b: Block<FileRec>) => (!b.clip.file ? b.clip.title || "Placeholder" : !b.file ? "Missing file" : b.clip.frame ? `${b.file.name} · ${((b.file.body as unknown as CanvasBody | undefined)?.frames ?? []).find((x) => x.id === b.clip.frame)?.name ?? "frame"}` : b.file.name);
  const seenOf = (s: Seg, u = 0) => (s.ref ? see(s.ref, ctx, s.def ?? null, u) : null);

  // A file dragged from the Files panel: a ghost at the pointer; a line where it would land, or a placeholder lit up.
  const [drop, setDrop] = useState<{ x: number; y: number; label: string; line: [number, number, number] | null; at: number | null; into: string | null } | null>(null);
  const fileDrag = (r: { file: string; frame?: string }, label: string) => (e: PointerEvent) => {
    if (e.button !== 0 || readonly) return;
    const sx = e.clientX, sy = e.clientY;
    let live: typeof drop = null;
    const move = (m: PointerEvent) => {
      if (!live && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
      const box = track.current?.getBoundingClientRect(), inside = box && m.clientY > box.top - 40 && m.clientY < box.bottom + 16 && m.clientX > box.left - 8;
      let index: number | null = null, line: [number, number, number] | null = null, into: string | null = null;
      if (box && inside) {
        const els = [...track.current!.querySelectorAll<HTMLElement>(":scope > [data-sort]")], rs = els.map((c) => c.getBoundingClientRect());
        // Over the middle of a placeholder: it is filled. Elsewhere: a new clip goes between two.
        const hit = els.findIndex((el, i) => el.dataset.placeholder === "1" && m.clientX > rs[i].left + rs[i].width * 0.25 && m.clientX < rs[i].right - rs[i].width * 0.25);
        if (hit >= 0) into = els[hit].dataset.clip ?? null;
        else { index = rs.filter((x) => x.left + x.width / 2 < m.clientX).length; line = [index < rs.length ? rs[index].left - 2 : (rs[rs.length - 1]?.right ?? box.left) + 1, box.top, box.height]; }
      }
      live = { x: m.clientX, y: m.clientY, label, line, at: index, into }; setDrop(live);
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); setDrop(null); if (live?.into) fill(live.into, r); else if (live?.at != null) insert([r], live.at); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const stretch = (b: Block<FileRec>) => (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (readonly) return;
    const sx = e.clientX, orig = b.clip.ms, cid = b.clip.id;
    const move = (m: PointerEvent) => change((x) => ({ ...x, clips: x.clips.map((c) => (c.id === cid ? { ...c, ms: clampHold(orig + ((m.clientX - sx) / scale) * 1000) } : c)) }));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const sort = useSort("x", (a, b) => { if (!readonly) setClips(moveClips(clips, [clips[a].id], b > a ? b + 1 : b)); });

  // ---------- The stage ----------
  const seg = here?.seg;
  const stageSeen = seg ? seenOf(seg, here!.u) : null;
  const stage = (
    <div className="tl-stage">
      <div className={cx("sh-stage", (!seg || seg.kind !== "pic" && seg.kind !== "prog") && "is-empty")}>
        {!seg ? <EmptyState icon="timeline" title="An empty cut">Drag files in from the Files panel, or add a placeholder (P).</EmptyState>
          : seg.kind === "placeholder" ? <div className="tl-card"><Icon name="hourglass" size={20} /><strong>{here!.block.clip.title || "Placeholder"}</strong><span>A placeholder: something is still missing here.</span></div>
            : seg.kind === "missing" ? <div className="tl-card is-missing"><Icon name="warning" size={20} /><strong>{labelOf(here!.block)}</strong><span>The clip stays in its place until the file is restored or the clip is removed.</span></div>
              : seg.kind === "empty" || !stageSeen ? <div className="tl-card"><Icon name="slate" size={20} /><strong>{labelOf(here!.block)}</strong><span>This shot has no picture yet.</span></div>
                : <div className="sh-box"><Pic seen={stageSeen} mode={mode} overlay={overlaySrc(seg.overlay)} label /></div>}
        {seg && here && <span className="sh-caption">{chapterAt && <b className="tl-chap" style={{ background: colorCss(chapterAt.color) }}>{chapterAt.title}</b>}{labelOf(here.block)}{here.block.segs.length > 1 && <small> · picture {here.block.segs.indexOf(seg) + 1} of {here.block.segs.length}</small>}</span>}
      </div>
      <div className="tl-transport">
        <Button size="sm" variant="quiet" icon="skip-back" label="To the start (Home)" onClick={() => seek(0)} />
        <Button size="sm" variant="quiet" icon="chevron-left" label="Previous clip (←)" disabled={idx <= 0} onClick={() => blocks[idx - 1] && pick(blocks[idx - 1])} />
        <Button size="sm" variant="primary" icon={playing ? "pause" : "play"} label={playing ? "Pause (Space)" : "Play (Space)"} disabled={!blocks.length} onClick={() => setPlaying(!playing)} />
        <Button size="sm" variant="quiet" icon="chevron-right" label="Next clip (→)" disabled={idx >= blocks.length - 1} onClick={() => blocks[idx + 1] && pick(blocks[idx + 1])} />
        <span className="tl-time oc-num"><strong>{clock(Math.min(t, total))}</strong> / {clock(total)}</span>
        <span style={{ flex: 1 }} />
        <Segmented label="View mode" value={mode} disabled={!stageSeen?.rect} onChange={(v) => setMode(v as Mode)} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} />
      </div>
    </div>
  );

  // ---------- The strip ----------
  const stepS = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((x) => x * scale >= 64) ?? 600;
  const ticks = Array.from({ length: Math.floor(total / 1000 / stepS) + 1 }, (_, i) => i * stepS);
  const scrub = (e: PointerEvent) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).closest(".tl-lanes")!.querySelector(".tl-ruler")!.getBoundingClientRect(); const to = (m: PointerEvent) => seek(((m.clientX - r.left) / scale) * 1000); to(e); const up = () => { removeEventListener("pointermove", to); removeEventListener("pointerup", up); }; addEventListener("pointermove", to); addEventListener("pointerup", up); };
  const fit = () => { const w = view.current?.clientWidth; if (w && total) setScale(Math.max(2, (w - 34) / (total / 1000))); };
  const px = (ms: number) => (ms / 1000) * scale;
  const strip = !blocks.length ? <p className="sh-note">Nothing in this cut yet. Drag files here from the Files panel, double-click one, or add a placeholder.</p> : (
    <div className="tl-scroll" ref={view} onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setScale((s) => Math.min(240, Math.max(2, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); } }}>
      <div className="tl-lanes" style={{ width: px(total) }}>
        <div className="tl-ruler" onPointerDown={scrub}>{ticks.map((s) => <span key={s} style={{ left: s * scale }}>{clock(s * 1000)}</span>)}</div>
        <div className="tl-chapters">{chapters.map((c) => <button type="button" key={c.clip} style={{ left: px(c.start), width: px(c.len), "--c": colorCss(c.color) }} title={`Chapter “${c.title}”`} onClick={(e) => pick(blocks.find((b) => b.clip.id === c.clip)!, e)}><Icon name="bookmark" size={10} />{c.title}</button>)}</div>
        <div className="tl-track" ref={track}>
          {blocks.map((b, i) => {
            const many = b.segs.length > 1, cells = many && spread === "spread" ? b.segs : [b.segs[0]];
            let s0 = b.start;
            const kindOfSeg = b.segs[0].kind;
            return (
              <div key={b.clip.id} data-sort data-clip={b.clip.id} data-placeholder={kindOfSeg === "placeholder" ? "1" : undefined} role="button" tabIndex={0}
                className={cx("tl-clip", sel.includes(b.clip.id) && "is-current", many && "is-group", kindOfSeg === "placeholder" && "is-placeholder", kindOfSeg === "missing" && "is-missing", drop?.into === b.clip.id && "is-target")}
                style={{ width: px(b.len), ...sort.style(i) }} title={labelOf(b)} onPointerDown={readonly ? undefined : sort.start(i)} onClick={(e) => pick(b, e)}
                onDblClick={() => b.file && !b.file.deleted_at && openFile(b.file, map)}>
                <span className="tl-clip__cells">
                  {cells.map((s, k) => { const from = s0; s0 += s.ms; const sn = s.kind === "missing" ? null : seenOf(s); return (
                    <span key={k} className="tl-cell" style={{ flex: cells.length > 1 ? `${s.ms} 1 0px` : 1 }} onClick={(e) => { if (cells.length > 1) { e.stopPropagation(); pick(b, e, from); } }}>
                      <span className="sh-item__art sh-box">{sn ? <Pic seen={sn} overlay={overlaySrc(s.overlay)} /> : <span className="tl-cell__none"><Icon name={s.kind === "placeholder" ? "hourglass" : s.kind === "missing" ? "warning" : "slate"} /></span>}</span>
                    </span>
                  ); })}
                </span>
                <span className="tl-clip__label">{b.file && <AppIcon glyph={kindOf(b.file.type).glyph} color={kindOf(b.file.type).color} size={20} />}<b>{labelOf(b)}</b>{many && <small title={spread === "spread" ? "A progression, spread" : "A progression, collapsed"}><Icon name="layers" size={10} />{b.segs.length}</small>}<i className="oc-num">{clock(b.len)}</i></span>
                {!b.fixed && !readonly && <i data-nodrag className="sh-item__grip" title="Drag to change how long it holds" onPointerDown={stretch(b)} />}
              </div>
            );
          })}
          {sort.ghost((i) => <div className="tl-clip is-current" style={{ width: "100%" }}><span className="tl-clip__cells"><span className="tl-cell" style={{ flex: 1 }}><span className="sh-item__art sh-box">{(() => { const s = blocks[i].segs[0], sn = s.kind === "missing" ? null : seenOf(s); return sn ? <Pic seen={sn} /> : null; })()}</span></span></span><span className="tl-clip__label"><b>{labelOf(blocks[i])}</b></span></div>)}
        </div>
        <i className="tl-playhead" style={{ left: px(Math.min(t, total)) }}><b onPointerDown={scrub} title="Drag to scrub" /></i>
      </div>
    </div>
  );
  const stripActions = (
    <div className="sh-row">
      <span className="sh-count oc-num">{clips.length} clips · {clock(total)}</span>
      <Button size="sm" variant="quiet" icon="undo" label="Undo (Ctrl+Z)" disabled={readonly || !history.current.past.length} onClick={() => jump("past")} />
      <Button size="sm" variant="quiet" icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={readonly || !history.current.future.length} onClick={() => jump("future")} />
      <Button size="sm" variant="quiet" icon="hourglass" disabled={readonly} title="A place in the cut where something is still missing (P)" onClick={placeholder}>Placeholder</Button>
      <Button size="sm" variant="quiet" icon="bookmark" disabled={readonly || !one} selected={!!one?.clip.chapter} title="A chapter starts at the chosen clip (C)" onClick={chapter}>Chapter</Button>
      <span style={{ flex: 1 }} />
      <Popover align="end" trigger={<Button size="sm" variant="quiet" icon="clock" iconAfter="chevron-down" title="How long a clip holds when a file is added">New clips {clock(hold)}</Button>}>
        <div className="sh-pop">
          <Checkbox checked={body.holdMs != null} disabled={readonly} onChange={(c) => change((b) => ({ ...b, holdMs: c ? prefs.clipHoldMs : null }))}>This timeline has its own value</Checkbox>
          {body.holdMs != null
            ? <span className="sh-bar">In this timeline <NumberInput size="sm" value={body.holdMs / 1000} unit="s" min={0.1} max={3600} step={0.5} style={{ width: 96 }} onChange={(v) => change((b) => ({ ...b, holdMs: clampHold(v * 1000) }))} /></span>
            : <span className="sh-bar">For your account <NumberInput size="sm" value={prefs.clipHoldMs / 1000} unit="s" min={0.1} max={3600} step={0.5} style={{ width: 96 }} onChange={(v) => setPrefs({ clipHoldMs: clampHold(v * 1000) })} /></span>}
          <p className="sh-hint">A file or a placeholder added to a cut holds this long. Every timeline takes your account's value unless it has its own.</p>
        </div>
      </Popover>
      <Segmented label="Shots with a progression" value={spread} onChange={setSpread} options={[{ value: "spread", label: "Spread", title: "One cell per picture of a progression" }, { value: "collapsed", label: "Collapsed", title: "A progression as one clip showing its first picture" }]} />
      <Button size="sm" variant="quiet" icon="expand" title="Fit the whole cut into the width of the strip" onClick={fit}>Fit</Button>
      <span className="sh-bar" style={{ width: 150 }} title="Zoom the strip (Ctrl + wheel)"><Icon name="zoom-out" size={12} /><Slider min={2} max={240} step={2} value={Math.min(240, Math.max(2, Math.round(scale)))} onChange={setScale} /><Icon name="zoom-in" size={12} /></span>
    </div>
  );

  // ---------- The side panels ----------
  const offered = files.filter((x) => !x.internal_of && ["photo", "canvas", "shot", "collection"].includes(x.type) && (kind === "all" || x.type === kind || (kind === "photo" && x.type === "collection")) && (!q || x.name.toLowerCase().includes(q.toLowerCase())));
  const inColl = (x: FileRec) => !!x.container && map.get(x.container)?.type === "collection";
  const thumbSeen = (fid: string, frame?: string) => { const x = map.get(fid); if (x?.type !== "shot") return see({ to: fid, frame }, ctx); const s = blocksOf([{ id: "x", file: fid, ms: 1 }], map)[0].segs[0]; return seenOf(s) ?? see({ to: fid }, ctx); };
  const fileRow = (x: FileRec, r: { file: string; frame?: string }, label: string, depth = 0, extra?: ComponentChildren) => (
    <li key={`${r.file}${r.frame ?? ""}`} className="tl-file" style={{ paddingLeft: 6 + depth * 18 }} onPointerDown={fileDrag(r, label)} onDblClick={() => insert([r])} title="Drag into the cut (onto a placeholder fills it), or double-click to add after the chosen clip">
      <span className="sh-pickrow__art sh-box"><Pic seen={thumbSeen(r.file, r.frame)} /></span>
      <span className="sh-pickrow__name">{label}<small>{r.frame ? "One frame of the canvas" : kindOf(x.type).label}</small></span>
      {extra && <span data-nodrag onPointerDown={(e) => e.stopPropagation()}>{extra}</span>}
      <Button size="sm" variant="quiet" icon="plus" label={`Add ${label} to the cut`} disabled={readonly} onPointerDown={(e) => e.stopPropagation()} onClick={() => insert([r])} />
    </li>
  );
  const twist = (fid: string, count: number, what: string) => { const on = open.includes(fid); return <Button size="sm" variant="quiet" iconAfter={on ? "chevron-up" : "chevron-down"} onClick={() => setOpen(on ? open.filter((x) => x !== fid) : [...open, fid])}>{count} {what}</Button>; };
  const filesBody = (
    <ul className="tl-files">
      {offered.filter((x) => !inColl(x)).sort((a, b) => kindOf(a.type).label.localeCompare(kindOf(b.type).label) || a.name.localeCompare(b.name, undefined, { numeric: true })).flatMap((x) => {
        const on = open.includes(x.id);
        if (x.type === "collection") {
          const kids = photosOf(x, files);
          return [<li key={x.id} className="tl-file tl-file--coll"><AppIcon glyph="layers" color={4} size={24} /><span className="sh-pickrow__name">{x.name}<small>Collection: its photos are added one by one</small></span>{twist(x.id, kids.length, "photos")}</li>, ...(on ? kids.map((c) => fileRow(c, { file: c.id }, c.name, 1)) : [])];
        }
        const frames = x.type === "canvas" ? ((x.body as unknown as CanvasBody | undefined)?.frames ?? []) : [];
        return [fileRow(x, { file: x.id }, x.name, 0, frames.length ? twist(x.id, frames.length, "frames") : undefined), ...(on ? frames.map((fr) => fileRow(x, { file: x.id, frame: fr.id }, `${x.name} · ${fr.name}`, 1)) : [])];
      })}
      {!offered.length && <li className="sh-note">Nothing matches.</li>}
    </ul>
  );
  const used = [...new Set(clips.filter((c) => c.file).map((c) => c.file!))].map((fid) => ({ fid, x: map.get(fid), count: clips.filter((c) => c.file === fid).length }));
  const placeholders = clips.filter((c) => !c.file);
  /** A click on a file in use goes to its next clip after the chosen one. */
  const nextUse = (pred: (c: Clip) => boolean) => { const list = blocks.filter((b) => pred(b.clip)); if (!list.length) return; const i = list.findIndex((b) => b.start > (one?.start ?? -1)); pick(list[i >= 0 ? i : 0]); };
  const usedBody = (
    <ul className="tl-files">
      {used.map(({ fid, x, count }) => (
        <li key={fid} className={cx("tl-file", (!x || x.deleted_at) && "is-missing")} onClick={() => nextUse((c) => c.file === fid)} title="Go to its next clip">
          <span className="sh-pickrow__art sh-box"><Pic seen={thumbSeen(fid)} /></span>
          <span className="sh-pickrow__name">{x ? x.name : "Missing file"}<small>{x?.deleted_at ? "In the recycle bin" : x ? kindOf(x.type).label : ""}</small></span>
          <Badge>{count}×</Badge>
        </li>
      ))}
      {placeholders.length > 0 && <li className="tl-file" onClick={() => nextUse((c) => !c.file)}><span className="tl-cell__none sh-pickrow__art"><Icon name="hourglass" /></span><span className="sh-pickrow__name">Placeholders<small>Nothing yet</small></span><Badge>{placeholders.length}×</Badge></li>}
      {!used.length && !placeholders.length && <li className="sh-note">Nothing in this cut yet.</li>}
    </ul>
  );
  const chaptersBody = !chapters.length ? <p className="sh-note">No chapters. Choose a clip and press Chapter (C): a chapter starts there.</p> : (
    <ul className="tl-files">{chapters.map((c) => <li key={c.clip} className={cx("tl-file", chapterAt?.clip === c.clip && "is-on")} onClick={() => pick(blocks.find((b) => b.clip.id === c.clip)!)}><i className="tl-dot" style={{ background: colorCss(c.color) }} /><span className="sh-pickrow__name">{c.title}<small className="oc-num">{clock(c.start)} · {clock(c.len)} long</small></span></li>)}</ul>
  );
  const holdRow = (b: Block<FileRec>) => b.fixed ? <PropertyRow label="Plays" value={`its progression: ${b.segs.length} pictures, ${clock(b.len)}`} /> : (
    <PropertyRow label="Holds">
      <span className="sh-bar" ref={holdInput}>
        <Button size="sm" variant="quiet" icon="minus" label="0.5 s shorter (-)" disabled={readonly} onClick={() => nudge(-STEP_MS)} />
        <NumberInput size="sm" value={b.clip.ms / 1000} unit="s" min={0.1} max={3600} step={0.5} disabled={readonly} style={{ width: 96 }} onChange={(v) => patch([b.clip.id], { ms: clampHold(v * 1000) })} />
        <Button size="sm" variant="quiet" icon="plus" label="0.5 s longer (+)" disabled={readonly} onClick={() => nudge(STEP_MS)} />
      </span>
    </PropertyRow>
  );
  const file = one?.file;
  const clipBody = !chosen.length ? <EmptyState icon="info" title="Nothing chosen">Click a clip in the strip; Shift or Ctrl to choose several.</EmptyState>
    : !one ? (
      <PropertyList>
        <PropertySection title={`${chosen.length} clips chosen`} icon="timeline">
          <PropertyRow label="Together" value={clock(chosen.reduce((a, b) => a + b.len, 0))} numeric />
          <PropertyRow label="Each holds">
            <span className="sh-bar">
              <Button size="sm" variant="quiet" icon="minus" label="0.5 s shorter (-)" disabled={readonly} onClick={() => nudge(-STEP_MS)} />
              <NumberInput size="sm" value={null} placeholder="Mixed" unit="s" min={0.1} max={3600} step={0.5} disabled={readonly} style={{ width: 96 }} onChange={(v) => { if (v != null) patch(sel, { ms: clampHold(v * 1000) }); }} />
              <Button size="sm" variant="quiet" icon="plus" label="0.5 s longer (+)" disabled={readonly} onClick={() => nudge(STEP_MS)} />
            </span>
          </PropertyRow>
          <p className="sh-note">Shots with a progression keep the progression's length. Alt + arrows move them together.</p>
          <div className="sh-row" style={{ borderBottom: 0 }}><Button size="sm" variant="quiet" icon="trash" disabled={readonly} onClick={() => remove(sel)}>Remove {chosen.length} clips</Button></div>
        </PropertySection>
      </PropertyList>
    ) : (
      <div className="sh-side">
        <header className="sh-head">
          <span className="sh-head__art sh-box">{one.segs[0].kind !== "missing" && seenOf(one.segs[0]) ? <Pic seen={seenOf(one.segs[0])!} /> : <span className="tl-cell__none"><Icon name={one.clip.file ? "warning" : "hourglass"} size={20} /></span>}</span>
          {one.clip.file ? <strong>{labelOf(one)}</strong> : <TextInput size="sm" value={one.clip.title ?? ""} disabled={readonly} aria-label="Title of the placeholder" placeholder="What is missing here" onInput={(e) => patch([one.clip.id], { title: e.currentTarget.value.slice(0, 200) })} />}
          {file && <span className="sh-head__type"><AppIcon glyph={kindOf(file.type).glyph} color={kindOf(file.type).color} size={20} />{kindOf(file.type).label}</span>}
        </header>
        {one.segs[0].kind === "missing" && <Banner tone="warning" action={file && <Button size="sm" variant="quiet" onClick={() => void store.restore({ project: projectId }, [file.id]).catch(toastError)}>Restore</Button>}>The file is {file ? "in the recycle bin" : "gone"}. The clip keeps its place.</Banner>}
        <PropertyList key={one.clip.id}>
          <PropertySection title="Clip" icon="timeline">
            {holdRow(one)}
            <PropertyRow label="Starts at" value={clock(one.start)} numeric />
            {one.fixed && <p className="sh-note">The pictures and their timing belong to the shot and are changed there. The clip has no time of its own.</p>}
            <div className="sh-row" style={{ borderBottom: 0 }}>
              {file && !file.deleted_at && <Button size="sm" icon="external" title={`Open the ${kindOf(file.type).label} in a window of its own (or double-click the clip)`} onClick={() => openFile(file, map)}>Open in {kindOf(file.type).label}</Button>}
              {file?.type === "photo" && !file.deleted_at && <Button size="sm" variant="quiet" icon="brush" disabled={readonly} onClick={() => void makeCanvas(one)}>Make a canvas from it</Button>}
              {!one.clip.file && <Button size="sm" variant="quiet" icon="plus" disabled={readonly} onClick={() => { setPanels(dockShow(panels, "files")); toast("Drag a file from the Files panel onto the placeholder: it takes its place, its time and its chapter", { tone: "info" }); }}>Fill it</Button>}
              <Button size="sm" variant="quiet" icon="trash" disabled={readonly} onClick={() => remove([one.clip.id])}>Remove</Button>
            </div>
          </PropertySection>
          <PropertySection title="Chapter" icon="bookmark">
            <div className="sh-row" style={{ borderBottom: 0 }}><Switch checked={!!one.clip.chapter} disabled={readonly} onChange={() => chapter()}>A chapter starts here</Switch></div>
            {one.clip.chapter && (
              <PropertyRow label="Title">
                <span className="sh-bar" style={{ flex: 1 }}>
                  <Popover trigger={<button type="button" className="tl-swatch" disabled={readonly} style={{ background: colorCss(one.clip.chapter.color) }} aria-label="Chapter colour" />}><ColorChooser value={one.clip.chapter.color} label="Chapter colour" onChange={(c) => patch([one.clip.id], (x) => ({ ...x, chapter: { ...x.chapter!, color: c } }))} /></Popover>
                  <TextInput size="sm" value={one.clip.chapter.title} disabled={readonly} onInput={(e) => { const v = e.currentTarget.value.slice(0, 120); patch([one.clip.id], (x) => ({ ...x, chapter: { ...x.chapter!, title: v } })); }} />
                </span>
              </PropertyRow>
            )}
          </PropertySection>
          {useFile && uses.filter((u) => u.id !== f.id).length > 0 && (
            <PropertySection title={`The file is also used in · ${uses.filter((u) => u.id !== f.id).length}`} icon="link" defaultOpen={false}>
              <div className="sh-chips">{uses.filter((u) => u.id !== f.id).map((u) => { const x = map.get(u.id); return x ? <button type="button" key={u.id + u.kind} className="st-tag" onClick={() => openFile(x, map)}><AppIcon glyph={kindOf(x.type).glyph} color={kindOf(x.type).color} size={16} />{x.name}</button> : null; })}</div>
            </PropertySection>
          )}
          {useFile && <PropertySections projectId={projectId} targets={[useFile]} defs={defs} files={files} />}
        </PropertyList>
      </div>
    );

  const dockPanels: DockPanel[] = [
    { id: "files", title: "Files", icon: "folder", actions: <div className="sh-row"><SearchInput size="sm" value={q} onChange={setQ} placeholder="Name" style={{ flex: 1, minWidth: 90 }} /><Segmented label="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "shot", icon: "slate", title: "Shots" }, { value: "photo", icon: "image", title: "Photos" }, { value: "canvas", icon: "brush", title: "Canvases" }]} /></div>, body: filesBody },
    { id: "used", title: "In use", icon: "files", body: usedBody },
    { id: "chapters", title: "Chapters", icon: "bookmark", body: chaptersBody },
    { id: "clip", title: chosen.length > 1 ? "Clips" : "Clip", icon: "info", body: <div className={cx(readonly && "tl-readonly-soft")}>{clipBody}</div> },
    { id: "strip", title: "Cut", icon: "film", actions: stripActions, body: strip },
  ];
  const master = project?.master ?? [];
  return (
    <div className="oc-app">
      <Toolbar>
        <AppIcon glyph="timeline" color={6} size={24} /><strong className="st-title">{f.name}</strong>
        <Badge>{master.includes(f.id) ? `No. ${master.indexOf(f.id) + 1} in the master` : "Not in the master"}</Badge>
        {lock.editing
          ? <Button size="sm" variant="quiet" icon="eye" title="Save, let the timeline go and keep watching it: someone else can edit it now" onClick={() => void lock.stop(flush)}>Stop editing</Button>
          : <span className="tl-viewing"><Icon name="eye" size={14} /><span>{lock.by === "You" ? "Editing in another window of yours" : lock.by ? `${lock.by} is editing` : "Nobody is editing"}</span><Button size="sm" variant="primary" icon="edit" disabled={!!lock.by} onClick={() => void lock.edit()}>Edit</Button></span>}
        <ToolbarSpacer />
        <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "panels", label: "Panels back to their places", icon: "refresh" }]} onSelect={() => resetPanels()} />
      </Toolbar>
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 300, right: 320, bottom: 300 }}>{stage}</Dock>
      <StatusBar>{clips.length} clips · {clock(total)} · {chapters.length} chapters{placeholders.length > 0 && <> · {placeholders.length} placeholders</>}{sel.length > 1 && <> · {sel.length} chosen</>}{playing && <> · playing</>} · {readonly ? "Read-only, read again every 5 s" : status === "saving" ? "Saving…" : status === "waiting" ? "Changed" : status === "failed" ? <strong>Not saved</strong> : "Saved"}</StatusBar>
      {drop && createPortal(<>{drop.line && <i className="tl-insert" style={{ left: drop.line[0], top: drop.line[1], height: drop.line[2] }} />}<div className="oc-dock__ghost" style={{ left: drop.x + 12, top: drop.y + 12 }}><Icon name={drop.into ? "check" : "plus"} size={12} />{drop.into ? `Fill the placeholder with ${drop.label}` : drop.label}</div></>, document.body)}
    </div>
  );
}
