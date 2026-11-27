// The master timeline (docs/features/timeline.md, docs/rewrite/ux-4-timeline.md): one per project, an order of its
// timelines played end to end. The same window as a timeline with timelines for clips: each shows as a film strip
// (as many pictures as its width holds, the first and the last always) and as a chapter. Only membership and order
// are set here; clips are edited in the timeline.
import "../shots/shots.css";
import "../timeline/timeline.css";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  AppIcon, Button, Dock, DropdownMenu, EmptyState, Icon, PropertyList, PropertyRow, PropertySection, Segmented, Slider, Spinner, StatusBar, Toolbar, ToolbarSpacer, cx, moved, useDockLayout, useSort, type DockPanel,
  Playhead, TimeRuler, useTimeScrub,
} from "@openclapper/design";
import type { PresetBody, TimelineBody } from "@openclapper/model";
import * as api from "../api";
import type { FileRec } from "../api";
import { openFile } from "../fileOps";
import * as store from "../files";
import { toastError } from "../hosts";
import { presetsIn } from "../optics";
import { setMaster, useProjects } from "../projects";
import { Pic } from "../shots/Pic";
import { see, type Mode, type PicCtx } from "../shots/picture";
import { clock } from "../shots/progressionParts";
import { at as atTime, blocksOf, filmOf, type Seg } from "../timeline/cut";
import type { AppProps } from "./registry";

/** A timeline in the master: all it plays, where it starts and how long it lasts. */
interface Reel { file: FileRec; segs: Seg[]; clips: number; start: number; len: number }
const CHAPTER_COLOURS = [6, 2, 4, 3, 7, 1, 5, 8];

export function MasterApp({ projectId, setTitle, setRoute, focused }: AppProps) {
  const { files, bin } = store.useRoot({ project: projectId });
  const project = useProjects().list?.find((p) => p.id === projectId);
  useEffect(() => { setTitle("Master timeline"); setRoute("master"); }, []);
  if (!files || !project) return <div className="oc-app st-center"><Spinner /></div>;
  return <Master files={files} bin={bin ?? []} project={project} active={focused} />;
}

