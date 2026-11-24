import { ApiError, canCall, isRejection, putValues } from "../api";
import { log } from "../log";
import { persisted } from "../store";
import { onSync } from "../sync";
import { toast } from "../ui";
import { storedValues, takeValues } from "./library";
import { onUploaded, queue } from "./queue";

/**
 * Property values set on the phone (docs/features/properties.md): shown at once and kept on the phone
 * until the server has them, so an edit made offline is not lost. A photo still in the queue gets its
 * values once the server knows it. A value the server refuses (the property changed meanwhile) is
 * dropped with a message; the photo shows the server's values again.
 */
const pending = persisted<Record<string, Record<string, unknown>>>("pendingValues.v1", {});

/** A file's values as the phone shows them: the stored ones with what waits on top. */
export function useValues(id: string): Record<string, unknown> {
  const p = pending.use();
  const merged = { ...storedValues(id), ...p[id] };
  for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
  return merged;
}

export function setValue(fileId: string, defId: string, value: unknown) {
  pending.set((p) => ({ ...p, [fileId]: { ...p[fileId], [defId]: value } }));
  void flushValues();
}

let running: Promise<void> | null = null;
export function flushValues(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!canCall()) return;
    for (const [fileId, change] of Object.entries(pending.get())) {
      // Not on the server yet: it waits for the photo's first upload step.
      if (queue.get().some((q) => q.id === fileId && q.step === "meta")) continue;
      try {
        takeValues(fileId, await putValues(fileId, change));
        // What was changed again while this was on its way stays for the next run.
        pending.set((p) => {
          const left = Object.fromEntries(Object.entries(p[fileId] ?? {}).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(change[k])));
          const { [fileId]: _sent, ...rest } = p;
          return Object.keys(left).length ? { ...rest, [fileId]: left } : rest;
        });
      } catch (e) {
        if (!isRejection(e)) { log("warn", "values wait", { fileId, error: e }); return; }
        log("warn", "values refused", { fileId, error: e });
        toast(`A property was not saved: ${e instanceof ApiError ? e.message : String(e)}`, "danger");
        pending.set((p) => { const { [fileId]: _gone, ...rest } = p; return rest; });
      }
    }
  })().finally(() => { running = null; });
  return running;
}
onSync(flushValues);
// A photo that has just reached the server can take the values set while it waited.
onUploaded(() => void flushValues());
