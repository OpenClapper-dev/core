import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
// One module per weight, so only the five weights in use are bundled.
import { AtkinsonHyperlegibleNext_400Regular } from "@expo-google-fonts/atkinson-hyperlegible-next/400Regular";
import { AtkinsonHyperlegibleNext_500Medium } from "@expo-google-fonts/atkinson-hyperlegible-next/500Medium";
import { AtkinsonHyperlegibleNext_600SemiBold } from "@expo-google-fonts/atkinson-hyperlegible-next/600SemiBold";
import { AtkinsonHyperlegibleNext_700Bold } from "@expo-google-fonts/atkinson-hyperlegible-next/700Bold";
import { AtkinsonHyperlegibleNext_800ExtraBold } from "@expo-google-fonts/atkinson-hyperlegible-next/800ExtraBold";
import { AppContext, type AppState, type Route, type ShotsView, type Tab } from "./src/appState";
import { isSignedIn, onAuthChange } from "./src/auth";
import { isConfigured } from "./src/config";
import { setLogging } from "./src/log";
import { setOfflineMode, useOnline } from "./src/net";
import { useLivePreview } from "./src/preview";
import { copyDefault, editLayout as writeLayout, withLook } from "./src/layouts";
import { resolveLayout } from "./src/vfLayout";
import { useShots } from "./src/shots";
import { store, usePref } from "./src/storage";
import type { LayoutEntry, LocationEntry, ProjectEntry, Settings, SpotEntry } from "./src/types";
import { flush, onFlushed } from "./src/uploads";
import { ConfirmHost, Icon, makeStyles, PALETTES, resolveTheme, SIZE, ThemeProvider, toast, ToastHost, type, useTheme } from "./src/ui";
import { ProjectSheet } from "./src/components/ProjectSheet";
import { Day } from "./src/screens/Day";
import { LoginForm, ProjectGate, SignInGate } from "./src/screens/Gates";
import { Offline } from "./src/screens/Offline";
import { History } from "./src/screens/History";
import { RigEditor, RigList } from "./src/screens/Rigs";
import { Setup } from "./src/screens/Setup";
import { Account, Calibration, CaptureSettings, ChangePassword, DebugLog, ViewfinderSettings } from "./src/screens/SetupScreens";
import { CorrectPosition, MapFocus, ShotDetails } from "./src/screens/ShotDetails";
import { Shots } from "./src/screens/Shots";
import { StepThrough } from "./src/screens/StepThrough";
import { Uploads } from "./src/screens/Uploads";
import { Viewfinder } from "./src/screens/Viewfinder";

const TABS: { tab: Tab; label: string; icon: string }[] = [
  { tab: "shoot", label: "Shoot", icon: "camera-iris" },
  { tab: "history", label: "History", icon: "history" },
  { tab: "shots", label: "Shots", icon: "view-grid-outline" },
  { tab: "day", label: "Day", icon: "calendar-clock" },
  { tab: "setup", label: "Setup", icon: "cog-outline" },
];
const TAB = SIZE.tabBar;
/** While the server can't be reached, try again this often (a flush also syncs projects and locations). */
const OFFLINE_RETRY_MS = 20_000;

