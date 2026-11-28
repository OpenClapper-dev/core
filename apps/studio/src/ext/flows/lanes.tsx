// A flow's lanes (docs/features/flows.md, "In the Studio"): the ruler with the playhead's thumb, the marker strip,
// and a lane per track with its keyframes (the start one square), the gaps between them (a fade tile where one is
// set), its markers, the intensity graph; a selection box drawn over the lanes. One component for the Studio and the
// phone's web view: pointer events, so a finger works like the mouse.
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Icon, Popover, Select, cx } from "@openclapper/design";
import { effectName, fixtureKind, modelOf, type FixtureLive } from "@openclapper/ext-hardware";
import { fmtSeconds, NATIVE_FADES, playedKeyframes, sampleTrack, snap, snapLevel, SNAP_MS, START_KEYFRAME, TRACK_COLORS, type Flow, type FlowMarker, type FlowTrack, type Keyframe, type LevelStep } from "@openclapper/ext-flows";
import type { FileRec } from "../../api";
import { graphPoints, keyframeLevel, lightColour, shortLabel, type FlowView } from "./view";
import { Draft } from "./draft";

export const CURVE_LABELS = { linear: "Linear", exp: "Expo", log: "Log", s: "S-curve" } as const;

/** A selected keyframe ("track/keyframe") or marker ("@m/id"): they share the selection. */
export const keyOf = (trackId: string, kfId: string) => `${trackId}/${kfId}`;
export const splitKey = (k: string) => { const i = k.indexOf("/"); return [k.slice(0, i), k.slice(i + 1)] as const; };
export const markKey = (id: string) => `@m/${id}`;
export const markOf = (k: string) => (k.startsWith("@m/") ? k.slice(3) : null);

export interface LanesProps {
  flow: Flow; /** The time axis stretched this many times the window's width (1: fits). */ zoom: number; mode: "select" | "insert"; kfSize: "s" | "m" | "l"; view: FlowView; /** Intensity drags snap to this many percent. */ levelStep: LevelStep; trackHeight: number; heights: Record<string, number>;
  devices: FileRec[]; liveOf: (id: string) => FixtureLive | undefined; playhead: number; playing: boolean; locked: boolean;
  sel: ReadonlySet<string>; tile: { trackId: string; toId: string } | null;
  onSeek: (t: number) => void; onAdd: (trackId: string, at: number) => void;
  onSelect: (keys: string[], add: boolean) => void; onToggle: (key: string) => void;
  /** Keyframes and markers dragged to times; `base`: the tracks as the drag began (pushes are worked out from there). */
  onMoveAll: (moves: Map<string, number>, base: FlowTrack[]) => void;
  /** A keyframe's margin dragged (half seconds; 0 removes it), from the tracks as the drag began. */
  onMargin: (trackId: string, kfId: string, side: "before" | "after", ms: number, base: FlowTrack[]) => void;
  onLevel: (trackId: string, kfId: string, level: number) => void;
  onTile: (trackId: string, toId: string) => void; onPickTrack: (trackId: string) => void;
  onTrack: (trackId: string, fn: (t: FlowTrack) => FlowTrack) => void; onRemoveTrack: (trackId: string) => void; onMoveTrack: (trackId: string, before: string | null) => void;
  onHeight: (trackId: string, h: number) => void;
  /** The track whose widget is chosen on the stage (#426): its label shows it. */
  marked?: string | null;
  onMarkerAdd: (at: number, end?: number, trackId?: string) => void; onMarkerPick: (id: string) => void; onMarkerResize: (id: string, edge: "at" | "end", at: number) => void;
}
type Gesture = (move: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) => void;

/** The ruler's steps in seconds, finest first; minutes are labelled m:ss. */
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const fmtTick = (ms: number) => { const s = ms / 1000; return s >= 60 && Number.isInteger(s) ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s); };

