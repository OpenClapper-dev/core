import { useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { label, STATE_ICONS } from "@openclapper/vocab";
import { cover, positionOf, type Shot } from "../api";
import { useApp } from "../appState";
import { useOnline } from "../net";
import { applyFilter, placeLabel, rigLabel, shortTime, shotTitle, STATE_FILTERS, type StateFilter } from "../shots";
import { usePref } from "../storage";
import { AppHeader, Banner, BORDER, Button, Chip, Empty, FIXED, IconButton, makeStyles, num, OfflineBanner, PhotoTag, RADIUS, Seg, SeqBadge, Skeleton, StateMarker, type, useLayoutSize, useRefreshControl } from "../ui";
import { offlineProject } from "../offline";
import { LeafletView, type MapHandle } from "../components/LeafletView";
import { shotsScript, type MapPin } from "../components/mapHtml";
import { OptionSheet } from "../components/OptionSheet";
import { FRAME_MODES, frameModeLabel, ShotFrame, type FrameMode } from "../components/ShotFrame";

/**
 * Gallery and Map in one tab: one state filter and one frame view (both remembered) over the
 * active project's shots, a Grid ⇄ Map switch. A shot opens as a full screen (Shot details).
 */
export function Shots() {
  const s = useStyles();
  const app = useApp();
  const online = useOnline();
  const { width, height } = useWindowDimensions();
  const portrait = height >= width;
  const [filter, setFilter] = usePref<StateFilter>("shotsFilter.v1", "all", STATE_FILTERS);
  const [mode, setMode] = usePref<FrameMode>("shotsMode.v1", "mask", FRAME_MODES);
  const [modeSheet, setModeSheet] = useState(false);
  const [picked, setPicked] = useState<string | null>(app.mapFocus);
  const map = useRef<MapHandle | null>(null);
  const [box, onBox] = useLayoutSize();
  const { shots, source, error, refreshing, load } = app.shots;
  const refresh = useRefreshControl(refreshing, () => void load());
  const fallback = source === "phone";
  const kept = !!offlineProject(app.project?.id ?? null);
  const visible = useMemo(() => applyFilter(shots, filter), [shots, filter]);
  const counts = useMemo(() => Object.fromEntries(STATE_FILTERS.map((f) => [f, applyFilter(shots, f).length])), [shots]);
  const open = (shot: Shot) => app.push({ name: "shot", shotId: shot.id, list: visible.map((x) => x.id) });

  const viewSeg = (
    <Seg size="lg" accessibilityLabel="Grid or map" value={app.shotsView} onChange={app.setShotsView}
      options={[{ id: "grid", icon: "view-grid-outline", label: "Grid" }, { id: "map", icon: "map-outline", label: "Map" }]} />
  );
  const modeChip = <Chip icon="crop-free" label={frameModeLabel(mode)} onPress={() => setModeSheet(true)} />;
  const stateChips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
      {STATE_FILTERS.map((f) => <Chip key={f} icon={f === "all" ? undefined : f === "queued" ? QUEUED_ICON : STATE_ICONS[f]} label={`${label(f)} ${counts[f] ?? 0}`} selected={filter === f} onPress={() => setFilter(f)} />)}
    </ScrollView>
  );
  const bar = portrait ? (
    <View style={s.bar}>
      <View style={s.barRow}>{viewSeg}<View style={{ flex: 1 }} />{modeChip}</View>
      {stateChips}
    </View>
  ) : (
    <View style={[s.bar, s.barRow, { paddingVertical: 8 }]}>{viewSeg}<View style={{ flex: 1 }}>{stateChips}</View>{modeChip}</View>
  );

  const cols = portrait ? 2 : 4;
  const gap = 10;
  const cell = Math.max(80, (box.width - 32 - gap * (cols - 1)) / cols);

  let body: ReactNode;
  if (!shots || box.width === 0) {
    body = (
      <View style={s.skeletons}>
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} style={{ width: cell, height: cell * 0.75 + 56 }} />)}
      </View>
    );
  } else if (app.shotsView === "map") {
    // Shots captured without GPS have no pin.
    const pins: MapPin[] = visible.flatMap((x) => { const p = positionOf(x); return p ? [{ id: x.id, lat: p.lat, lon: p.lon, state: x.state, icon: STATE_ICONS[x.state] }] : []; });
    const sel = picked ? visible.find((x) => x.id === picked) ?? null : null;
    body = (
      <View style={{ flex: 1 }}>
        <LeafletView script={shotsScript(pins, app.mapFocus)} handle={map} onMessage={(m) => setPicked(typeof m.pin === "string" ? m.pin : null)}
          offlineAction={<Button kind="secondary" icon="view-grid-outline" label="Show the grid" onPress={() => app.setShotsView("grid")} />} />
        {sel && online && <PreviewCard shot={sel} mode={mode} onOpen={() => open(sel)} onClose={() => { setPicked(null); map.current?.run("select(null)"); }} />}
      </View>
    );
  } else {
    body = (
      <FlatList
        key={cols}
        data={visible}
        numColumns={cols}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap }}
        columnWrapperStyle={{ gap }}
        refreshControl={refresh}
        ListHeaderComponent={fallback ? <View style={{ marginBottom: 4 }}><Banner kind="offline" title="Showing what is on this phone" meta={kept ? "The project's offline copy and the queued shots." : "Queued shots and shots of days made available offline. Keep the whole project on the phone in Setup → Offline."} /></View> : null}
        ListEmptyComponent={
          (shots.length === 0
            ? <Empty icon="camera-iris" title={fallback ? "Nothing on this phone" : `No shots in ${app.project?.name ?? "this project"} yet`} body={fallback ? "Keep the project on the phone (Setup → Offline) while you have a connection." : "Take one in the Shoot tab; it shows up here right away."}>
                {!fallback && <Button icon="camera-iris" label="Go to Shoot" onPress={() => app.setTab("shoot")} />}
              </Empty>
            : <Empty icon="filter-off-outline" title={`No ${label(filter).toLowerCase()} shots`}>
                <Button kind="secondary" label={`Show all ${shots.length}`} onPress={() => setFilter("all")} />
              </Empty>)
        }
        renderItem={({ item }) => <ShotCard shot={item} width={cell} mode={mode} onPress={() => open(item)} />}
      />
    );
  }

  return (
    <View style={s.root}>
      <AppHeader offlineMeta={fallback ? "Showing what is stored on this phone." : undefined} />
      {bar}
      {error && source === "server" && online && <View style={{ padding: 12 }}><Banner kind="danger" title="Couldn't refresh" meta={error} action={<Button kind="secondary" label="Retry" onPress={() => void load()} />} /></View>}
      <View style={{ flex: 1 }} onLayout={onBox}>{body}</View>
      <OptionSheet visible={modeSheet} title="Frame view" sub="How the rig frame is drawn on the photos" options={FRAME_MODES.map((m) => ({ id: m, label: frameModeLabel(m), icon: m === "mask" ? "square-opacity" : m === "frame" ? "crop-free" : m === "fit" ? "fit-to-screen-outline" : "image-outline" }))}
        value={[mode]} onChange={(ids) => ids[0] && setMode(ids[0] as FrameMode)} onClose={() => setModeSheet(false)} columns={2} />
    </View>
  );
}

