import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { modelOf } from "@openclapper/ext-hardware";
import { arrowHead, PENS, smooth, STROKE_UNIT, taper, TEXT_SIZE, type CanvasObject, type DrawPoint } from "@openclapper/model";
import {
  beamOpacity, beamPath, ceilingShape, effectOpacity, emptyStage, fmtClock, fmtSeconds, glowRadius, isCeiling, poolRadius, START_KEYFRAME, STAGE_INK, STAGE_TRACK_COLOURS, STAGE_W, tagAt, tagWidth, widgetShape, widgetState,
  type FlowBody, type FlowTrack, type StageLight, type WidgetPart,
} from "@openclapper/ext-flows";
import { imageSource } from "../../../media/cache";
import { Button, catColor, Icon, IconButton, makeStyles, type, useTheme, type IconName } from "../../../ui";

/**
 * A flow's stage on the device (docs/features/flows.md, "The stage"; #426): read only. The drawing made in the
 * Studio and a widget per placed light showing what its track plays at the playhead, drawn from the same shared
 * shapes, beams and motions as the Studio's. Nothing is drawn, placed or moved here; a widget tapped shows its state.
 */
export function StageView({ body, t, onShowTrack }: { body: FlowBody; t: number; onShowTrack: (track: string) => void }) {
  const s = useStyles();
  const stage = body.stage ?? emptyStage();
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [chosen, setChosen] = useState<string | null>(null);
  const H = STAGE_W / stage.aspect;
  // The paper keeps its aspect inside the room it has.
  const w = Math.min(room.w, room.h * stage.aspect), h = w / stage.aspect;
  const placed = stage.lights.map((l) => ({ l, tr: body.tracks.find((x) => x.id === l.track) })).filter((x): x is { l: StageLight; tr: FlowTrack } => !!x.tr);
  const states = placed.map(({ tr }) => widgetState(tr, t));
  const now = useClock(states.some((x) => x.effect));
  const pick = placed.find((x) => x.tr.id === chosen);
  const onRoom = (e: LayoutChangeEvent) => setRoom({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  // A tap: the widget nearest to it, within reach of a finger; elsewhere lets go.
  const tap = (e: GestureResponderEvent) => {
    const x = (e.nativeEvent.locationX / w) * STAGE_W, y = (e.nativeEvent.locationY / h) * H, reach = (40 / w) * STAGE_W;
    const near = placed.map(({ l, tr }) => ({ id: tr.id, d: Math.hypot(l.x * STAGE_W - x, l.y * H - y) })).sort((a, b) => a.d - b.d)[0];
    setChosen(near && near.d < reach ? near.id : null);
  };

  return (
    <View style={s.room} onLayout={onRoom}>
      {w > 0 && (
        <Pressable onPress={tap} style={[s.paper, { width: w, height: h, backgroundColor: STAGE_INK.paper }]} accessibilityLabel="The flow's stage">
          {stage.underlay && <Image source={imageSource(stage.underlay.photo, "preview")} style={[s.fill, { opacity: stage.underlay.opacity }]} contentFit="contain" />}
          <Svg width={w} height={h} viewBox={`0 0 ${STAGE_W} ${H}`} style={s.fill}>
            {stage.objects.filter((o) => o.visible && o.kind !== "stencil").map((o) => <Drawn key={o.id} o={o} vh={H} />)}
            {placed.map(({ l, tr }, i) => {
              const st = states[i], c = st.colour ?? "#ffffff", id = `w${i}`;
              if (!st.on) return null;
              const fade = beamOpacity(st.level) * (st.effect ? effectOpacity(st.effect.family, now) : 1);
              // A ceiling light: a pool of light around it, no direction (as the Studio draws it).
              if (isCeiling(l)) return (
                <G key={`b${tr.id}`} transform={`translate(${l.x * STAGE_W} ${l.y * H})`} opacity={fade}>
                  <Defs><RadialGradient id={`${id}p`}><Stop offset="0" stopColor={c} stopOpacity={0.8} /><Stop offset="0.4" stopColor={c} stopOpacity={0.4} /><Stop offset="1" stopColor={c} stopOpacity={0} /></RadialGradient></Defs>
                  <Circle cx={0} cy={0} r={poolRadius(ceilingShape(tr.model), st.level)} fill={`url(#${id}p)`} />
                </G>
              );
              const g = widgetShape(tr.model);
              return (
                <G key={`b${tr.id}`} transform={`translate(${l.x * STAGE_W} ${l.y * H}) rotate(${l.rot})`} opacity={fade}>
                  <Defs>
                    <RadialGradient id={`${id}g`}><Stop offset="0" stopColor={c} stopOpacity={0.95} /><Stop offset="0.45" stopColor={c} stopOpacity={0.45} /><Stop offset="1" stopColor={c} stopOpacity={0} /></RadialGradient>
                    <LinearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={c} stopOpacity={0.7} /><Stop offset="1" stopColor={c} stopOpacity={0} /></LinearGradient>
                  </Defs>
                  <Path d={beamPath(g, st.level)} fill={`url(#${id}b)`} />
                  <Circle cx={g.front} cy={0} r={glowRadius(g, st.level)} fill={`url(#${id}g)`} />
                </G>
              );
            })}
            {placed.map(({ l, tr }, i) => (
              <G key={`w${tr.id}`} transform={`translate(${l.x * STAGE_W} ${l.y * H})${isCeiling(l) ? "" : ` rotate(${l.rot})`}`}>
                <Body shape={isCeiling(l) ? ceilingShape(tr.model) : widgetShape(tr.model)} face={states[i].on ? states[i].colour ?? "#ffffff" : STAGE_INK.unlit} muted={states[i].muted} />
              </G>
            ))}
            {placed.map(({ l, tr }, i) => {
              const st = states[i], tw = tagWidth(tr.name, st.line), [tx, ty] = tagAt(l, stage.aspect, tw), ink = tr.color !== undefined ? STAGE_TRACK_COLOURS[tr.color] : STAGE_INK.rim;
              return (
                <G key={`t${tr.id}`} transform={`translate(${tx} ${ty})`}>
                  <Rect x={-tw / 2} y={-23} width={tw} height={46} rx={6} fill={STAGE_INK.tag} stroke={ink} strokeWidth={1.5} />
                  <Rect x={-tw / 2 + 4} y={-18} width={5} height={36} rx={2} fill={ink} />
                  <SvgText x={-tw / 2 + 16} y={-3} fontSize={18} fontWeight="700" fill={STAGE_INK.name}>{tr.name}</SvgText>
                  <SvgText x={-tw / 2 + 16} y={15} fontSize={14} fill={STAGE_INK.line}>{st.line}</SvgText>
                </G>
              );
            })}
            {pick && <Circle cx={pick.l.x * STAGE_W} cy={pick.l.y * H} r={42} fill="none" stroke={STAGE_INK.select} strokeWidth={2} strokeDasharray="5 4" />}
          </Svg>
          {/* Stencils: the design system's glyphs, as the Studio draws them, in their boxes. */}
          {stage.objects.filter((o) => o.visible && o.kind === "stencil").map((o) => (
            <View key={o.id} pointerEvents="none" style={{ position: "absolute", left: o.x * w, top: o.y * h, width: o.w * w, height: o.h * h, opacity: o.opacity, alignItems: "center", justifyContent: "center", transform: o.rot ? [{ rotate: `${o.rot}deg` }] : undefined }}>
              <Icon name={(o.icon ?? "camera") as IconName} size={Math.min(o.w * w, o.h * h)} color={ink(o.stroke)} />
            </View>
          ))}
          {!placed.length && !stage.objects.length && <Text style={s.empty}>Nothing on the stage yet: it is drawn and lights are placed in the Studio.</Text>}
        </Pressable>
      )}
      {pick && <Card tr={pick.tr} l={pick.l} t={t} onShowTrack={() => onShowTrack(pick.tr.id)} onClose={() => setChosen(null)} />}
    </View>
  );
}

/** A colour of the drawing: its own, or a categorical one (1–8) as the dark paper shows it. */
const ink = (c: CanvasObject["stroke"] | null | undefined) => (typeof c === "string" ? c : c ? STAGE_TRACK_COLOURS[c - 1] ?? STAGE_INK.rim : STAGE_INK.rim);

/** One drawn object, in the paper's units (1000 wide), as the Studio's canvas draws it. */
function Drawn({ o, vh }: { o: CanvasObject; vh: number }) {
  const c = ink(o.stroke), cx = (o.x + o.w / 2) * 1000, cy = (o.y + o.h / 2) * vh;
  const turn = o.rot ? `rotate(${o.rot} ${cx} ${cy})` : undefined;
  if (o.kind === "pen" || o.kind === "line" || o.kind === "arrow") {
    const flat = o.pts ?? [], q: DrawPoint[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) q.push([Number(((o.x + flat[i] * o.w) * 1000).toFixed(1)), Number(((o.y + flat[i + 1] * o.h) * vh).toFixed(1))]);
    if (q.length < 2) return null;
    const pen = PENS[o.pen ?? "pen"], sw = o.width * STROKE_UNIT * (o.kind === "pen" ? pen.scale : 1);
    return (
      <G transform={turn} opacity={o.opacity * (o.kind === "pen" ? pen.opacity : 1)}>
        {o.kind === "pen" && pen.taper ? <Path d={taper(q, sw)} fill={c} />
          : <Path d={o.kind === "pen" ? smooth(q) : `M${q.map((x) => x.join(" ")).join(" L")}`} fill="none" stroke={c} strokeWidth={sw} strokeLinecap={o.kind === "pen" ? pen.cap : "round"} strokeLinejoin="round" strokeDasharray={o.kind === "pen" && pen.dash ? pen.dash : undefined} />}
        {o.kind === "arrow" && <Path d={arrowHead(q[q.length - 2], q[q.length - 1], sw)} fill={c} />}
      </G>
    );
  }
  if (o.kind === "rect" || o.kind === "ellipse") {
    const bw = o.width * STROKE_UNIT, x = o.x * 1000, y = o.y * vh, ww = o.w * 1000, hh = o.h * vh;
    const fill = o.fill != null ? ink(o.fill) : "none";
    return o.kind === "rect"
      ? <Rect x={x + bw / 2} y={y + bw / 2} width={Math.max(0, ww - bw)} height={Math.max(0, hh - bw)} fill={fill} stroke={c} strokeWidth={bw} opacity={o.opacity} transform={turn} />
      : <Ellipse cx={cx} cy={cy} rx={Math.max(0, ww / 2 - bw / 2)} ry={Math.max(0, hh / 2 - bw / 2)} fill={fill} stroke={c} strokeWidth={bw} opacity={o.opacity} transform={turn} />;
  }
  if (o.kind === "text") {
    const size = o.h * TEXT_SIZE * vh, lines = (o.text ?? "").split("\n");
    return <G transform={turn} opacity={o.opacity}>{lines.map((line, i) => <SvgText key={i} x={o.x * 1000} y={cy + (i - (lines.length - 1) / 2) * size * 1.05} fontSize={size} fontWeight="700" fill={c} alignmentBaseline="middle">{line}</SvgText>)}</G>;
  }
  return null;
}

/** A widget's body after its fixture (aimed: facing +x; ceiling: seen from below); the face takes the light's colour. */
function Body({ shape, face, muted }: { shape: { parts: WidgetPart[] }; face: string; muted?: boolean }) {
  return <G opacity={muted ? 0.45 : 1}>{shape.parts.map((p, i) => p.kind === "rect"
    ? <Rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={p.face ? face : STAGE_INK.body} stroke={p.face ? "none" : STAGE_INK.rim} strokeWidth={1.5} strokeDasharray={muted ? [3, 2] : undefined} />
    : <Path key={i} d={p.d} fill={p.face ? face : STAGE_INK.body} stroke={STAGE_INK.rim} strokeWidth={1.5} strokeDasharray={muted ? [3, 2] : undefined} />)}</G>;
}

/** The time for an effect's motion, ticking only while an effect runs (a few frames a second is enough for a sketch). */
function useClock(on: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(h);
  }, [on]);
  return now;
}