export function Lanes(p: LanesProps) {
  const { flow } = p;
  const pct = (t: number) => `${(t / flow.durationMs) * 100}%`;
  const lanesRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  // The ruler's labels as dense as the room allows (#426): the finest step (half a second up) that leaves a label
  // at least 36 px; the ruler's width is followed as the window, the panels and the zoom change it.
  const [rulerW, setRulerW] = useState(0);
  useEffect(() => {
    const el = rulerRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setRulerW(el.clientWidth)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const perSec = rulerW / Math.max(1, flow.durationMs / 1000);
  const step = RULER_STEPS.find((x) => x * perSec >= 36) ?? RULER_STEPS[RULER_STEPS.length - 1];
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const timeAt = (clientX: number) => { const r = rulerRef.current!.getBoundingClientRect(); return Math.min(flow.durationMs, Math.max(0, snap(((clientX - r.left) / r.width) * flow.durationMs))); };
  const msPerPx = () => flow.durationMs / rulerRef.current!.getBoundingClientRect().width;
  const gesture: Gesture = (move, up) => {
    const end = (e: PointerEvent) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); up?.(e); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  // Scrubbing: press on the ruler or the thumb, and drag.
  const scrub = (e: PointerEvent) => {
    e.stopPropagation();
    if (p.playing || e.button !== 0) return;
    p.onSeek(timeAt(e.clientX));
    gesture((ev) => p.onSeek(timeAt(ev.clientX)));
  };

  // A press on empty lane space: a click adds a keyframe (Insert, or Alt), else clears; a drag draws a selection box.
  const pressLanes = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || p.locked || target.closest(".fl-kf, .fl-trim, .fl-gap, .fl-label, .fl-ruler, .fl-mark, button, input, select")) return;
    const x0 = e.clientX, y0 = e.clientY, add = e.shiftKey, insert = p.mode === "insert" || e.altKey;
    const lane = target.closest<HTMLElement>(".fl-lane");
    let moved = false;
    gesture((ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      setBox({ x0, y0, x1: ev.clientX, y1: ev.clientY });
    }, (ev) => {
      setBox(null);
      if (!moved) { if (insert && lane?.dataset.track) p.onAdd(lane.dataset.track, timeAt(ev.clientX)); else if (!add) p.onSelect([], false); return; }
      const [l, r] = [Math.min(x0, ev.clientX), Math.max(x0, ev.clientX)], [t, b] = [Math.min(y0, ev.clientY), Math.max(y0, ev.clientY)];
      const hit = [...(lanesRef.current?.querySelectorAll<HTMLElement>(".fl-kf, .fl-mark[data-key]") ?? [])].filter((el) => {
        const q = el.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2;
        return cx >= l && cx <= r && cy >= t && cy <= b;
      }).map((el) => el.dataset.key!);
      p.onSelect(hit, add);
    });
  };

  // A press on a keyframe or marker: Shift toggles it; else it (with the rest of the selection) drags in time. With the
  // intensity graph shown, a light keyframe also drags up and down for its intensity (the start one only that).
  const pressKf = (e: PointerEvent, key: string) => {
    e.stopPropagation();
    if (e.button !== 0 || p.locked) return;
    if (e.shiftKey) { p.onToggle(key); return; }
    const group = p.sel.has(key) ? [...p.sel] : [key];
    if (!p.sel.has(key)) p.onSelect([key], false);
    const origin = new Map<string, { at: number; reach: number; min: number }>();
    for (const k of group) {
      const mid = markOf(k);
      if (mid) { const m = flow.markers?.find((x) => x.id === mid); if (m) origin.set(k, { at: m.at, reach: m.end ?? m.at, min: 0 }); continue; }
      const [tid, kid] = splitKey(k);
      const kf = flow.tracks.find((t) => t.id === tid)?.keyframes.find((x) => x.id === kid);
      if (kf && kf.id !== START_KEYFRAME) origin.set(k, { at: kf.at, reach: kf.at, min: SNAP_MS });
    }
    const picked = markOf(key);
    const [ptid, pkid] = picked ? ["", ""] : splitKey(key);
    const ptrack = flow.tracks.find((t) => t.id === ptid);
    // A locked intensity (#426) is the start keyframe's: only there does a drag up or down set it.
    const graphLane = p.view.graph && ptrack && modelOf(ptrack.model)?.type === "light" && (pkid === START_KEYFRAME || !ptrack.locked?.includes("intensity")) ? (e.currentTarget as HTMLElement).closest<HTMLElement>(".fl-lane") : null;
    // Where the intensity starts: the snap goes from there (the View's intensity snap, #426).
    const pkf = ptrack?.keyframes.find((x) => x.id === pkid);
    const plevel = graphLane && ptrack && pkf ? keyframeLevel(playedKeyframes(ptrack), pkf) : null;
    const x0 = e.clientX, y0 = e.clientY, perPx = msPerPx(), base = flow.tracks;
    const dMin = origin.size ? Math.max(...[...origin.values()].map((o) => o.min - o.at)) : 0, dMax = origin.size ? Math.min(...[...origin.values()].map((o) => flow.durationMs - o.reach)) : 0;
    let moved = false;
    gesture((ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      // Each lands on the half-second grid (one kept from before snaps once moved), within the flow.
      if (origin.size) { const d = Math.min(dMax, Math.max(dMin, (ev.clientX - x0) * perPx)); p.onMoveAll(new Map([...origin].map(([k, o]) => [k, Math.min(flow.durationMs - (o.reach - o.at), Math.max(o.min, snap(o.at + d)))])), base); }
      if (graphLane && plevel !== null) {
        const r = graphLane.querySelector<SVGElement>(".fl-graph")?.getBoundingClientRect() ?? graphLane.getBoundingClientRect();
        p.onLevel(ptid, pkid, snapLevel(plevel, 1 - (ev.clientY - r.top) / r.height, p.levelStep));
      }
    }, () => { if (!moved && picked) p.onMarkerPick(picked); });
  };

  return (
    <div className={cx("fl-lanes", `kf-${p.kfSize}`, p.mode === "insert" && "is-insert", p.locked && "is-locked")} ref={lanesRef} onPointerDown={pressLanes} style={{ "--zoom": p.zoom }}>
      <div className="fl-row fl-row--ruler">
        <div className="fl-label" />
        <div className="fl-ruler" ref={rulerRef} onPointerDown={scrub}>
          {Array.from({ length: Math.floor(flow.durationMs / 1000 / step) + 1 }, (_, i) => Math.round(i * step * 1000)).filter((t) => t <= flow.durationMs).map((t) => <span key={t} className="fl-tick" style={{ left: pct(t) }}>{fmtTick(t)}</span>)}
          <span className="fl-thumb" style={{ left: pct(p.playhead) }} title="Drag to scrub" />
          <span className="fl-playhead" style={{ left: pct(p.playhead) }} />
        </div>
      </div>
      <div className="fl-row fl-row--marks">
        <div className="fl-label"><span className="fl-label__kind">Markers</span></div>
        <MarkStrip {...p} markers={(flow.markers ?? []).filter((m) => !m.trackId)} pct={pct} timeAt={timeAt} gesture={gesture} pressKf={pressKf} />
      </div>
      {flow.tracks.map((tr) => <TrackRow key={tr.id} {...p} tr={tr} pct={pct} pressKf={pressKf} timeAt={timeAt} gesture={gesture} />)}
      {flow.tracks.length === 0 && <p className="fl-empty">Add a track: pick the type of light or camera it is for, then assign a device to it.</p>}
      {box && <div className="fl-box" style={{ left: `${Math.min(box.x0, box.x1)}px`, top: `${Math.min(box.y0, box.y1)}px`, width: `${Math.abs(box.x1 - box.x0)}px`, height: `${Math.abs(box.y1 - box.y0)}px` }} />}
    </div>
  );
}

