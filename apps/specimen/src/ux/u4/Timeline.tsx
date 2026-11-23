// UX workshop U4, round 1: the timeline. A stage that plays the cut, the strip of clips below it (each as wide as it
// lasts), and panels around them: the project's files, the files in this timeline, chapters, and the chosen clip. A
// shot with a progression shows spread or collapsed; a canvas is edited in place. The master timeline is the same
// window with timelines for clips. A prototype on fake data: no server, no product code.
// Specified in docs/rewrite/06-timeline.md.
import "../u3/u3.css";
import "./u4.css";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  AppIcon, Badge, Banner, Button, Dock, DropdownMenu, EmptyState, Icon, NumberInput, PropertyList, PropertyRow, PropertySection, SearchInput, Segmented, Slider, StatusBar, Switch, TextInput, Toast, Toolbar, ToolbarSpacer, cx, dockShow, useDockLayout,
  type DockPanel,
} from "@openclapper/design";
import { ColourButton, css } from "../u1/catalogue";
import { TYPES, type FileRec } from "../u1/data";
import U2Canvas from "../u2/Canvas";
import { DOCS, START_PROGS, clock, holds, type Ref } from "../u3/model";
import { Pic, see, type Mode } from "../u3/Pic";
import { FileChip, FileProps } from "../u3/Props";
import { moved, useSort } from "../u3/sortable";
import { CUTS, FILES4, MASTER, type Clip, type Seg } from "./model";

/** A block of the strip: a clip of a timeline, or a whole timeline in the master. */
interface Block { id: string; name: string; file?: FileRec; segs: Seg[]; len: number; start: number; fixed: boolean; clip?: Clip }
const PICTURE = ["photo", "canvas"];
let n = 0;
const uid = () => `n${++n}`;

