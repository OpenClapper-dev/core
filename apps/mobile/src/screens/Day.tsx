import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, SectionList, Text, View } from "react-native";
import { dayLight, lightLabel, localDay, PHASE_ICONS, shootableWindows, type DayLight, type Interval } from "@openclapper/vocab";
import { api, cover, positionOf, type Shot, type ShootingDay } from "../api";
import { useApp } from "../appState";
import { useOnline } from "../net";
import { offlineDays, removeOfflineDay, saveDayOffline, type OfflineDay } from "../offline";
import { hhmm, placeLabel, shotTitle } from "../shots";
import { ActionBar, AppHeader, BORDER, Button, confirm, Empty, Icon, makeStyles, num, type Palette, RADIUS, SectionHeading, SeqBadge, toast, type, useRefreshControl, useTheme, useToastOffset } from "../ui";
import { ShotFrame } from "../components/ShotFrame";

const BERLIN = { lat: 52.52, lon: 13.405 };
export const phaseFill = (c: Palette, phase: string) => (phase === "dawn" ? c.phaseDawn : phase === "day" ? c.phaseDay : phase === "dusk" ? c.phaseDusk : c.phaseNight);
export const phaseInk = (c: Palette, phase: string) => (phase === "dawn" ? c.onPhaseDawn : phase === "day" ? c.onPhaseDay : phase === "dusk" ? c.onPhaseDusk : c.onPhaseNight);
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
export const windowsText = (w: Interval[]) => (w.length ? w.map((x) => `${hhmm(x.start)}–${hhmm(x.end)}`).join(", ") : "light not on this day");
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateParts = (date: string) => { const d = new Date(`${date}T12:00:00`); return { wd: d.toLocaleDateString([], { weekday: "short" }), dd: String(d.getDate()), mon: d.toLocaleDateString([], { month: "short" }), long: d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) }; };

/** Centre of the shots' positions (for the daylight), Berlin when none has one. */
function centroid(shots: Shot[]) {
  const ps = shots.map(positionOf).filter((p): p is { lat: number; lon: number } => !!p);
  if (ps.length === 0) return BERLIN;
  return { lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length };
}

export function useDayLight(day: ShootingDay, shots: Shot[]): { light: DayLight; start: Date; hours: number } {
  return useMemo(() => {
    const where = centroid(shots);
    const { start, hours } = localDay(day.date);
    return { light: dayLight(start, where.lat, where.lon, hours), start, hours };
  }, [day.date, shots.map((s) => s.id).join()]);
}

/** Planned "HH:MM" on the day as a Date, or null. */
export function plannedAt(day: ShootingDay, shotId: string): Date | null {
  const t = day.shots.find((x) => x.shot_id === shotId)?.planned_time;
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const { start } = localDay(day.date);
  return new Date(start.getTime() + (h * 60 + m) * 60_000);
}
/** Where the planned time falls against the shot's windows. */
export function windowFit(planned: Date | null, w: Interval[]): "inside" | "before" | "after" | "outside" | null {
  if (!planned || w.length === 0) return null;
  if (w.some((x) => planned >= x.start && planned <= x.end)) return "inside";
  if (planned < w[0].start) return "before";
  if (planned > w[w.length - 1].end) return "after";
  return "outside";
}

type OfflineState = "none" | "saving" | "saved" | "stale" | "error";

/**
 * Shooting days planned in the Studio for the active project. Opens on today when a day is
 * planned for today. A day can be saved offline (its shots and photos); without a connection the
 * tab shows only the saved days.
 */
