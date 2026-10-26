import { useRef, useState } from "react";
import * as Location from "expo-location";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { extraSummary, label, lightLabel, MOVEMENTS, SHOT_SIZE_ABBR, STATE_ICONS, type FieldDef } from "@openclapper/vocab";
import { cover, positionOf, type Composed, type Photo, type Shot, steps } from "../api";
import { isWaiting, setPosition } from "../localShots";
import { useApp } from "../appState";
import { useOnline } from "../net";
import { fovLabel, placeLabel, rigLabel, shortTime, shotTitle } from "../shots";
import { store } from "../storage";
import { ActionBar, AppHeader, BORDER, Button, Empty, FONT, IconButton, makeStyles, notice, num, PushScreen, SectionLabel, SideBySide, toast, Toggle, type, useLayoutSize, useTheme } from "../ui";
import { ComposeStrip, ComposeViewer } from "../components/ComposeParts";
import { EditTagsSheet } from "../components/EditTagsSheet";
import { MarkdownText } from "../components/Markdown";
import { LeafletView, type MapHandle } from "../components/LeafletView";
import { focusScript, positionScript } from "../components/mapHtml";
import { PhotoStrip } from "../components/PhotoStrip";
import { FRAME_MODES, FrameModeSeg, type FrameMode } from "../components/ShotFrame";
import { FullPhoto, MoreSheet, ShotPhoto, ShotSummary, stateActions, useShotActions } from "../components/ShotParts";

const time = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * A shot as a full screen over the tab: photo (swipe = the neighbours in the list it was opened
 * from), strip, frame view, tags with Edit, position per photo, camera facts, raw metadata; the
 * two other states pinned at the thumb.
 */
