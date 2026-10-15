import { useEffect, useMemo, useState } from "preact/hooks";
import { extraFilterFields, type FieldDef } from "@fielder/vocab";
import { deleteView, onProjectCreated, fetchAllShots, fetchFields, fetchLocations, fetchPresets, fetchProjects, fetchSpots, fetchViews, putView, type FieldDefinition, type Location, type Preset, type Project, type SavedView, type Shot, type ShootingDay, type Spot } from "./api";
import { CommandPalette, ShortcutSheet, type Command } from "./CommandPalette";
import { FieldsPage } from "./Fields";
import { FRAME_MODES, isFrameMode } from "./format";
import type { MaskMode } from "./Framed";
import { projectDays } from "./Inspector";
import { bind, useKeys } from "./keys";
import { hintsFor } from "./shortcuts";
import { LocationsPage } from "./Locations";
import { PlanPage } from "./Plan";
import { ProjectGate, ProjectsPage } from "./Projects";
import { MetadataPage } from "./MetadataPage";
import { RigsPage } from "./Rigs";
import { DEFAULT_ROUTE, parseRoute, useRoute, type Route } from "./router";
import { NewShotDialog } from "./NewShot";
import { SettingsPage } from "./SettingsPage";
import { ShotsPage } from "./ShotsPage";
import { TimelinePage } from "./Timeline";
import { ViewfinderLayoutsPage } from "./ViewfinderLayouts";
import { decodeView, emptyQuery, encodeView, runQuery, type Layout, type ShotsQuery } from "./shotsQuery";
import { shotHints, ShotView } from "./ShotView";
import { Sidebar } from "./Sidebar";
import { useTheme } from "./theme";
import { Button, ConfirmHost, confirmDialog, cx, Empty, Kbd, Loading, promptDialog, toast, ToastHost } from "./ui";

function readStorage(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* ignore */ } }
const loadLayout = (): Layout => { const v = readStorage("layout"); return v === "list" || v === "map" ? v : "grid"; };
function loadMask(): MaskMode { const v = readStorage("maskMode"); return isFrameMode(v) ? v : "mask"; }
const nextMode = (m: MaskMode) => FRAME_MODES[(FRAME_MODES.indexOf(m) + 1) % FRAME_MODES.length];
const sameFilter = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Without a choice of its own, the sidebar collapses to a rail on narrow windows. */
function useNarrow(): boolean {
  const mq = () => window.matchMedia?.("(max-width: 1100px)");
  const [narrow, setNarrow] = useState(() => !!mq()?.matches);
  useEffect(() => { const m = mq(); const on = () => setNarrow(!!m?.matches); m?.addEventListener("change", on); return () => m?.removeEventListener("change", on); }, []);
  return narrow;
}