export function Day() {
  const s = useStyles();
  const app = useApp();
  const online = useOnline();
  const project = app.project;
  const [days, setDays] = useState<ShootingDay[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState<OfflineDay[]>(() => offlineDays());
  const [dayId, setDayId] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** Offline save in progress / stopped, with photos done of total. */
  const [progress, setProgress] = useState<{ id: string; done: number; total: number; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!project) return;
    setRefreshing(true);
    try { setDays(await api.listDays(project.id)); setFailed(false); } catch { setFailed(true); } finally { setRefreshing(false); }
  }, [project?.id]);
  useEffect(() => { setDayId(null); setOpened(false); setDays(null); void load(); }, [load]);
  const refresh = useRefreshControl(refreshing, () => void load());

  const mine = offline.filter((o) => o.day.project_id === project?.id);
  const list: ShootingDay[] | null = days && !failed ? days : failed ? mine.map((o) => o.day) : null;
  const saved = (id: string) => mine.find((o) => o.day.id === id) ?? null;
  // Open on today once, when a day is planned for today.
  useEffect(() => {
    if (opened || !list) return;
    const today = list.find((d) => d.date === todayIso());
    if (today) setDayId(today.id);
    setOpened(true);
  }, [list, opened]);

  const shotsFor = (d: ShootingDay): Shot[] => {
    const pool = !failed && app.shots.shots ? app.shots.shots : saved(d.id)?.shots ?? [];
    return d.shots.map((ds) => pool.find((x) => x.id === ds.shot_id)).filter((x): x is Shot => !!x);
  };
  const stateOf = (d: ShootingDay): OfflineState => {
    if (progress?.id === d.id) return progress.error ? "error" : "saving";
    const sv = saved(d.id);
    if (!sv) return "none";
    return !failed && d.updated_at && sv.day.updated_at !== d.updated_at ? "stale" : "saved";
  };

  async function makeOffline(d: ShootingDay) {
    if (!project || progress) return;
    const shots = shotsFor(d);
    const total = shots.reduce((n, x) => n + x.photos.length, 0);
    setProgress({ id: d.id, done: 0, total });
    try {
      await saveDayOffline(d, app.shots.shots ?? shots, project.name, (done, t) => setProgress({ id: d.id, done, total: t }));
      setOffline(offlineDays());
      setProgress(null);
      toast(`${dateParts(d.date).long} is available offline`);
    } catch {
      setProgress((p) => (p ? { ...p, error: true } : p));
    }
  }
  async function dropOffline(d: ShootingDay) {
    const ok = await confirm({ title: "Remove the offline copy?", body: "The day's photos are deleted from the phone (photos another saved day uses stay). The plan stays on the server.", confirmLabel: "Remove", danger: true });
    if (ok === true) { removeOfflineDay(d.id); setOffline(offlineDays()); toast("Offline copy removed", "neutral"); }
  }

  if (!project) {
    return <View style={s.root}><AppHeader /><Empty icon="folder-alert-outline" title="No project" body="Shooting days belong to a project."><Button label="Pick a project" icon="folder-outline" onPress={app.openProjectSheet} /></Empty></View>;
  }
  const day = list?.find((d) => d.id === dayId) ?? null;
  if (day) {
    return <DayOverview day={day} shots={shotsFor(day)} offlineCopy={failed} onBack={() => setDayId(null)}
      state={stateOf(day)} progress={progress?.id === day.id ? progress : null} savedAt={saved(day.id)?.savedAt ?? null}
      onMakeOffline={() => { setProgress(null); void makeOffline(day); }} onRemove={() => void dropOffline(day)}
      onStart={(i) => app.push({ name: "step", day, shots: shotsFor(day), index: i })} canSave={online && !failed} />;
  }

  const today = todayIso();
  const upcoming = (list ?? []).filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = (list ?? []).filter((d) => d.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const sections = [...(upcoming.length ? [{ title: "Upcoming", data: upcoming }] : []), ...(past.length ? [{ title: "Past", data: past }] : [])];
  return (
    <View style={s.root}>
      <AppHeader offlineMeta="Showing the days saved on this phone." />
      {!list ? <Empty loading title="Loading shooting days…" /> : (
        <SectionList
          sections={sections}
          keyExtractor={(d) => d.id}
          stickySectionHeadersEnabled={false}
          refreshControl={refresh}
          renderSectionHeader={({ section }) => <SectionHeading>{section.title}</SectionHeading>}
          ListEmptyComponent={failed
            ? <Empty icon="cloud-off-outline" title="Nothing saved offline" body="Make a day available offline while you have a connection." />
            : <Empty icon="calendar-blank-outline" title="No shooting days yet" body="Plan them in the Studio (Plan). They show up here with their light and shots." />}
          renderItem={({ item }) => {
            const st = stateOf(item);
            const locs = new Set(shotsFor(item).map((x) => x.location_id ?? "none")).size;
            return (
              <DayRow day={item} today={item.date === today} past={item.date < today} state={st} progress={progress?.id === item.id ? progress : null}
                meta={`${item.shots.length} shot${item.shots.length === 1 ? "" : "s"}${locs ? ` · ${locs} location${locs === 1 ? "" : "s"}` : ""}`}
                onPress={() => setDayId(item.id)}
                onLongPress={online && !failed && (st === "none" || st === "stale" || st === "error") ? () => void makeOffline(item) : undefined} />
            );
          }}
        />
      )}
    </View>
  );
}