export function ShotDetails({ shotId, list }: { shotId: string; list: string[] }) {
  const s = useStyles();
  const app = useApp();
  const online = useOnline();
  const { width, height } = useWindowDimensions();
  const portrait = height >= width;
  const [id, setId] = useState(shotId);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [mode, setMode] = useState<FrameMode>(() => store.loadPref("shotsMode.v1", "mask", FRAME_MODES));
  const [sheet, setSheet] = useState<"edit" | "more" | null>(null);
  const [full, setFull] = useState(false);
  const [viewing, setViewing] = useState<Composed | null>(null);
  const [raw, setRaw] = useState(false);
  const { setState } = useShotActions();
  const [box, onBox] = useLayoutSize();
  const shot = app.shots.shots?.find((x) => x.id === id) ?? null;
  if (!shot) {
    return <PushScreen title="Shot"><Empty icon="image-off-outline" title="This shot is gone" body="It was deleted or moved to another project." /></PushScreen>;
  }
  const stepList = steps(shot);
  const photo = stepList[Math.min(photoIndex, stepList.length - 1)].photo;
  const at = list.indexOf(shot.id);
  const step = (d: number) => { const nx = list[at + d]; if (nx && app.shots.shots?.some((x) => x.id === nx)) { setId(nx); setPhotoIndex(0); } };
  const fields = store.fieldsForProject(shot.project_id);

  const body = (
    <>
      <View style={s.section}>
        <FrameModeSeg block value={mode} onChange={setMode} />
        <ShotSummary shot={shot} photo={photo} />
      </View>
      {!!shot.description && <><Head title="Description" /><View style={s.section}><MarkdownText source={shot.description} /></View></>}
      <ComposeStrip shot={shot} photo={photo} onOpen={setViewing} />
      <Head title="Tags" action={{ label: "Edit", onPress: () => setSheet("edit") }} />
      <Facts rows={tagRows(shot, fields)} />
      <Head title={shot.photos.length > 1 ? `Position · photo ${photoIndex + 1}` : "Position"} />
      <View style={s.section}>
        {photo.lat === null || photo.lon === null
          ? <><Text style={s.value}>No position</Text><Text style={s.meta}>Captured without GPS. Set one by hand.</Text></>
          : <><Text style={s.value}>{photo.lat.toFixed(5)}, {photo.lon.toFixed(5)}</Text>
              <Text style={s.meta}>{photo.position_corrected ? "Corrected by hand" : photo.gps_accuracy_m != null ? `GPS ±${Math.round(photo.gps_accuracy_m)} m` : "GPS accuracy unknown"}</Text></>}
        <SideBySide>
          <Button style={{ flex: 1 }} kind="secondary" icon="map-marker-outline" label="Show on map" onPress={() => app.push({ name: "mapFocus", shotId: shot.id })} disabled={!positionOf(shot) || !online} />
          <Button style={{ flex: 1 }} kind="secondary" icon="crosshairs-gps" label={photo.lat === null ? "Set position" : "Correct"} onPress={() => app.push({ name: "position", shotId: shot.id, photoId: photo.id })} disabled={!online} />
        </SideBySide>
      </View>
      <Head title={shot.photos.length > 1 ? `Camera · photo ${photoIndex + 1}` : "Camera"} />
      <Facts rows={cameraRows(photo)} />
      <Head title="Raw metadata" action={{ label: raw ? "Hide" : "Show", onPress: () => setRaw(!raw) }} />
      {raw && <View style={s.section}><Text style={s.mono} selectable>{JSON.stringify({ ...shot, photos: undefined, photo }, null, 2)}</Text></View>}
    </>
  );
  const stateBar = stateActions(shot.state).map((a) => (
    <Button key={a.state} style={portrait ? { flex: 1 } : undefined} kind={a.kind} icon={a.icon} label={a.label} onPress={() => void setState(shot, a.state)} />
  ));
  const sheets = (
    <>
      <EditTagsSheet shot={shot} visible={sheet === "edit"} onClose={() => setSheet(null)} />
      <MoreSheet shot={shot} photo={photo} details={false} visible={sheet === "more"} onClose={() => setSheet(null)} onDeleted={app.pop} />
      {full && <FullPhoto shot={shot} index={photoIndex} mode={mode} onMode={setMode} settings={app.settings} onClose={() => setFull(false)} />}
      {viewing && <ComposeViewer item={viewing} photo={photo} settings={app.settings} onClose={() => setViewing(null)} />}
    </>
  );
  const sub = [shot.photos.length > 1 ? `${shot.photos.length} photos` : null, shortTime(shot.captured_at)].filter(Boolean).join(" · ");

  if (!portrait) {
    return (
      <View style={[s.root, { flexDirection: "row" }]}>
        <View style={{ flex: 1 }} onLayout={onBox}>
          {box.width > 0 && <ShotPhoto shot={shot} index={photoIndex} mode={mode} settings={app.settings} maxW={box.width} maxH={box.height} onNext={() => step(1)} onPrev={() => step(-1)} onOpen={() => setFull(true)} />}
          <View style={s.floatBack}><IconButton icon="arrow-left" label="Back" size={52} onPress={app.pop} /></View>
        </View>
        <View style={s.panel}>
          <View style={s.panelHead}>
            <View style={{ flex: 1 }}><Text style={s.title} numberOfLines={1}>{shotTitle(shot)}</Text><Text style={s.meta}>{sub}</Text></View>
            <IconButton icon="dots-horizontal" label="More" onPress={() => setSheet("more")} />
          </View>
          <PhotoStrip shot={shot} index={photoIndex} onPick={setPhotoIndex} />
          <ScrollView style={{ flex: 1 }}>{body}</ScrollView>
          <ActionBar style={{ paddingRight: 32 }}>{stateBar.map((b, i) => <View key={i} style={{ flex: 1 }}>{b}</View>)}</ActionBar>
        </View>
        {sheets}
      </View>
    );
  }
  return (
    <View style={s.root}>
      <AppHeader title={shotTitle(shot)} sub={sub} lead={{ icon: "arrow-left", label: "Back", onPress: app.pop }} trail={{ icon: "dots-horizontal", label: "More", onPress: () => setSheet("more") }} sync={false}
        offlineMeta="Changes are kept on the phone and sent when you are online." />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        <ShotPhoto shot={shot} index={photoIndex} mode={mode} settings={app.settings} maxW={width} maxH={Math.min(width * 0.75, 300)} onNext={() => step(1)} onPrev={() => step(-1)} onOpen={() => setFull(true)} />
        <View style={{ paddingHorizontal: 12 }}><PhotoStrip shot={shot} index={photoIndex} onPick={setPhotoIndex} /></View>
        {body}
      </ScrollView>
      <ActionBar edge>{stateBar}</ActionBar>
      {sheets}
    </View>
  );
}