export default function Root() {
  // The UI font; render nothing for the few frames it takes to load (and carry on with the system font if it fails).
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegibleNext_400Regular, AtkinsonHyperlegibleNext_500Medium, AtkinsonHyperlegibleNext_600SemiBold,
    AtkinsonHyperlegibleNext_700Bold, AtkinsonHyperlegibleNext_800ExtraBold,
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

function App() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const portrait = height >= width;
  const [tab, setTab] = useState<Tab>("shoot");
  const [stack, setStack] = useState<Route[]>([]);
  // Logging and offline mode take effect before the first request.
  const [settings, setSettingsState] = useState<Settings>(() => { const s = store.loadSettings(); setLogging(s.loggingEnabled); setOfflineMode(s.offlineMode); return s; });
  const setSettings = useCallback((u: Settings | ((s: Settings) => Settings)) => setSettingsState((cur) => (typeof u === "function" ? u(cur) : u)), []);
  const [locations, setLocations] = useState<LocationEntry[]>(() => store.loadLocations());
  const [spots, setSpots] = useState<SpotEntry[]>(() => store.loadSpots());
  const [layouts, setLayouts] = useState<LayoutEntry[]>(() => store.loadLayouts());
  const [projects, setProjects] = useState<ProjectEntry[]>(() => store.loadProjects());
  // Chosen once and remembered across launches until changed.
  const [projectId, setProjectId] = useState<string | null>(() => store.loadActiveProjectId());
  const project = projects.find((p) => p.id === projectId) ?? null;
  const [projectSheet, setProjectSheet] = useState(false);
  const [shotsView, setShotsView] = usePref<ShotsView>("shotsView.v1", "grid", ["grid", "map"]);
  const [mapFocus, setMapFocus] = useState<string | null>(null);
  const shots = useShots(project?.id ?? null);
  const online = useOnline();
  const live = useLivePreview(!settings.offlineMode);
  // A preview from the Studio brings the Shoot screen to the front.
  useEffect(() => { if (live.preview) { setStack([]); setTab("shoot"); } }, [!!live.preview]);
  // Sign-in gate on launch without a session, and again whenever a request finds the session gone.
  // "web" is the sign-in form opened from the gate; "webApp" the same form opened from inside the app (cancel returns there).
  const [login, setLogin] = useState<"gate" | "web" | "webApp" | null>(() => (isConfigured && !isSignedIn() ? "gate" : null));

  // flush() syncs projects first and repoints queued shots (and the active id) when a name clashed on the server.
  const refreshProjects = useCallback(async () => {
    await flush();
    setProjects(store.loadProjects());
    setProjectId(store.loadActiveProjectId());
  }, []);
  useEffect(() => { if (isSignedIn()) void refreshProjects(); }, []);
  // Any flush (camera, Uploads, here) may have synced or remapped projects and locations.
  useEffect(() => onFlushed(() => { setProjects(store.loadProjects()); setProjectId(store.loadActiveProjectId()); setLocations(store.loadLocations()); setSpots(store.loadSpots()); setLayouts(store.loadLayouts()); }), []);
  useEffect(() => onAuthChange(() => { if (!isSignedIn()) setLogin("gate"); else { void refreshProjects(); void shots.load(); } }), [shots.load]);
  useEffect(() => { store.saveActiveProjectId(projectId); }, [projectId]);
  useEffect(() => { store.saveSettings(settings); }, [settings]);
  // Offline mode switched off: send what waited and reload the lists.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return; }
    setOfflineMode(settings.offlineMode);
    if (!settings.offlineMode && isSignedIn()) void flush().then(() => shots.load());
  }, [settings.offlineMode]);
  useEffect(() => { store.saveLocations(locations); }, [locations]);
  useEffect(() => { store.saveSpots(spots); }, [spots]);
  // Refresh the lists when switching to a browsing tab, so new shots show up without a pull.
  useEffect(() => { if (tab !== "shoot") void shots.load(); }, [tab]);
  // Offline: keep knocking; when the server answers again, reload what the screens show.
  useEffect(() => {
    if (online || !isSignedIn()) return;
    const t = setInterval(() => { void flush(); }, OFFLINE_RETRY_MS);
    return () => clearInterval(t);
  }, [online]);
  const wasOnline = useRef(online);
  useEffect(() => { if (online && !wasOnline.current && isSignedIn()) void shots.load(); wasOnline.current = online; }, [online]);

  // The Studio owns the orientation while it previews a layout.
  const previewOrientation = live.preview?.orientation ?? null;
  useEffect(() => {
    const lock = previewOrientation ?? settings.orientationLock;
    const p = lock === "landscape"
      ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      : lock === "portrait"
        ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        : ScreenOrientation.unlockAsync();
    p.catch((e) => console.warn("orientation lock failed", e));
  }, [settings.orientationLock, previewOrientation]);

  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  // Android back: close the top screen, then go back to Shoot, then leave the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (login === "web") { setLogin("gate"); return true; }
      if (login === "webApp") { setLogin(null); return true; }
      if (stack.length) { pop(); return true; }
      if (tab !== "shoot" && !login && project) { setTab("shoot"); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, login, project, pop]);

  const pickProject = (id: string, created: ProjectEntry | null) => {
    if (created) { const next = [...store.loadProjects(), created]; store.saveProjects(next); setProjects(next); }
    store.saveActiveProjectId(id); // now, not in the effect: refreshProjects reads it back from the store
    const changed = id !== projectId;
    setProjectId(id);
    setProjectSheet(false);
    const name = created?.name ?? projects.find((p) => p.id === id)?.name;
    if (changed && name) toast(`Now shooting for ${name}`);
    if (created && isSignedIn()) void refreshProjects();
  };
  const countAt = useCallback(
    (locationId: string) =>
      (shots.shots ?? []).filter((x) => x.location_id === locationId).length + store.loadPending().filter((p) => p.metadata.location_id === locationId).length,
    [shots.shots],
  );

  // Issue #68: the layout carries the look and control options; the screens read them merged into the settings.
  const layoutEntry = layouts.find((l) => l.id === settings.viewfinderLayoutId) ?? null;
  const layout = live.preview?.layout ?? resolveLayout(settings.viewfinderLayoutId, layouts);
  const viewSettings = useMemo(() => withLook(settings, layout), [settings, layout]);
  const editLayout = useCallback((patch: Parameters<AppState["editLayout"]>[0]) => {
    if (!layoutEntry) return; // the Default is read-only
    writeLayout(layoutEntry, patch);
    setLayouts(store.loadLayouts());
    if (isSignedIn()) void flush();
  }, [layoutEntry]);
  const copyDefaultLayout = useCallback(() => {
    const e = copyDefault("My layout");
    setLayouts(store.loadLayouts());
    setSettings((s) => ({ ...s, viewfinderLayoutId: e.id }));
    toast("Copied the Default as “My layout”: change it here or in the Studio");
    if (isSignedIn()) void flush();
  }, []);

  const state: AppState = useMemo(() => ({
    settings: viewSettings, setSettings, layout, layoutEntry, editLayout, copyDefaultLayout, project, projects, shots, locations, setLocations, spots, setSpots, layouts, countAt,
    preview: live.preview, exitPreview: live.exit,
    tab, setTab: (t: Tab) => { setStack([]); setMapFocus(null); setTab(t); }, push, pop,
    openProjectSheet: () => setProjectSheet(true),
    signIn: () => setLogin("webApp"),
    shotsView, setShotsView, mapFocus,
    showOnMap: (id: string) => { setMapFocus(id); setShotsView("map"); setStack([]); setTab("shots"); },
  }), [viewSettings, layout, layoutEntry, editLayout, copyDefaultLayout, project, projects, shots, locations, spots, layouts, live.preview, countAt, tab, push, pop, shotsView, mapFocus]);

  const unreviewed = (shots.shots ?? []).filter((s) => s.state === "unreviewed").length;
  // The tab bar sits on the navigation-bar edge; keep at least the edge pad clear of it.
  const barPad = portrait ? Math.max(insets.bottom, SIZE.edgePad) : Math.max(insets.right, SIZE.edgePad);
  const os = useColorScheme();
  const themeName = resolveTheme(settings.theme, os);
  const top = stack[stack.length - 1] ?? null;
  const gate = login === "gate" ? "signin" : login === "web" || login === "webApp" ? "web" : !project ? "project" : null;
  const chromeless = !!gate || !!top;
  const immersive = top?.name === "step";

  return (
    <AppContext.Provider value={state}>
    <ThemeProvider choice={settings.theme}>
    <StatusBar style={themeName === "set" ? "light" : "dark"} />
    <View style={{ flex: 1, flexDirection: portrait ? "column" : "row", backgroundColor: PALETTES[themeName].surface }}>
      {/* Content stays clear of the camera cutout (top in portrait, left in landscape) and, without a tab bar, of the nav bar. */}
      <View style={{ flex: 1, backgroundColor: PALETTES[themeName].bg,
        paddingTop: immersive ? 0 : portrait ? insets.top : 0,
        paddingLeft: immersive || portrait ? 0 : insets.left,
        paddingRight: chromeless && !immersive && !portrait ? insets.right : 0 }}>
        {/* Viewfinder stays mounted so state and camera warm-up survive tab switches; it releases the camera when inactive. */}
        <View style={[{ flex: 1 }, (tab !== "shoot" || chromeless) && { display: "none" }]}>
          <Viewfinder active={tab === "shoot" && !chromeless} />
        </View>
        {/* The open tab stays mounted under a pushed screen, so Back returns to where you were (scroll, open day). */}
        {tab !== "shoot" && (
          <View style={[{ flex: 1 }, chromeless && { display: "none" }]}>
            {tab === "history" && <History />}
            {tab === "shots" && <Shots />}
            {tab === "day" && <Day />}
            {tab === "setup" && <Setup />}
          </View>
        )}
        {gate === "signin" && <SignInGate onSignIn={() => setLogin("web")} onSkip={() => setLogin(null)} />}
        {gate === "web" && <LoginForm onDone={() => setLogin(null)} onCancel={() => setLogin(login === "web" && !isSignedIn() ? "gate" : null)} />}
        {gate === "project" && <ProjectGate projects={projects} onPick={pickProject} />}
        {!gate && top && <Screen route={top} />}
      </View>
      {!chromeless && <TabBar tab={tab} onTab={state.setTab} unreviewed={unreviewed} portrait={portrait} pad={barPad} />}
      <ToastHost bottom={chromeless ? SIZE.edgePad + 64 : portrait ? TAB + barPad : 0} />
      <ConfirmHost />
      <ProjectSheet visible={projectSheet && !gate} projects={projects} activeId={project?.id ?? null} onPick={pickProject} onClose={() => setProjectSheet(false)} />
    </View>
    </ThemeProvider>
    </AppContext.Provider>
  );
}