/** A tapped widget's state at the playhead (read only). */
function Card({ tr, l, t, onShowTrack, onClose }: { tr: FlowTrack; l: StageLight; t: number; onShowTrack: () => void; onClose: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const st = widgetState(tr, t), m = modelOf(tr.model);
  const rows: [string, string][] = [["Power", st.muted ? "Muted" : st.line === "off" ? "Off" : "On"], ["Intensity", `${Math.round(st.level * 100)} %`], ["Light", st.tint ?? "Not set"], ["Effect", st.effect ? `${st.effect.name} (${st.effect.family})` : "None"]];
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={[s.dot, { backgroundColor: catColor(c, (tr.color ?? 0) + 1) }]} />
        <Text style={s.cardTitle} numberOfLines={1}>{tr.name}</Text>
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>
      <Text style={s.dim}>{m ? `${m.brand} ${m.model}` : tr.model} · {isCeiling(l) ? "on the ceiling" : "aimed"} · {tr.device ? "assigned" : "no device"} · at {fmtClock(t)}</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={s.kv}>
          <Text style={s.dim}>{k}</Text>
          <View style={s.kvValue}>{k === "Light" && st.colour && <View style={[s.swatch, { backgroundColor: st.colour }]} />}<Text style={s.value}>{v}</Text></View>
        </View>
      ))}
      <Button kind="secondary" icon="timeline" label="Show track" onPress={onShowTrack} />
    </View>
  );
}

