import { useEffect, useState } from "preact/hooks";
import { switchExtension } from "@openclapper/model";
import { deleteProject, fetchProjects, putProject, type Project, deleteProjectPicture, putProjectPicture } from "./api";

/**
 * The projects the signed-in person can reach: one list for the picker, the taskbar's switcher and
 * the Project app, so a rename in one shows in all.
 */
export interface ProjectsState { list: Project[] | null; error: string | null }

let state: ProjectsState = { list: null, error: null };
const listeners = new Set<(s: ProjectsState) => void>();
function put(s: ProjectsState) { state = s; for (const cb of listeners) cb(s); }

export const getProjects = () => state.list ?? [];

export async function loadProjects(): Promise<void> {
  try { put({ list: await fetchProjects(), error: null }); } catch (e) { put({ list: state.list, error: (e as Error).message }); }
}
/** Forget the list (another account signed in). */
export const clearProjects = () => put({ list: null, error: null });

const byName = (a: Project, b: Project) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Make or rename a project. A name taken in the workspace is the server's 409, passed on as it is. */
export async function saveProject(id: string, name: string, workspaceId?: string): Promise<Project> {
  const p = await putProject(id, workspaceId ? { name, workspace_id: workspaceId } : { name });
  put({ list: [...getProjects().filter((x) => x.id !== p.id), p].sort(byName), error: null });
  return p;
}

/** How watchers of the project's canvases see them change. */
export async function setCanvasLive(p: Project, live: Project["canvas_live"]): Promise<void> {
  const next = await putProject(p.id, { name: p.name, canvas_live: live });
  put({ list: [...getProjects().filter((x) => x.id !== next.id), next].sort(byName), error: null });
}

/** The master timeline: the order of the project's timelines. Shown at once; the server's answer replaces it. */
export async function setMaster(p: Project, master: string[]): Promise<void> {
  put({ list: (getProjects() ?? []).map((x) => (x.id === p.id ? { ...x, master } : x)), error: null });
  const next = await putProject(p.id, { name: p.name, master });
  put({ list: [...getProjects().filter((x) => x.id !== next.id), next].sort(byName), error: null });
}

/** Switches an extension on or off for the project, with what it needs or what needs it (docs/rewrite/08-extensions.md). */
export async function setExtension(p: Project, id: string, on: boolean): Promise<void> {
  const next = await putProject(p.id, { name: p.name, extensions: switchExtension(p.extensions ?? [], id, on) });
  put({ list: [...getProjects().filter((x) => x.id !== next.id), next].sort(byName), error: null });
}

/** What the project is about (#426). */
export async function setDescription(p: Project, description: string): Promise<void> {
  const next = await putProject(p.id, { name: p.name, description });
  put({ list: [...getProjects().filter((x) => x.id !== next.id), next].sort(byName), error: null });
}

/**
 * The project's picture (#426): scaled down in the browser to fit 2000 × 2000 (the server takes at most 4 MP and
 * 5 MB), as a JPEG; null removes it.
 */
export async function setPicture(p: Project, file: File | null): Promise<void> {
  let next: Project;
  if (!file) next = await deleteProjectPicture(p.id);
  else {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    next = await putProjectPicture(p.id, await c.convertToBlob({ type: "image/jpeg", quality: 0.88 }));
  }
  put({ list: [...getProjects().filter((x) => x.id !== next.id), next].sort(byName), error: null });
}

export async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  put({ list: getProjects().filter((x) => x.id !== id), error: null });
}

export function useProjects(): ProjectsState {
  const [s, set] = useState(state);
  useEffect(() => { listeners.add(set); set(state); return () => { listeners.delete(set); }; }, []);
  return s;
}