function Master({ files, bin, project, active }: { files: FileRec[]; bin: FileRec[]; project: api.Project; active: boolean }) {
  const map = useMemo(() => new Map([...bin, ...files].map((x) => [x.id, x])), [files, bin]);
  const ctx: PicCtx = { files: map, presets: new Map(presetsIn(files).map((p) => [p.id, p.body as PresetBody])) };
  const timelines = files.filter((x) => x.type === "timeline" && !x.internal_of);
  // Timelines that are gone are skipped; the order is the project's.
  const order = project.master.filter((id) => timelines.some((x) => x.id === id));
  const outside = timelines.filter((x) => !order.includes(x.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let at = 0;
  const reels: Reel[] = order.map((id) => {
    const file = map.get(id)!, body = { clips: [], ...(file.body as Partial<TimelineBody> | undefined) } as TimelineBody;
    const segs = blocksOf(body.clips, map).flatMap((b) => b.segs);
    const len = segs.reduce((a, s) => a + s.ms, 0), start = at;
    at += len;
    return { file, segs, clips: body.clips.length, start, len };
  });
  const total = at;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string | null>(order[0] ?? null);
  const [scale, setScale] = useState(24);
  const [mode, setMode] = useState<Mode>("crop");
  const [panels, setPanels, resetPanels] = useDockLayout("master", { left: { tabs: ["timelines"] }, right: { tabs: ["info"] }, bottom: { tabs: ["strip"] } });
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now() - t; let raf = 0;
    const step = () => { const now = performance.now() - t0; if (now >= total) { setPlaying(false); setT(0); } else { setT(now); raf = requestAnimationFrame(step); } };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);
  const save = (ids: string[]) => void setMaster(project, ids).catch(toastError);
  const reelAt = (time: number) => reels.find((r) => time >= r.start && time < r.start + r.len) ?? reels[reels.length - 1];
  const here = reels.length ? reelAt(Math.min(t, total - 0.001)) : undefined;
  // Inside the timeline under the playhead: its own clock.
  const inside = here ? atTime(blocksOf(((here.file.body as Partial<TimelineBody> | undefined)?.clips ?? []), map), t - here.start) : null;
  const seek = (time: number) => { setPlaying(false); const x = Math.max(0, Math.min(total, time)); setT(x); const r = reelAt(x); if (r) setSel(r.file.id); };
  const pick = (r: Reel) => { setPlaying(false); setSel(r.file.id); setT(r.start); };
  const open = (x: FileRec) => openFile(x, map);
  const sort = useSort("x", (a, b) => save(moved(order, a, b)));
  const sortL = useSort("y", (a, b) => save(moved(order, a, b)));
  const overlaySrc = (id: string | null | undefined) => { const o = id ? map.get(id) : undefined; return o && !o.deleted_at && o.updated_at !== o.created_at ? api.renderUrl(o, "render") : null; };
  const seenOf = (s: Seg, u = 0) => (s.ref && s.kind !== "missing" ? see(s.ref, ctx, s.def ?? null, u) : null);
  const px = (ms: number) => (ms / 1000) * scale;
  const chosen = reels.find((r) => r.file.id === sel) ?? null;

  const seg = inside?.seg;
  const stageSeen = seg ? seenOf(seg, inside!.u) : null;
  const ci = here ? reels.indexOf(here) : -1;
  const stage = (
    <div className="tl-stage">
      <div className={cx("sh-stage", (!seg || (seg.kind !== "pic" && seg.kind !== "prog")) && "is-empty")}>
        {!reels.length ? <EmptyState icon="film" title="The master timeline is empty">Add timelines from the Timelines panel: they play one after the other.</EmptyState>
          : !seg ? <div className="tl-card"><Icon name="timeline" size={20} /><strong>{here?.file.name}</strong><span>An empty timeline.</span></div>
            : seg.kind === "placeholder" ? <div className="tl-card"><Icon name="hourglass" size={20} /><strong>{inside!.block.clip.title || "Placeholder"}</strong><span>A placeholder in “{here!.file.name}”.</span></div>
              : !stageSeen ? <div className="tl-card is-missing"><Icon name="warning" size={20} /><strong>Missing</strong><span>A file of “{here!.file.name}” is gone or has no picture.</span></div>
                : <div className="sh-box"><Pic seen={stageSeen} mode={mode} overlay={overlaySrc(seg.overlay)} /></div>}
        {here && <span className="sh-caption"><b className="tl-chap" style={{ background: `var(--cat-${CHAPTER_COLOURS[ci % 8]})` }}>{here.file.name}</b>{inside?.block.file?.name ?? inside?.block.clip.title ?? ""}</span>}
      </div>
      <div className="tl-transport">
        <Button size="sm" variant="quiet" icon="skip-back" label="To the start" onClick={() => seek(0)} />
        <Button size="sm" variant="quiet" icon="chevron-left" label="Previous timeline" disabled={ci <= 0} onClick={() => reels[ci - 1] && pick(reels[ci - 1])} />
        <Button size="sm" variant="primary" icon={playing ? "pause" : "play"} label={playing ? "Pause (Space)" : "Play (Space)"} disabled={!reels.length || !total} onClick={() => setPlaying(!playing)} />
        <Button size="sm" variant="quiet" icon="chevron-right" label="Next timeline" disabled={ci < 0 || ci >= reels.length - 1} onClick={() => reels[ci + 1] && pick(reels[ci + 1])} />
        <span className="tl-time oc-num"><strong>{clock(Math.min(t, total))}</strong> / {clock(total)}</span>
        <span style={{ flex: 1 }} />
        <Segmented label="View mode" value={mode} disabled={!stageSeen?.rect} onChange={(v) => setMode(v as Mode)} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} />
      </div>
    </div>
  );
  // Space plays here too; the window's own keys stay simple.
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => { if (e.key === " " && !(e.target as HTMLElement).closest("input, textarea, [contenteditable]")) { e.preventDefault(); setPlaying((p) => !p); } };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [active]);

  const scrub = useTimeScrub(scale, seek);
  const strip = !reels.length ? <p className="sh-note">No timeline is in the master yet. Add one from the Timelines panel.</p> : (
    <div className="tl-scroll" onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setScale((s) => Math.min(160, Math.max(1, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); } }}>
      <div className="tl-lanes" style={{ width: px(total) }}>
        <TimeRuler scale={scale} seconds={total / 1000} scrub={scrub} />
        <div className="tl-chapters">{reels.map((r, i) => <button type="button" key={r.file.id} style={{ left: px(r.start), width: px(r.len), "--c": `var(--cat-${CHAPTER_COLOURS[i % 8]})` }} onClick={() => pick(r)}><Icon name="timeline" size={10} />{r.file.name}</button>)}</div>
        <div className="tl-track">
          {reels.map((r, i) => {
            // A film strip: as many pictures as the width holds, the first and the last always.
            const cells = r.segs.length ? filmOf(r.segs, Math.floor(px(r.len) / 96)) : [];
            return (
              <div key={r.file.id} data-sort role="button" tabIndex={0} className={cx("tl-clip", sel === r.file.id && "is-current")} style={{ width: Math.max(24, px(r.len)), ...sort.style(i) }} title={r.file.name}
                onPointerDown={sort.start(i)} onClick={() => pick(r)} onDblClick={() => open(r.file)}>
                <span className="tl-clip__cells">
                  {cells.map((s, k) => { const sn = seenOf(s); return <span key={k} className="tl-cell" style={{ flex: 1 }}><span className="sh-item__art sh-box">{sn ? <Pic seen={sn} /> : <span className="tl-cell__none"><Icon name={s.kind === "placeholder" ? "hourglass" : "warning"} /></span>}</span></span>; })}
                </span>
                <span className="tl-clip__label"><AppIcon glyph="timeline" color={6} size={20} /><b>{r.file.name}</b><i className="oc-num">{clock(r.len)}</i></span>
              </div>
            );
          })}
          {sort.ghost((i) => <div className="tl-clip is-current" style={{ width: "100%" }}><span className="tl-clip__label"><b>{reels[i].file.name}</b></span></div>)}
        </div>
        <Playhead left={16 + px(Math.min(t, total))} scrub={scrub} />
      </div>
    </div>
  );
  const stripActions = (
    <div className="sh-row">
      <span className="sh-count oc-num">{reels.length} timelines · {clock(total)}</span>
      <span style={{ flex: 1 }} />
      <span className="sh-bar" style={{ width: 150 }} title="Zoom the strip (Ctrl + wheel): more pictures of each timeline"><Icon name="zoom-out" size={12} /><Slider min={1} max={160} step={1} value={Math.round(scale)} onChange={setScale} /><Icon name="zoom-in" size={12} /></span>
    </div>
  );
  const newTimeline = async () => { try { const id = crypto.randomUUID(); await store.create({ project: project.id }, "timeline", { id }); save([...order, id]); } catch (e) { toastError(e); } };
  const timelinesBody = (
    <>
      <ul className="tl-files">
        {reels.map((r, i) => (
          <li key={r.file.id} data-sort className={cx("tl-file", sel === r.file.id && "is-on")} style={sortL.style(i)} onPointerDown={sortL.start(i)} onClick={() => pick(r)} onDblClick={() => open(r.file)}>
            <Icon name="grip" size={12} /><b className="oc-num">{i + 1}</b>
            <span className="sh-pickrow__name">{r.file.name}<small className="oc-num">{r.clips} clips · {clock(r.len)}</small></span>
            <Button size="sm" variant="quiet" icon="close" label="Take out of the master" data-nodrag onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); save(order.filter((x) => x !== r.file.id)); }} />
          </li>
        ))}
        {sortL.ghost((i) => <div className="tl-file is-on"><Icon name="grip" size={12} /><span className="sh-pickrow__name">{reels[i].file.name}</span></div>)}
      </ul>
      <p className="sh-note">Not in the master: alternatives and experiments.</p>
      <ul className="tl-files">
        {outside.map((x) => <li key={x.id} className="tl-file" onDblClick={() => open(x)}><AppIcon glyph="timeline" color={6} size={20} /><span className="sh-pickrow__name">{x.name}<small className="oc-num">{((x.body as Partial<TimelineBody> | undefined)?.clips ?? []).length} clips</small></span><Button size="sm" variant="quiet" icon="plus" onClick={() => save([...order, x.id])}>Add</Button></li>)}
        {!outside.length && <li className="sh-note">Every timeline of the project is in the master.</li>}
      </ul>
      <div className="sh-row" style={{ borderBottom: 0 }}><Button size="sm" icon="plus" onClick={() => void newTimeline()}>New timeline</Button></div>
    </>
  );
  const info = !chosen ? <EmptyState icon="info" title="Nothing chosen">Click a timeline in the strip.</EmptyState> : (
    <PropertyList>
      <PropertySection title="Timeline" icon="timeline">
        <PropertyRow label="Name" value={chosen.file.name} />
        <PropertyRow label="Clips" value={String(chosen.clips)} numeric />
        <PropertyRow label="Length" value={clock(chosen.len)} numeric />
        <PropertyRow label="Starts at" value={clock(chosen.start)} numeric />
        <div className="sh-row" style={{ borderBottom: 0 }}><Button size="sm" icon="external" onClick={() => open(chosen.file)}>Open the timeline</Button><Button size="sm" variant="quiet" icon="close" onClick={() => save(order.filter((x) => x !== chosen.file.id))}>Take out of the master</Button></div>
        <p className="sh-note">Only membership and order are set here. Clips are edited in the timeline.</p>
      </PropertySection>
    </PropertyList>
  );
  const dockPanels: DockPanel[] = [
    { id: "timelines", title: "Timelines", icon: "timeline", body: timelinesBody },
    { id: "info", title: "Timeline", icon: "info", body: info },
    { id: "strip", title: "Master", icon: "film", actions: stripActions, body: strip },
  ];
  return (
    <div className="oc-app">
      <Toolbar>
        <AppIcon glyph="film" color={1} size={24} /><strong className="st-title">Master timeline</strong>
        <ToolbarSpacer />
        <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "panels", label: "Panels back to their places", icon: "refresh" }]} onSelect={() => resetPanels()} />
      </Toolbar>
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 300, right: 300, bottom: 260 }}>{stage}</Dock>
      <StatusBar>{reels.length} timelines play end to end · {clock(total)}{playing && <> · playing</>}</StatusBar>
    </div>
  );
}
