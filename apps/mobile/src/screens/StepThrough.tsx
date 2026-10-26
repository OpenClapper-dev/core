import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lightLabel, shootableWindows } from "@openclapper/vocab";
import { steps, type Composed, type Shot, type ShootingDay } from "../api";
import { useApp } from "../appState";
import { useOnline } from "../net";
import { extraLine, hhmm, placeLabel, rigLabel, shotTitle, tagsLabel } from "../shots";
import { FRAME_MODES, FrameModeSeg, type FrameMode } from "../components/ShotFrame";
import { ComposeRows, ComposeViewer } from "../components/ComposeParts";
import { MarkdownText } from "../components/Markdown";
import { ShotPhoto, stepTag } from "../components/ShotParts";
import { BORDER, Button, FIXED, Icon, makeStyles, num, PhotoTag, RADIUS, Sheet, type, useLayoutSize, useTheme } from "../ui";
import { store } from "../storage";
import { plannedAt, useDayLight, windowFit, windowsText } from "./Day";

/**
 * The day's shots one by one with the phone on the rig: no tab bar, no header, screen kept on.
 * Next is the largest target (right thumb), Prev the left; swipe on the photo does the same.
 * Everything here works from the offline copy.
 */
export function StepThrough({ day, shots, index: start }: { day: ShootingDay; shots: Shot[]; index: number }) {
  useKeepAwake();
  const s = useStyles();
  const { c } = useTheme();
  const app = useApp();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const [box, onBox] = useLayoutSize();
  const [index, setIndex] = useState(Math.min(start, shots.length - 1));
  const [photoIndex, setPhotoIndex] = useState(0);
  const [mode, setMode] = useState<FrameMode>(() => store.loadPref("stepMode.v1", "fit", FRAME_MODES));
  const [info, setInfo] = useState(false);
  const [viewing, setViewing] = useState<Composed | null>(null);
  const { light } = useDayLight(day, shots);
  useEffect(() => { setPhotoIndex(0); }, [index]);
  const [screen, onScreen] = useLayoutSize();
  const portrait = screen.height >= screen.width;

  const shot = shots[index];
  const list = steps(shot);
  const photo = list[Math.min(photoIndex, list.length - 1)].photo;
  const w = shootableWindows(light, shot.light);
  const planned = plannedAt(day, shot.id);
  const fit = windowFit(planned, w);
  const bad = !!fit && fit !== "inside";
  const windowLine = w.length
    ? `${fit === "before" ? "Before the window" : fit === "after" ? "After the window" : fit === "outside" ? "Outside the windows" : "Window"} ${windowsText(w)}${shot.light.length ? ` · ${lightLabel(shot.light, false)}` : ""}`
    : "Any time works";
  const atStart = index === 0, atEnd = index === shots.length - 1;
  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(shots.length - 1, i + d)));
  const notes = day.shots.find((x) => x.shot_id === shot.id)?.notes;
  const pickMode = (m: FrameMode) => { setMode(m); store.savePref("stepMode.v1", m); };

  const nav = (dir: -1 | 1, style: object) => {
    const disabled = dir < 0 ? atStart : atEnd;
    const next = dir > 0;
    return (
      <Pressable onPress={() => go(dir)} disabled={disabled} accessibilityRole="button" accessibilityLabel={next ? "Next shot" : "Previous shot"}
        style={({ pressed }) => [s.nav, style, next ? s.navNext : s.navPrev, pressed && { opacity: 0.8 }, disabled && s.navOff]}>
        <Icon name={next ? "chevron-right" : "chevron-left"} size={next ? 56 : 48} color={disabled ? c.textDisabled : next ? c.onAccent : c.text} />
        <Text style={[s.navText, { color: disabled ? c.textDisabled : next ? c.onAccent : c.text }]}>{next ? "Next" : "Prev"}</Text>
      </Pressable>
    );
  };
  const photoArea = (
    <View style={{ flex: 1 }} onLayout={onBox}>
      {box.width > 0 && <ShotPhoto shot={shot} index={photoIndex} badges={false} mode={mode} settings={app.settings} maxW={box.width} maxH={box.height} onNext={() => go(1)} onPrev={() => go(-1)} />}
      <View style={s.pos} pointerEvents="none"><PhotoTag big>{index + 1} / {shots.length}</PhotoTag></View>
      {list.length > 1 && (
        <Pressable onPress={() => setPhotoIndex((photoIndex + 1) % list.length)} style={s.photoBtn} accessibilityRole="button" accessibilityLabel={shot.steps?.length ? "Next step of this shot" : "Next photo of this shot"}>
          <Text style={s.photoBtnText}>{stepTag(shot, photoIndex, list.length)}</Text>
          <Icon name="chevron-right" size={22} color={FIXED.white} />
        </Pressable>
      )}
    </View>
  );
  const infoBlock = (
    <View style={{ gap: 6 }}>
      <Text style={s.name} numberOfLines={2}>{shotTitle(shot)}</Text>
      <Text style={s.place} numberOfLines={1}>{placeLabel(shot) || "No location"}</Text>
      {planned && <Text style={[s.planned, portrait && { fontSize: 40, lineHeight: 46 }, bad && { color: c.danger }]}>{hhmm(planned)}</Text>}
      <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
        {bad && <Icon name="alert" size={18} color={c.danger} />}
        <Text style={[s.window, { color: bad ? c.danger : c.ok }]}>{windowLine}</Text>
      </View>
    </View>
  );
  const details = <Button kind="secondary" icon="information-outline" label="Details" onPress={() => setInfo(true)} />;

  return (
    <View style={s.root} onLayout={onScreen}>
      <StatusBar hidden />
      {portrait ? (
        <>
          <View style={{ flex: 1, paddingTop: insets.top }}>
            {photoArea}
            <View style={s.infoPortrait}>{infoBlock}{details}</View>
          </View>
          <View style={[s.stepNav, { height: 120 + Math.max(28, insets.bottom), paddingBottom: Math.max(28, insets.bottom) }]}>
            {nav(-1, { flex: 1 })}
            {nav(1, { flex: 1.4 })}
          </View>
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: "row" }}>
          {nav(-1, { width: 96 + insets.left, paddingLeft: insets.left })}
          {photoArea}
          <View style={s.infoSide}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>{infoBlock}</ScrollView>
            {details}
          </View>
          {nav(1, { width: 112 + Math.max(0, insets.right), paddingRight: insets.right })}
        </View>
      )}
      <Sheet visible={info} title={shotTitle(shot)} sub={`${index + 1} of ${shots.length}`} onClose={() => setInfo(false)} height={0.74}>
        <Fact k="Planned" v={`${planned ? hhmm(planned) : "No time"} · ${w.length ? `window ${windowsText(w)}` : "any time"}`} danger={bad} />
        <Fact k="Location" v={placeLabel(shot) || "Not set"} />
        <Fact k="Tags" v={tagsLabel(shot) || "No tags"} />
        <Fact k="Rig" v={rigLabel(photo)} />
        {!!extraLine(shot) && <Fact k="Fields" v={extraLine(shot)} />}
        {!!notes && <Fact k="Plan notes" v={notes} />}
        {!!shot.description && <View style={{ paddingVertical: 6 }}><MarkdownText source={shot.description} /></View>}
        <ComposeRows shot={shot} photo={photo} onOpen={(c) => { setInfo(false); setViewing(c); }} />
        <FrameModeSeg block value={mode} onChange={pickMode} />
        {online && app.shots.shots?.some((x) => x.id === shot.id) && <Button kind="secondary" icon="map-marker-outline" label="Show on map" onPress={() => { setInfo(false); app.push({ name: "mapFocus", shotId: shot.id }); }} />}
        <Button kind="secondary" icon="exit-to-app" label="Leave step-through" onPress={() => { setInfo(false); app.pop(); }} />
      </Sheet>
      {viewing && <ComposeViewer item={viewing} photo={photo} settings={app.settings} onClose={() => setViewing(null)} />}
    </View>
  );
}

