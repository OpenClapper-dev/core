import { useEffect, useMemo, useState } from "preact/hooks";
import { deleteView, putView, type SavedView, type Shot } from "../api";
import { binned } from "./trashOps";
import * as data from "../data";
import { useMask } from "../frameMode";
import { useProjectId } from "../project";
import { parseRoute } from "../router";
import { ShotsPage } from "../ShotsPage";
import { decodeView, emptyQuery, encodeView, runQuery, type Layout, type ShotsQuery } from "../shotsQuery";
import { confirmDialog, promptDialog, toast } from "../ui";
import { openOverlay } from "../wm/overlays";
import type { AppProps } from "./registry";
import { useAppGuard } from "./useAppGuard";

/** What a launch may ask of the Gallery (a deep link, the palette, another app). */
export interface GalleryLaunch {
  viewId?: string | null;
  layout?: Layout;
  /** Show this location's shots (Library › Locations, ⌘K). */
  locationId?: string;
  /** Show this shot on the map (Show on map in a shot window). */
  showShot?: string;
}

function readStorage(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
const loadLayout = (): Layout => { const v = readStorage("layout"); return v === "list" || v === "map" ? v : "grid"; };
const sameFilter = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Gallery (#/shots): the project's shots in a grid, list or map with filters and saved views
 * (ShotsPage). Owns what App.tsx used to lift for it; edits to a saved view are guarded against
 * switching view, closing the window and switching project.
 */
export function GalleryApp({ win, setTitle, replaceRoute, open }: AppProps) {
  const projectId = useProjectId()!;
  const pd = data.useProjectData(projectId);
  const [mask, setMask] = useMask();
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const [query, setQuery] = useState<ShotsQuery>(emptyQuery);
  const [viewId, setViewId] = useState<string | null>(() => {
    const st = win.state as GalleryLaunch | undefined;
    if (st && "viewId" in st) return st.viewId ?? null;
    const r = win.route ? parseRoute(win.route) : null;
    return r?.page === "shots" ? r.viewId : null;
  });
  const [loadedView, setLoadedView] = useState<SavedView | null>(null);
  const [panel, setPanel] = useState(false);
  const [mapSelected, setMapSelected] = useState<string | null>(null);
  const setLayout = (l: Layout) => { setLayoutState(l); try { localStorage.setItem("layout", l); } catch { /* a preference */ } };

  // The route's view loads into the query; edits mark it "Edited" until saved or reverted.
  useEffect(() => {
    if (!viewId) { if (loadedView) { setLoadedView(null); setQuery(emptyQuery()); } return; }
    if (loadedView?.id === viewId) return;
    const v = pd.views.find((x) => x.id === viewId);
    if (!v) return;
    setLoadedView(v);
    setQuery({ ...emptyQuery(), ...decodeView(v.filter), sort: query.sort });
  }, [viewId, pd.views]);
  const edited = !!loadedView && !sameFilter(encodeView(query), loadedView.filter);
  useEffect(() => { replaceRoute({ page: "shots", viewId }); }, [viewId]);
  useEffect(() => { setTitle(loadedView ? `Gallery · ${loadedView.name}` : "Gallery"); }, [loadedView?.name]);

  const confirmDiscard = async () => !loadedView || (await confirmDialog({ title: `Discard changes to “${loadedView.name}”?`, body: "The view keeps its saved filter.", confirmLabel: "Discard", cancelLabel: "Keep editing" })) === true;
  useAppGuard(win.id, edited, confirmDiscard);

  /** Switch to a view (null = all shots), asking before dropping unsaved edits. */
  async function pickView(id: string | null) {
    if (id === viewId && loadedView?.id === id) return;
    if (edited && !(await confirmDiscard())) return;
    setLoadedView(null);
    if (!id) setQuery({ ...emptyQuery(), sort: query.sort });
    setViewId(id);
  }

  const result = useMemo(() => runQuery(pd.scoped, query, pd.extra), [pd.scoped, query, pd.extra]);
  function showOnMap(shotId: string) {
    const visible = result.shots.some((x) => x.id === shotId);
    if (!visible) { setLoadedView(null); setViewId(null); setQuery({ ...emptyQuery(), sort: query.sort }); }
    setLayout("map");
    setMapSelected(shotId);
  }
  const showLocationShots = (locationId: string, l: Layout) => {
    setLoadedView(null);
    setViewId(null);
    setQuery({ ...emptyQuery(), filter: { match: "all", rules: [{ field: "location_id", op: "is", value: locationId }] } });
    setLayout(l);
  };

  // A launch (deep link, ⌘K, another app) carries what to show: on opening, and again whenever
  // it re-targets this open window (stateSeq; the initial view is already in useState above).
  useEffect(() => {
    const st = win.state as GalleryLaunch | undefined;
    if (!st) return;
    if (win.stateSeq && "viewId" in st) void pickView(st.viewId ?? null);
    if (st.layout) setLayout(st.layout);
    if (st.locationId) showLocationShots(st.locationId, st.layout ?? "grid");
    if (st.showShot) showOnMap(st.showShot);
  }, [win.stateSeq]);

  async function saveView() {
    if (!loadedView) return;
    // The name as stored now: Files may have renamed the view since it was loaded.
    const name = pd.views.find((x) => x.id === loadedView.id)?.name ?? loadedView.name;
    try { const v = await putView({ id: loadedView.id, project_id: loadedView.project_id, name, filter: encodeView(query) }); data.setViews((cur) => (cur ?? []).map((x) => (x.id === v.id ? v : x))); setLoadedView(v); toast("View saved"); } catch (e) { toast(`Saving failed: ${(e as Error).message}`, "danger"); }
  }
  async function saveAsNew() {
    const name = await promptDialog({ title: loadedView ? "Save as a new view" : "Save view", input: { label: "Name", value: loadedView ? `${loadedView.name} (copy)` : "", placeholder: "e.g. Dusk exteriors" }, confirmLabel: "Save view" });
    if (!name) return;
    try {
      const v = await putView({ id: crypto.randomUUID(), project_id: projectId, name, filter: encodeView(query) });
      data.setViews((cur) => [...(cur ?? []), v].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
      setLoadedView(v);
      setViewId(v.id);
      toast("View saved");
    } catch (e) { toast(`Saving failed: ${(e as Error).message}`, "danger"); }
  }
  async function viewMenu(action: "rename" | "delete") {
    const v = loadedView;
    if (!v) return;
    if (action === "rename") {
      const name = await promptDialog({ title: "Rename view", input: { label: "Name", value: v.name }, confirmLabel: "Rename" });
      if (!name || name === v.name) return;
      try { const saved = await putView({ id: v.id, project_id: v.project_id, name, filter: v.filter }); data.setViews((cur) => (cur ?? []).map((x) => (x.id === saved.id ? saved : x))); setLoadedView({ ...saved, filter: v.filter }); } catch (e) { toast(`Rename failed: ${(e as Error).message}`, "danger"); }
      return;
    }
    try { await deleteView(v.id); data.setViews((cur) => (cur ?? []).filter((x) => x.id !== v.id)); setLoadedView(null); setViewId(null); setQuery(emptyQuery()); binned([{ type: "view", id: v.id }], v.project_id ?? projectId, `The view “${v.name}”`); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  const newView = async () => { await pickView(null); setPanel(true); };

  const openShot = (s: Shot, list: Shot[]) => {
    const line = [query.state === "all" ? "All states" : query.state[0].toUpperCase() + query.state.slice(1), loadedView?.name ?? pd.project?.name ?? "", { newest: "newest first", oldest: "oldest first", name: "by name" }[query.sort]].join(" · ");
    open({ app: "shot", resource: { type: "shot", id: s.id }, state: { stage: "photo", list: list.map((x) => x.id), line, from: win.id } });
  };

  const ctx = { projects: pd.data.projects ?? [], locations: pd.locations, spots: pd.spots, presets: pd.data.presets ?? [], extra: pd.extra };
  return (
    <ShotsPage shots={pd.scoped} error={pd.data.error} scopeName={pd.project?.name ?? ""} query={query} onQuery={setQuery} view={loadedView} edited={edited}
      onSaveView={() => void saveView()} onSaveAsNew={() => void saveAsNew()} onRevert={() => loadedView && setQuery({ ...query, ...decodeView(loadedView.filter) })} onViewMenu={(a) => void viewMenu(a)}
      panel={panel} onPanel={setPanel} layout={layout} onLayout={setLayout} mask={mask} onMask={setMask} ctx={ctx} onOpen={openShot}
      mapSelected={mapSelected} onMapSelected={setMapSelected} onDeleted={data.deleted} onUpdated={data.updated} onLocations={data.setLocationsOf(projectId)} fieldsOf={data.fieldsOf}
      onReload={() => void data.load()} onSwitchScope={() => openOverlay("palette")} onNewShot={() => openOverlay("newShot")}
      views={pd.views} onPickView={(id) => void pickView(id)} onNewView={() => void newView()} />
  );
}
