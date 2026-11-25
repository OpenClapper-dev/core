import { useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { modelOf } from "@openclapper/ext-hardware";
import { fmtSeconds, snap, START_KEYFRAME, type FlowBody, type FlowMarker, type FlowTrack, type Keyframe } from "@openclapper/ext-flows";
import { catColor, Icon, makeStyles, num, type, useTheme } from "../../../ui";

/** What is chosen in the lanes: one keyframe, the fade into one, a marker, or a track. */
export type Pick = { kind: "kf" | "fade"; track: string; id: string } | { kind: "marker"; id: string } | { kind: "track"; id: string } | null;

const LABEL_W = 112, RULER_H = 32, MARKS_H = 28, LANE_H = 64, DOT = 22;

/**
 * A flow's lanes on the device (docs/features/flows.md, "On the device"): the ruler (tap: the playhead), the marker
 * strip and one lane per track, `zoom` times the screen's width and scrolling sideways, the track labels beside them.
 * In Insert mode a tap on a lane adds a keyframe and a tap on the strip a marker; a keyframe is dragged in time.
 */
export function Lanes({ body, zoom, insert, playhead, pick, locked, onPick, onSeek, onAddKeyframe, onAddMarker, onMoveKeyframe, onAddTrack, deviceName }: {
  body: FlowBody; zoom: number; insert: boolean; playhead: number; pick: Pick; locked: boolean;
  onPick: (p: Pick) => void; onSeek: (t: number) => void; onAddKeyframe: (track: string, t: number) => void; onAddMarker: (t: number) => void;
  onMoveKeyframe: (track: string, kf: Keyframe, t: number) => void; onAddTrack: () => void; deviceName: (id: string | null) => string;
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

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <View style={s.row} onLayout={onRoom}>
        <View style={s.labels}>
          <View style={[s.labelCell, { height: RULER_H }]} />
          <View style={[s.labelCell, { height: MARKS_H }]}><Text style={s.dim}>Markers</Text></View>
          {body.tracks.map((t) => {
            const on = pick?.kind === "track" && pick.id === t.id;
            return (
              <Pressable key={t.id} onPress={() => onPick({ kind: "track", id: t.id })} style={[s.labelCell, s.trackLabel, { height: LANE_H, borderLeftColor: catColor(c, (t.color ?? 0) + 1) }, on && s.labelOn]}>
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
            <Pressable style={[s.marks, { height: MARKS_H }]} onPress={(e) => { if (insert && !locked) onAddMarker(at(press(e))); }}>
              {markers.map((m) => <MarkerChip key={m.id} m={m} x={x} on={pick?.kind === "marker" && pick.id === m.id} onPress={() => onPick({ kind: "marker", id: m.id })} />)}
            </Pressable>
            {body.tracks.map((t) => (
              <Lane key={t.id} t={t} x={x} at={at} insert={insert && !locked} locked={locked} pick={pick} onPick={onPick} onAdd={(time) => onAddKeyframe(t.id, time)} onMove={(kf, time) => onMoveKeyframe(t.id, kf, time)} />
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

function MarkerChip({ m, x, on, onPress }: { m: FlowMarker; x: (t: number) => number; on: boolean; onPress: () => void }) {
  const s = useStyles();
  const left = x(m.at), w = m.end !== undefined ? Math.max(12, x(m.end) - left) : undefined;
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[s.marker, { left }, w !== undefined && { width: w }, on && s.markerOn]}>
      <Text style={s.markerText} numberOfLines={1}>{m.name || "Marker"}</Text>
    </Pressable>
  );
}

/** One track's lane: its fades as strips, its keyframes as dots to tap or drag. */
function Lane({ t, x, at, insert, locked, pick, onPick, onAdd, onMove }: {
  t: FlowTrack; x: (t: number) => number; at: (px: number) => number; insert: boolean; locked: boolean; pick: Pick;
  onPick: (p: Pick) => void; onAdd: (t: number) => void; onMove: (kf: Keyframe, t: number) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const col = catColor(c, (t.color ?? 0) + 1);
  const kfs = [...t.keyframes].sort((a, b) => a.at - b.at);
  const camera = modelOf(t.model)?.type === "camera";
  return (
    <Pressable style={[s.lane, { height: LANE_H, backgroundColor: c.surfaceSunken }, t.muted && { opacity: 0.4 }]} onPress={(e) => { if (insert) onAdd(at(e.nativeEvent.locationX)); else onPick(null); }}>
      {kfs.map((k, i) => {
        if (i === 0) return null;
        const from = kfs[i - 1], on = pick?.kind === "fade" && pick.track === t.id && pick.id === k.id;
        return (
          <Pressable key={`f${k.id}`} onPress={() => onPick({ kind: "fade", track: t.id, id: k.id })} hitSlop={{ top: 10, bottom: 10 }}
            style={[s.gap, { left: x(from.at) + DOT / 2, width: Math.max(0, x(k.at) - x(from.at) - DOT) }, k.fadeIn ? { backgroundColor: col, opacity: 0.55 } : { borderColor: col }, on && s.gapOn]} />
        );
      })}
      {kfs.map((k) => (
        <Dot key={k.id} k={k} left={x(k.at)} color={col} camera={camera} on={pick?.kind === "kf" && pick.track === t.id && pick.id === k.id} locked={locked}
          onPress={() => onPick({ kind: "kf", track: t.id, id: k.id })} onDrop={(dx) => onMove(k, at(x(k.at) + dx))} />
      ))}
    </Pressable>
  );
}

/** A keyframe: tap to choose it; drag sideways to move it (not the start keyframe). */
function Dot({ k, left, color, camera, on, locked, onPress, onDrop }: { k: Keyframe; left: number; color: string; camera: boolean; on: boolean; locked: boolean; onPress: () => void; onDrop: (dx: number) => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const [dx, setDx] = useState(0);
  const r = useRef({ onDrop, onPress, locked, start: k.id === START_KEYFRAME });
  r.current = { onDrop, onPress, locked, start: k.id === START_KEYFRAME };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => !r.current.locked && !r.current.start && Math.abs(g.dx) > 6,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => { if (!r.current.locked && !r.current.start) setDx(g.dx); },
    onPanResponderRelease: (_e, g) => { setDx(0); if (Math.abs(g.dx) > 6 && !r.current.locked && !r.current.start) r.current.onDrop(g.dx); else r.current.onPress(); },
    onPanResponderTerminate: () => setDx(0),
  })).current;
  const level = camera ? 0.5 : k.intensity ?? 0.5;
  return (
    <View {...pan.panHandlers} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Keyframe at ${fmtSeconds(k.at)}`}
      style={[s.dot, { left: left - DOT / 2 + dx, top: (LANE_H - DOT) * (1 - level), borderColor: color, backgroundColor: on ? color : c.surface }, camera && s.dotCamera, on && s.dotOn]} />
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
  gap: { position: "absolute", top: LANE_H / 2 - 3, height: 6, borderRadius: 3, borderWidth: 1, borderStyle: "dashed" },
  gapOn: { borderWidth: 2, borderStyle: "solid", borderColor: c.text },
  dot: { position: "absolute", width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 3 },
  dotCamera: { borderRadius: 4, top: (LANE_H - DOT) / 2 },
  dotOn: { borderColor: c.text },
  playhead: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: c.danger },
  add: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16 },
  addText: { ...type("label", "semibold"), color: c.accent },
}));