/**
 * A strip of markers: across the flow under the ruler, or a lane's top strip for that track. In Insert mode (or with
 * Alt) a click adds a point and a drag a range; in Select mode the strip selects like the lanes.
 */
function MarkStrip(p: LanesProps & { markers: FlowMarker[]; trackId?: string; pct: (t: number) => string; timeAt: (x: number) => number; gesture: Gesture; pressKf: (e: PointerEvent, key: string) => void }) {
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  const press = (e: PointerEvent) => {
    if (e.button !== 0 || p.locked || (e.target as HTMLElement).closest(".fl-mark")) return;
    if (p.mode !== "insert" && !e.altKey) return;
    e.stopPropagation();
    const x0 = e.clientX, a = p.timeAt(x0);
    let moved = false;
    p.gesture((ev) => { if (!moved && Math.abs(ev.clientX - x0) < 4) return; moved = true; setDraft({ a, b: p.timeAt(ev.clientX) }); }, (ev) => {
      setDraft(null);
      const b = p.timeAt(ev.clientX);
      if (moved && Math.abs(b - a) >= SNAP_MS) p.onMarkerAdd(Math.min(a, b), Math.max(a, b), p.trackId);
      else p.onMarkerAdd(a, undefined, p.trackId);
    });
  };
  return (
    <div className={p.trackId ? "fl-lane__marks" : "fl-marks"} onPointerDown={press} title={p.trackId ? "This track's markers (Insert mode or Alt: click for a point, drag for a range)" : "Markers (Insert mode or Alt: click for a point, drag for a range; M, Shift+M)"}>
      {p.markers.map((m) => {
        const edge = (e: PointerEvent, which: "at" | "end") => {
          e.stopPropagation();
          if (e.button !== 0 || p.locked) return;
          p.gesture((ev) => { const t = p.timeAt(ev.clientX); if (which === "at") p.onMarkerResize(m.id, "at", Math.min(t, (m.end ?? t) - SNAP_MS)); else p.onMarkerResize(m.id, "end", Math.max(t, m.at + SNAP_MS)); });
        };
        return (
          <button key={m.id} type="button" data-key={markKey(m.id)} className={cx("fl-mark", m.end !== undefined ? "is-range" : "is-point", p.sel.has(markKey(m.id)) && "is-selected")}
            style={{ left: p.pct(m.at), ...(m.end !== undefined ? { width: p.pct(m.end - m.at) } : {}) }} title={`${m.name || "Marker"} · ${fmtSeconds(m.at)}${m.end !== undefined ? `–${fmtSeconds(m.end)}` : ""} (drag to move)`}
            onPointerDown={(e) => p.pressKf(e, markKey(m.id))}>
            <span>{m.name || "Marker"}</span>
            {m.end !== undefined && <><span className="fl-mark__edge is-in" title="Drag the in point" onPointerDown={(e) => edge(e, "at")} /><span className="fl-mark__edge is-out" title="Drag the out point" onPointerDown={(e) => edge(e, "end")} /></>}
          </button>
        );
      })}
      {draft && <span className="fl-mark is-range is-draft" style={{ left: p.pct(Math.min(draft.a, draft.b)), width: p.pct(Math.abs(draft.b - draft.a)) }} />}
    </div>
  );
}

