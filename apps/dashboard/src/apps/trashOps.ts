import { emptyTrash, purgeTrash, restoreTrash, type TrashType } from "../api";
import * as data from "../data";
import { invalidateDays, invalidateTimelines, projectDays, projectTimelines } from "../Inspector";
import { confirmDialog, toast } from "../ui";

/**
 * The recycle bin from the dashboard's side (epic #90): every delete moves to the bin and says so
 * with Undo; restore and purge go through here so the store, the bin and open windows follow.
 */

export interface Binned { type: TrashType; id: string }

/** After a delete went to the bin: refresh the bin, tell windows with their own lists, offer Undo. */
export function binned(items: Binned[], projectId: string, what: string) {
  for (const it of items) data.emitTrash({ kind: "binned", ...it, projectId });
  void data.loadTrash(projectId);
  toast(`${what} moved to the recycle bin`, "ok", { label: "Undo", run: () => void restore(items, projectId) });
}

/** Everything a restore can bring back (a folder brings anything) is re-read. */
async function afterRestore(projectId: string, items: Binned[]) {
  invalidateTimelines(projectId);
  invalidateDays(projectId);
  await data.load();
  await data.loadTrash(projectId);
  for (const it of items) data.emitTrash({ kind: "restored", ...it, projectId });
}

/** Put entries back where they were; resolves how many came back. */
export async function restore(items: Binned[], projectId: string): Promise<number> {
  let ok = 0;
  const renamed: string[] = [];
  let failure: string | null = null;
  for (const it of items) {
    try { const r = await restoreTrash(it.type, it.id); ok++; if (r.name) renamed.push(r.name); } catch (e) { failure = (e as Error).message; }
  }
  if (ok) await afterRestore(projectId, items);
  if (failure) toast(`Restore failed: ${failure}`, "danger");
  else toast(ok === 1 ? "Restored" : `Restored ${ok} items`, "ok");
  return ok;
}

/** Delete entries for good, after one confirmation. */
export async function purge(items: Binned[], projectId: string): Promise<boolean> {
  if (!items.length) return false;
  const ok = await confirmDialog({ title: items.length === 1 ? "Delete permanently?" : `Delete ${items.length} items permanently?`, body: `${items.length === 1 ? "It is" : "They are"} removed from the server with ${items.length === 1 ? "its" : "their"} images and drawings. This cannot be undone.`, confirmLabel: "Delete permanently", danger: true });
  if (!ok) return false;
  let failure: string | null = null;
  for (const it of items) { try { await purgeTrash(it.type, it.id); } catch (e) { failure = (e as Error).message; } }
  await data.loadTrash(projectId);
  toast(failure ? `Delete failed: ${failure}` : "Deleted permanently", failure ? "danger" : "ok");
  return !failure;
}

/** Empty the project's bin, after one confirmation. */
export async function emptyBin(projectId: string): Promise<void> {
  const n = data.getData().trash?.entries.length ?? 0;
  if (!n) { toast("The recycle bin is empty", "info"); return; }
  const ok = await confirmDialog({ title: "Empty the recycle bin?", body: `${n} item${n === 1 ? "" : "s"} and everything in them are removed from the server for good. This cannot be undone.`, confirmLabel: "Empty the bin", danger: true });
  if (!ok) return;
  try { await emptyTrash(projectId); await data.loadTrash(projectId); toast("The recycle bin is empty"); } catch (e) { toast(`Emptying failed: ${(e as Error).message}`, "danger"); }
}

/**
 * Shots in the bin lose their clips on timelines and their places on shooting days, and a
 * restore does not bring those back: ask only when that is the case.
 */
export async function confirmShotBin(projectId: string, shotIds: string[]): Promise<boolean> {
  const ids = new Set(shotIds);
  const [timelines, days] = await Promise.all([projectTimelines(projectId).catch(() => []), projectDays(projectId).catch(() => [])]);
  const usedIn = timelines.filter((t) => t.clips.some((c) => c.shot_id && ids.has(c.shot_id)));
  const plannedOn = days.filter((d) => d.shots.some((s) => ids.has(s.shot_id)));
  if (!usedIn.length && !plannedOn.length) return true;
  const one = shotIds.length === 1;
  const where = [
    usedIn.length ? `${usedIn.length} timeline${usedIn.length === 1 ? "" : "s"} (${usedIn.map((t) => t.name).join(", ")})` : "",
    plannedOn.length ? `${plannedOn.length} shooting day${plannedOn.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" and ");
  return !!(await confirmDialog({
    title: one ? "Move this shot to the recycle bin?" : `Move ${shotIds.length} shots to the recycle bin?`,
    body: `${one ? "It is" : "They are"} used in ${where}. The bin takes ${one ? "it" : "them"} off there now, and restoring does not put ${one ? "it" : "them"} back.`,
    confirmLabel: "Move to the bin", danger: true,
  }));
}
