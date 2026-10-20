import { useEffect, useState } from "preact/hooks";
import * as data from "../data";
import { FieldsPage } from "../Fields";
import { LocationsPage } from "../Locations";
import { getProjectId, switchProject, useProjectId } from "../project";
import { ProjectsPage } from "../Projects";
import { RigsPage } from "../Rigs";
import { parseRoute, type LibrarySection } from "../router";
import { fetchAllShots } from "../api";
import { toast } from "@openclapper/ui";
import { ViewfinderLayoutsPage } from "../ViewfinderLayouts";
import type { AppProps } from "./registry";

/** What a launch hands a library app: the item to select (#/library/<section>/<id>). */
export interface LibraryLaunch { id?: string | null }

/**
 * The selected item of a library app: from the launch, else the window's route; re-launches
 * select again, and the route follows the selection.
 */
function useSelection({ win, replaceRoute }: AppProps, section: LibrarySection): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => {
    const st = win.state as LibraryLaunch | undefined;
    if (st && "id" in st) return st.id ?? null;
    const r = win.route ? parseRoute(win.route) : null;
    return r?.page === "library" && r.section === section ? r.id : null;
  });
  useEffect(() => {
    const st = win.state as LibraryLaunch | undefined;
    if (win.stateSeq && st && "id" in st) setId(st.id ?? null);
  }, [win.stateSeq]);
  useEffect(() => { replaceRoute({ page: "library", section, id }); }, [id]);
  return [id, setId];
}

/** Projects: the list with counts and each project's details; Activate switches the desktop. */
export function ProjectsApp(p: AppProps) {
  const d = data.useData();
  const projectId = useProjectId()!;
  const [sel, setSel] = useSelection(p, "projects");
  /** Another project's things live on its own desktop: switch there first. */
  const inProject = async (id: string, go: () => void) => { if (id === getProjectId() || (await switchProject(id))) go(); };
  if (!d.projects || !d.fields) return null;
  return (
    <ProjectsPage projects={d.projects} onChange={data.setProjects} fields={d.fields} scope={projectId} selectedId={sel} onSelect={setSel}
      onActivate={(id) => void inProject(id, () => toast(`Now working on ${d.projects!.find((x) => x.id === id)?.name ?? "the project"}`))}
      onShowShots={(id) => void inProject(id, () => p.open({ app: "gallery", state: { viewId: null } }))}
      onEditFields={(id) => void inProject(id, () => p.open({ app: "fields", state: { id: null } }))} />
  );
}

/** Fields: the active project's extra fields, JSON editor and preview. */
export function FieldsApp(p: AppProps) {
  const projectId = useProjectId()!;
  const pd = data.useProjectData(projectId);
  const [sel, setSel] = useSelection(p, "fields");
  if (!pd.project) return null;
  return <FieldsPage project={pd.project} fields={pd.fields} onChange={data.setFieldsOf(projectId)} selectedId={sel} onSelect={setSel} />;
}

/** Rigs: shared by every project (presets), as before. */
export function RigsApp(p: AppProps) {
  const d = data.useData();
  const [sel, setSel] = useSelection(p, "rigs");
  if (!d.presets || !d.shots) return null;
  return <RigsPage presets={d.presets} shots={d.shots} onChange={data.setPresets} selectedId={sel} onSelect={setSel} />;
}

/** Locations: the active project's locations and spots; "show its shots" opens the Gallery filtered. */
export function LocationsApp(p: AppProps) {
  const projectId = useProjectId()!;
  const pd = data.useProjectData(projectId);
  // The page keeps its own focus; a launch's id moves it there.
  const [sel] = useSelection(p, "locations");
  return (
    <LocationsPage locations={pd.locations} shots={pd.scoped} onChange={data.setLocationsOf(projectId)} spots={pd.data.spots ?? []} onSpots={(update) => data.setSpots((cur) => update(cur ?? []))}
      onShotsChanged={() => void fetchAllShots().then(data.setShots).catch(() => {})}
      onShowShots={(locationId, layout) => p.open({ app: "gallery", state: { locationId, layout } })} focusId={sel} />
  );
}

/** Viewfinder layouts: global (not per project), as before. */
export function ViewfinderApp(p: AppProps) {
  const [sel, setSel] = useSelection(p, "viewfinder");
  return <ViewfinderLayoutsPage selectedId={sel} onSelect={setSel} />;
}