function DayRow({ day, today, past, state, progress, meta, onPress, onLongPress }: { day: ShootingDay; today: boolean; past: boolean; state: OfflineState; progress: { done: number; total: number } | null; meta: string; onPress: () => void; onLongPress?: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const p = dateParts(day.date);
  const off = {
    none: { icon: "cloud-outline", color: c.textDim, text: "Online only" },
    saving: { icon: "progress-download", color: c.accent, text: `Saving ${progress?.done ?? 0} / ${progress?.total ?? 0}` },
    saved: { icon: "check-circle", color: c.ok, text: "Offline · up to date" },
    stale: { icon: "alert", color: c.warnInk, text: "Offline copy out of date" },
    error: { icon: "alert-circle", color: c.danger, text: "Saving offline stopped" },
  }[state];
  const fg = past ? c.textDim : c.text;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={500} accessibilityRole="button" accessibilityHint={onLongPress ? "Hold to make it available offline" : undefined}
      style={({ pressed }) => [s.dayRow, pressed && { backgroundColor: c.surfaceSunken }]}>
      <View style={[s.date, today && { backgroundColor: c.accent, borderColor: c.accent }]}>
        <Text style={[s.dateWd, { color: today ? c.onAccent : fg }]}>{p.wd}</Text>
        <Text style={[s.dateDd, { color: today ? c.onAccent : fg }]}>{p.dd}</Text>
        <Text style={[s.dateMon, { color: today ? c.onAccent : fg }]}>{p.mon}</Text>
      </View>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[s.dayTitle, { color: fg }]} numberOfLines={1}>{day.title || p.long}</Text>
          {today && <Text style={s.todayTag}>TODAY</Text>}
        </View>
        <Text style={s.dayMeta}>{meta}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          {state === "saving" ? <ActivityIndicator size="small" color={off.color} /> : <Icon name={off.icon} size={16} color={off.color} />}
          <Text style={[s.offText, { color: off.color }]}>{off.text}</Text>
        </View>
      </View>
      <Icon name="chevron-right" color={fg} />
    </Pressable>
  );
}

/** 24 h bar: phases with their icons, the shootable windows as a band below, a now marker on today. */
export function DaylightTimeline({ light, start, hours, windows, now, height = 36 }: { light: DayLight; start: Date; hours: number; windows: Interval[]; now: Date | null; height?: number }) {
  const s = useStyles();
  const { c } = useTheme();
  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / (hours * 3_600_000)) * 100));
  return (
    <View accessibilityLabel={`Daylight. Shootable ${windowsText(windows)}`}>
      <View style={[s.bar, { height }]}>
        {light.phases.map((ph) => {
          const w = pct(ph.end) - pct(ph.start);
          return (
            <View key={ph.start.toISOString()} style={[s.seg, { left: `${pct(ph.start)}%`, width: `${w}%`, backgroundColor: phaseFill(c, ph.phase) }]}>
              {w > 7 && height >= 24 && <Icon name={PHASE_ICONS[ph.phase]} size={16} color={phaseInk(c, ph.phase)} />}
            </View>
          );
        })}
        {now && <View style={[s.now, { left: `${pct(now)}%` }]} />}
      </View>
      <View style={s.windows}>
        {windows.map((w) => <View key={w.start.toISOString()} style={[s.window, { left: `${pct(w.start)}%`, width: `${pct(w.end) - pct(w.start)}%` }]} />)}
      </View>
    </View>
  );
}

