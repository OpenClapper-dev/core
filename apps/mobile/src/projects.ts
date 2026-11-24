import { randomUUID } from "expo-crypto";
import { ApiError, canCall, listProjects, putProject } from "./api";
import { log } from "./log";
import { persisted } from "./store";

/**
 * The projects this phone knows, and the one it works in. A project made on the phone works at once,
 * also offline or without an account; it is created on the server at the next sync. When the name is
 * taken there, the phone takes the existing project instead and tells its listeners (the upload queue
 * repoints its photos).
 */
/** `extensions`: those the project has switched on (docs/rewrite/08-extensions.md), as last read from the server. */
export interface ProjectEntry { id: string; name: string; synced: boolean; extensions?: string[] }

export const projects = persisted<ProjectEntry[]>("projects.v2", [], Array.isArray);
export const activeProject = persisted<string | null>("activeProject.v2", null);

export const currentProject = (): ProjectEntry | null => projects.get().find((p) => p.id === activeProject.get()) ?? null;
export function useProject(): ProjectEntry | null {
  const list = projects.use();
  const id = activeProject.use();
  return list.find((p) => p.id === id) ?? null;
}

/** The extensions the active project has on; none without a project. */
export function useExtensionsOn(): readonly string[] {
  return useProject()?.extensions ?? NONE;
}
const NONE: readonly string[] = [];

const remapListeners = new Set<(from: string, to: string) => void>();
/** Called when a project made on the phone turned out to exist on the server under another id. */
export function onProjectRemap(cb: (from: string, to: string) => void): () => void {
  remapListeners.add(cb);
  return () => { remapListeners.delete(cb); };
}

/** A new project, made the active one. */
export function createProject(name: string): ProjectEntry {
  const p: ProjectEntry = { id: randomUUID(), name: name.trim() || "New project", synced: false };
  projects.set((l) => [...l, p]);
  activeProject.set(p.id);
  void syncProjects();
  return p;
}

let running: Promise<void> | null = null;

/** Creates what was made on the phone, then takes the server's list (keeping what is still to be created). */
export function syncProjects(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!canCall()) return;
    try {
      for (const p of projects.get().filter((x) => !x.synced)) {
        try {
          await putProject(p.id, p.name);
        } catch (e) {
          const existing = e instanceof ApiError && e.status === 409 ? (e.body as { existing_id?: string } | null)?.existing_id : undefined;
          if (!existing) throw e;
          log("info", "project name taken, using the existing one", { from: p.id, to: existing });
          projects.set((l) => l.filter((x) => x.id !== p.id));
          if (activeProject.get() === p.id) activeProject.set(existing);
          for (const cb of remapListeners) cb(p.id, existing);
        }
        projects.set((l) => l.map((x) => (x.id === p.id ? { ...x, synced: true } : x)));
      }
      const server = await listProjects();
      projects.set((l) => [...server.map((s) => ({ id: s.id, name: s.name, synced: true, extensions: s.extensions ?? [] })), ...l.filter((x) => !x.synced && !server.some((s) => s.id === x.id))]
        .sort((a, b) => a.name.localeCompare(b.name)));
      // The active project was deleted on the server: none is active, the apps that need one ask.
      const active = activeProject.get();
      if (active && !projects.get().some((p) => p.id === active)) activeProject.set(null);
    } catch (e) { log("warn", "project sync failed", e); }
  })().finally(() => { running = null; });
  return running;
}