function tagRows(shot: Shot, fields: readonly FieldDef[]): [string, string][] {
  const rows: [string, string][] = [
    ["Location", placeLabel(shot) || "Not set"],
    ["INT / EXT", label(shot.int_ext) || "Not set"],
    ["Light", lightLabel(shot.light, shot.artificial) || "Any"],
    ["Weather", label(shot.weather) || "Not set"],
    ["Shot size", shot.shot_size ? `${SHOT_SIZE_ABBR[shot.shot_size as keyof typeof SHOT_SIZE_ABBR] ?? ""} · ${label(shot.shot_size)}` : "Not set"],
    ["Support", label(shot.camera_support) || "Not set"],
    ["Movement", MOVEMENTS.filter((m) => shot.movement?.includes(m)).map(label).join(" / ") || "None"],
  ];
  for (const f of fields) {
    const v = shot.extra?.[f.key];
    if (v === undefined || v === null) continue;
    const text = extraSummary([f], { [f.key]: v });
    if (text) rows.push([f.label, text.startsWith(`${f.label}: `) ? text.slice(f.label.length + 2) : text.split(`${f.label} › `).join("")]);
  }
  return rows;
}

function cameraRows(p: Photo): [string, string][] {
  const d = p.device ?? {};
  const rows: [string, string][] = [
    ["Rig", rigLabel(p)],
    ["Equivalent", fovLabel(p) || "Unknown"],
    ["Captured", time(p.timestamp)],
  ];
  if (typeof d.gps_altitude_m === "number") rows.push(["Altitude", `${Math.round(d.gps_altitude_m)} m`]);
  if (typeof d.gps_fix_age_ms === "number") rows.push(["GPS fix age", `${(d.gps_fix_age_ms / 1000).toFixed(1)} s`]);
  if (typeof d.phone_model === "string") rows.push(["Phone", d.phone_model]);
  return rows;
}