/**
 * The mini timeline under the stage: where the playhead is, the light tracks' keyframes as dots in their colours,
 * a tap or drag moves the playhead (to see where the lights are at 5 s, say).
 */
export function MiniScrubber({ body, t, onSeek }: { body: FlowBody; t: number; onSeek: (t: number) => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const D = body.durationMs;
  const lights = useMemo(() => body.tracks.filter((x) => modelOf(x.model)?.type === "light"), [body.tracks]);
  const seek = (e: GestureResponderEvent) => { if (w > 0) onSeek(Math.min(D, Math.max(0, (e.nativeEvent.locationX / w) * D))); };
  const marks: number[] = [];
  const step = D <= 30_000 ? 5000 : D <= 120_000 ? 15_000 : 60_000;
  for (let x = 0; x <= D; x += step) marks.push(x);
  const p = D ? Math.min(1, t / D) : 0;
  return (
    <View style={s.mini}>
      <View style={s.miniBar} onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={seek} onResponderMove={seek}
        accessibilityRole="adjustable" accessibilityLabel="Playhead" accessibilityValue={{ text: fmtClock(t) }}>
        {lights.map((tr, i) => tr.keyframes.filter((k) => k.id !== START_KEYFRAME).map((k) => (
          <View key={`${tr.id}${k.id}`} pointerEvents="none" style={[s.miniDot, { left: (k.at / D) * w - 4, top: 2 + (i % 4) * 5, backgroundColor: catColor(c, (tr.color ?? 0) + 1) }]} />
        )))}
        <View pointerEvents="none" style={s.miniLine} />
        <View pointerEvents="none" style={[s.miniDone, { width: p * w }]} />
        <View pointerEvents="none" style={[s.miniThumb, { left: p * w - 14 }]} />
      </View>
      <View style={s.miniLabels} pointerEvents="none">
        {marks.map((x) => <Text key={x} style={[s.miniLabel, { left: (x / D) * w - 20 }]}>{fmtSeconds(x)}</Text>)}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  room: { flex: 1, alignItems: "center", justifyContent: "center", padding: 8, backgroundColor: c.surfaceSunken },
  paper: { overflow: "hidden", borderRadius: 4 },
  fill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  empty: { position: "absolute", left: 12, bottom: 10, right: 12, ...type("caption"), color: STAGE_INK.line },
  card: { position: "absolute", left: 16, bottom: 16, width: 360, maxWidth: "92%", gap: 8, padding: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, ...type("label", "semibold"), color: c.text },
  dot: { width: 12, height: 12, borderRadius: 6 },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kvValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: c.border },
  dim: { ...type("caption"), color: c.textDim },
  value: { ...type("body"), color: c.text, fontVariant: ["tabular-nums"] },
  mini: { paddingHorizontal: 28, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: c.borderSubtle, backgroundColor: c.surface },
  miniBar: { height: 44 },
  miniLine: { position: "absolute", left: 0, right: 0, top: 26, height: 6, borderRadius: 3, backgroundColor: c.surfaceSunken },
  miniDone: { position: "absolute", left: 0, top: 26, height: 6, borderRadius: 3, backgroundColor: c.accent },
  miniDot: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
  miniThumb: { position: "absolute", top: 15, width: 28, height: 28, borderRadius: 14, backgroundColor: c.surface, borderWidth: 3, borderColor: c.accent },
  miniLabels: { height: 16 },
  miniLabel: { position: "absolute", width: 40, textAlign: "center", ...type("caption"), color: c.textDim, fontVariant: ["tabular-nums"] },
}));
