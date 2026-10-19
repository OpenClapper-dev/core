import { useEffect, useMemo, useState } from "preact/hooks";
import { extraFilterFields, type FieldDef } from "@fielder/vocab";
import { fetchAllShots, fetchFields, fetchFiles, fetchTrash, type FilesPayload, type TrashEntry, type TrashType, fetchLocations, fetchPresets, fetchProjects, fetchSpots, fetchViews, onProjectCreated, type FieldDefinition, type Location, type Preset, type Project, type SavedView, type Shot, type Spot } from "./api";
import { getProjectId, onProjectChange } from "./project";
import { toast } from "@fielder/ui";

/**
 * The dashboard's data cache (epic #72), moved out of App.tsx into a module store (settings.ts
 * idiom) so every window reads one copy: an edit in one window shows in all of them. Collections
 * are loaded whole, as before; null until the first load.
 */
export interface DataState {
  shots: Shot[] | null;
  projects: Project[] | null;
  presets: Preset[] | null;
  locations: Location[] | null;
  views: SavedView[] | null;
  spots: Spot[] | null;
  fields: FieldDefinition[] | null;
  error: string | null;
  loadedAt: Date | null;
  /** The active project's folders, placements and desktop shortcuts (epic #72); per project, not gating the first render. */
  files: (FilesPayload & { projectId: string }) | null;
  /** The active project's recycle bin (epic #90): what the Trash app lists and the bin icon shows full or empty. */
  trash: { projectId: string; entries: TrashEntry[] } | null;
}

const EMPTY: DataState = { shots: null, projects: null, presets: null, locations: null, views: null, spots: null, fields: null, error: null, loadedAt: null, files: null, trash: null };
let state: DataState = EMPTY;
const listeners = new Set<(s: DataState) => void>();
function put(p: Partial<DataState>) {
  state = { ...state, ...p };
  for (const cb of listeners) cb(state);
}
export const getData = () => state;

/** A collection setter with useState's shape: a list, or an updater of the current one. */
type Upd<T> = T[] | ((cur: T[] | null) => T[]);
const setter = <K extends "shots" | "projects" | "presets" | "locations" | "views" | "spots" | "fields">(k: K) =>
  (v: Upd<NonNullable<DataState[K]>[number]>) => put({ [k]: typeof v === "function" ? v(state[k] as never) : v } as Partial<DataState>);
export const setShots = setter("shots");
export const setProjects = setter("projects");
export const setPresets = setter("presets");
export const setLocations = setter("locations");
export const setViews = setter("views");
export const setSpots = setter("spots");
export const setFields = setter("fields");

export const loaded = (s: DataState = state) => !!s.shots && !!s.projects && !!s.presets && !!s.locations && !!s.spots && !!s.views && !!s.fields;

/** (Re)load one project's files; a failure leaves the last copy (the desktop keeps working without icons). */
export function loadFiles(projectId: string): Promise<void> {
  return fetchFiles(projectId).then((f) => { if (getProjectId() === projectId) put({ files: { ...f, projectId } }); }).catch(() => {});
}
/** (Re)load one project's recycle bin; a failure leaves the last copy. */
export function loadTrash(projectId: string): Promise<void> {
  return fetchTrash(projectId).then((entries) => { if (getProjectId() === projectId) put({ trash: { projectId, entries } }); }).catch(() => {});
}

/**
 * Something went to the recycle bin or came back from it. Windows that keep their own copy of a
 * list (Timeline, Plan) follow these instead of the store: drop a binned item, take a restored one.
 */
export interface TrashEvent { kind: "binned" | "restored"; type: TrashType; id: string; projectId: string }
const trashListeners = new Set<(e: TrashEvent) => void>();
export function onTrash(cb: (e: TrashEvent) => void): () => void { trashListeners.add(cb); return () => { trashListeners.delete(cb); }; }
export function emitTrash(e: TrashEvent) { for (const cb of trashListeners) cb(e); }

/** Update the loaded files in place after a mutation (same shape as the setters above). */
export function setFiles(update: (cur: FilesPayload) => FilesPayload) {
  if (state.files) put({ files: { ...update(state.files), projectId: state.files.projectId } });
}