/** Where a track stands (#426): " · on the stage" with one stage, " · on 2 of 3 stages" with several. */
function onStages(flow: Flow, track: string): string {
  const all = flow.stages ?? [], n = all.filter((s) => s.lights.some((l) => l.track === track)).length;
  return !n ? "" : all.length === 1 ? " · on the stage" : ` · on ${n} of ${all.length} stages`;
}

function TrackRow(p: LanesProps & { tr: FlowTrack; pct: (t: number) => string; pressKf: (e: PointerEvent, key: string) => void; timeAt: (x: number) => number; gesture: Gesture }) {
  const { tr, flow, pct } = p;
  const model = modelOf(tr.model);
  const camera = model?.type === "camera";
  const kind = fixtureKind(tr.model);
  const ks = [...tr.keyframes].sort((a, b) => a.at - b.at);
  // What plays (#426): locked parameters at the start keyframe's value; the graph, the fill and the labels show it.
  const played = [...playedKeyframes(tr)].sort((a, b) => a.at - b.at);
  const playedOf = (k: Keyframe) => played.find((x) => x.id === k.id) ?? k;
  const global = (flow.markers ?? []).filter((m) => !m.trackId);
  // A device drives at most one track of a flow.
  const taken = new Set(flow.tracks.filter((t) => t.id !== tr.id && t.device).map((t) => t.device!));
  const options = p.devices.filter((d) => (d.body as { model?: unknown }).model === tr.model && !taken.has(d.id)).map((d) => ({ value: d.id, label: d.name }));
  const missing = tr.device && !options.some((o) => o.value === tr.device) ? [{ value: tr.device, label: "A device that is gone" }] : [];
  const height = p.heights[tr.id] ?? p.trackHeight + (p.view.graph && !camera ? 48 : 0);
  const [drag, setDrag] = useState<"from" | "over" | null>(null);

  // The grip reorders tracks: drop on another row to go before it (below the last: to the end).
  const grip = (e: PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || p.locked) return;
    setDrag("from");
    p.gesture(() => {}, (ev) => {
      setDrag(null);
      const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-row]");
      if (row && row.dataset.row !== tr.id) p.onMoveTrack(tr.id, row.dataset.row === "end" ? null : row.dataset.row!);
    });
  };
  // The lower edge: this track's own height (kept until the height slider or Fit is used again).
  const resize = (e: PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const y0 = e.clientY, h0 = height;
    p.gesture((ev) => p.onHeight(tr.id, Math.round(Math.min(320, Math.max(40, h0 + ev.clientY - y0)))));
  };
  // Trim handles (#426): in Select mode, on the keyframe pointed at or the one chosen, at the edges of its margins.
  const [hover, setHover] = useState<string | null>(null);
  const trims = (key: string) => p.mode === "select" && !p.locked && (hover === key || (p.sel.size === 1 && p.sel.has(key)));
  const trim = (e: PointerEvent, k: Keyframe, side: "before" | "after") => {
    e.stopPropagation();
    if (e.button !== 0 || p.locked) return;
    const base = flow.tracks;
    p.gesture((ev) => { const t = p.timeAt(ev.clientX); p.onMargin(tr.id, k.id, side, Math.max(0, side === "before" ? k.at - t : t - k.at), base); });
  };

  return (
    <div className={cx("fl-row", drag === "from" && "is-dragged")} data-row={tr.id} style={{ minHeight: `${height}px`, ...(tr.color !== undefined ? { "--track-c": `var(--cat-${tr.color + 1})` } : {}) }}>
      <div className={cx("fl-label", tr.color !== undefined && "has-colour", p.marked === tr.id && "is-marked")}>
        <span className="fl-label__grip" onPointerDown={grip} title="Drag to reorder the tracks"><Icon name="grip" size={14} /></span>
        <div className="fl-label__text">
          <div className="fl-label__top">
            <Draft value={tr.name} commit={(v) => { const name = v.trim(); if (name) p.onTrack(tr.id, (t) => ({ ...t, name })); }}>{(d) => <input className="fl-name" aria-label="Track name" disabled={p.locked} maxLength={60} {...d} />}</Draft>
          </div>
          <span className="fl-label__kind">{model ? `${model.brand} ${model.model}` : tr.model}{onStages(flow, tr.id)}</span>
          <Select size="sm" aria-label={`Device for ${tr.name}`} value={tr.device ?? ""} disabled={p.locked}
            onChange={(id: string) => p.onTrack(tr.id, (t) => ({ ...t, device: id || null }))}
            options={[{ value: "", label: model ? `No ${model.model} assigned` : "Not assigned" }, ...missing, ...options]} />
        </div>
        <div className="fl-label__actions">
          <Button size="sm" variant={tr.muted ? "secondary" : "quiet"} icon="bulb" label={tr.muted ? "Unmute the track" : "Mute the track (left out of playback and Live)"} aria-pressed={!!tr.muted} disabled={p.locked} onClick={() => p.onTrack(tr.id, (t) => ({ ...t, muted: !t.muted }))} />
          <Popover align="end" trigger={<Button size="sm" variant="quiet" icon="palette" label="Track colour" disabled={p.locked} />}>
            <div className="fl-swatches" role="radiogroup" aria-label="Track colour">
              {Array.from({ length: TRACK_COLORS }, (_, i) => (
                <button key={i} type="button" role="radio" aria-checked={tr.color === i} aria-label={`Colour ${i + 1}`} className={cx("fl-swatch", tr.color === i && "is-on")} style={{ background: `var(--cat-${i + 1})` }}
                  onClick={() => p.onTrack(tr.id, (t) => ({ ...t, color: i }))} />
              ))}
              <button type="button" className="fl-swatch is-none" aria-label="No colour" onClick={() => p.onTrack(tr.id, (t) => { const n = { ...t }; delete n.color; return n; })} />
            </div>
          </Popover>
          <Button size="sm" variant="quiet" icon="more" label="Track" disabled={p.locked} onClick={() => p.onPickTrack(tr.id)} />
        </div>
        <span className="fl-resize" onPointerDown={resize} title="Drag to make this track taller or lower" />
      </div>
      <div className={cx("fl-lane", !tr.device && "is-unassigned", tr.muted && "is-muted")} data-track={tr.id} onPointerLeave={() => setHover(null)}>
        {global.map((m) => <span key={m.id} className={m.end !== undefined ? "fl-mband" : "fl-mline"} style={{ left: pct(m.at), ...(m.end !== undefined ? { width: pct(m.end - m.at) } : {}) }} />)}
        <MarkStrip {...p} markers={(flow.markers ?? []).filter((m) => m.trackId === tr.id)} trackId={tr.id} pct={pct} timeAt={p.timeAt} gesture={p.gesture} pressKf={p.pressKf} />
        {/* Margins (#426): a band before and after a keyframe that has one; a neighbour inside it is pushed. */}
        {ks.flatMap((k) => [
          k.marginBeforeMs ? <span key={`mb-${k.id}`} className={cx("fl-margin", p.sel.has(keyOf(tr.id, k.id)) && "is-selected")} style={{ left: pct(Math.max(0, k.at - k.marginBeforeMs)), width: pct(Math.min(k.at, k.marginBeforeMs)) }} /> : null,
          k.marginAfterMs ? <span key={`ma-${k.id}`} className={cx("fl-margin", p.sel.has(keyOf(tr.id, k.id)) && "is-selected")} style={{ left: pct(k.at), width: pct(Math.min(flow.durationMs - k.at, k.marginAfterMs)) }} /> : null,
        ])}
        {p.view.graph && !camera && (
          <svg className="fl-graph" viewBox={`0 0 ${flow.durationMs} 1`} preserveAspectRatio="none" aria-hidden="true">
            <polyline points={graphPoints(played, flow.durationMs)} vector-effect="non-scaling-stroke" />
          </svg>
        )}
        {!camera && ks.slice(1).map((k, i) => {
          const from = ks[i];
          const on = p.tile?.trackId === tr.id && p.tile.toId === k.id;
          // Stepped or run by the light is a distinction only while native fades are on (off since #426).
          const native = NATIVE_FADES && !!kind?.caps.fade;
          return (
            <button key={`gap-${k.id}`} type="button" className={cx("fl-gap", k.fadeIn && "is-fade", k.fadeIn && native && k.fadeStepped && "is-stepped", on && "is-selected")} style={{ left: pct(from.at), width: pct(k.at - from.at) }}
              title={k.fadeIn ? `Fade ${fmtSeconds(from.at)}–${fmtSeconds(k.at)} (${CURVE_LABELS[k.fadeIn]})${native ? (k.fadeStepped ? ": in steps every 0.1 s" : ": the light runs it by itself") : ""}` : "Jump here; click to fade instead"}
              disabled={p.locked} onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onTile(tr.id, k.id)}>
              {k.fadeIn ? <span className="fl-gap__label">{CURVE_LABELS[k.fadeIn]}{native && k.fadeStepped ? " · steps" : ""}</span> : <span className="fl-gap__add">+ Fade</span>}
            </button>
          );
        })}
        {ks.map((k) => {
          const key = keyOf(tr.id, k.id);
          const top = p.view.graph && !camera ? `calc(var(--g-top) + ${(1 - keyframeLevel(played, k)).toFixed(4)} * var(--g-h))` : undefined;
          const fill = p.view.fill && !camera ? lightColour(sampleTrack(played, k.at)) : null;
          const label = p.view.labels || camera ? shortLabel(tr.model, playedOf(k), !p.view.badges) : "";
          return [
            <button key={k.id} type="button" data-key={key}
              className={cx("fl-kf", k.id === START_KEYFRAME && "is-start", p.sel.has(key) && "is-selected", camera && "is-camera", camera && k.controls?.record === true && "is-rec", k.hue !== undefined && "is-colour", k.effect?.id && "is-effect", fill && "has-fill", p.view.badges && k.power === false && "is-off")}
              style={{ left: pct(k.at), ...(top ? { top } : {}), ...(fill ? { "--kf-fill": fill } : {}) }} title={`${k.id === START_KEYFRAME ? "Start · " : ""}${fmtSeconds(k.at)} · ${shortLabel(tr.model, playedOf(k)) || "sets nothing"}`}
              onPointerDown={(e) => p.pressKf(e, key)} onPointerEnter={() => setHover(key)} />,
            ...(trims(key) ? (["before", "after"] as const).filter((side) => side === "after" || k.id !== START_KEYFRAME).map((side) => {
              const ms = (side === "before" ? k.marginBeforeMs : k.marginAfterMs) ?? 0;
              return (
                <span key={`t-${side}-${k.id}`} className={cx("fl-trim", `is-${side}`, ms === 0 && "is-zero")} style={{ left: pct(side === "before" ? Math.max(0, k.at - ms) : Math.min(flow.durationMs, k.at + ms)), ...(top ? { top } : {}) }}
                  title={`Margin ${side}: ${fmtSeconds(ms)} (drag; to 0 removes it)`} onPointerDown={(e) => trim(e, k, side)} onPointerEnter={() => setHover(key)} />
              );
            }) : []),
            label ? <span key={`l-${k.id}`} className="fl-kf-label" style={{ left: pct(k.at), ...(top ? { top } : {}) }}>{label}</span> : null,
            p.view.badges && k.effect?.id ? <span key={`b-${k.id}`} className="fl-kf-badge" style={{ left: pct(k.at), ...(top ? { top } : {}) }}>{effectName(k.effect.id)}</span> : null,
          ];
        })}
        <span className="fl-playhead" style={{ left: pct(p.playhead) }} />
      </div>
    </div>
  );
}