export function App() {
  const [route, navigateRaw, replace] = useRoute();
  const [theme, setTheme] = useTheme();
  const narrow = useNarrow();
  // The user's own collapse/expand (the sidebar button or Ctrl/⌘ B), remembered; null = follow the window width.
  const [sideChoice, setSideChoice] = useState<"rail" | "full" | null>(() => { const v = readStorage("sidebar"); return v === "rail" || v === "full" ? v : null; });
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [spots, setSpotsState] = useState<Spot[] | null>(null);
  const setSpots = (update: (cur: Spot[]) => Spot[]) => setSpotsState((cur) => update(cur ?? []));
  const [fields, setFields] = useState<FieldDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [storedScope, setStoredScope] = useState<string | null>(() => readStorage("project"));
  const [mask, setMaskState] = useState<MaskMode>(loadMask);
  /** The shot view starts from the global mode; a change there sticks for ←/→ until it closes. */
  const [viewMode, setViewMode] = useState<MaskMode>(mask);
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const [query, setQuery] = useState<ShotsQuery>(emptyQuery);
  const [loadedView, setLoadedView] = useState<SavedView | null>(null);
  const [panel, setPanel] = useState(false);
  const [mapSelected, setMapSelected] = useState<string | null>(null);
  /** The list the open shot came from (ids), for ←/→, and where Esc returns to. */
  const [openList, setOpenList] = useState<string[]>([]);
  const [returnTo, setReturnTo] = useState<Route>(DEFAULT_ROUTE);
  const [palette, setPalette] = useState(false);
  const [newShot, setNewShot] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [paletteDays, setPaletteDays] = useState<ShootingDay[]>([]);

  const setLayout = (l: Layout) => { setLayoutState(l); writeStorage("layout", l); };
  const setMask = (m: MaskMode) => { setMaskState(m); writeStorage("maskMode", m); };
  const setScope = (s: string) => { setStoredScope(s); writeStorage("project", s); };

  const load = () => Promise.all([fetchAllShots().then(setShots), fetchProjects().then(setProjects), fetchPresets().then(setPresets), fetchLocations().then(setLocations), fetchSpots().then(setSpotsState), fetchViews().then(setViews), fetchFields().then(setFields)])
    .then(() => { setError(null); setLoadedAt(new Date()); })
    .catch((e: Error) => setError(e.message));
  const reload = () => { void load().then(() => toast("Reloaded", "info")); };
  const refreshCounts = () => { void fetchLocations().then(setLocations).catch(() => {}); void fetchSpots().then(setSpotsState).catch(() => {}); void fetchProjects().then(setProjects).catch(() => {}); };
  useEffect(() => { void load(); }, []);
  // A project created inline (move, bulk edit) joins the list at once; counts follow with the next refresh.
  useEffect(() => onProjectCreated((p) => setProjects((cur) => (cur ?? []).some((x) => x.id === p.id) ? cur : [...(cur ?? []), p].sort((a, b) => a.name.localeCompare(b.name)))), []);

  // The dashboard always works inside one project (issue #44). A remembered project that no longer exists counts as "not chosen".
  const scope: string | null = storedScope && projects?.some((p) => p.id === storedScope) ? storedScope : null;
  const scopeProject = projects?.find((p) => p.id === scope) ?? null;
  const scopeName = scopeProject?.name ?? "";
  const scoped = useMemo(() => (shots ?? []).filter((s) => s.project_id === scope), [shots, scope]);
  const fieldsOf = (projectId: string): FieldDef[] => (fields ?? []).filter((f) => f.project_id === projectId).sort((a, b) => a.position - b.position).map((f) => f.definition);
  const locationsOf = (projectId: string) => (locations ?? []).filter((l) => l.project_id === projectId);
  /** A page hands back one project's list (after a create, rename or delete): it replaces that project's rows. */
  const setLocationsOf = (projectId: string) => (list: Location[]) => {
    const ids = new Set(list.map((l) => l.id));
    setLocations((cur) => [...(cur ?? []).filter((l) => l.project_id !== projectId && !ids.has(l.id)), ...list]);
  };
  const projectLocations = useMemo(() => locationsOf(scope ?? ""), [locations, scope]);
  const setProjectLocations = setLocationsOf(scope ?? "");
  const projectViews = useMemo(() => (views ?? []).filter((v) => v.project_id === scope), [views, scope]);
  const projectFields = useMemo(() => (fields ?? []).filter((f) => f.project_id === scope), [fields, scope]);
  const setProjectFields = (list: FieldDefinition[]) => setFields((cur) => [...(cur ?? []).filter((f) => f.project_id !== scope), ...list]);
  const extra = useMemo(() => extraFilterFields(scope ? fieldsOf(scope) : []), [scope, fields]);
  const projectSpots = useMemo(() => { const ids = new Set(projectLocations.map((l) => l.id)); return (spots ?? []).filter((sp) => ids.has(sp.location_id)); }, [spots, projectLocations]);
  const ctx = { projects: projects ?? [], locations: projectLocations, spots: projectSpots, presets: presets ?? [], extra };

  // Saved views: the route's view loads into the query; edits mark it "Edited" until saved or reverted.
  const viewId = route.page === "shots" ? route.viewId : null;
  useEffect(() => {
    if (route.page !== "shots") return;
    if (!viewId) { if (loadedView) { setLoadedView(null); setQuery(emptyQuery()); } return; }
    if (loadedView?.id === viewId) return;
    const v = projectViews.find((x) => x.id === viewId);
    if (!v) return;
    setLoadedView(v);
    setQuery({ ...emptyQuery(), ...decodeView(v.filter), sort: query.sort });
  }, [viewId, projectViews]);
  const edited = !!loadedView && !sameFilter(encodeView(query), loadedView.filter);

  /** Navigation that asks before dropping unsaved view edits. */
  const navigate = async (r: Route) => {
    const leavingView = loadedView && edited && route.page === "shots" && r.page !== "shot" && !(r.page === "shots" && r.viewId === loadedView.id);
    if (leavingView) {
      const ok = await confirmDialog({ title: `Discard changes to “${loadedView.name}”?`, body: "The view keeps its saved filter.", confirmLabel: "Discard", cancelLabel: "Keep editing" });
      if (!ok) return;
      setLoadedView(null);
    }
    navigateRaw(r);
  };

  const updated = (s: Shot | Shot[]) => { const m = new Map((Array.isArray(s) ? s : [s]).map((x) => [x.id, x])); setShots((cur) => (cur ?? []).map((x) => m.get(x.id) ?? x)); refreshCounts(); };
  const deleted = (ids: string[]) => { const gone = new Set(ids); setShots((cur) => (cur ?? []).filter((x) => !gone.has(x.id))); refreshCounts(); };

  const result = useMemo(() => runQuery(scoped, query, extra), [scoped, query, extra]);
  function openShot(s: Shot, list?: Shot[]) {
    setOpenList((list ?? result.shots).map((x) => x.id));
    setViewMode(mask);
    // From the URL, not `route`: a cut's playhead and tool are written there silently.
    setReturnTo(route.page === "shot" ? returnTo : parseRoute(location.hash));
    navigateRaw({ page: "shot", shotId: s.id, stage: "photo" });
  }
  function showOnMap(s: Shot) {
    const visible = result.shots.some((x) => x.id === s.id);
    if (!visible) { setLoadedView(null); setQuery({ ...emptyQuery(), sort: query.sort }); }
    setLayout("map");
    setMapSelected(s.id);
    navigateRaw({ page: "shots", viewId: visible ? loadedView?.id ?? null : null });
  }
  const openDay = (projectId: string, dayId: string) => { if (scope !== projectId) setScope(projectId); navigateRaw({ page: "plan", dayId }); };
  const openTimeline = (projectId: string, timelineId: string) => { if (scope !== projectId) setScope(projectId); navigateRaw({ page: "timeline", timelineId }); };

  async function saveView() {
    if (!loadedView) return;
    try { const v = await putView({ id: loadedView.id, project_id: loadedView.project_id, name: loadedView.name, filter: encodeView(query) }); setViews((cur) => (cur ?? []).map((x) => (x.id === v.id ? v : x))); setLoadedView(v); toast("View saved"); } catch (e) { toast(`Saving failed: ${(e as Error).message}`, "danger"); }
  }
  async function saveAsNew() {
    const name = await promptDialog({ title: loadedView ? "Save as a new view" : "Save view", input: { label: "Name", value: loadedView ? `${loadedView.name} (copy)` : "", placeholder: "e.g. Dusk exteriors" }, confirmLabel: "Save view" });
    if (!name) return;
    try {
      const v = await putView({ id: crypto.randomUUID(), project_id: scope!, name, filter: encodeView(query) });
      setViews((cur) => [...(cur ?? []), v].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
      setLoadedView(v);
      navigateRaw({ page: "shots", viewId: v.id });
      toast("View saved");
    } catch (e) { toast(`Saving failed: ${(e as Error).message}`, "danger"); }
  }
  async function viewMenu(action: "rename" | "delete") {
    const v = loadedView;
    if (!v) return;
    if (action === "rename") {
      const name = await promptDialog({ title: "Rename view", input: { label: "Name", value: v.name }, confirmLabel: "Rename" });
      if (!name || name === v.name) return;
      try { const saved = await putView({ id: v.id, project_id: v.project_id, name, filter: v.filter }); setViews((cur) => (cur ?? []).map((x) => (x.id === saved.id ? saved : x))); setLoadedView({ ...saved, filter: v.filter }); } catch (e) { toast(`Rename failed: ${(e as Error).message}`, "danger"); }
      return;
    }
    const ok = await confirmDialog({ title: `Delete the view “${v.name}”?`, body: "Only the saved filter is deleted; no shots.", confirmLabel: "Delete view", danger: true });
    if (!ok) return;
    try { await deleteView(v.id); setViews((cur) => (cur ?? []).filter((x) => x.id !== v.id)); setLoadedView(null); setQuery(emptyQuery()); navigateRaw({ page: "shots", viewId: null }); toast("View deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  const newView = async () => { await navigate({ page: "shots", viewId: null }); setLoadedView(null); setQuery(emptyQuery()); setPanel(true); };
  const showLocationShots = (locationId: string, l: Layout) => {
    setLoadedView(null);
    setQuery({ ...emptyQuery(), filter: { match: "all", rules: [{ field: "location_id", op: "is", value: locationId }] } });
    setLayout(l);
    navigateRaw({ page: "shots", viewId: null });
  };
  function toggleSidebar() {
    const next = (sideChoice ? sideChoice === "rail" : narrow) ? "full" : "rail";
    setSideChoice(next);
    writeStorage("sidebar", next);
  }
  const openPalette = () => { setPalette(true); if (scope) void projectDays(scope).then(setPaletteDays); };

  // Global keys: palette, shortcut sheet, sidebar, G then a section.
  useKeys(bind("global", {
    palette: openPalette,
    sheet: () => setSheet(true),
    sidebar: () => toggleSidebar(),
    goShots: () => void navigate({ page: "shots", viewId: null }),
    goPlan: () => void navigate({ page: "plan", dayId: null }),
    goTimeline: () => void navigate({ page: "timeline", timelineId: null }),
    goLibrary: () => void navigate({ page: "library", section: "projects", id: null }),
    goMap: () => { setLayout("map"); void navigate({ page: "shots", viewId }); },
  }), !palette && !sheet);

  const loaded = !!shots && !!projects && !!presets && !!locations && !!spots && !!views && !!fields;
  if (loaded && !scope) {
    return <><ProjectGate projects={projects!} onChange={setProjects} onActivate={setScope} /><ConfirmHost /><ToastHost /></>;
  }

  const rail = sideChoice ? sideChoice === "rail" : narrow;
  const openShotObj = route.page === "shot" ? (shots ?? []).find((s) => s.id === route.shotId) ?? null : null;
  const byId = new Map((shots ?? []).map((s) => [s.id, s]));
  const fromList = openList.map((id) => byId.get(id)).filter((s): s is Shot => !!s);
  const listForShot = openShotObj && fromList.some((s) => s.id === openShotObj.id) ? fromList : result.shots;
  const backLabel = returnTo.page === "plan" ? "Plan" : returnTo.page === "timeline" ? "Timeline" : "Shots";
  const shotLine = returnTo.page === "plan" ? "Planned shots of the day" : returnTo.page === "timeline" ? "Shots in the timeline"
    : [query.state === "all" ? "All states" : query.state[0].toUpperCase() + query.state.slice(1), loadedView?.name ?? scopeName, { newest: "newest first", oldest: "oldest first", name: "by name" }[query.sort]].join(" · ");

  let main;
  let hints: { k: string; t: string }[] = [];
  if (!loaded) {
    main = error ? <Empty icon="cloud-alert" title="Could not load" actions={<Button onClick={() => void load()}>Try again</Button>}>{error}</Empty> : <Loading />;
  } else if (route.page === "shot") {
    main = openShotObj
      ? <ShotView shot={openShotObj} list={listForShot} onNavigate={(s) => replace({ page: "shot", shotId: s.id, stage: route.stage })}
          context={{ line: shotLine, onBack: () => navigateRaw(returnTo), backLabel }} stage={route.stage} onStage={(st) => replace({ ...route, stage: st })}
          mode={viewMode} onMode={setViewMode} projects={projects!} presets={presets!} fieldsOf={fieldsOf} locations={locationsOf(openShotObj.project_id)} onLocations={setLocationsOf(openShotObj.project_id)} spots={spots ?? []} onSpots={setSpots}
          onUpdated={updated}
          onDeleted={(id) => { const i = listForShot.findIndex((s) => s.id === id); const n = listForShot[i + 1] ?? listForShot[i - 1]; deleted([id]); if (n) replace({ page: "shot", shotId: n.id, stage: "photo" }); else navigateRaw(returnTo); }}
          onShowOnMap={showOnMap} onOpenDay={openDay} onOpenTimeline={openTimeline} />
      : <Empty icon="image-off-outline" title="Shot not found" actions={<Button kind="secondary" onClick={() => navigateRaw(returnTo)}>Back to {backLabel}</Button>}>It may have been deleted.</Empty>;
    hints = shotHints(route.stage);
  } else if (route.page === "metadata") {
    main = <MetadataPage project={scopeProject!} shots={scoped} locations={projectLocations} onLocations={setProjectLocations} mask={mask}
      field={route.field} onField={(f) => replace({ page: "metadata", field: f })} onUpdated={updated} onOpen={openShot} />;
    hints = hintsFor("metadata");
  } else if (route.page === "plan") {
    main = <PlanPage project={scopeProject!} shots={scoped} mask={mask} dayId={route.dayId} onDay={(id) => replace({ page: "plan", dayId: id })} onOpen={openShot} />;
    hints = hintsFor("plan");
  } else if (route.page === "timeline") {
    main = <TimelinePage project={scopeProject!} shots={scoped} presets={presets!} mask={mask} timelineId={route.timelineId} at={route.at} onTimeline={(id) => replace({ page: "timeline", timelineId: id })}
      onOpen={openShot} onUpdated={updated} onShowOnMap={showOnMap} onNewShot={() => setNewShot(true)} />;
    hints = hintsFor("timeline", "browser");
  } else if (route.page === "settings") {
    main = <SettingsPage tab={route.tab} onTab={(tab) => replace({ page: "settings", tab })} theme={theme} onTheme={setTheme} mask={mask} onMask={setMask} />;
    hints = [];
  } else if (route.page === "library") {
    const sel = route.id;
    const setSel = (id: string | null) => replace({ page: "library", section: route.section, id });
    if (route.section === "projects") {
      main = <ProjectsPage projects={projects!} onChange={setProjects} fields={fields!} scope={scope!} selectedId={sel} onSelect={setSel}
        onActivate={(id) => { setScope(id); toast(`Now working on ${projects!.find((p) => p.id === id)?.name ?? "the project"}`); }}
        onShowShots={(id) => { setScope(id); navigateRaw({ page: "shots", viewId: null }); }} onEditFields={(id) => { setScope(id); navigateRaw({ page: "library", section: "fields", id: null }); }} />;
      hints = [];
    } else if (route.section === "fields") {
      main = <FieldsPage project={scopeProject!} fields={projectFields} onChange={setProjectFields} selectedId={sel} onSelect={setSel} />;
      hints = hintsFor("fields");
    } else if (route.section === "viewfinder") {
      main = <ViewfinderLayoutsPage selectedId={sel} onSelect={setSel} />;
      hints = [];
    } else if (route.section === "rigs") {
      main = <RigsPage presets={presets!} shots={shots!} onChange={setPresets} selectedId={sel} onSelect={setSel} />;
      hints = hintsFor("rigs", "rig");
    } else {
      main = <LocationsPage locations={projectLocations} shots={scoped} onChange={setProjectLocations} spots={spots ?? []} onSpots={setSpots} onShotsChanged={() => void fetchAllShots().then(setShots).catch(() => {})} onShowShots={showLocationShots} />;
      hints = hintsFor("locations");
    }
  } else {
    main = <ShotsPage shots={scoped} error={error} scopeName={scopeName} query={query} onQuery={setQuery} view={loadedView} edited={edited}
      onSaveView={() => void saveView()} onSaveAsNew={() => void saveAsNew()} onRevert={() => loadedView && setQuery({ ...query, ...decodeView(loadedView.filter) })} onViewMenu={(a) => void viewMenu(a)}
      panel={panel} onPanel={setPanel} layout={layout} onLayout={setLayout} mask={mask} onMask={setMask} ctx={ctx} onOpen={openShot}
      mapSelected={mapSelected} onMapSelected={setMapSelected} onDeleted={deleted} onUpdated={updated} onLocations={setProjectLocations} fieldsOf={fieldsOf} onReload={() => void load()} onSwitchScope={openPalette} onNewShot={() => setNewShot(true)} />;
    hints = [...hintsFor(layout === "list" ? "shots.list" : layout === "map" ? "map" : "shots.grid"), ...hintsFor("shots"), ...hintsFor("global")];
  }

  const actions: Command[] = [
    { id: "a-shots", group: "Go to", icon: "view-grid-outline", title: "Shots", keys: "G S", run: () => void navigate({ page: "shots", viewId: null }) },
    { id: "a-plan", group: "Go to", icon: "calendar-clock", title: "Plan", keys: "G P", run: () => void navigate({ page: "plan", dayId: null }) },
    { id: "a-timeline", group: "Go to", icon: "filmstrip", title: "Timeline", keys: "G T", run: () => void navigate({ page: "timeline", timelineId: null }) },
    { id: "a-map", group: "Go to", icon: "map-outline", title: "Map", keys: "G M", run: () => { setLayout("map"); void navigate({ page: "shots", viewId }); } },
    { id: "a-lib", group: "Go to", icon: "bookshelf", title: "Library: projects, fields, rigs, locations", keys: "G L", run: () => void navigate({ page: "library", section: "projects", id: null }) },
    { id: "a-mode", group: "Actions", icon: "vector-rectangle", title: "Change frame mode", sub: `Now ${mask === "off" ? "raw" : mask}`, keys: "M", run: () => setMask(nextMode(mask)) },
    { id: "a-newshot", group: "Actions", icon: "image-plus", title: "New shot", sub: "Upload images or draw a sketch", keys: "⇧N", run: () => { void navigate({ page: "shots", viewId }).then(() => setNewShot(true)); } },
    { id: "a-day", group: "Actions", icon: "calendar-plus", title: "New shooting day", sub: "In Plan", keys: "⇧N", run: () => void navigate({ page: "plan", dayId: null }) },
    { id: "a-rig", group: "Actions", icon: "camera-plus-outline", title: "New rig", sub: "Library › Rigs", run: () => navigateRaw({ page: "library", section: "rigs", id: null }) },
    { id: "a-theme", group: "Actions", icon: "theme-light-dark", title: "Toggle theme", sub: `Now ${theme === "auto" ? "Auto" : theme === "sun" ? "Sun" : "Set"}`, run: () => setTheme(theme === "set" ? "sun" : "set") },
    { id: "a-settings", group: "Go to", icon: "cog-outline", title: "Settings", sub: "Theme, frame mode, new shots", run: () => void navigate({ page: "settings", tab: "general" }) },
    { id: "a-reload", group: "Actions", icon: "refresh", title: "Reload data", run: reload },
    { id: "a-side", group: "Actions", icon: rail ? "chevron-double-right" : "chevron-double-left", title: rail ? "Expand the sidebar" : "Collapse the sidebar", keys: "Ctrl B", run: toggleSidebar },
    { id: "a-keys", group: "Actions", icon: "keyboard-outline", title: "Keyboard shortcuts", keys: "?", run: () => setSheet(true) },
  ];

  return (
    <div class={cx("f-app", rail && "f-app--rail")}>
      <Sidebar route={route} rail={rail} onToggle={toggleSidebar} scope={scope ?? ""} projects={projects ?? []} views={projectViews} editedViewId={edited ? loadedView?.id ?? null : null}
        counts={{ shots: scoped.length, projects: projects?.length ?? 0, fields: projectFields.length, rigs: presets?.length ?? 0, locations: projectLocations.length }}
        theme={theme} onTheme={setTheme} onScope={setScope} onNavigate={(r) => void navigate(r)} onNewView={() => void newView()} onPalette={openPalette} onReload={reload} loadedAt={loadedAt} />
      <main class="f-app__main">{main}</main>
      <div class="f-hints">
        {hints.map((h) => <span key={h.k + h.t} class="f-hint"><Kbd>{h.k}</Kbd>{h.t}</span>)}
        <span class="f-hints__sp" />
        {error && loaded && <span class="f-hint" style={{ color: "var(--danger)" }}>Last reload failed</span>}
        <span class="f-hint"><Kbd>?</Kbd>All shortcuts</span>
      </div>
      {palette && <CommandPalette shots={scoped} locations={projectLocations} views={projectViews} projects={projects ?? []} days={paletteDays} actions={actions} onClose={() => setPalette(false)}
        onOpenShot={(s) => openShot(s, [s])} onLocation={(l) => showLocationShots(l.id, "grid")} onView={(v) => void navigate({ page: "shots", viewId: v.id })}
        onProject={(p) => setScope(p.id)} onDay={(d) => navigateRaw({ page: "plan", dayId: d.id })} />}
      {sheet && <ShortcutSheet onClose={() => setSheet(false)} />}
      {newShot && scope && <NewShotDialog projectId={scope} locations={projectLocations} onLocations={setProjectLocations} onClose={() => setNewShot(false)}
        onCreated={(created) => { setShots((cur) => [...created, ...(cur ?? [])]); refreshCounts(); setNewShot(false); const first = created[0]; if (first) openShot(first, created.length > 1 ? created : undefined); }} />}
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
