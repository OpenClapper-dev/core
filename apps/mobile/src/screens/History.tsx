import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import type { Shot } from "../api";
import { steps } from "../api";
import { useApp } from "../appState";
import { usePref } from "../storage";
import { ActionBar, AppHeader, BORDER, Button, Empty, IconButton, makeStyles, num, RADIUS, Seg, SideBySide, Skeleton, type, useLayoutSize, useRefreshControl, useToastOffset } from "../ui";
import { EditTagsSheet } from "../components/EditTagsSheet";
import { PhotoStrip } from "../components/PhotoStrip";
import { FRAME_MODES, FrameModeSeg, type FrameMode } from "../components/ShotFrame";
import { FullPhoto, MoreSheet, ShotPhoto, ShotSummary, stateActions, useShotActions } from "../components/ShotParts";

/** Portrait decision bar: Prev · n of m · Next, then Archive | Approve. */
const BAR_H = 10 + 52 + 8 + 52 + 12 + 2;

type HistoryOrder = "newest" | "oldest";
type HistoryFilter = "all" | "unreviewed";
const FILTERS = [{ id: "all", label: "All shots" }, { id: "unreviewed", label: "To review" }] as const;

/**
 * History (issue #48): the active project's shots (queued ones included), newest first unless switched
 * in the header, one at a time: photo first, the two states the shot is not in pinned at the thumb.
 * "To review" narrows it to the unreviewed queue (a decided shot leaves, the next takes its position);
 * in "All shots" a decision moves on to the next shot. Both choices are remembered. Edit opens the same
 * tag editor as Tag; Delete lives in ⋯ with Archive as the safe choice.
 */
