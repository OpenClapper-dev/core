import { useEffect, useState } from "preact/hooks";
import { readExif, readoutOf, takenAt, type Exif } from "@openclapper/model";
import { ApiError, send, type Root } from "./api";
import * as store from "./files";

/**
 * Importing photos in the Studio (docs/rewrite/01-media.md). The browser makes what the server does
 * not: it reads the EXIF, draws a preview (about 2048 px) and a thumbnail (about 400 px), and sends
 * them first, then the untouched original. Each photo goes through the queue below, which keeps
 * trying a refused step and says per photo where it stands.
 */
export type UploadState = "waiting" | "preview" | "stuck";
interface Job { id: string; root: Root; file: File; name: string; container: string | null; state: UploadState; error: string | null; step: number; tries: number; busy: boolean }

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const PREVIEW = 2048, THUMB = 400;
const AT_ONCE = 2;

let jobs: Job[] = [];
let running = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const cb of listeners) cb(); };

/** Where each photo's upload stands, by file id; a photo not in here is stored. */
export function useUploads(): ReadonlyMap<string, { state: UploadState; error: string | null; name: string }> {
  const [, tick] = useState(0);
  useEffect(() => { const cb = () => tick((n) => n + 1); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  return new Map(jobs.map((j) => [j.id, { state: j.state, error: j.error, name: j.name }]));
}
export const uploadsPending = () => jobs.length;

/** The picture drawn at most `edge` px on its long side, as JPEG. `createImageBitmap` turns it upright by its EXIF. */
async function derive(bmp: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  return c.convertToBlob({ type: "image/jpeg", quality });
}

const putImage = async (id: string, part: "thumbnail" | "preview" | "original", body: Blob) => {
  const res = await fetch(`/api/photos/${id}/${part}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/octet-stream" }, body });
  if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; throw new ApiError(res.status, b.error ?? `Upload failed (${res.status})`); }
};

/** One photo, from where it stopped: 0 what is known, 1 thumbnail, 2 preview, 3 original, 4 done. */
async function run(j: Job): Promise<void> {
  const bytes = new Uint8Array(await j.file.arrayBuffer());
  const exif: Exif = j.file.type === "image/jpeg" ? readExif(bytes) : {};
  const bmp = await createImageBitmap(j.file);
  try {
    if (j.step === 0) {
      // The bitmap is already upright (createImageBitmap applies the EXIF orientation): its size is the photo's as shown.
      const width = bmp.width, height = bmp.height;
      await send("PUT", `/api/photos/${j.id}`, {
        project_id: j.root === "home" ? null : j.root.project, origin: "import", media_type: j.file.type, width, height, name: j.name, container: j.container,
        taken_at: takenAt(exif) ?? (j.file.lastModified ? new Date(j.file.lastModified).toISOString() : undefined), exif, readout: readoutOf(exif),
      });
      j.step = 1;
    }
    if (j.step === 1) { await putImage(j.id, "thumbnail", await derive(bmp, THUMB, 0.8)); j.step = 2; }
    if (j.step === 2) { await putImage(j.id, "preview", await derive(bmp, PREVIEW, 0.86)); j.step = 3; j.state = "preview"; notify(); void store.loadRoot(j.root); }
    if (j.step === 3) { await putImage(j.id, "original", j.file); j.step = 4; }
  } finally { bmp.close(); }
}

function pump() {
  while (running < AT_ONCE) {
    const j = jobs.find((x) => x.state !== "stuck" && x.step < 4 && !x.busy);
    if (!j) return;
    j.busy = true;
    running++;
    void run(j).then(
      () => { jobs = jobs.filter((x) => x !== j); },
      (e: unknown) => {
        j.tries++;
        j.error = e instanceof Error ? e.message : String(e);
        // What the server refuses as wrong will not get better by itself; anything else is tried again.
        const final = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
        j.state = "stuck";
        if (!final) setTimeout(() => { if (jobs.includes(j)) { j.state = j.step >= 3 ? "preview" : "waiting"; pump(); notify(); } }, Math.min(60_000, 2000 * 2 ** j.tries));
      },
    ).finally(() => {
      j.busy = false;
      running--;
      notify();
      // The last upload of a root: read it again, so every window shows what is stored.
      if (!jobs.some((x) => store.rootKey(x.root) === store.rootKey(j.root) && x.state !== "stuck")) void store.loadRoot(j.root);
      pump();
    });
  }
}

/** Try every stuck upload again now. */
export function retryUploads() { for (const j of jobs) if (j.state === "stuck") { j.state = j.step >= 3 ? "preview" : "waiting"; j.error = null; } notify(); pump(); }
/** Give up the stuck uploads: what was not stored yet is not stored. */
export function dropStuck() { jobs = jobs.filter((j) => j.state !== "stuck"); notify(); }

/**
 * Queue files for import into a container of a root. Returns what was taken and, per refused
 * file, why: only JPEG, PNG and WebP can be drawn by the browser (HEIC comes from the phone).
 */
export function importFiles(root: Root, files: Iterable<File>, container: string | null): { queued: string[]; refused: { name: string; why: string }[] } {
  const queued: string[] = [], refused: { name: string; why: string }[] = [];
  for (const file of files) {
    if (!ACCEPT.includes(file.type)) {
      refused.push({ name: file.name, why: /heic|heif/i.test(file.type || file.name) ? "HEIC cannot be read by the browser; import it from the phone" : "not a JPEG, PNG or WebP image" });
      continue;
    }
    const id = crypto.randomUUID();
    jobs.push({ id, root, file, name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Photo", container, state: "waiting", error: null, step: 0, tries: 0, busy: false });
    queued.push(id);
  }
  notify();
  pump();
  return { queued, refused };
}

/** Before the page closes with uploads still running: the browser asks the person to stay. */
if (typeof window !== "undefined") window.addEventListener("beforeunload", (e) => { if (jobs.some((j) => j.state !== "stuck")) e.preventDefault(); });

/** The URL of a photo's image in a size. */
export const imageUrl = (id: string, size: "thumbnail" | "preview" | "original" = "preview") => `/api/photos/${id}/image?size=${size}`;