function Fact({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={s.factKey}>{k}</Text>
      <Text style={[s.factValue, danger && { color: c.danger }]}>{v}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: FIXED.photoBg },
  nav: { alignItems: "center", justifyContent: "center", gap: 2, alignSelf: "stretch" },
  navPrev: { backgroundColor: c.surface, borderColor: c.border, borderRightWidth: BORDER.control },
  navNext: { backgroundColor: c.accent, borderColor: c.accent },
  navOff: { backgroundColor: c.surface, borderWidth: BORDER.control, borderStyle: "dashed", borderColor: c.textDisabled },
  navText: { ...type("label", "heavy") },
  pos: { position: "absolute", top: 10, left: 10 },
  photoBtn: { position: "absolute", right: 10, bottom: 10, height: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 14, paddingRight: 8, borderRadius: RADIUS.sm, backgroundColor: FIXED.black, borderWidth: BORDER.badge, borderColor: FIXED.white },
  photoBtnText: { ...type("label", "heavy"), color: FIXED.white, ...num },
  infoPortrait: { padding: 16, gap: 12, backgroundColor: c.surface, borderTopWidth: BORDER.control, borderTopColor: c.border },
  infoSide: { width: 232, padding: 12, gap: 12, backgroundColor: c.surface, borderLeftWidth: BORDER.control, borderLeftColor: c.border, justifyContent: "space-between" },
  stepNav: { flexDirection: "row", backgroundColor: c.surface, borderTopWidth: BORDER.control, borderTopColor: c.border },
  name: { ...type("title", "bold"), color: c.text },
  place: { ...type("small", "semibold"), color: c.textDim },
  planned: { ...type("display", "heavy"), fontSize: 28, lineHeight: 34, color: c.text, ...num },
  window: { ...type("small", "bold"), flex: 1, ...num },
  factKey: { ...type("small", "semibold"), color: c.textDim },
  factValue: { ...type("body", "semibold"), color: c.text },
}));