export function History() {
  const s = useStyles();
  const app = useApp();
  const { width, height } = useWindowDimensions();
  const portrait = height >= width;
  const [mode, setMode] = usePref<FrameMode>("reviewMode.v1", "mask", FRAME_MODES);
  const [order, setOrder] = usePref<HistoryOrder>("reviewOrder.v1", "newest", ["newest", "oldest"]);
  const [filter, setFilter] = usePref<HistoryFilter>("historyFilter.v1", "all", ["all", "unreviewed"]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [sheet, setSheet] = useState<"edit" | "more" | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Follow the shot, not the position; when it leaves the queue stay at the same position. */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [lastIndex, setLastIndex] = useState(0);
  const { shots, error, refreshing, load } = app.shots;
  const { setState } = useShotActions();
  const [box, onBox] = useLayoutSize();
  useToastOffset(portrait ? BAR_H : 0);

  const queue = useMemo(() => (shots ?? []).filter((x) => filter === "all" || x.state === "unreviewed").sort((a, b) => (order === "newest" ? -1 : 1) * a.captured_at.localeCompare(b.captured_at)), [shots, order, filter]);
  const found = queue.findIndex((x) => x.id === currentId);
  const index = found >= 0 ? found : Math.min(lastIndex, queue.length - 1);
  const current: Shot | null = index >= 0 ? queue[index] : null;
  useEffect(() => { if (current && current.id !== currentId) setCurrentId(current.id); setLastIndex(Math.max(0, index)); }, [current?.id, index]);
  useEffect(() => { setPhotoIndex(0); }, [current?.id]);
  // A new order starts at its top (the newest or the oldest shot), not on the shot that was showing.
  const switchOrder = () => { setOrder(order === "newest" ? "oldest" : "newest"); setCurrentId(null); setLastIndex(0); };
  const switchFilter = (f: HistoryFilter) => { setFilter(f); setCurrentId(null); setLastIndex(0); };
  const go = (delta: number) => { const nx = queue[index + delta]; if (nx) setCurrentId(nx.id); };
  const decide = async (state: Shot["state"]) => {
    if (!current || busy) return;
    setBusy(true);
    const next = filter === "all" ? queue[index + 1] : undefined;
    try { await setState(current, state); if (next) setCurrentId(next.id); } finally { setBusy(false); }
  };

  const header = <AppHeader offlineMeta="Decisions and edits are kept on the phone and sent when you are online."
    trail={{ icon: order === "newest" ? "sort-clock-descending-outline" : "sort-clock-ascending-outline", label: order === "newest" ? "Newest first, switch to oldest first" : "Oldest first, switch to newest first", onPress: switchOrder }} />;
  const refresh = useRefreshControl(refreshing, () => void load());

  if (error && !shots) {
    return (
      <View style={s.root}>{header}
        <ScrollView refreshControl={refresh}>
          <Empty icon="cloud-alert" title="Couldn't load the shots" body={`${error}. Queued uploads are safe on the phone.`}>
            <Button icon="refresh" label="Try again" onPress={() => void load()} />
          </Empty>
        </ScrollView>
      </View>
    );
  }
  if (!shots) {
    return (
      <View style={s.root}>{header}
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton style={{ height: Math.min(width * 0.75, 262), marginHorizontal: -16, borderRadius: 0 }} />
          <Skeleton style={{ height: 48, borderRadius: RADIUS.pill }} />
          <Skeleton style={{ height: 24, width: "70%" }} />
          <Skeleton style={{ height: 18, width: "50%" }} />
          <Skeleton style={{ height: 18, width: "60%" }} />
        </View>
      </View>
    );
  }
  const filterSeg = <Seg block accessibilityLabel="Which shots" value={filter} onChange={switchFilter} options={FILTERS} />;
  if (!current) {
    const approved = shots.filter((x) => x.state === "approved").length;
    const archived = shots.filter((x) => x.state === "archived").length;
    return (
      <View style={s.root}>{header}
        <ScrollView refreshControl={refresh}>
          {shots.length > 0 && <View style={{ padding: 16, paddingBottom: 0 }}>{filterSeg}</View>}
          <Empty icon={shots.length ? "check-all" : "camera-outline"} title={shots.length ? "Nothing to review" : "No shots yet"} body={shots.length ? `${approved} approved · ${archived} archived in ${app.project?.name ?? "this project"}. New shots show up here right after capture.` : "New shots show up here right after capture."}>
            {shots.length > 0 && <Button kind="secondary" icon="history" label="Show all shots" onPress={() => switchFilter("all")} />}
          </Empty>
        </ScrollView>
      </View>
    );
  }

  const list = steps(current);
  const photo = list[Math.min(photoIndex, list.length - 1)].photo;
  const disabled = busy;
  const nav = (big: boolean) => (
    <View style={s.navRow}>
      {big ? <Button style={{ flex: 1 }} kind="secondary" icon="chevron-left" label="Prev" onPress={() => go(-1)} disabled={index === 0} />
        : <IconButton icon="chevron-left" label="Previous shot" size={52} onPress={() => go(-1)} disabled={index === 0} />}
      <Text style={s.pos}>{index + 1} of {queue.length}{"\n"}<Text style={s.order}>{order} first</Text></Text>
      {big ? <Button style={{ flex: 1 }} kind="secondary" icon="chevron-right" label="Next" onPress={() => go(1)} disabled={index === queue.length - 1} />
        : <IconButton icon="chevron-right" label="Next shot" size={52} onPress={() => go(1)} disabled={index === queue.length - 1} />}
    </View>
  );
  const decisions = (
    <SideBySide>
      {stateActions(current.state).map((a) => <Button key={a.state} style={{ flex: 1 }} kind={a.kind} icon={a.icon} label={a.label} onPress={() => void decide(a.state)} disabled={disabled} />)}
    </SideBySide>
  );
  const tools = (
    <SideBySide>
      <IconButton icon="pencil-outline" label="Edit details" size={52} onPress={() => setSheet("edit")} />
      <IconButton icon="dots-horizontal" label="More" size={52} onPress={() => setSheet("more")} />
    </SideBySide>
  );
  const summary = (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <View style={{ flex: 1 }}><ShotSummary shot={current} photo={photo} /></View>
      {tools}
    </View>
  );
  const sheets = (
    <>
      <EditTagsSheet shot={current} visible={sheet === "edit"} onClose={() => setSheet(null)} />
      <MoreSheet shot={current} photo={photo} visible={sheet === "more"} onClose={() => setSheet(null)} />
      {full && <FullPhoto shot={current} index={photoIndex} mode={mode} onMode={setMode} settings={app.settings} onClose={() => setFull(false)} />}
    </>
  );

  if (!portrait) {
    return (
      <View style={[s.root, { flexDirection: "row" }]}>
        <View style={{ flex: 1 }} onLayout={onBox}>
          {box.width > 0 && <ShotPhoto shot={current} index={photoIndex} mode={mode} settings={app.settings} maxW={box.width} maxH={box.height} onNext={() => go(1)} onPrev={() => go(-1)} onOpen={() => setFull(true)} />}
          <View style={s.floatMode}><FrameModeSeg value={mode} onChange={setMode} /></View>
        </View>
        <View style={s.side}>
          <PhotoStrip shot={current} index={photoIndex} onPick={setPhotoIndex} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }} refreshControl={refresh}>{filterSeg}{summary}</ScrollView>
          <View style={s.sideBar}>{nav(false)}{decisions}</View>
        </View>
        {sheets}
      </View>
    );
  }
  return (
    <View style={s.root}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} refreshControl={refresh}>
        <ShotPhoto shot={current} index={photoIndex} mode={mode} settings={app.settings} maxW={width} maxH={Math.min(width * 0.75, 262)} onNext={() => go(1)} onPrev={() => go(-1)} onOpen={() => setFull(true)} />
        <View style={{ paddingHorizontal: 12 }}><PhotoStrip shot={current} index={photoIndex} onPick={setPhotoIndex} /></View>
        <View style={s.body}>
          {filterSeg}
          <FrameModeSeg block value={mode} onChange={setMode} />
          {summary}
        </View>
      </ScrollView>
      <ActionBar style={{ flexDirection: "column", paddingTop: 10 }}>{nav(true)}{decisions}</ActionBar>
      {sheets}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  body: { padding: 16, gap: 16 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pos: { ...type("body", "bold"), color: c.text, ...num, minWidth: 72, textAlign: "center" },
  order: { ...type("caption"), color: c.textDim },
  floatMode: { position: "absolute", left: 8, bottom: 8, padding: 4, borderRadius: RADIUS.pill, backgroundColor: c.chromeBg, borderWidth: BORDER.badge, borderColor: c.chromeBorder },
  side: { width: 292, backgroundColor: c.surface, borderLeftWidth: BORDER.control, borderLeftColor: c.border },
  sideBar: { gap: 8, padding: 12, borderTopWidth: BORDER.control, borderTopColor: c.border },
}));
