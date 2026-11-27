import { useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { effectName, modelOf } from "@openclapper/ext-hardware";
import { fmtSeconds, graphLine, keyframeLevel, lightColour, sampleTrack, shortLabel, snap, snapLevel, START_KEYFRAME, type FlowBody, type FlowMarker, type FlowTrack, type FlowView, type Keyframe, type KeyframeSize } from "@openclapper/ext-flows";
import { catColor, Icon, makeStyles, num, type, useTheme } from "../../../ui";

/** What is chosen in the lanes: one keyframe, the fade into one, a marker, or a track. */
/** A keyframe drag held to one axis (#426): "time" keeps its time, "level" its intensity. */
export type AxisLock = "time" | "level";
/** What a tap does (#426): Select chooses and drags, Insert adds, Edit opens what is tapped (no drags). */
export type Mode = "select" | "insert" | "edit";
export type Pick = { kind: "kf" | "fade"; track: string; id: string } | { kind: "marker"; id: string } | { kind: "track"; id: string } | null;

export const LABEL_W = 112, RULER_H = 32, MARKS_H = 28;
/** Keyframe sizes (#426): small for a pen, large for a finger. */
export const DOT_SIZES: Record<KeyframeSize, number> = { s: 22, m: 30, l: 40 };
/** The strip between two keyframes (the fade): thick enough to see and to tap with a finger. */
const GAP_H = 14;
/** The room above and below a keyframe in a lane with the graph: the dot's half, so it never leaves the lane. */
const pad = (dot: number) => dot / 2 + 4;

/**
 * A flow's lanes on the device (docs/features/flows.md, "On the device"): the ruler (tap: the playhead), the marker
 * strip and one lane per track, `zoom` times the screen's width and scrolling sideways, the track labels beside them.
 * In Insert mode a tap on a lane adds a keyframe and a tap on the strip a marker; keyframes and markers are dragged
 * in Select and Insert, never in Edit, where a tap is for opening what it hits.
 */
export function Lanes({ body, zoom, mode, playhead, pick, locked, view, kfSize, laneHeight, levelStep, axisLock, onPick, onSeek, onAddKeyframe, onAddMarker, onMoveMarker, onMoveKeyframe, onAddTrack, deviceName }: {
  body: FlowBody; zoom: number; mode: Mode; playhead: number; pick: Pick; locked: boolean; view: FlowView; kfSize: KeyframeSize; laneHeight: number; /** Intensity drags snap to this many percent. */ levelStep: number; axisLock?: AxisLock;
  onPick: (p: Pick) => void; onSeek: (t: number) => void; onAddKeyframe: (track: string, t: number) => void; onAddMarker: (t: number) => void; /** A marker dragged to a time (snapped). */ onMoveMarker: (id: string, t: number) => void;
  /** A keyframe dragged: to a time, and with the graph to a level (0..1; undefined: unchanged). */ onMoveKeyframe: (track: string, kf: Keyframe, t: number, level?: number) => void; onAddTrack: () => void; deviceName: (id: string | null) => string;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const [room, setRoom] = useState(0);
  const width = Math.max(1, room * zoom);
  const x = (t: number) => (t / body.durationMs) * width;
  const at = (px: number) => Math.min(body.durationMs, Math.max(0, snap((px / width) * body.durationMs)));
  const onRoom = (e: LayoutChangeEvent) => setRoom(e.nativeEvent.layout.width - LABEL_W);
  const seconds = ticks(body.durationMs, width);
  const markers = (body.markers ?? []).filter((m) => !m.trackId);
  const press = (e: GestureResponderEvent) => e.nativeEvent.locationX;
  const insert = mode === "insert" && !locked, drags = mode !== "edit" && !locked;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <View style={s.row} onLayout={onRoom}>
        <View style={s.labels}>
          <View style={[s.labelCell, { height: RULER_H }]} />
          <View style={[s.labelCell, { height: MARKS_H }]}><Text style={s.dim}>Markers</Text></View>
          {body.tracks.map((t) => {
            const on = pick?.kind === "track" && pick.id === t.id;
            return (
              <Pressable key={t.id} onPress={() => onPick({ kind: "track", id: t.id })} style={[s.labelCell, s.trackLabel, { height: laneHeight, borderLeftColor: catColor(c, (t.color ?? 0) + 1) }, on && s.labelOn]}>
                <Text style={s.name} numberOfLines={1}>{t.name}</Text>
                <Text style={s.dim} numberOfLines={1}>{t.muted ? "Muted · " : ""}{deviceName(t.device)}</Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView horizontal style={s.scroll} contentContainerStyle={{ width }}>
          <View style={{ width }}>
            <Pressable style={[s.ruler, { height: RULER_H }]} onPress={(e) => onSeek(at(press(e)))}>
              {seconds.map((t) => <View key={t} style={[s.tick, { left: x(t) }]}><Text style={s.tickText}>{t / 1000}</Text></View>)}
            </Pressable>
            <Pressable style={[s.marks, { height: MARKS_H }]} onPress={(e) => { if (insert) onAddMarker(at(press(e))); }}>
              {markers.map((m) => <MarkerChip key={m.id} m={m} x={x} drags={drags} onDrop={(dx) => onMoveMarker(m.id, at(x(m.at) + dx))} on={pick?.kind === "marker" && pick.id === m.id} onPress={() => onPick({ kind: "marker", id: m.id })} />)}
            </Pressable>
            {body.tracks.map((t) => (
              <Lane key={t.id} t={t} x={x} at={at} width={width} h={laneHeight} dot={DOT_SIZES[kfSize]} view={view} levelStep={levelStep} axisLock={axisLock} duration={body.durationMs} insert={insert} drags={drags} pick={pick} onPick={onPick} onAdd={(time) => onAddKeyframe(t.id, time)} onMove={(kf, time, level) => onMoveKeyframe(t.id, kf, time, level)} />
            ))}
            <View pointerEvents="none" style={[s.playhead, { left: x(playhead) }]} />
          </View>
        </ScrollView>
      </View>
      <Pressable style={s.add} onPress={onAddTrack} disabled={locked} accessibilityRole="button">
        <Icon name="plus" size={18} color={locked ? c.textDisabled : c.accent} />
        <Text style={[s.addText, locked && { color: c.textDisabled }]}>Add a track</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Whole seconds to label on the ruler, at least about 56 dp apart. */
function ticks(durationMs: number, width: number): number[] {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  const perSec = width / (durationMs / 1000);
  const step = steps.find((x) => x * perSec >= 56) ?? 600;
  const out: number[] = [];
  for (let t = 0; t <= durationMs; t += step * 1000) out.push(t);
  return out;
}

/** A marker: tap to choose it; dragged sideways (when `drags`) to move it, a range with its length. */
function MarkerChip({ m, x, on, drags, onPress, onDrop }: { m: FlowMarker; x: (t: number) => number; on: boolean; drags: boolean; onPress: () => void; onDrop: (dx: number) => void }) {
  const s = useStyles();
  const [dx, setDx] = useState(0);
  const r = useRef({ onPress, onDrop, drags });
  r.current = { onPress, onDrop, drags };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => r.current.drags && Math.abs(g.dx) > 6,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => { if (r.current.drags) setDx(g.dx); },
    onPanResponderRelease: (_e, g) => {
      setDx(0);
      if (!r.current.drags || Math.abs(g.dx) <= 6) r.current.onPress(); else r.current.onDrop(g.dx);
    },
    onPanResponderTerminate: () => setDx(0),
  })).current;
  const left = x(m.at), w = m.end !== undefined ? Math.max(12, x(m.end) - left) : undefined;
  return (
    <View {...pan.panHandlers} hitSlop={8} accessibilityRole="button" accessibilityLabel={m.name || "Marker"} style={[s.marker, { left: left + dx }, w !== undefined && { width: w }, on && s.markerOn]}>
      <Text style={s.markerText} numberOfLines={1}>{m.name || "Marker"}</Text>
    </View>
  );
}

/**
 * One track's lane: its fades as strips, its keyframes as dots to tap or drag. With the intensity graph on, a light's
 * keyframes sit at their level on the line and dragging up or down sets it; light colour fills a dot with what the
 * light shows there; value labels and badges say what a keyframe sets.
 */
function Lane({ t, x, at, width, h, dot, view, levelStep, axisLock, duration, insert, drags, pick, onPick, onAdd, onMove }: {
  t: FlowTrack; x: (t: number) => number; at: (px: number) => number; width: number; h: number; dot: number; view: FlowView; levelStep: number; axisLock?: AxisLock; duration: number; insert: boolean; /** Keyframes may be dragged (not in Edit mode, not read-only). */ drags: boolean; pick: Pick;
  onPick: (p: Pick) => void; onAdd: (t: number) => void; onMove: (kf: Keyframe, t: number, level?: number) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const col = catColor(c, (t.color ?? 0) + 1);
  const kfs = [...t.keyframes].sort((a, b) => a.at - b.at);
  const camera = modelOf(t.model)?.type === "camera";
  const graph = view.graph && !camera;
  const room = Math.max(1, h - 2 * pad(dot));
  const yOf = (level: number) => (graph ? pad(dot) + (1 - level) * room : h / 2);
  const line = graph ? graphLine(kfs, duration).map(([time, y]) => `${x(time).toFixed(1)},${(pad(dot) + y * room).toFixed(1)}`).join(" ") : "";
  return (
    <Pressable style={[s.lane, { height: h, backgroundColor: c.surfaceSunken }, t.muted && { opacity: 0.4 }]} onPress={(e) => { if (insert) onAdd(at(e.nativeEvent.locationX)); else onPick(null); }}>
      {/* Margins (#426): a band before and after a keyframe that has one, stronger on the chosen keyframe. */}
      {kfs.flatMap((k) => {
        const on = pick?.kind === "kf" && pick.track === t.id && pick.id === k.id;
        const band = (key: string, from: number, to: number) => <View key={key} pointerEvents="none" style={[s.margin, { left: x(from), width: Math.max(0, x(to) - x(from)), borderColor: col }, on ? { backgroundColor: col, opacity: 0.3 } : { backgroundColor: col, opacity: 0.12 }]} />;
        return [
          k.marginBeforeMs ? band(`mb${k.id}`, Math.max(0, k.at - k.marginBeforeMs), k.at) : null,
          k.marginAfterMs ? band(`ma${k.id}`, k.at, Math.min(duration, k.at + k.marginAfterMs)) : null,
        ];
      })}
      {graph && <Svg pointerEvents="none" width={width} height={h} style={{ position: "absolute", left: 0, top: 0 }}><Polyline points={line} fill="none" stroke={col} strokeWidth={2} /></Svg>}
      {kfs.map((k, i) => {
        if (i === 0 || camera) return null;
        const from = kfs[i - 1], on = pick?.kind === "fade" && pick.track === t.id && pick.id === k.id;
        return (
          <Pressable key={`f${k.id}`} onPress={() => onPick({ kind: "fade", track: t.id, id: k.id })} hitSlop={{ top: 8, bottom: 8 }}
            style={[s.gap, { top: h - GAP_H - 4, left: x(from.at) + dot / 2, width: Math.max(0, x(k.at) - x(from.at) - dot) }, k.fadeIn ? { backgroundColor: col, opacity: 0.55 } : { borderColor: col }, on && s.gapOn]} />
        );
      })}
      {kfs.map((k) => {
        const level = camera ? 0.5 : keyframeLevel(kfs, k);
        const fill = view.fill && !camera ? lightColour(sampleTrack(kfs, k.at)) : null;
        const label = view.labels || camera ? shortLabel(t.model, k, !view.badges) : "";
        return (
          <Dot key={k.id} k={k} left={x(k.at)} top={yOf(level)} size={dot} color={col} fill={fill} camera={camera} graph={graph} room={room} level={level} levelStep={levelStep}
            fixTime={k.id === START_KEYFRAME || axisLock === "time"} fixLevel={axisLock === "level"}
            label={label} badge={view.badges && k.effect?.id ? effectName(k.effect.id) : null} off={view.badges && k.power === false}
            on={pick?.kind === "kf" && pick.track === t.id && pick.id === k.id} locked={!drags}
            onPress={() => onPick({ kind: "kf", track: t.id, id: k.id })} onDrop={(dx, dl) => onMove(k, dx === 0 ? k.at : at(x(k.at) + dx), dl === null ? undefined : snapLevel(level, level + dl, levelStep))} />
        );
      })}
    </Pressable>
  );
}

/** A keyframe: tap to choose it; drag sideways to move it in time (not the start keyframe), up or down for its level (graph on). */
function Dot({ k, left, top, size, color, fill, camera, graph, room, level, levelStep, fixTime, fixLevel, label, badge, off, on, locked, onPress, onDrop }: {
  k: Keyframe; left: number; top: number; size: number; color: string; fill: string | null; camera: boolean; graph: boolean; room: number; level: number; levelStep: number; /** Held in time (the start keyframe, or Lock time). */ fixTime: boolean; /** Held in intensity (Lock intensity). */ fixLevel: boolean;
  label: string; badge: string | null; off: boolean; on: boolean; locked: boolean; onPress: () => void; onDrop: (dx: number, dLevel: number | null) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const r = useRef({ onDrop, onPress, locked, fixTime, levels: graph && !fixLevel, room });
  r.current = { onDrop, onPress, locked, fixTime, levels: graph && !fixLevel, room };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => !r.current.locked && Math.abs(g.dx) + Math.abs(g.dy) > 6,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => { if (!r.current.locked) setDrag({ dx: r.current.fixTime ? 0 : g.dx, dy: r.current.levels ? g.dy : 0 }); },
    onPanResponderRelease: (_e, g) => {
      setDrag({ dx: 0, dy: 0 });
      const moved = Math.abs(g.dx) + Math.abs(g.dy) > 6;
      if (!moved || r.current.locked) { r.current.onPress(); return; }
      const dx = r.current.fixTime ? 0 : g.dx, dl = r.current.levels ? -g.dy / r.current.room : null;
      if (dx !== 0 || dl !== null) r.current.onDrop(dx, dl);
    },
    onPanResponderTerminate: () => setDrag({ dx: 0, dy: 0 }),
  })).current;
  const shown = graph ? snapLevel(level, level - drag.dy / room, levelStep) : null;
  // While dragging up or down the dot sits on the snapped level it will take.
  const y = shown !== null && drag.dy !== 0 ? top - (shown - level) * room : top;
  return (
    <>
      <View {...pan.panHandlers} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Keyframe at ${fmtSeconds(k.at)}`}
        style={[s.dot, { width: size, height: size, borderRadius: camera ? 4 : size / 2, left: left - size / 2 + drag.dx, top: y - size / 2, borderColor: on ? c.text : color, backgroundColor: fill ?? (on ? color : c.surface) }, off && s.dotOff]} />
      {shown !== null && (drag.dy !== 0) && <Text pointerEvents="none" style={[s.value, { left: left + size / 2 + 4 + drag.dx, top: y - 9 }]}>{`${Math.round(shown * 100)} %`}</Text>}
      {!!label && <Text pointerEvents="none" numberOfLines={1} style={[s.kfLabel, { left: left + size / 2 + 3 + drag.dx, top: y - 8 }]}>{label}</Text>}
      {!!badge && <Text pointerEvents="none" numberOfLines={1} style={[s.badge, { left: left - size / 2 + drag.dx, top: y + size / 2 + 2 }]}>{badge}</Text>}
    </>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1 },
  content: { paddingBottom: 24 },
  row: { flexDirection: "row" },
  labels: { width: LABEL_W, borderRightWidth: 1, borderRightColor: c.borderSubtle },
  labelCell: { justifyContent: "center", paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  trackLabel: { borderLeftWidth: 4 },
  labelOn: { backgroundColor: c.surfaceSunken },
  name: { ...type("small", "semibold"), color: c.text },
  dim: { ...type("caption"), color: c.textDim },
  scroll: { flex: 1 },
  ruler: { borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  tick: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: 1, borderLeftColor: c.border, paddingLeft: 3 },
  tickText: { ...type("caption"), color: c.textDim, ...num },
  marks: { borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  marker: { position: "absolute", top: 3, height: 22, minWidth: 12, paddingHorizontal: 5, justifyContent: "center", borderLeftWidth: 2, borderLeftColor: c.accent, backgroundColor: c.surfaceSunken, borderRadius: 3 },
  markerOn: { backgroundColor: c.accent },
  markerText: { ...type("caption", "semibold"), color: c.text },
  lane: { borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  margin: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: 1, borderRightWidth: 1, borderStyle: "dashed" },
  gap: { position: "absolute", height: GAP_H, borderRadius: GAP_H / 2, borderWidth: 1, borderStyle: "dashed" },
  gapOn: { borderWidth: 2, borderStyle: "solid", borderColor: c.text },
  dot: { position: "absolute", borderWidth: 3 },
  dotOff: { borderStyle: "dashed", opacity: 0.6 },
  value: { position: "absolute", ...type("caption", "semibold"), color: c.text, backgroundColor: c.surface, paddingHorizontal: 4, borderRadius: 3 },
  kfLabel: { position: "absolute", ...type("caption"), fontSize: 11, color: c.textDim, maxWidth: 140 },
  badge: { position: "absolute", ...type("caption", "semibold"), fontSize: 10, color: c.text, backgroundColor: c.borderSubtle, paddingHorizontal: 4, borderRadius: 3, overflow: "hidden" },
  playhead: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: c.danger },
  add: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16 },
  addText: { ...type("label", "semibold"), color: c.accent },
}));