export function load(): Promise<void> {
  const pid = getProjectId();
  if (pid) { void loadFiles(pid); void loadTrash(pid); }
  return Promise.all([fetchAllShots().then(setShots), fetchProjects().then(setProjects), fetchPresets().then(setPresets), fetchLocations().then(setLocations), fetchSpots().then(setSpots), fetchViews().then(setViews), fetchFields().then(setFields)])
    .then(() => put({ error: null, loadedAt: new Date() }))
    .catch((e: Error) => put({ error: e.message }));
}
export const reload = () => { void load().then(() => toast("Reloaded", "info")); };
/** Forget everything loaded (another user signs in): the shell shows Loading until load() is back. */
export const clear = () => put(EMPTY);
/** Counts (shots per location, spot, project) follow an edit elsewhere. */
export function refreshCounts() {
  void fetchLocations().then(setLocations).catch(() => {});
  void fetchSpots().then(setSpots).catch(() => {});
  void fetchProjects().then(setProjects).catch(() => {});
}
export function updated(s: Shot | Shot[]) {
  const m = new Map((Array.isArray(s) ? s : [s]).map((x) => [x.id, x]));
  setShots((cur) => (cur ?? []).map((x) => m.get(x.id) ?? x));
  refreshCounts();
}
export function deleted(ids: string[]) {
  const gone = new Set(ids);
  setShots((cur) => (cur ?? []).filter((x) => !gone.has(x.id)));
  refreshCounts();
}
export function created(list: Shot[]) {
  setShots((cur) => [...list, ...(cur ?? [])]);
  refreshCounts();
}

// The desktop's files follow the active project.
onProjectChange((id) => { put({ files: null, trash: null }); if (id) { void loadFiles(id); void loadTrash(id); } });

// A project created inline (move, bulk edit) joins the list at once; counts follow with the next refresh.
onProjectCreated((p) => setProjects((cur) => (cur ?? []).some((x) => x.id === p.id) ? cur ?? [] : [...(cur ?? []), p].sort((a, b) => a.name.localeCompare(b.name))));

export const fieldsOf = (projectId: string, s: DataState = state): FieldDef[] =>
  (s.fields ?? []).filter((f) => f.project_id === projectId).sort((a, b) => a.position - b.position).map((f) => f.definition);
export const locationsOf = (projectId: string, s: DataState = state) => (s.locations ?? []).filter((l) => l.project_id === projectId);
/** A page hands back one project's list (after a create, rename or delete): it replaces that project's rows. */
export const setLocationsOf = (projectId: string) => (list: Location[]) => {
  const ids = new Set(list.map((l) => l.id));
  setLocations((cur) => [...(cur ?? []).filter((l) => l.project_id !== projectId && !ids.has(l.id)), ...list]);
};
export const setFieldsOf = (projectId: string) => (list: FieldDefinition[]) => setFields((cur) => [...(cur ?? []).filter((f) => f.project_id !== projectId), ...list]);

/** The whole cache as state. */
export function useData(): DataState {
  const [s, setS] = useState(state);
  useEffect(() => { listeners.add(setS); setS(state); return () => { listeners.delete(setS); }; }, []);
  return s;
}

/** One project's slice of the cache, memoised: what most apps render. */
export function useProjectData(projectId: string | null) {
  const d = useData();
  const pid = projectId ?? "";
  const project = d.projects?.find((p) => p.id === pid) ?? null;
  const scoped = useMemo(() => (d.shots ?? []).filter((s) => s.project_id === pid), [d.shots, pid]);
  const locations = useMemo(() => locationsOf(pid, d), [d.locations, pid]);
  const views = useMemo(() => (d.views ?? []).filter((v) => v.project_id === pid), [d.views, pid]);
  const fields = useMemo(() => (d.fields ?? []).filter((f) => f.project_id === pid), [d.fields, pid]);
  const extra = useMemo(() => extraFilterFields(fieldsOf(pid, d)), [d.fields, pid]);
  const spots = useMemo(() => { const ids = new Set(locations.map((l) => l.id)); return (d.spots ?? []).filter((sp) => ids.has(sp.location_id)); }, [d.spots, locations]);
  return { data: d, project, scoped, locations, views, fields, extra, spots };
}
