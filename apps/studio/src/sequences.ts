import { useEffect, useState } from "preact/hooks";
import type { LightSequence } from "@openclapper/vocab";
import { toast } from "@openclapper/ui";
import { deleteLightSequence, fetchLightSequences, putLightSequence } from "./api";

/**
 * Light sequences (#304), stored on the server per project. Edits land here at once (the editor
 * stays instant, also while dragging) and go to the server a moment later, one save per sequence.
 */
const SAVE_AFTER_MS = 400;
const listeners = new Set<() => void>();
let cache: LightSequence[] = [];
let project: string | null = null;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

const changed = () => { for (const cb of listeners) cb(); };
export const getSequences = () => cache;

async function load(projectId: string) {
  try {
    const list = await fetchLightSequences(projectId);
    if (project !== projectId) return;
    // Sequences still waiting to be saved keep their local version.
    const local = (id: string) => (pending.has(id) ? cache.find((c) => c.id === id) : undefined);
    cache = [...list.map((s) => local(s.id) ?? s), ...cache.filter((c) => pending.has(c.id) && !list.some((s) => s.id === c.id))];
    changed();
    await moveBrowserSequences(projectId);
  } catch (e) {
    toast(`Sequences not loaded: ${(e as Error).message}`, "danger");
  }
}

/**
 * One-time move (2026-11-08): sequences made while they lived in the browser go to the project open
 * when this first runs, then leave the browser. Delete once the owner's browsers have moved theirs.
 */
async function moveBrowserSequences(projectId: string) {
  let local: LightSequence[] = [];
  try { local = JSON.parse(localStorage.getItem("openclapper.sequences.v2") ?? "[]") as LightSequence[]; } catch { return; }
  if (!Array.isArray(local) || local.length === 0) return;
  for (const s of local) {
    if (cache.some((c) => c.id === s.id)) continue;
    try { cache = [...cache, await putLightSequence(projectId, s)]; } catch (e) { toast(`“${s.name}” not moved to the server: ${(e as Error).message}`, "danger"); return; }
  }
  try { localStorage.removeItem("openclapper.sequences.v2"); } catch { /* stays; moved ones are skipped next time */ }
  toast(`${local.length} sequence${local.length === 1 ? "" : "s"} moved from this browser to the project`);
  changed();
}

/**
 * Saves a sequence now, waiting for the server (#321): before the phone runs it, so it fetches
 * exactly what the editor shows. Returns the server's revision (updated_at).
 */
export async function flushSequence(id: string): Promise<string> {
  clearTimeout(pending.get(id));
  pending.delete(id);
  const latest = cache.find((x) => x.id === id);
  if (!latest || !project) throw new Error("the sequence is not loaded");
  const saved = await putLightSequence(project, latest);
  cache = cache.map((x) => (x.id === id ? saved : x));
  changed();
  return saved.updatedAt;
}

/** Saves `s` (debounced); the editor sees the change at once, a failed save shows a toast. */
export function upsertSequence(s: LightSequence) {
  const stamped = { ...s, updatedAt: new Date().toISOString() };
  cache = cache.some((x) => x.id === s.id) ? cache.map((x) => (x.id === s.id ? stamped : x)) : [...cache, stamped];
  changed();
  const projectId = project;
  if (!projectId) return;
  clearTimeout(pending.get(s.id));
  pending.set(s.id, setTimeout(() => {
    const latest = cache.find((x) => x.id === s.id);
    if (!latest) { pending.delete(s.id); return; }
    putLightSequence(projectId, latest)
      .catch((e) => toast(`“${latest.name}” not saved: ${(e as Error).message}`, "danger"))
      .finally(() => pending.delete(s.id));
  }, SAVE_AFTER_MS));
}

export function deleteSequence(id: string) {
  clearTimeout(pending.get(id));
  pending.delete(id);
  cache = cache.filter((x) => x.id !== id);
  changed();
  deleteLightSequence(id).catch((e) => toast(`Not deleted on the server: ${(e as Error).message}`, "danger"));
}

/** The active project's sequences; loads them when the project changes. */
export function useSequences(projectId: string | null): LightSequence[] {
  const [v, setV] = useState(cache);
  useEffect(() => { const cb = () => setV(cache); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  useEffect(() => {
    if (!projectId || projectId === project) return;
    project = projectId;
    cache = [];
    changed();
    void load(projectId);
  }, [projectId]);
  return v;
}
