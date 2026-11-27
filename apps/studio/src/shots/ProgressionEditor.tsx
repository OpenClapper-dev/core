// The progression editor (docs/features/shots.md, #426 feedback 4): one progression of a shot as a small timeline.
// A ruler with the playhead and its knob, the clips (each as wide as it holds, with its pictures), choosing them
// (click, Shift, Ctrl, a box), moving them by dragging, pulling the right edge to change the time, a context menu
// (cut, copy, paste, duplicate, delete, edit), the keys of the "shot" scope, and drops of photos and canvases
// from the content list, a Files window or the desktop. The shot window owns the playhead and the choice; this
// draws the panel's head and body and edits the progression through `edit`.
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AppIcon, Badge, Button, Checkbox, DropdownMenu, Icon, NumberInput, Playhead, Select, Slider, TimeRuler, clickSelect, cx, useMarquee, useTimeScrub } from "@openclapper/design";
import { ITEM_MS, TOTAL_MS, itemUnits, type ItemData, type Progression } from "@openclapper/model";
import type { FileRec } from "../api";
import { kindOf } from "../fileKinds";
import { hasDrag, readDrag } from "../fileOps";
import { contextMenu, toast } from "../hosts";
import { bind, isTyping, useKeys } from "../keys";
import type { Preset } from "../optics";
import type { ProgDoc } from "./doc";
import { Pic } from "./Pic";
import { see, type PicCtx } from "./picture";
import { frameIdsOf, itemKey, pictureOf, type Item } from "./progression";
import { DefaultFrame, clock } from "./progressionParts";

const PAD = 16;
const SCALE = { min: 10, max: 400 };
const TIMING = [{ value: "each", label: "Each picture its own time" }, { value: "even", label: "One length, split evenly" }, { value: "ends", label: "One length, first and last longer" }];
const KIND: Record<string, string> = { photo: "Photo", canvas: "Canvas", frame: "One frame of a canvas", move: "Smooth move between two frames", zoom: "Generated zoom" };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** What sort of item it is, for its label and its menu. */
export function itemKind(it: Item, files: ReadonlyMap<string, FileRec>): keyof typeof KIND {
  if (it.data.zoom) return "zoom";
  if (it.data.move) return "move";
  if (it.data.frame) return "frame";
  return files.get(it.to)?.type === "photo" ? "photo" : "canvas";
}
export const itemKindLabel = (k: string) => KIND[k] ?? k;

/** Copied or cut items, kept across progressions and shots of this Studio. */
const board: { items: Pick<Item, "to" | "data">[] | null } = { items: null };

export interface EditorProps {
  file: FileRec;
  doc: ProgDoc;
  progs: readonly FileRec[];
  files: ReadonlyMap<string, FileRec>;
  ctx: PicCtx;
  presets: readonly Preset[];
  readonly: boolean;
  /** Keys are live (the window has focus, nothing else holds them). */
  keys: boolean;
  overlaySrc: string | null;
  overlayEditing: boolean;
  times: number[]; starts: number[]; total: number;
  t: number; seek: (ms: number) => void; playing: boolean; togglePlay: () => void;
  sel: string[]; setSel: (keys: string[]) => void;
  /** Changes the progression; `merge` folds steps of one gesture into one undo step. */
  edit: (fn: (d: ProgDoc) => ProgDoc, merge?: string) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  isThumb: boolean; useAsThumb: () => void;
  pick: (id: string) => void; addNew: () => void; rename: () => void; duplicate: () => void; remove: () => void;
  generate: (gap: number) => void;
  addPictures: (gap: number) => void;
  addOverlay: () => void; editOverlay: () => void;
  editCanvas: (id: string) => void;
  /** Makes a file the shot's thumbnail (to the top of its content). */
  thumbFile: (id: string) => void;
  /** Items the window adds, made from files dropped or picked (`gap`: where they go). */
  insertFiles: (refs: { to: string; frame?: string }[], gap: number) => void;
}

