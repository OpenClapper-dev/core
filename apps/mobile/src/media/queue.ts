import { Directory, File } from "expo-file-system";
import * as Network from "expo-network";
import { canCall, isRejection, putPhoto, putPhotoPart, type PhotoMeta } from "../api";
import { kv, dataDir } from "../kv";
import { log } from "../log";
import { getPrefs } from "../prefs";
import { onProjectRemap, projects } from "../projects";
import { persisted } from "../store";
import { onSync } from "../sync";
import { cacheImage } from "./cache";
import { nextStep, rejected, type Step } from "./steps";

/**
 * The upload queue (docs/rewrite/03-capture.md, "Upload queue"): one photo per entry, with its three
 * files on the phone. A photo is stored here before anything else happens and is never deleted for
 * a rejection. Steps: what is known (the photo route), thumbnail, preview, then the original (on Wi-Fi
 * only, if the person wants). Every step is idempotent on the server, so any can be sent again.
 * Network errors stop the run and wait for the next sync; a rejection counts, and the third parks the
 * photo as stuck with the server's error, to retry or discard by hand. Once the original is stored
 * the phone deletes its copy and keeps thumbnail and preview in the image cache.
 */
export interface QueuedPhoto {
  id: string;
  meta: PhotoMeta & { name: string };
  /** File names in the queue folder; the original keeps its type. */
  original: string; preview: string; thumbnail: string;
  step: Step;
  rejections: number;
  stuck: boolean;
  error: string | null;
  added: string;
}

export const queue = persisted<QueuedPhoto[]>("queue.v1", [], Array.isArray);
export const queueDir = (): Directory => { const d = dataDir("queue"); if (!d.exists) d.create({ intermediates: true }); return d; };
export const queueFile = (name: string) => new File(queueDir(), name);

/** A local image of a queued photo, for Media and the camera's last photo. */
export function queuedUri(q: QueuedPhoto, size: "thumbnail" | "preview" = "thumbnail"): string | null {
  const f = queueFile(size === "thumbnail" ? q.thumbnail : q.preview);
  return f.exists ? f.uri : null;
}

export function enqueue(p: QueuedPhoto) {
  queue.set((q) => [...q.filter((x) => x.id !== p.id), p]);
  log("info", "queued", { id: p.id, origin: p.meta.origin, size: [p.meta.width, p.meta.height] });
  void flush();
}

/** Changes what a waiting photo will be sent with (its name or place); a photo already announced is changed through the file route. */
export function editQueued(id: string, change: Partial<Pick<PhotoMeta, "name" | "container">>) {
  queue.set((q) => q.map((x) => (x.id === id ? { ...x, meta: { ...x.meta, ...change } as QueuedPhoto["meta"] } : x)));
}

export function retry(id: string) {
  queue.set((q) => q.map((x) => (x.id === id ? { ...x, stuck: false, rejections: 0, error: null } : x)));
  void flush();
}

/** Throws a stuck photo away, files and all: the only way a photo leaves the phone unsent. */
export function discard(id: string) {
  const p = queue.get().find((x) => x.id === id);
  if (!p) return;
  for (const f of [p.original, p.preview, p.thumbnail]) { try { const file = queueFile(f); if (file.exists) file.delete(); } catch { /* gone */ } }
  queue.set((q) => q.filter((x) => x.id !== id));
  log("info", "discarded", { id });
}

/** A project made on the phone turned out to exist on the server: its photos go there. */
onProjectRemap((from, to) => queue.set((q) => q.map((x) => (x.meta.project_id === from ? { ...x, meta: { ...x.meta, project_id: to } } : x))));

async function onWifi(): Promise<boolean> {
  try { const s = await Network.getNetworkStateAsync(); return s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET; } catch { return false; }
}

const doneListeners = new Set<(id: string) => void>();
/** Called when a photo's preview is on the server (Media reloads) and when it is done. */
export const onUploaded = (cb: (id: string) => void) => { doneListeners.add(cb); return () => { doneListeners.delete(cb); }; };

function update(id: string, change: Partial<QueuedPhoto>) {
  queue.set((q) => q.map((x) => (x.id === id ? { ...x, ...change } : x)));
}

async function send(p: QueuedPhoto, wifiOnly: boolean, wifi: () => Promise<boolean>): Promise<"next" | "wait"> {
  for (;;) {
    const cur = queue.get().find((x) => x.id === p.id);
    if (!cur || cur.stuck) return "next";
    const step = nextStep(cur.step);
    if (step === "done") break;
    if (step === "original" && wifiOnly && !(await wifi())) return "next";
    try {
      if (step === "meta") await putPhoto(cur.id, cur.meta);
      else {
        const name = step === "original" ? cur.original : step === "preview" ? cur.preview : cur.thumbnail;
        const file = queueFile(name);
        if (!file.exists) throw new Error(`the ${step} file is gone from the phone`);
        await putPhotoPart(cur.id, step, file, step === "original" ? cur.meta.media_type ?? "image/jpeg" : "image/jpeg");
      }
      update(cur.id, { step: step === "meta" ? "thumbnail" : step === "thumbnail" ? "preview" : step === "preview" ? "original" : "done", error: null });
      if (step === "preview") for (const cb of doneListeners) cb(cur.id);
    } catch (e) {
      const missing = e instanceof Error && e.message.includes("is gone from the phone");
      if (!missing && !isRejection(e)) { log("warn", "upload paused", { id: cur.id, step, error: e }); return "wait"; }
      const r = rejected(cur.rejections, missing);
      update(cur.id, { rejections: r.rejections, stuck: r.stuck, error: e instanceof Error ? e.message : String(e) });
      log("warn", r.stuck ? "upload stuck" : "upload refused", { id: cur.id, step, error: e });
      return "next";
    }
  }
  // Done: the original leaves the phone, thumbnail and preview go to the image cache.
  const done = queue.get().find((x) => x.id === p.id)!;
  cacheImage(done.id, "thumbnail", queueFile(done.thumbnail));
  cacheImage(done.id, "preview", queueFile(done.preview));
  try { const o = queueFile(done.original); if (o.exists) o.delete(); } catch { /* best effort */ }
  queue.set((q) => q.filter((x) => x.id !== done.id));
  log("info", "uploaded", { id: done.id });
  for (const cb of doneListeners) cb(done.id);
  return "next";
}

let running: Promise<void> | null = null;
let again = false;

/** Sends what waits, oldest first. Runs once at a time; a call while running runs it again after. */
export function flush(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      if (!canCall()) return;
      const wifiOnly = getPrefs().originalsOnWifi;
      let wifiKnown: boolean | null = null;
      const wifi = async () => (wifiKnown ??= await onWifi());
      // A project made on the phone must be on the server before its photos (the sync creates it first).
      const ready = new Set(projects.get().filter((x) => x.synced).map((x) => x.id));
      for (const p of queue.get().filter((x) => !x.stuck && ready.has(x.meta.project_id))) if ((await send(p, wifiOnly, wifi)) === "wait") return;
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

onSync(flush);
// Old entries of the first app's queue are not this queue's: they were tied to shots (B3 starts afresh).
try { kv.removeItemSync("pendingUploads.v2"); } catch { /* none */ }

/** Waiting (not on the server completely), stuck, and how many of the waiting have their preview there. */
export function useQueueCounts() {
  const q = queue.use();
  return { waiting: q.length, stuck: q.filter((x) => x.stuck).length, previewed: q.filter((x) => !x.stuck && (x.step === "original" || x.step === "done")).length };
}
