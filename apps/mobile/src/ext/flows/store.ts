import { randomUUID } from "expo-crypto";
import { FLOW, flowBodyOf, flowError, type FlowBody } from "@openclapper/ext-flows";
import { ApiError, canCall, getFile, isRejection, listFiles, putFile, putLockedFile, type FileRec } from "../../api";
import { log } from "../../log";
import { persisted } from "../../store";
import { onSync } from "../../sync";
import { toast } from "../../ui";

/**
 * The project's flows on this device (docs/features/flows.md, "On the device"; #426): kept here so a flow opens,
 * changes and plays without a connection, as on set. An edit is saved here first and sent when the server answers:
 * under the edit lock while the editor holds it, else as a save of the version it started from. When the server's
 * flow changed meanwhile (the Studio edited it), or it is gone, the edit is saved as a copy beside it: nothing made
 * on the device is lost, nothing made elsewhere is overwritten.
 */
export interface LocalFlow { id: string; projectId: string; name: string; body: FlowBody; /** The server's version; null: not on the server yet. */ updatedAt: string | null; /** The body's version (FLOW.version); absent: 1, kept before #426's stages. */ v?: number }
interface Pending { id: string; projectId: string; name: string; body: FlowBody; /** As LocalFlow's. */ v?: number; /** The server version the edit started from; null: new here. */ base: string | null; rev: number; holder?: string; error?: string }

const isList = (v: unknown) => Array.isArray(v);
const isMap = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
const kept = persisted<LocalFlow[]>("flows.v1", [], isList);
const pending = persisted<Record<string, Pending>>("flowEdits.v1", {}, isMap);
let rev = 0;

// Flows kept here at an older body version (before #426's stages) are brought up to date once, as the server
// upgrades a stored body: an unsent edit then still saves.
const stale = (x: { v?: number }) => (x.v ?? 1) < FLOW.version;
const upgraded = <T extends { body: FlowBody; v?: number }>(x: T): T => (stale(x) ? { ...x, body: flowBodyOf(x.body, x.v ?? 1), v: FLOW.version } : x);
if (kept.get().some(stale)) kept.set((all) => all.map(upgraded));
if (Object.values(pending.get()).some(stale)) pending.set((all) => Object.fromEntries(Object.entries(all).map(([k, p]) => [k, upgraded(p)])));

const fromFile = (f: FileRec, projectId: string): LocalFlow => ({ id: f.id, projectId, name: f.name, body: flowBodyOf(f.body, f.body_version), updatedAt: f.updated_at, v: FLOW.version });
const upsert = (list: LocalFlow[], f: LocalFlow) => [...list.filter((x) => x.id !== f.id), f];

/** The server's flows of a project, kept for offline use (the device's unsent edits stay on top of them). */
export async function loadFlows(projectId: string): Promise<void> {
  if (!canCall()) return;
  try {
    const files = await listFiles({ project_id: projectId }, { type: "flow", body: true });
    kept.set((all) => [...all.filter((x) => x.projectId !== projectId), ...files.map((f) => fromFile(f, projectId))]);
  } catch (e) { log("info", "flows not loaded", { error: e }); }
}

/** A project's flows as this device has them: its own edits over the server's copies, by name. */
export function useFlows(projectId: string | undefined): LocalFlow[] {
  const all = kept.use(), edits = pending.use();
  if (!projectId) return [];
  const mine = all.filter((x) => x.projectId === projectId).map((x) => (edits[x.id] ? { ...x, name: edits[x.id].name, body: edits[x.id].body } : x));
  const fresh = Object.values(edits).filter((p) => p.projectId === projectId && !all.some((x) => x.id === p.id)).map((p): LocalFlow => ({ id: p.id, projectId, name: p.name, body: p.body, updatedAt: null }));
  return [...mine, ...fresh].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
export const hasUnsent = (id: string) => !!pending.get()[id];
export const usePendingOf = (id: string): Pending | undefined => pending.use()[id];

/** A change to a flow, kept here at once and sent soon; `holder`: the editor holds the edit lock. */
export function saveFlow(f: { id: string; projectId: string; name: string; body: FlowBody }, holder?: string) {
  const was = pending.get()[f.id];
  const base = was ? was.base : kept.get().find((x) => x.id === f.id)?.updatedAt ?? null;
  pending.set((all) => ({ ...all, [f.id]: { ...f, v: FLOW.version, base, rev: ++rev, holder } }));
  schedule();
}

/** A new flow, made here (also offline); it goes to the server with the next send. */
export function newFlow(projectId: string, count: number): string {
  const id = randomUUID();
  saveFlow({ id, projectId, name: `Flow ${count + 1}`, body: flowBodyOf({}) });
  return id;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void flushFlows(); }, 800); }

let flushing: Promise<void> | null = null;
/** Sends what waits, one flow at a time. A network error stops the run until the next sync. */
export function flushFlows(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const p of Object.values(pending.get())) {
      if (!canCall()) return;
      if (p.error) continue; // refused before and not edited since: shown, not retried in a loop
      const bad = flowError(p.body as unknown as Record<string, unknown>);
      if (bad) { pending.set((all) => (all[p.id]?.rev === p.rev ? { ...all, [p.id]: { ...p, error: bad } } : all)); continue; }
      try {
        let server: FileRec | null = null;
        if (p.base !== null) { try { server = await getFile(p.id); } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; } }
        const changedElsewhere = p.base !== null && (!server || server.deleted_at !== null || server.updated_at !== p.base);
        const body = p.body as unknown as Record<string, unknown>;
        if (changedElsewhere) {
          // Edited in the Studio meanwhile, or deleted: this device's version goes beside it, as a copy.
          const copy = randomUUID(), name = `${p.name} (from this device)`.slice(0, 120);
          const f = await putFile(copy, { type: "flow", project_id: p.projectId, name, body });
          kept.set((all) => upsert(all, fromFile(f, p.projectId)));
          toast(`“${p.name}” changed elsewhere while this device was editing: saved as “${name}”`, "neutral");
        } else {
          const req = { type: "flow", project_id: p.projectId, name: p.name, body };
          const f = p.holder ? await putLockedFile(p.id, p.holder, req) : await putFile(p.id, req);
          kept.set((all) => upsert(all, fromFile(f, p.projectId)));
          // Edited again while it was on its way: that edit now starts from the version just saved.
          if (pending.get()[p.id]?.rev !== p.rev) { pending.set((all) => (all[p.id] ? { ...all, [p.id]: { ...all[p.id], base: f.updated_at } } : all)); continue; }
        }
        pending.set((all) => { if (all[p.id]?.rev !== p.rev) return all; const { [p.id]: _sent, ...rest } = all; void _sent; return rest; });
      } catch (e) {
        if (e instanceof ApiError && e.status === 423) { log("info", "flow held by someone else; kept here", { flow: p.id }); continue; }
        if (!isRejection(e)) { log("info", "flows not sent", { error: e }); return; }
        log("warn", "flow refused", { flow: p.id, error: e });
        pending.set((all) => (all[p.id]?.rev === p.rev ? { ...all, [p.id]: { ...p, error: (e as Error).message } } : all));
        toast(`“${p.name}” could not be saved: ${(e as Error).message}. It stays on this device.`, "danger");
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
onSync(flushFlows);