export default function U4Timeline() {
  const [files, setFiles] = useState<FileRec[]>(FILES4);
  const [cuts, setCuts] = useState<Record<string, Clip[]>>(CUTS);
  const [master, setMaster] = useState<string[]>(MASTER);
  const [cur, setCur] = useState("t1");
  const [sel, setSel] = useState<string | null>("a1");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [spread, setSpread] = useState("spread");
  const [scale, setScale] = useState(56);
  const [mode, setMode] = useState<Mode>("crop");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ x: number; y: number; ref: Ref; at: number | null; line: [number, number, number] | null; root: Element } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState("dark");
  const [panels, setPanels, resetPanels] = useDockLayout("u4", { left: { tabs: ["files", "used", "chapters"] }, right: { tabs: ["clip"] }, bottom: { tabs: ["strip"] } });
  const track = useRef<HTMLDivElement>(null);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((x) => (x === m ? null : x)), 3200); };

  const map = new Map(files.map((f) => [f.id, f]));
  const isMaster = cur === "master", clips = isMaster ? [] : cuts[cur];
  const nameOf = (c: Clip) => { if (!c.ref) return c.title || "Placeholder"; const f = map.get(c.ref.file); return !f ? "Missing file" : c.ref.frame ? `${f.name} · ${DOCS[f.id]?.frames.find((x) => x.id === c.ref!.frame)?.name ?? "frame"}` : f.name; };
  /** What a clip plays: a picture for its hold time, or a shot's progression at the progression's own timing. */
  const segsOf = (c: Clip): Seg[] => {
    if (!c.ref) return [{ dur: c.hold, kind: "placeholder", label: c.title || "Placeholder" }];
    const f = map.get(c.ref.file);
    if (!f || f.binned) return [{ dur: c.hold, kind: "missing", ref: c.ref, label: f ? `${f.name} · in the bin` : "Missing file" }];
    if (f.type !== "shot") return [{ dur: c.hold, kind: "pic", ref: c.ref, label: nameOf(c) }];
    const p = START_PROGS[f.id];
    if (p?.items.length) { const hs = holds(p); return p.items.map((it, i) => ({ dur: hs[i], kind: "prog", ref: it, def: p.frame, overlay: !!p.overlay?.visible, label: `${f.name} · ${i + 1}` })); }
    const first = (f.content ?? []).find((id) => { const x = map.get(id); return x && !x.binned && PICTURE.includes(x.type); });
    return [{ dur: c.hold, kind: first ? "pic" : "empty", ref: first ? { file: first } : undefined, label: f.name }];
  };
  /** The picture a file stands for in a list: a shot shows the first picture of its progression or content. */
  const thumb = (id: string, frame?: string) => { const f = map.get(id); if (f?.type !== "shot") return see({ file: id, frame }, map, DOCS); const s = segsOf({ id: "", ref: { file: id }, hold: 0 })[0]; return s.ref ? see(s.ref, map, DOCS, s.def) : see({ file: id }, map, DOCS); };
  let at = 0;
  const blocks: Block[] = (isMaster
    ? master.map((id) => { const segs = cuts[id].flatMap(segsOf); return { id, name: map.get(id)!.name, file: map.get(id), segs, fixed: true }; })
    : clips.map((c) => { const segs = segsOf(c), f = c.ref ? map.get(c.ref.file) : undefined; return { id: c.id, name: nameOf(c), file: f, segs, fixed: segs[0].kind === "prog", clip: c }; })
  ).map((b) => { const len = b.segs.reduce((a, s) => a + s.dur, 0), start = at; at += len; return { ...b, len, start }; });
  const total = at;
  const here = Math.min(t, Math.max(0, total - 0.001));
  const block = blocks.find((b) => here >= b.start && here < b.start + b.len) ?? blocks[0];
  let segStart = block?.start ?? 0;
  const seg = block?.segs.find((s) => { if (here < segStart + s.dur) return true; segStart += s.dur; return false; }) ?? block?.segs[0];
  const chosen = blocks.find((b) => b.id === sel) ?? null, clip = chosen?.clip;
  const chapters = isMaster ? blocks.map((b, i) => ({ id: b.id, title: b.name, color: (i % 8) + 1, start: b.start })) : blocks.filter((b) => b.clip?.marker).map((b) => ({ id: b.id, ...b.clip!.marker!, start: b.start }));
  const chapterAt = [...chapters].reverse().find((c) => c.start <= here);
  const usedBy = (id: string) => files.filter((f) => !f.binned && f.id !== cur && ((f.content ?? []).includes(id) || (cuts[f.id] ?? []).some((c) => c.ref?.file === id) || START_PROGS[f.id]?.items.some((i) => i.file === id)));

  // Playback runs on the clock. Editing and playback do not mix.
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now() - t * 1000; let raf = 0;
    const tick = () => { const now = (performance.now() - t0) / 1000; if (now >= total) { setPlaying(false); setT(0); } else { setT(now); raf = requestAnimationFrame(tick); } };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
  const setClips = (list: Clip[]) => setCuts({ ...cuts, [cur]: list });
  const patch = (id: string, c: Partial<Clip>) => setClips(clips.map((x) => (x.id === id ? { ...x, ...c } : x)));
  const seek = (time: number) => { setPlaying(false); setEditing(null); const x = Math.max(0, Math.min(total, time)); setT(x); const b = blocks.find((k) => x >= k.start && x < k.start + k.len); if (b) setSel(b.id); };
  const pick = (b: Block, time = b.start) => { setPlaying(false); if (editing && editing !== b.id) setEditing(null); setSel(b.id); setT(time); };
  const go = (id: string) => { setCur(id); setPlaying(false); setEditing(null); setT(0); setSel(id === "master" ? master[0] ?? null : cuts[id][0]?.id ?? null); };
  const insert = (refs: Ref[], index?: number) => {
    const i = index ?? (clip ? clips.findIndex((c) => c.id === clip.id) + 1 : clips.length), fresh = refs.map((ref) => ({ id: uid(), ref, hold: 2 }));
    setClips([...clips.slice(0, i), ...fresh, ...clips.slice(i)]); setSel(fresh[0].id); say(`${fresh.length === 1 ? nameOf(fresh[0]) : `${fresh.length} clips`} added to the cut`);
  };
  const remove = (id: string) => { if (isMaster) setMaster(master.filter((x) => x !== id)); else setClips(clips.filter((c) => c.id !== id)); setSel(null); setEditing(null); };
  const stretch = (b: Block) => (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, orig = b.clip!.hold, id = b.id, key = cur;
    const move = (m: PointerEvent) => setCuts((now) => ({ ...now, [key]: now[key].map((c) => (c.id === id ? { ...c, hold: Math.max(0.5, Math.round((orig + (m.clientX - sx) / scale) * 2) / 2) } : c)) }));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const sort = useSort("x", (a, b) => (isMaster ? setMaster(moved(master, a, b)) : setClips(moved(clips, a, b))));
  const sortM = useSort("y", (a, b) => setMaster(moved(master, a, b)));
  /** Dragging a file out of the Files panel: a ghost at the pointer, and a line in the strip where the clip would go. */
  const fileDrag = (ref: Ref) => (e: PointerEvent) => {
    if (e.button !== 0 || isMaster) return;
    const sx = e.clientX, sy = e.clientY, root = (e.currentTarget as HTMLElement).closest("[data-theme]") ?? document.body;
    let live: typeof drop = null;
    const move = (m: PointerEvent) => {
      if (!live && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
      const box = track.current?.getBoundingClientRect(), inside = box && m.clientY > box.top - 40 && m.clientY < box.bottom + 16 && m.clientX > box.left - 8;
      let index: number | null = null, line: [number, number, number] | null = null;
      if (box && inside) { const rs = [...track.current!.querySelectorAll(":scope > [data-sort]")].map((c) => c.getBoundingClientRect()); index = rs.filter((r) => r.left + r.width / 2 < m.clientX).length; line = [index < rs.length ? rs[index].left - 2 : (rs[rs.length - 1]?.right ?? box.left) + 1, box.top, box.height]; }
      live = { x: m.clientX, y: m.clientY, ref, at: index, line, root }; setDrop(live);
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); setDrop(null); if (live?.at != null) insert([ref], live.at); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      const i = blocks.findIndex((b) => b.id === sel);
      if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === "ArrowRight" && blocks[i + 1]) pick(blocks[i + 1]);
      else if (e.key === "ArrowLeft" && blocks[i - 1]) pick(blocks[i - 1]);
      else if ((e.key === "Delete" || e.key === "Backspace") && sel) remove(sel);
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  });

  // The stage: the picture under the playhead, or the canvas tool in its place.
  const seen = seg?.ref ? see(seg.ref, map, DOCS, seg.def, seg.ref.to ? Math.min(1, (here - segStart) / seg.dur) : 0) : null;
  const editBlock = editing ? blocks.find((b) => b.id === editing) : undefined;
  const others = editBlock?.file ? usedBy(editBlock.file.id) : [];
  const stage = editBlock?.file ? (
    <div className="u3-top u3-top--edit">
      <div className="u3-host">
        <Button size="sm" icon="arrow-left" onClick={() => setEditing(null)}>Back to the cut</Button>
        <span className="u3-host__crumb"><AppIcon glyph="timeline" color={6} size={20} />{isMaster ? "Master" : map.get(cur)!.name}<Icon name="chevron-right" size={12} /><AppIcon glyph="brush" color={2} size={20} /><strong>{editBlock.file.name}</strong></span>
        <span className="u3-host__note">{others.length ? <><Icon name="link" size={12} /> You are changing the file itself. Also used in: {others.map((f) => f.name).join(", ")}</> : <><Icon name="file" size={12} /> Used only in this timeline</>}</span>
        <span style={{ flex: 1 }} />
        {others.length > 0 && <Button size="sm" variant="quiet" icon="copy" onClick={() => say(`A copy of “${editBlock.file!.name}” takes its place in this clip; the original stays as it is`)}>Edit a copy instead</Button>}
        <Button size="sm" variant="primary" icon="check" onClick={() => setEditing(null)}>Done</Button>
      </div>
      <U2Canvas key={editing} host={{ title: editBlock.file.name, theme, blank: !DOCS[editBlock.file.id]?.base }} />
    </div>
  ) : (
    <div className="u4-stage">
      <div className="oc-app__stage u3-stage">
        {!seg ? <EmptyState icon="timeline" title="An empty cut">Drag files in from the Files panel, or add a placeholder.</EmptyState>
          : seg.kind === "placeholder" ? <div className="u4-card"><Icon name="hourglass" size={20} /><strong>{seg.label}</strong><span>A placeholder: something is still missing here.</span></div>
            : seg.kind === "missing" ? <div className="u4-card is-missing"><Icon name="warning" size={20} /><strong>{seg.label}</strong><span>The clip stays in its place until the file is restored or the clip is removed.</span></div>
              : seg.kind === "empty" || !seen ? <div className="u4-card"><Icon name="slate" size={20} /><strong>{seg.label}</strong><span>This shot has no picture yet.</span></div>
                : <div className="u3-box"><Pic seen={seen} mode={mode} overlay={seg.overlay} label /></div>}
        {seg && block && <span className="u3-caption">{chapterAt && <b className="u4-chap" style={{ background: css(chapterAt.color) }}>{chapterAt.title}</b>}{block.name}{block.segs.length > 1 && <small> · picture {block.segs.indexOf(seg) + 1} of {block.segs.length}</small>}</span>}
      </div>
      <div className="u4-transport">
        <Button size="sm" variant="quiet" icon="skip-back" label="To the start" onClick={() => seek(0)} />
        <Button size="sm" variant="quiet" icon="chevron-left" label="Previous clip (←)" onClick={() => { const i = blocks.indexOf(block!); if (blocks[i - 1]) pick(blocks[i - 1]); }} />
        <Button size="sm" variant="primary" icon={playing ? "pause" : "play"} label={playing ? "Pause (Space)" : "Play (Space)"} disabled={!blocks.length} onClick={() => { setEditing(null); setPlaying(!playing); }} />
        <Button size="sm" variant="quiet" icon="chevron-right" label="Next clip (→)" onClick={() => { const i = blocks.indexOf(block!); if (blocks[i + 1]) pick(blocks[i + 1]); }} />
        <span className="u4-time oc-num"><strong>{clock(here)}</strong> / {clock(total)}</span>
        <span style={{ flex: 1 }} />
        <Segmented label="View mode" value={mode} disabled={!seen?.frame} onChange={(v) => setMode(v as Mode)} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} />
      </div>
    </div>
  );

  // The strip: a ruler, the chapters, and the clips, each as wide as it lasts.
  const step = scale > 90 ? 1 : scale > 40 ? 2 : 5, ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  const scrub = (e: PointerEvent) => { const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect(); const to = (m: PointerEvent) => seek((m.clientX - r.left) / scale); to(e); const up = () => { removeEventListener("pointermove", to); removeEventListener("pointerup", up); }; addEventListener("pointermove", to); addEventListener("pointerup", up); };
  const strip = !blocks.length ? <p className="u3-note">{isMaster ? "No timeline is in the master yet. Add one from the Timelines panel." : "Nothing in this cut yet. Drag files here from the Files panel."}</p> : (
    <div className="u4-scroll">
      <div className="u4-lanes" style={{ width: total * scale + 80 }}>
        <div className="u4-ruler" onPointerDown={scrub}>{ticks.map((s) => <span key={s} style={{ left: s * scale }}>{clock(s)}</span>)}</div>
        <div className="u4-chapters">{chapters.map((c, i) => <button type="button" key={c.id} style={{ left: c.start * scale, width: ((chapters[i + 1]?.start ?? total) - c.start) * scale, "--c": css(c.color) }} title={`Chapter “${c.title}”`} onClick={() => pick(blocks.find((b) => b.id === c.id)!)}><Icon name="bookmark" size={10} />{c.title}</button>)}</div>
        <div className="u4-track" ref={track}>
          {blocks.map((b, i) => {
            const many = b.segs.length > 1, cells = many && spread === "spread" ? b.segs : [b.segs[0]];
            let s0 = b.start;
            return (
              <div key={b.id} data-sort role="button" tabIndex={0} className={cx("u4-clip", sel === b.id && "is-current", many && "is-group", b.segs[0].kind === "placeholder" && "is-placeholder", b.segs[0].kind === "missing" && "is-missing")} style={{ width: b.len * scale, ...sort.style(i) }} title={b.name} onPointerDown={sort.start(i)} onClick={() => pick(b)} onDblClick={() => (isMaster ? go(b.id) : b.file?.type === "canvas" ? (pick(b), setEditing(b.id)) : b.file && say(`“${b.file.name}” opens in the ${TYPES[b.file.type].app} app, in a window of its own`))}>
                <span className="u4-clip__cells">
                  {cells.map((s, k) => { const from = s0; s0 += s.dur; return (
                    <span key={k} className="u4-cell" style={{ flex: cells.length > 1 ? `${s.dur} 1 0px` : 1 }} onClick={(e) => { if (cells.length > 1) { e.stopPropagation(); pick(b, from); } }}>
                      <span className="u3-item__art">{s.ref && s.kind !== "missing" ? <Pic seen={see(s.ref, map, DOCS, s.def)} overlay={s.overlay} /> : <span className="u4-cell__none"><Icon name={s.kind === "placeholder" ? "hourglass" : s.kind === "missing" ? "warning" : "slate"} /></span>}</span>
                    </span>
                  ); })}
                </span>
                <span className="u4-clip__label">{b.file && <AppIcon glyph={TYPES[b.file.type].glyph} color={TYPES[b.file.type].color} size={20} />}<b>{b.name}</b>{many && <small title={spread === "spread" ? "A progression, spread" : "A progression, collapsed"}><Icon name="layers" size={10} />{b.segs.length}</small>}<i className="oc-num">{clock(b.len)}</i></span>
                {!b.fixed && <i data-nodrag className="u3-item__grip" title="Drag to change how long it holds" onPointerDown={stretch(b)} />}
              </div>
            );
          })}
          {sort.ghost((i) => <div className="u4-clip is-current" style={{ width: "100%" }}><span className="u4-clip__cells"><span className="u4-cell" style={{ flex: 1 }}><span className="u3-item__art">{blocks[i].segs[0].ref && <Pic seen={see(blocks[i].segs[0].ref!, map, DOCS, blocks[i].segs[0].def)} />}</span></span></span><span className="u4-clip__label"><b>{blocks[i].name}</b></span></div>)}
        </div>
        <i className="u4-playhead" style={{ left: here * scale }} />
      </div>
    </div>
  );
  const stripActions = (
    <>
      <span className="u3-sec__count oc-num">{blocks.length} {isMaster ? "timelines" : "clips"} · {clock(total)}</span>
      {!isMaster && <Button size="sm" variant="quiet" icon="hourglass" title="A place in the cut where something is still missing" onClick={() => { const c = { id: uid(), hold: 2, title: "Placeholder" }, i = clip ? clips.findIndex((x) => x.id === clip.id) + 1 : clips.length; setClips([...clips.slice(0, i), c, ...clips.slice(i)]); setSel(c.id); setPanels(dockShow(panels, "clip")); }}>Placeholder</Button>}
      {!isMaster && <Button size="sm" variant="quiet" icon="bookmark" disabled={!clip} selected={!!clip?.marker} title="A chapter starts at the chosen clip" onClick={() => clip && patch(clip.id, { marker: clip.marker ? undefined : { title: "New chapter", color: 3 } })}>Chapter</Button>}
      <span style={{ flex: 1 }} />
      <Segmented label="Shots with a progression" value={spread} onChange={setSpread} options={[{ value: "spread", label: "Spread", title: "One cell per picture of a progression" }, { value: "collapsed", label: "Collapsed", title: "A progression as one clip showing its first picture" }]} />
      <span className="u3-slide" style={{ flex: "none", width: 150 }} title="Zoom the strip"><Icon name="zoom-out" size={12} /><Slider min={16} max={160} step={4} value={scale} onChange={setScale} /><Icon name="zoom-in" size={12} /></span>
    </>
  );

  // Panels at the sides.
  const offered = files.filter((f) => !f.binned && !f.internalOf && ["photo", "canvas", "shot", "collection"].includes(f.type) && (kind === "all" || f.type === kind || (kind === "photo" && f.type === "collection")) && (!q || f.name.toLowerCase().includes(q.toLowerCase())));
  const inColl = (f: FileRec) => f.parent != null && map.get(f.parent)?.type === "collection";
  const fileRow = (f: FileRec, ref: Ref, label: string, depth = 0, extra?: ComponentChildren) => (
    <li key={`${ref.file}${ref.frame ?? ""}`} className="u4-file" style={{ paddingLeft: 6 + depth * 18 }} onPointerDown={fileDrag(ref)} onDblClick={() => !isMaster && insert([ref])} title="Drag into the cut, or double-click to add after the chosen clip">
      <span className="u3-pickrow__art"><Pic seen={thumb(ref.file, ref.frame)} /></span>
      <span className="u3-pickrow__name">{label}<small>{ref.frame ? "One frame of the canvas" : TYPES[f.type].label}{f.type === "shot" && START_PROGS[f.id] ? ` · progression, ${clock(holds(START_PROGS[f.id]).reduce((a, b) => a + b, 0))}` : ""}</small></span>
      {extra && <span data-nodrag onPointerDown={(e) => e.stopPropagation()}>{extra}</span>}
      <Button size="sm" variant="quiet" icon="plus" label={`Add ${label} to the cut`} data-nodrag disabled={isMaster} onPointerDown={(e) => e.stopPropagation()} onClick={() => insert([ref])} />
    </li>
  );
  const filesBody = (
    <ul className="u4-files">
      {offered.filter((f) => !inColl(f)).sort((a, b) => TYPES[a.type].label.localeCompare(TYPES[b.type].label) || a.name.localeCompare(b.name, undefined, { numeric: true })).flatMap((f) => {
        const on = open.includes(f.id), twist = (count: number, what: string) => <Button size="sm" variant="quiet" iconAfter={on ? "chevron-up" : "chevron-down"} onClick={() => setOpen(on ? open.filter((x) => x !== f.id) : [...open, f.id])}>{count} {what}</Button>;
        if (f.type === "collection") { const kids = files.filter((c) => c.parent === f.id && !c.binned); return [<li key={f.id} className="u4-file u4-file--coll"><AppIcon glyph="layers" color={4} size={24} /><span className="u3-pickrow__name">{f.name}<small>Collection: its photos are added one by one</small></span>{twist(kids.length, "photos")}</li>, ...(on ? kids.map((c) => fileRow(c, { file: c.id }, c.name, 1)) : [])]; }
        const frames = f.type === "canvas" ? DOCS[f.id]?.frames ?? [] : [];
        return [fileRow(f, { file: f.id }, f.name, 0, frames.length > 0 ? twist(frames.length, "frames") : undefined), ...(on ? frames.map((fr) => fileRow(f, { file: f.id, frame: fr.id }, `${f.name} · ${fr.name}`, 1)) : [])];
      })}
    </ul>
  );
  const used = [...new Set(clips.filter((c) => c.ref).map((c) => c.ref!.file))].map((id) => ({ id, f: map.get(id), count: clips.filter((c) => c.ref?.file === id).length }));
  const usedBody = isMaster ? <p className="u3-note">Open a timeline to see the files it uses.</p> : (
    <ul className="u4-files">
      {used.map(({ id, f, count }) => (
        <li key={id} className={cx("u4-file", (!f || f.binned) && "is-missing")} onClick={() => { const b = blocks.find((x) => x.clip?.ref?.file === id); if (b) pick(b); }}>
          <span className="u3-pickrow__art"><Pic seen={thumb(id)} /></span>
          <span className="u3-pickrow__name">{f ? f.name : "Missing file"}<small>{f?.binned ? "In the recycle bin" : f ? TYPES[f.type].label : ""}</small></span>
          <Badge count>{count}×</Badge>
        </li>
      ))}
      {clips.some((c) => !c.ref) && <li className="u4-file"><span className="u4-cell__none u3-pickrow__art"><Icon name="hourglass" /></span><span className="u3-pickrow__name">Placeholders<small>Nothing yet</small></span><Badge count>{clips.filter((c) => !c.ref).length}×</Badge></li>}
    </ul>
  );
  const chaptersBody = !chapters.length ? <p className="u3-note">No chapters. Choose a clip and press Chapter in the strip: a chapter starts there.</p> : (
    <ul className="u4-files">{chapters.map((c, i) => <li key={c.id} className={cx("u4-file", chapterAt?.id === c.id && "is-on")} onClick={() => pick(blocks.find((b) => b.id === c.id)!)}><i className="u4-dot" style={{ background: css(c.color) }} /><span className="u3-pickrow__name">{c.title}<small className="oc-num">{clock(c.start)} · {clock((chapters[i + 1]?.start ?? total) - c.start)} long</small></span></li>)}</ul>
  );
  const outside = files.filter((f) => f.type === "timeline" && !f.binned && !master.includes(f.id));
  const timelinesBody = (
    <>
      <ul className="u4-files">
        {master.map((id, i) => <li key={id} data-sort className={cx("u4-file", sel === id && "is-on")} style={sortM.style(i)} onPointerDown={sortM.start(i)} onClick={() => pick(blocks[i])} onDblClick={() => go(id)}><Icon name="grip" size={12} /><b className="oc-num">{i + 1}</b><span className="u3-pickrow__name">{map.get(id)!.name}<small className="oc-num">{cuts[id].length} clips · {clock(blocks[i]?.len ?? 0)}</small></span><Button size="sm" variant="quiet" icon="close" label="Take out of the master" data-nodrag onClick={(e) => { e.stopPropagation(); remove(id); }} /></li>)}
        {sortM.ghost((i) => <div className="u4-file is-on"><Icon name="grip" size={12} /><span className="u3-pickrow__name">{map.get(master[i])!.name}</span></div>)}
      </ul>
      <p className="u3-note">Not in the master: alternatives and experiments.</p>
      <ul className="u4-files">{outside.map((f) => <li key={f.id} className="u4-file" onDblClick={() => go(f.id)}><AppIcon glyph="timeline" color={6} size={20} /><span className="u3-pickrow__name">{f.name}<small className="oc-num">{cuts[f.id].length} clips</small></span><Button size="sm" variant="quiet" icon="plus" onClick={() => setMaster([...master, f.id])}>Add</Button></li>)}{!outside.length && <li className="u3-note">Every timeline of the project is in the master.</li>}</ul>
    </>
  );
  const file = chosen?.file;
  const clipBody = !chosen ? <EmptyState icon="info" title="Nothing chosen">Click a clip in the strip.</EmptyState> : isMaster ? (
    <PropertyList>
      <PropertySection title="Timeline" icon="timeline">
        <PropertyRow label="Name" value={chosen.name} /><PropertyRow label="Clips" value={String(cuts[chosen.id].length)} numeric /><PropertyRow label="Length" value={clock(chosen.len)} numeric /><PropertyRow label="Starts at" value={clock(chosen.start)} numeric />
        <div className="u3-bar u4-pad u4-wrap"><Button size="sm" icon="external" onClick={() => go(chosen.id)}>Open the timeline</Button><Button size="sm" variant="quiet" icon="close" onClick={() => remove(chosen.id)}>Take out of the master</Button></div>
        <p className="u3-note">Only membership and order are set here. Clips are edited in the timeline.</p>
      </PropertySection>
    </PropertyList>
  ) : clip && (
    <>
      <header className="u3-head">
        <span className="u3-head__art">{chosen.segs[0].ref && chosen.segs[0].kind !== "missing" ? <Pic seen={see(chosen.segs[0].ref, map, DOCS, chosen.segs[0].def)} /> : <span className="u4-cell__none"><Icon name={clip.ref ? "warning" : "hourglass"} size={20} /></span>}</span>
        {clip.ref ? <span className="u3-chips"><FileChip file={map.get(clip.ref.file)} onOpen={(id) => say(`“${map.get(id)!.name}” opens in the ${TYPES[map.get(id)!.type].app} app, in a window of its own`)} />{clip.ref.frame && <Badge icon="frame">{DOCS[clip.ref.file]?.frames.find((x) => x.id === clip.ref!.frame)?.name}</Badge>}</span> : <TextInput value={clip.title ?? ""} aria-label="Title of the placeholder" placeholder="What is missing here" onInput={(e) => patch(clip.id, { title: (e.target as HTMLInputElement).value })} />}
      </header>
      {chosen.segs[0].kind === "missing" && <Banner tone="warning" action={file && <Button size="sm" variant="quiet" onClick={() => { setFiles(files.map((f) => (f.id === file.id ? { ...f, binned: false } : f))); say(`Restored “${file.name}”`); }}>Restore</Button>}>The file is {file ? "in the recycle bin" : "gone"}. The clip keeps its place.</Banner>}
      <PropertyList key={clip.id}>
        <PropertySection title="Clip" icon="timeline">
          {chosen.fixed ? <PropertyRow label="Plays" value={`its progression: ${chosen.segs.length} pictures, ${clock(chosen.len)}`} /> : <PropertyRow label="Holds"><NumberInput size="sm" value={clip.hold} unit="s" min={0.1} max={3600} step={0.5} onChange={(v) => patch(clip.id, { hold: v })} /></PropertyRow>}
          <PropertyRow label="Starts at" value={clock(chosen.start)} numeric />
          {chosen.fixed && <p className="u3-note">The pictures and their timing belong to the shot and are changed there. The clip has no time of its own.</p>}
          <div className="u3-bar u4-pad u4-wrap">
            {file?.type === "canvas" && !file.binned && <Button size="sm" icon="edit" onClick={() => { pick(chosen); setEditing(chosen.id); }}>Edit here</Button>}
            {file?.type === "photo" && !file.binned && <Button size="sm" icon="brush" onClick={() => say(`Makes a canvas on “${file.name}” and points this clip at it: draw on it, give it a look, frame it`)}>Make a canvas from it</Button>}
            {file && !file.binned && <Button size="sm" variant="quiet" icon="external" onClick={() => say(`“${file.name}” opens in the ${TYPES[file.type].app} app, in a window of its own`)}>Open</Button>}
            {!clip.ref && <Button size="sm" icon="plus" onClick={() => { setPanels(dockShow(panels, "files")); say("Drag a file from the Files panel onto the strip; then remove the placeholder"); }}>Fill it</Button>}
            <Button size="sm" variant="quiet" icon="trash" onClick={() => remove(clip.id)}>Remove</Button>
          </div>
        </PropertySection>
        <PropertySection title="Chapter" icon="bookmark">
          <div className="u4-pad"><Switch checked={!!clip.marker} onChange={(c) => patch(clip.id, { marker: c ? { title: "New chapter", color: 3 } : undefined })}>A chapter starts here</Switch></div>
          {clip.marker && <PropertyRow label="Title"><span className="u3-inline" style={{ flex: 1 }}><ColourButton value={clip.marker.color} label="Chapter colour" onChange={(c) => patch(clip.id, { marker: { ...clip.marker!, color: c as number } })} /><TextInput size="sm" value={clip.marker.title} onInput={(e) => patch(clip.id, { marker: { ...clip.marker!, title: (e.target as HTMLInputElement).value } })} /></span></PropertyRow>}
        </PropertySection>
        {file && !file.binned && usedBy(file.id).length > 0 && <PropertySection title={`The file is also used in · ${usedBy(file.id).length}`} icon="link" defaultOpen={false}><div className="u3-chips u3-chips--pad">{usedBy(file.id).map((f) => <FileChip key={f.id} file={f} onOpen={(id) => (cuts[id] ? go(id) : say(`“${map.get(id)!.name}” opens in a window of its own`))} />)}</div></PropertySection>}
        {file && !file.binned && <FileProps file={file} files={files} onProp={(k, v) => setFiles(files.map((f) => (f.id === file.id ? { ...f, props: { ...f.props, [k]: v } } : f)))} onPos={() => undefined} onOpen={(id) => say(`“${map.get(id)!.name}” opens in a window of its own`)} />}
      </PropertyList>
    </>
  );

  const dockPanels: DockPanel[] = [
    ...(isMaster ? [{ id: "timelines", title: "Timelines", icon: "timeline" as const, body: timelinesBody }] : [
      { id: "files", title: "Files", icon: "folder" as const, actions: <><SearchInput size="sm" value={q} onChange={setQ} placeholder="Name" style={{ flex: 1, minWidth: 90 }} /><Segmented label="Type" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "shot", icon: "slate", title: "Shots" }, { value: "photo", icon: "image", title: "Photos" }, { value: "canvas", icon: "brush", title: "Canvases" }]} /></>, body: filesBody },
      { id: "used", title: "In use", icon: "files" as const, body: usedBody },
      { id: "chapters", title: "Chapters", icon: "bookmark" as const, body: chaptersBody },
    ]),
    { id: "clip", title: isMaster ? "Timeline" : "Clip", icon: "info", body: clipBody },
    { id: "strip", title: isMaster ? "Master" : "Cut", icon: "film", actions: stripActions, body: strip },
  ];
  const layout = isMaster ? { ...panels, left: { tabs: ["timelines"] } } : panels;
  return (
    <div className="u3 u4" data-theme={theme}>
      <header className="u3-proto">
        <strong>U4</strong><span className="u3-proto__note">prototype</span>
        <span className="u3-proto__files" role="tablist" aria-label="Open file">
          {["t1", "t2", "t3"].map((id) => <button type="button" key={id} role="tab" aria-selected={cur === id} className={cx(cur === id && "is-on")} onClick={() => go(id)}><AppIcon glyph="timeline" color={6} size={20} />{map.get(id)!.name}</button>)}
          <button type="button" role="tab" aria-selected={isMaster} className={cx(isMaster && "is-on")} onClick={() => go("master")}><AppIcon glyph="film" color={1} size={20} />Master timeline</button>
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      <div className="oc-app u3-win">
        <Toolbar>
          <AppIcon glyph={isMaster ? "film" : "timeline"} color={isMaster ? 1 : 6} size={24} /><strong className="u3-title">{isMaster ? "Master timeline" : map.get(cur)!.name}</strong>
          {!isMaster && <Badge>{master.includes(cur) ? `No. ${master.indexOf(cur) + 1} in the master` : "Not in the master"}</Badge>}
          <ToolbarSpacer />
          <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "panels", label: "Panels back to their places", icon: "refresh" }]} onSelect={() => resetPanels()} />
        </Toolbar>
        <Dock panels={dockPanels} layout={layout} onLayoutChange={(l) => setPanels(isMaster ? { ...l, left: panels.left } : l)} zoneSizes={{ left: 300, right: 320, bottom: 236 }}>{stage}</Dock>
        <StatusBar>{isMaster ? <>{master.length} timelines play end to end · {clock(total)}</> : <>{clips.length} clips · {clock(total)} · {chapters.length} chapters{clips.some((c) => !c.ref) && <> · {clips.filter((c) => !c.ref).length} placeholders</>}</>}{playing && <> · playing</>}{editing && <> · editing <strong>{editBlock?.file?.name}</strong> in place: playback is paused and the playhead stays on the clip</>}</StatusBar>
      </div>
      {drop && createPortal(<>{drop.line && <i className="u4-insert" style={{ left: drop.line[0], top: drop.line[1], height: drop.line[2] }} />}<div className="oc-dock__ghost" style={{ left: drop.x + 12, top: drop.y + 12 }}><Icon name="plus" size={12} />{nameOf({ id: "", ref: drop.ref, hold: 0 })}</div></>, drop.root)}
      {toast && <Toast className="u3-toast" tone="info" onDismiss={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
}