/** The pushed full screen on top of the stack. */
function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "uploads": return <Uploads />;
    case "offline": return <Offline />;
    case "shot": return <ShotDetails key={route.shotId} shotId={route.shotId} list={route.list} />;
    case "position": return <CorrectPosition shotId={route.shotId} photoId={route.photoId} />;
    case "mapFocus": return <MapFocus shotId={route.shotId} />;
    case "step": return <StepThrough day={route.day} shots={route.shots} index={route.index} />;
    case "rigs": return <RigList />;
    case "rigEditor": return <RigEditor key={route.rigId ?? "new"} rigId={route.rigId} />;
    case "viewfinderSettings": return <ViewfinderSettings />;
    case "captureSettings": return <CaptureSettings />;
    case "calibration": return <Calibration />;
    case "account": return <Account />;
    case "password": return <ChangePassword />;
    case "debugLog": return <DebugLog />;
  }
}

/** Bottom tab bar (a right-hand column in landscape). Selected = accent pill behind the icon + heavy label. */
function TabBar({ tab, onTab, unreviewed, portrait, pad }: { tab: Tab; onTab: (t: Tab) => void; unreviewed: number; portrait: boolean; pad: number }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.bar, portrait ? { height: TAB + pad, paddingBottom: pad, flexDirection: "row", borderTopWidth: 2 } : { width: 72 + pad, paddingRight: pad, flexDirection: "column", borderLeftWidth: 2 }]}>
      {TABS.map((t) => {
        const on = tab === t.tab;
        return (
          <Pressable key={t.tab} onPress={() => onTab(t.tab)} style={s.tab} accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={t.tab === "history" && unreviewed ? `${t.label}, ${unreviewed} to review` : t.label}>
            <View style={[s.pill, on && { backgroundColor: c.accent }]}>
              <Icon name={t.icon} size={22} color={on ? c.onAccent : c.text} />
            </View>
            <Text style={[s.label, on && s.labelOn]} numberOfLines={1}>{t.label}</Text>
            {t.tab === "history" && unreviewed > 0 && <Text style={s.badge}>{unreviewed}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  bar: { backgroundColor: c.surface, borderColor: c.border, justifyContent: "space-around", alignItems: "stretch", paddingHorizontal: 4, paddingTop: 4 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minWidth: 52, minHeight: 56 },
  pill: { width: 56, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  label: { ...type("caption", "medium"), fontSize: 12, lineHeight: 14, color: c.text },
  labelOn: { fontFamily: type("caption", "heavy").fontFamily },
  badge: { position: "absolute", top: 0, left: "56%", minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, overflow: "hidden", backgroundColor: c.warn, color: c.onWarn, textAlign: "center", ...type("caption", "bold"), fontSize: 12, lineHeight: 20 },
}));