function Head({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const s = useStyles();
  return (
    <View style={s.head}>
      <SectionLabel>{title}</SectionLabel>
      {action && <Text onPress={action.onPress} style={s.headAction} accessibilityRole="button" suppressHighlighting>{action.label}</Text>}
    </View>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  const s = useStyles();
  return (
    <View style={s.facts}>
      {rows.map(([k, v]) => (
        <View key={k} style={s.fact}>
          <Text style={s.factKey}>{k}</Text>
          <Text style={s.factValue}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const distanceM = (a: [number, number], b: [number, number]) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Where the map opens for a photo without a position when no other photo of the shot has one. */
const BERLIN: [number, number] = [52.52, 13.405];

/**
 * Drag the pin (or tap the map) to where the photo was taken, or set a first position for one
 * captured without GPS ("Use my location" asks the phone once). Saved on the server, in the
 * upload queue, or kept on the phone until online (localShots.setPosition).
 */
export function CorrectPosition({ shotId, photoId }: { shotId: string; photoId: string }) {
  const s = useStyles();
  const { c } = useTheme();
  const app = useApp();
  const map = useRef<MapHandle | null>(null);
  const shot = app.shots.shots?.find((x) => x.id === shotId);
  const photo = shot?.photos.find((p) => p.id === photoId) ?? (shot ? cover(shot) : null);
  const had = !!photo && photo.lat !== null && photo.lon !== null;
  const start = useState<[number, number] | null>(() => {
    if (!photo || !shot) return null;
    if (had) return [photo.lat!, photo.lon!];
    const p = positionOf(shot);
    return p ? [p.lat, p.lon] : BERLIN;
  })[0];
  const [pos, setPos] = useState<[number, number] | null>(start);
  const [all, setAll] = useState((shot?.photos.length ?? 0) > 1);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const script = useState(() => (start ? positionScript(start[0], start[1], had ? photo!.gps_accuracy_m : null, c.accent) : ""))[0];
  if (!shot || !photo || !pos || !start) return <PushScreen title="Correct position"><Empty icon="image-off-outline" title="This shot is gone" /></PushScreen>;
  const moved = distanceM(start, pos);
  const title = had ? "Correct position" : "Set position";
  const moveTo = (lat: number, lon: number) => { setPos([lat, lon]); map.current?.run(`mk.setLatLng([${lat},${lon}]);map.setView([${lat},${lon}],18);`); };
  const here = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { void notice("No location permission", "Allow location for OpenClapper to use where you are now."); return; }
      const timeout = new Promise<null>((res) => setTimeout(() => res(null), 8000));
      const p = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null), timeout])
        ?? await Location.getLastKnownPositionAsync();
      if (p) moveTo(p.coords.latitude, p.coords.longitude); else toast("No location fix right now", "neutral");
    } finally { setLocating(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const updated = await setPosition(shot, photo.id, pos[0], pos[1], all);
      app.shots.update(updated);
      toast(updated.queued ? "Position saved · uploads with the shot" : isWaiting(shot.id) ? "Position saved · syncs when online" : "Position saved");
      app.pop();
    }
    catch (e) { void notice("Position not saved", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <PushScreen title={title} sub={had ? (photo.gps_accuracy_m != null ? `Reported ±${Math.round(photo.gps_accuracy_m)} m · drag the pin or tap the map` : "Drag the pin or tap the map") : "Captured without GPS · put the pin where it was taken"} scroll={false}
      footer={<View style={{ flex: 1, gap: 8 }}>
        {shot.photos.length > 1 && <View style={{ marginHorizontal: -16 }}><Toggle label={`All ${shot.photos.length} photos of this shot`} value={all} onChange={setAll} /></View>}
        <Text style={s.coords}>{pos[0].toFixed(5)}, {pos[1].toFixed(5)}{had ? ` · moved ${moved < 1 ? "0" : Math.round(moved)} m` : ""}</Text>
        {!had && <Button kind="secondary" icon="crosshairs-gps" label="Use my location" onPress={() => void here()} busy={locating} />}
        <SideBySide>
          <Button style={{ flex: 1 }} kind="secondary" label="Cancel" onPress={app.pop} />
          <Button style={{ flex: 2 }} icon="map-marker-check-outline" label="Save position" onPress={() => void save()} disabled={had && moved < 0.5} busy={busy} />
        </SideBySide>
      </View>}>
      <LeafletView script={script} handle={map} fitLabel="Back to the pin" onMessage={(m) => { if (typeof m.lat === "number" && typeof m.lon === "number") setPos([m.lat, m.lon]); }} />
    </PushScreen>
  );
}

/** Show on map: one shot centred with a labelled pin; "See all shots" switches to the Shots map. */
export function MapFocus({ shotId }: { shotId: string }) {
  const app = useApp();
  const shot = app.shots.shots?.find((x) => x.id === shotId);
  const script = useState(() => {
    const p = shot ? positionOf(shot) : null;
    if (!shot || !p) return "";
    return focusScript({ id: shot.id, lat: p.lat, lon: p.lon, state: shot.state, icon: STATE_ICONS[shot.state] }, shotTitle(shot));
  })[0];
  if (!shot) return <PushScreen title="Map"><Empty icon="image-off-outline" title="This shot is gone" /></PushScreen>;
  if (!script) return <PushScreen title="Map"><Empty icon="map-marker-off-outline" title="No position" body="This shot was captured without GPS. Set a position in its details." /></PushScreen>;
  return (
    <PushScreen title={shotTitle(shot)} sub={[placeLabel(shot), shortTime(shot.captured_at)].filter(Boolean).join(" · ")} scroll={false}
      footer={<Button style={{ flex: 1 }} kind="secondary" icon="map-outline" label="See all shots on the map" onPress={() => app.showOnMap(shot.id)} />}>
      <LeafletView script={script} fitLabel="Back to the shot" />
    </PushScreen>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  section: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4, minHeight: 48 },
  headAction: { ...type("body", "bold"), color: c.accent, minHeight: 48, lineHeight: 48, paddingHorizontal: 8 },
  facts: { backgroundColor: c.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.borderSubtle },
  fact: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  factKey: { ...type("small", "semibold"), color: c.textDim, width: 110 },
  factValue: { ...type("small", "bold"), color: c.text, flex: 1, ...num },
  value: { ...type("body", "bold"), color: c.text, ...num },
  meta: { ...type("small"), color: c.textDim, ...num },
  mono: { fontFamily: FONT.mono, fontSize: 12, lineHeight: 17, color: c.text, backgroundColor: c.surfaceSunken, padding: 10, borderRadius: 6 },
  title: { ...type("title", "bold"), color: c.text },
  floatBack: { position: "absolute", top: 12, left: 12 },
  panel: { width: 320, backgroundColor: c.bg, borderLeftWidth: BORDER.control, borderLeftColor: c.border },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: BORDER.control, borderBottomColor: c.borderSubtle, backgroundColor: c.surface },
  coords: { ...type("small", "bold"), color: c.text, ...num },
}));