export function ShotCard({ shot, width, mode, onPress }: { shot: Shot; width: number; mode: FrameMode; onPress: () => void }) {
  const s = useStyles();
  const { settings } = useApp();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, { width }, pressed && s.cardPressed]} accessibilityRole="button" accessibilityLabel={shotTitle(shot)}>
      <View style={{ height: width * 0.75, alignItems: "center", justifyContent: "center", backgroundColor: FIXED.photoBg, overflow: "hidden" }}>
        <ShotFrame photo={cover(shot)} width={width - 2} settings={settings} mode={mode} />
        {shot.photos.length > 1 && <View style={s.tl}><SeqBadge count={shot.photos.length} /></View>}
        <View style={s.tr}><StateMarker state={shot.state} iconOnly /></View>
        {shot.queued && <View style={s.bl}><QueuedTag /></View>}
      </View>
      <View style={{ padding: 10, gap: 2 }}>
        <Text style={s.cardTitle} numberOfLines={1}>{shotTitle(shot)}</Text>
        <Text style={s.cardSub} numberOfLines={1}>{placeLabel(shot) || rigLabel(cover(shot))}</Text>
      </View>
    </Pressable>
  );
}

const QUEUED_ICON = "cloud-upload-outline";

/** "Queued" on a photo: opaque, icon + label (never colour alone). */
export function QueuedTag() {
  return <PhotoTag icon={QUEUED_ICON}>Queued</PhotoTag>;
}

/** Native card for the tapped pin, 12 dp above the tab bar: thumb, title, place · time, state, open. */
function PreviewCard({ shot, mode, onOpen, onClose }: { shot: Shot; mode: FrameMode; onOpen: () => void; onClose: () => void }) {
  const s = useStyles();
  const { settings } = useApp();
  return (
    <Pressable onPress={onOpen} style={s.preview} accessibilityRole="button" accessibilityLabel={`Open ${shotTitle(shot)}`}>
      <View style={s.previewThumb}><ShotFrame photo={cover(shot)} width={96} settings={settings} mode={mode === "off" ? "off" : "fit"} /></View>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text style={s.cardTitle} numberOfLines={2}>{shotTitle(shot)}</Text>
        <Text style={[s.cardSub, num]} numberOfLines={1}>{[placeLabel(shot), shortTime(shot.captured_at)].filter(Boolean).join(" · ")}</Text>
        <StateMarker state={shot.state} />
      </View>
      <View style={{ gap: 6 }}>
        <IconButton icon="arrow-right" label="Open details" size={52} onPress={onOpen} />
        <IconButton icon="close" label="Close preview" onPress={onClose} plain />
      </View>
    </Pressable>
  );
}


const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  bar: { gap: 8, paddingVertical: 10, backgroundColor: c.surface, borderBottomWidth: BORDER.control, borderBottomColor: c.borderSubtle },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  skeletons: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16 },
  card: { backgroundColor: c.surface, borderRadius: RADIUS.md, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  cardPressed: { borderColor: c.borderStrong, transform: [{ translateY: 1 }] },
  tl: { position: "absolute", top: 8, left: 8 },
  tr: { position: "absolute", top: 8, right: 8 },
  bl: { position: "absolute", bottom: 8, left: 8 },
  cardTitle: { ...type("small", "bold"), color: c.text },
  cardSub: { ...type("caption"), color: c.textDim },
  preview: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: RADIUS.md, backgroundColor: c.surfaceRaised, borderWidth: BORDER.control, borderColor: c.borderStrong, elevation: 8 },
  previewThumb: { width: 96, height: 72, borderRadius: RADIUS.sm, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: FIXED.photoBg },
}));