export function useProgressionEditor(p: EditorProps) {
  const { doc, files, ctx, readonly } = p;
  const items = doc.items, body = doc.body, each = body.timing.mode === "each";
  const [scale, setScale] = useState(80);
  const [insert, setInsert] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const px = (ms: number) => (ms / 1000) * scale;
  const ends = [...p.starts, p.total];
  const width = Math.max((scroll.current?.clientWidth ?? 600), px(p.total) + PAD * 2 + 160);
  const scrub = useTimeScrub(scale, (ms) => p.seek(Math.min(ms, p.total)), PAD);
  const atIndex = (() => { for (let i = 0; i < items.length; i++) if (p.t < p.starts[i] + p.times[i]) return i; return items.length - 1; })();

  /** The gap (0..n) nearest to a point on the track, or null when the point is not over it. */
  const gapAt = (x: number, y?: number): number | null => {
    const r = scroll.current?.getBoundingClientRect(), ir = inner.current?.getBoundingClientRect();
    if (!r || !ir || x < r.left || x > r.right || (y != null && (y < r.top - 12 || y > r.bottom + 12))) return null;
    const t = ((x - ir.left - PAD) / scale) * 1000;
    for (let i = 0; i < items.length; i++) if (t < p.starts[i] + p.times[i] / 2) return i;
    return items.length;
  };
  /** Where something inserted "at the playhead" lands: the clip boundary nearest to it. */
  const playheadGap = () => { for (let i = 0; i < items.length; i++) if (p.t < p.starts[i] + p.times[i]) return p.t - p.starts[i] < p.times[i] / 2 ? i : i + 1; return items.length; };
  const fit = () => { const w = scroll.current?.clientWidth ?? 600; setScale(clamp((w - PAD * 2 - 40) / Math.max(1, (p.total || 4000) / 1000), SCALE.min, SCALE.max)); };
  // A progression opened or switched fits its width once.
  useEffect(() => { requestAnimationFrame(fit); }, [p.file.id]);
  // While playing the track follows the playhead.
  useEffect(() => {
    const s = scroll.current; if (!s || !p.playing) return;
    const x = PAD + px(p.t);
    if (x > s.scrollLeft + s.clientWidth - 40 || x < s.scrollLeft) s.scrollLeft = x - 60;
  }, [p.t, p.playing]);

  const chosen = () => items.filter((i) => p.sel.includes(i.key));
  const choose = (keys: string[]) => p.setSel(keys);
  const insertItems = (made: Item[], gap: number) => {
    p.edit((d) => ({ ...d, items: [...d.items.slice(0, gap), ...made, ...d.items.slice(gap)] }));
    choose(made.map((i) => i.key)); setAnchor(made[0]?.key ?? null);
    p.seek(ends[Math.min(gap, ends.length - 1)] ?? 0);
  };
  const clone = (x: Pick<Item, "to" | "data">): Item => ({ key: itemKey(), to: x.to, data: { ...x.data } });
  const removeChosen = (what = "removed") => {
    const n = p.sel.length; if (!n || readonly) return;
    p.edit((d) => ({ ...d, items: d.items.filter((i) => !p.sel.includes(i.key)) }));
    choose([]);
    toast(`${n} ${n === 1 ? "item" : "items"} ${what}. The files stay in the project; Ctrl+Z brings ${n === 1 ? "it" : "them"} back.`, { tone: "info" });
  };
  const copy = (cut: boolean) => {
    const c = chosen(); if (!c.length) return;
    board.items = c.map((i) => ({ to: i.to, data: { ...i.data } }));
    if (cut) removeChosen("cut"); else toast(`${c.length} copied`, { tone: "info" });
  };
  const paste = (gap?: number) => {
    if (!board.items || readonly) { toast("Nothing to paste", { tone: "info" }); return; }
    const after = p.sel.length ? Math.max(...items.map((it, i) => (p.sel.includes(it.key) ? i : -1))) + 1 : playheadGap();
    insertItems(board.items.map(clone), gap ?? after);
  };
  const duplicate = () => { const c = chosen(); if (!c.length || readonly) return; insertItems(c.map(clone), Math.max(...c.map((i) => items.indexOf(i))) + 1); };
  // The choice as it is now: a drag started before the press re-rendered still moves what was chosen by it.
  const selNow = useRef(p.sel);
  selNow.current = p.sel;
  /** Moves the chosen items, in their order, to a gap of the list as it is. */
  const moveChosen = (gap: number) => p.edit((d) => {
    const s = selNow.current, pick = d.items.filter((i) => s.includes(i.key)), rest = d.items.filter((i) => !s.includes(i.key));
    const before = d.items.slice(0, gap).filter((i) => !s.includes(i.key)).length;
    return { ...d, items: [...rest.slice(0, before), ...pick, ...rest.slice(before)] };
  });
  const setTiming = (mode: string) => p.edit((d) => {
    if (mode === d.body.timing.mode) return d;
    if (mode === "each") return { ...d, body: { ...d.body, timing: { mode: "each" } }, items: d.items.map((it, i) => { const n = itemUnits(it.data, frameIdsOf(files, it.to).length); return { ...it, data: { ...it.data, ms: clamp(Math.round((p.times[i] ?? it.data.ms) / n / 100) * 100, ITEM_MS.min, ITEM_MS.max / n) * n } }; }) };
    return { ...d, body: { ...d.body, timing: { mode: mode as "even" | "ends", total: clamp(Math.round(p.total / 100) * 100 || 4000, TOTAL_MS.min, TOTAL_MS.max) } } };
  });
  const setBody = (b: Partial<Progression>) => p.edit((d) => ({ ...d, body: { ...d.body, ...b } }));

  // ---------- Pointer gestures on the track ----------
  const startClip = (i: number) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const it = items[i], mod = e.shiftKey || e.ctrlKey || e.metaKey, was = p.sel.includes(it.key);
    // A press on a chosen item keeps the choice, so several move together; a click without moving narrows it.
    const next = was && !mod ? p.sel : clickSelect(items.map((x) => x.key), p.sel, anchor, it.key, e);
    choose(next); if (!e.shiftKey) setAnchor(it.key);
    if (readonly) return;
    e.preventDefault();
    const x0 = e.clientX; let moving = false, gap: number | null = null;
    const move = (m: PointerEvent) => {
      if (!moving && Math.abs(m.clientX - x0) > 4 && next.includes(it.key)) moving = true;
      if (!moving) return;
      gap = gapAt(m.clientX); setInsert(gap);
      const s = scroll.current!, r = s.getBoundingClientRect();
      if (m.clientX > r.right - 30) s.scrollLeft += 12; else if (m.clientX < r.left + 30) s.scrollLeft -= 12;
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); setInsert(null);
      if (moving && gap != null) moveChosen(gap);
      else if (!moving && !mod && was && p.sel.length > 1) choose([it.key]);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  /** Pulling the right edge: the item's time in tenths of a second (a zoom in steps per step). */
  const startTrim = (i: number) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || readonly) return;
    e.preventDefault(); e.stopPropagation();
    const it = items[i], d0 = it.data.ms, x0 = e.clientX, n = itemUnits(it.data, frameIdsOf(files, it.to).length), gesture = `trim${Date.now()}`;
    choose([it.key]);
    const move = (m: PointerEvent) => {
      const raw = d0 + ((m.clientX - x0) / scale) * 1000;
      const ms = clamp(Math.round(raw / n / 100) * 100, ITEM_MS.min, Math.floor(ITEM_MS.max / n / 100) * 100) * n;
      p.edit((d) => ({ ...d, items: d.items.map((x) => (x.key === it.key ? { ...x, data: { ...x.data, ms } } : x)) }), gesture);
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const marquee = useMarquee({ items: ".pg-clip", attr: "data-key", selected: p.sel, onSelect: choose });
  const onWheel = (e: WheelEvent) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setScale((s) => clamp(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), SCALE.min, SCALE.max)); };
  useEffect(() => { const s = scroll.current; if (!s) return; s.addEventListener("wheel", onWheel, { passive: false }); return () => s.removeEventListener("wheel", onWheel); });

  // Files dragged from a Files window or the desktop: photos and canvases become items where they land.
  const onDragOver = (e: DragEvent) => { if (readonly || !hasDrag(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; setInsert(gapAt(e.clientX)); };
  const onDrop = (e: DragEvent) => {
    if (readonly || !hasDrag(e)) return;
    e.preventDefault(); setInsert(null);
    const ids = readDrag(e) ?? [], ok = ids.filter((id) => ["photo", "canvas"].includes(files.get(id)?.type ?? ""));
    if (ok.length < ids.length) toast("A progression shows photos and canvases only; the rest was left out", { tone: "info" });
    if (ok.length) p.insertFiles(ok.map((to) => ({ to })), gapAt(e.clientX) ?? items.length);
  };

  // ---------- Menus ----------
  const clipMenu = (i: number) => (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const it = items[i];
    const sel = p.sel.includes(it.key) ? p.sel : [it.key];
    if (sel !== p.sel) choose(sel);
    const one = sel.length === 1, k = itemKind(it, files), canvas = files.get(it.to)?.type === "canvas";
    contextMenu(e, [
      { id: "cut", label: "Cut", icon: "scissors", kbd: "Ctrl+X", disabled: readonly, run: () => copy(true) },
      { id: "copy", label: "Copy", icon: "copy", kbd: "Ctrl+C", run: () => copy(false) },
      { id: "paste", label: "Paste after", icon: "clipboard", kbd: "Ctrl+V", disabled: readonly || !board.items, run: () => paste(Math.max(...items.map((x, j) => (sel.includes(x.key) ? j : -1))) + 1) },
      { id: "dup", label: "Duplicate", icon: "copy", kbd: "Ctrl+D", disabled: readonly, run: duplicate },
      { id: "del", label: sel.length > 1 ? `Delete ${sel.length} items` : "Delete", icon: "trash", kbd: "Del", danger: true, disabled: readonly, run: () => removeChosen() },
      { separator: true },
      canvas && k !== "zoom" && { id: "edit", label: "Edit the canvas here", icon: "edit", disabled: !one, run: () => p.editCanvas(it.to) },
      { id: "thumb", label: "Use this file as the thumbnail", icon: "image", disabled: !one || readonly, run: () => p.thumbFile(it.to) },
    ]);
  };
  const laneMenu = (e: MouseEvent) => {
    e.preventDefault();
    const gap = gapAt(e.clientX) ?? items.length;
    contextMenu(e, [
      { id: "paste", label: "Paste here", icon: "clipboard", kbd: "Ctrl+V", disabled: readonly || !board.items, run: () => paste(gap) },
      { id: "all", label: "Choose all", kbd: "Ctrl+A", run: () => choose(items.map((i) => i.key)) },
      { separator: true },
      { id: "gen", label: "Generate a zoom here…", icon: "frame", disabled: readonly, run: () => p.generate(gap) },
      { id: "add", label: "Add pictures here…", icon: "plus", disabled: readonly, run: () => p.addPictures(gap) },
    ]);
  };

  // ---------- Keys ----------
  const step = (ms: number) => () => p.seek(clamp(p.t + ms, 0, p.total));
  const unlessTyping = (fn: () => void) => (e: KeyboardEvent) => { if (isTyping(e)) return false; fn(); };
  useKeys(bind("shot", {
    play: () => p.togglePlay(),
    back: step(-100), forward: step(100), backMore: step(-1000), forwardMore: step(1000),
    start: () => p.seek(0), end: () => p.seek(p.total),
    remove: () => removeChosen(),
    cut: unlessTyping(() => copy(true)), copy: unlessTyping(() => copy(false)), paste: unlessTyping(() => paste()),
    duplicate: () => duplicate(),
    all: unlessTyping(() => choose(items.map((i) => i.key))),
    undo: unlessTyping(p.undo), redo: unlessTyping(p.redo),
    clear: () => { if (!p.sel.length) return false; choose([]); },
  }), p.keys);

  // ---------- Drawing ----------
  const clip = (it: Item, i: number) => {
    const d = p.times[i] ?? 0, w = Math.max(6, px(d)), k = itemKind(it, files);
    const n = it.data.zoom?.mode === "steps" ? frameIdsOf(files, it.to).length : 0;
    let us = n > 1 ? Array.from({ length: n }, (_, j) => (j + 0.5) / n) : k === "move" || k === "zoom" ? [0, 1] : [0];
    const room = Math.max(1, Math.floor(w / 26));
    if (us.length > room) us = Array.from({ length: room }, (_, j) => us[Math.floor((j * us.length) / room)]);
    const f = files.get(it.to), missing = !f || !!f.deleted_at;
    const name = missing ? "Missing file" : f.name;
    const sub = k === "zoom" ? (it.data.zoom!.mode === "steps" ? `${n} steps` : "smooth") : k === "move" ? "smooth" : k === "frame" ? ((f?.body as { frames?: { id: string; name: string }[] } | undefined)?.frames?.find((x) => x.id === it.data.frame)?.name ?? "frame") : "";
    const smooth = k === "move" || (k === "zoom" && it.data.zoom!.mode === "smooth");
    return (
      <div key={it.key} data-key={it.key} className={cx("pg-clip", p.sel.includes(it.key) && "is-sel", i === atIndex && "is-cur", missing && "is-missing")}
        style={{ left: PAD + px(p.starts[i] ?? 0), width: w }} title={`${name}${sub ? ` · ${sub}` : ""} · ${KIND[k]} · ${clock(d)}`}
        onPointerDown={startClip(i)} onContextMenu={clipMenu(i)}
        onDblClick={() => { p.seek(p.starts[i]); if (f?.type === "canvas" && k !== "zoom") p.editCanvas(it.to); }}>
        <span className="pg-clip__cells">{us.map((u, j) => { const at = pictureOf(it, files, u); return <span key={j} className="pg-cell">{j > 0 && smooth && <i className="pg-cell__arrow"><Icon name="arrow-right" size={10} /></i>}<span className="sh-box"><Pic seen={see(at.ref, ctx, body.frame, at.u)} overlay={body.overlayShown ? p.overlaySrc : null} /></span></span>; })}</span>
        <span className="pg-clip__label">{k === "zoom" ? <Icon name="zoom-in" size={12} /> : k === "move" ? <Icon name="arrow-right" size={12} /> : f && <AppIcon glyph={kindOf(f.type).glyph} color={kindOf(f.type).color} size={16} />}<b>{name}</b>{sub && <small>{sub}</small>}<i className="oc-num">{clock(d)}</i></span>
        {!readonly && <i className="pg-clip__trim" data-no-marquee title={each ? "Drag to change how long it holds" : "Drag to change how long it holds (the timing becomes each its own)"} onPointerDown={each ? startTrim(i) : (e) => { e.stopPropagation(); setTiming("each"); }} />}
      </div>
    );
  };

  const head = (
    <div className="sh-row pg-head">
      <DropdownMenu size="sm" variant="secondary" icon="slideshow" label={p.file.name} items={[
        { heading: "Progressions of this shot" },
        ...p.progs.map((x) => ({ id: `go:${x.id}`, label: x.name, checked: x.id === p.file.id })),
        { separator: true as const },
        { id: "new", label: "New progression", icon: "plus" as const, disabled: readonly },
        { id: "rename", label: "Rename…", icon: "edit" as const, disabled: readonly },
        { id: "dup", label: "Duplicate", icon: "copy" as const, disabled: readonly },
        { id: "del", label: "Delete…", icon: "trash" as const, danger: true, disabled: readonly },
      ]} onSelect={(id) => (id.startsWith("go:") ? p.pick(id.slice(3)) : id === "new" ? p.addNew() : id === "rename" ? p.rename() : id === "dup" ? p.duplicate() : p.remove())} />
      <span className="sh-count oc-num">{items.length} {items.length === 1 ? "item" : "items"} · {clock(p.total)}</span>
      {p.isThumb ? <Badge tone="accent" title="The first entry of the content: the shot's thumbnail is this progression's first picture">Thumbnail of the shot</Badge>
        : !readonly && <Button size="sm" variant="quiet" icon="image" title="Moves it to the top of the content" onClick={p.useAsThumb}>Use as thumbnail</Button>}
      <span style={{ flex: 1 }} />
      <Button size="sm" variant="quiet" icon="undo" label="Undo (Ctrl+Z)" disabled={readonly || !p.canUndo} onClick={p.undo} />
      <Button size="sm" variant="quiet" icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={readonly || !p.canRedo} onClick={p.redo} />
      <Button size="sm" variant="quiet" icon="expand" title="Fit the whole progression into the width" onClick={fit}>Fit</Button>
      <span className="sh-bar" style={{ width: 140 }} title="Zoom the track (Ctrl + wheel)"><Icon name="zoom-out" size={12} /><Slider min={SCALE.min} max={SCALE.max} step={2} value={Math.round(scale)} onChange={setScale} /><Icon name="zoom-in" size={12} /></span>
    </div>
  );

  const bar = (
    <div className="sh-row pg-bar">
      <Button size="sm" variant="primary" icon={p.playing ? "pause" : "play"} label={p.playing ? "Pause (Space)" : "Play (Space)"} disabled={!items.length} onClick={p.togglePlay} />
      <span className="pg-time oc-num"><strong>{clock(Math.min(p.t, p.total))}</strong> / {clock(p.total)}</span>
      <span className="sh-sep" />
      <span className="sh-bar" inert={readonly || undefined}>
        <Select size="sm" value={body.timing.mode} onChange={setTiming} options={TIMING} />
        {body.timing.mode !== "each" && <NumberInput size="sm" value={body.timing.total / 1000} unit="s" min={0.1} max={3600} step={0.5} style={{ width: 92 }} aria-label="Total length" onChange={(v) => setBody({ timing: { mode: (body.timing as { mode: "even" | "ends" }).mode, total: clamp(Math.round(v * 10) * 100, TOTAL_MS.min, TOTAL_MS.max) } })} />}
        <span className="sh-sep" />
        <DefaultFrame value={body.frame} presets={p.presets} onChange={(fr) => setBody({ frame: fr })} />
        <span className="sh-sep" />
        {doc.overlay ? <><Checkbox checked={body.overlayShown} onChange={(c) => setBody({ overlayShown: c })}>Overlay</Checkbox><Button size="sm" variant={p.overlayEditing ? "secondary" : "quiet"} selected={p.overlayEditing} icon="brush" onClick={p.editOverlay}>{p.overlayEditing ? "Editing the overlay" : "Edit overlay"}</Button></>
          : <Button size="sm" variant="quiet" icon="brush" title="One drawing shown over every picture of this progression" onClick={p.addOverlay}>Add an overlay</Button>}
        <span className="sh-sep" />
        <Button size="sm" icon="frame" onClick={() => p.generate(playheadGap())}>Generate a zoom…</Button>
        <Button size="sm" variant="quiet" icon="plus" title="Photos, canvases or single frames of a canvas, inserted at the playhead" onClick={() => p.addPictures(playheadGap())}>Add pictures…</Button>
      </span>
    </div>
  );

  const track = (
    <div ref={scroll} className="pg-scroll" onPointerDown={marquee.onPointerDown} onContextMenu={(e) => { if (!(e.target as Element).closest(".pg-clip")) laneMenu(e); }}
      onDragOver={onDragOver} onDragLeave={(e) => { if (!scroll.current?.contains(e.relatedTarget as Node)) setInsert(null); }} onDrop={onDrop}>
      <div ref={inner} className="pg-inner" style={{ width }}>
        <TimeRuler scale={scale} seconds={(width - PAD) / scale} pad={PAD} scrub={scrub} />
        <div className="pg-lane">
          {items.map(clip)}
          {!items.length && <p className="pg-empty">Drag photos or canvases here from the content, a Files window or the desktop, or generate a zoom.</p>}
        </div>
        {insert != null && <i className="pg-insert" style={{ left: PAD + px(ends[insert] ?? p.total) }} />}
        <Playhead left={PAD + px(Math.min(p.t, p.total))} scrub={scrub} />
      </div>
      {marquee.band}
    </div>
  );

  return { head, body: <div className="pg">{bar}{track}</div>, gapAt, setInsert, playheadGap, insertItems };
}


/** The data an item starts with when a file or one of its frames is added. */
export const itemFor = (r: { to: string; frame?: string }, ms: number): Item => ({ key: itemKey(), to: r.to, data: { ms, ...(r.frame ? { frame: r.frame } : {}) } as ItemData });