function OfflineControl({ state, progress, savedAt, canSave, onMake, onRemove }: { state: OfflineState; progress: { done: number; total: number } | null; savedAt: string | null; canSave: boolean; onMake: () => void; onRemove: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const when = savedAt ? new Date(savedAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
  if (state === "none") return <Button kind="secondary" icon="download-outline" label="Make offline" onPress={onMake} disabled={!canSave} />;
  if (state === "saving" || state === "error") {
    const done = progress?.done ?? 0, total = progress?.total ?? 0;
    const err = state === "error";
    return (
      <View style={[s.off, { borderColor: err ? c.danger : c.accent, backgroundColor: err ? c.dangerTint : c.accentTint }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {err ? <Icon name="alert-circle" color={c.danger} /> : <ActivityIndicator color={c.accent} />}
          <Text style={[s.offTitle, { flex: 1 }]}>{err ? `Saving stopped at ${done} / ${total}` : "Saving offline"}</Text>
          {!err && <Text style={[s.offTitle, num]}>{done} / {total}</Text>}
        </View>
        {err ? <Button kind="secondary" icon="refresh" label="Try again" onPress={onMake} disabled={!canSave} />
          : <View style={s.progress}><View style={[s.progressFill, { width: `${total ? (done / total) * 100 : 0}%` }]} /></View>}
      </View>
    );
  }
  if (state === "stale") {
    return (
      <View style={[s.off, { borderColor: c.warn, backgroundColor: c.warnTint }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="alert" color={c.warnInk} />
          <View style={{ flex: 1 }}><Text style={s.offTitle}>Offline copy out of date</Text><Text style={s.offMeta}>The plan changed since {when}</Text></View>
        </View>
        <Button icon="sync" label="Update offline" onPress={onMake} disabled={!canSave} />
      </View>
    );
  }
  return (
    <View style={[s.off, s.offRow, { borderColor: c.ok, backgroundColor: c.okTint }]}>
      <Icon name="check-circle" color={c.ok} />
      <View style={{ flex: 1 }}><Text style={s.offTitle}>Offline · up to date</Text><Text style={s.offMeta}>Saved {when}</Text></View>
      <Button kind="ghost" label="Remove" onPress={onRemove} />
    </View>
  );
}

function DayOverview({ day, shots, offlineCopy, onBack, onStart, state, progress, savedAt, canSave, onMakeOffline, onRemove }: { day: ShootingDay; shots: Shot[]; offlineCopy: boolean; onBack: () => void; onStart: (i: number) => void; state: OfflineState; progress: { done: number; total: number } | null; savedAt: string | null; canSave: boolean; onMakeOffline: () => void; onRemove: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const app = useApp();
  const { light, start, hours } = useDayLight(day, shots);
  useToastOffset(shots.length ? 76 : 0);
  const isToday = day.date === todayIso();
  const now = new Date();
  const current = isToday ? light.phases.find((ph) => now >= ph.start && now < ph.end) : undefined;
  const all = shots.flatMap((x) => shootableWindows(light, x.light));
  const p = dateParts(day.date);
  const summary = light.phases.filter((ph) => ph.phase === "dawn" || ph.phase === "dusk").map((ph) => `${cap(ph.phase)} ${hhmm(ph.start)}–${hhmm(ph.end)}`).join(" · ");
  // Group by location in plan order (a location seen again later starts a new group).
  const groups: { name: string; items: { shot: Shot; index: number }[] }[] = [];
  shots.forEach((shot, index) => {
    const name = placeLabel(shot) || "No location";
    const g = groups[groups.length - 1];
    if (g && g.name === name) g.items.push({ shot, index }); else groups.push({ name, items: [{ shot, index }] });
  });
  const union = (ws: Interval[]) => ws.length ? `${hhmm(new Date(Math.min(...ws.map((w) => w.start.getTime()))))}–${hhmm(new Date(Math.max(...ws.map((w) => w.end.getTime()))))}` : "no window";

  return (
    <View style={s.root}>
      <AppHeader title={`${p.long}${isToday ? " · today" : ""}`} sub={[day.title, `${shots.length} shot${shots.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        lead={{ icon: "arrow-left", label: "All days", onPress: onBack }} offlineMeta={offlineCopy ? "Offline copy saved on this phone." : undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={s.lightBox}>
          <Text style={s.nowText}>{current ? `Now: ${current.phase} until ${hhmm(current.end)}` : summary || "No dawn or dusk on this day"}</Text>
          <DaylightTimeline light={light} start={start} hours={hours} windows={all} now={isToday ? now : null} />
          <Text style={s.times}>
            {[light.sunrise ? `Sunrise ${hhmm(light.sunrise)}` : null, light.sunset ? `Sunset ${hhmm(light.sunset)}` : null].filter(Boolean).join(" · ")}
            {current && summary ? `\n${summary}` : ""}
          </Text>
          {!!day.notes && <Text style={s.notes}><Text style={{ fontFamily: type("small", "bold").fontFamily }}>Notes · </Text>{day.notes}</Text>}
          {!offlineCopy && <OfflineControl state={state} progress={progress} savedAt={savedAt} canSave={canSave} onMake={onMakeOffline} onRemove={onRemove} />}
        </View>
        {shots.length === 0 && <Empty icon="image-off-outline" title="No shots on this day" body={day.shots.length ? "Its shots aren't loaded on the phone." : "Add shots in the Studio (Plan)."} />}
        {groups.map((g, gi) => {
          const gw = g.items.flatMap((x) => shootableWindows(light, x.shot.light));
          return (
            <View key={`${g.name}-${gi}`}>
              <View style={s.groupHead}>
                <Icon name="map-marker-outline" size={20} />
                <Text style={s.groupName} numberOfLines={1}>{g.name}</Text>
                <Text style={[s.groupWindow, { color: c.ok }]}>{union(gw)}</Text>
              </View>
              {g.items.map(({ shot, index }) => {
                const w = shootableWindows(light, shot.light);
                const planned = plannedAt(day, shot.id);
                const fit = windowFit(planned, w);
                const bad = fit && fit !== "inside";
                return (
                  <Pressable key={shot.id} onPress={() => onStart(index)} style={({ pressed }) => [s.shotRow, pressed && { backgroundColor: c.surfaceSunken }]} accessibilityRole="button" accessibilityLabel={`${shotTitle(shot)}, step through from here`}>
                    <View style={s.thumb}><ShotFrame photo={cover(shot)} width={80} settings={app.settings} mode="fit" /></View>
                    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                      <Text style={s.shotName} numberOfLines={1}>{shotTitle(shot)}</Text>
                      <Text style={s.shotMeta} numberOfLines={1}>{lightLabel(shot.light, shot.artificial) || "Any light"}</Text>
                      {shot.photos.length > 1 && <SeqBadge count={shot.photos.length} />}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      {planned && <Text style={[s.planned, bad && { color: c.danger }]}>{hhmm(planned)}</Text>}
                      {bad && <Text style={[s.flag, { color: c.danger }]}>outside window</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
      {shots.length > 0 && <ActionBar><Button style={{ flex: 1 }} icon="play" label="Start from the first shot" onPress={() => onStart(0)} /></ActionBar>}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 96, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  date: { width: 56, alignItems: "center", paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: BORDER.control, borderColor: c.border, backgroundColor: c.surface },
  dateWd: { ...type("caption", "bold"), fontSize: 12, letterSpacing: 0.7, textTransform: "uppercase" },
  dateDd: { ...type("heading", "heavy"), lineHeight: 26, ...num },
  dateMon: { ...type("caption", "semibold"), fontSize: 12 },
  dayTitle: { ...type("body", "bold"), flexShrink: 1 },
  todayTag: { ...type("caption", "bold"), fontSize: 12, letterSpacing: 0.7, color: c.onAccent, backgroundColor: c.accent, paddingHorizontal: 7, height: 22, lineHeight: 22, borderRadius: RADIUS.xs, overflow: "hidden" },
  dayMeta: { ...type("small"), color: c.textDim, ...num },
  offText: { ...type("small", "bold") },
  lightBox: { padding: 16, gap: 10, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  nowText: { ...type("heading", "heavy"), color: c.text },
  bar: { borderRadius: RADIUS.xs, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  seg: { position: "absolute", top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  now: { position: "absolute", top: 0, bottom: 0, width: 3, marginLeft: -1, backgroundColor: c.accent },
  windows: { height: 8, marginTop: 3, position: "relative" },
  window: { position: "absolute", top: 0, bottom: 0, backgroundColor: c.ok, borderRadius: 2 },
  times: { ...type("small"), color: c.textDim, ...num },
  notes: { ...type("small"), color: c.text },
  off: { gap: 8, padding: 12, borderRadius: RADIUS.sm, borderWidth: BORDER.control },
  offRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, paddingRight: 4, minHeight: 56 },
  offTitle: { ...type("body", "bold"), color: c.text },
  offMeta: { ...type("caption"), color: c.textDim },
  progress: { height: 8, borderRadius: 4, backgroundColor: c.surface, overflow: "hidden", borderWidth: 1, borderColor: c.accent },
  progressFill: { height: "100%", backgroundColor: c.accent },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  groupName: { ...type("overline", "bold"), color: c.text, flex: 1 },
  groupWindow: { ...type("small", "bold"), ...num },
  shotRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 72, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  thumb: { width: 80, height: 60, borderRadius: RADIUS.xs, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  shotName: { ...type("body", "bold"), color: c.text },
  shotMeta: { ...type("small"), color: c.textDim },
  planned: { ...type("body", "heavy"), color: c.text, ...num },
  flag: { ...type("caption", "bold") },
}));
