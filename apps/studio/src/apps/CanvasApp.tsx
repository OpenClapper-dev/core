// The Canvas app (docs/features/canvas.md): one window per canvas. It holds the edit lock while the window
// is open (others see the canvas read-only), saves every change on its own a moment after it was made,
// uploads the render and thumbnail with each save, and keeps the history for undo and redo.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EmptyState, Spinner } from "@openclapper/design";
import { canvasRefs, focalsOf, type CanvasBody, type PresetBody } from "@openclapper/model";
import * as api from "../api";
import type { FileRec } from "../api";
import { CanvasEditor, type PlaceablePhoto } from "../canvas/CanvasEditor";
import { pictureOf, rectOf, type BasePhoto } from "../canvas/geometry";
import { renderCanvas } from "../canvas/render";
import { loadRoot, useRoot } from "../files";
import { toastError } from "../hosts";
import { imageUrl } from "../media";
import { presetsIn } from "../optics";
import { usePeople } from "../people";
import { PresetFlow, type draftOf } from "../PresetFlow";
import { useProjects } from "../projects";
import { useUser } from "../user";
import { launch, type AppProps } from "./registry";

const SAVE_AFTER_MS = 700;
const RENEW_MS = 20_000;
const HISTORY = 100;

export const baseOf = (f: FileRec | undefined): BasePhoto | null => (f && f.type === "photo" ? {
  id: f.id, name: f.name, src: imageUrl(f.id, "preview"), aspect: f.photo && f.photo.height ? f.photo.width / f.photo.height : 4 / 3,
  view: f.photo?.angle_of_view ? { horizontal: f.photo.angle_of_view.horizontal, vertical: f.photo.angle_of_view.vertical } : null,
} : null);

export function CanvasApp({ win, projectId, setTitle, setRoute, focused }: AppProps) {
  const id = win.resource?.type === "canvas" ? win.resource.id : null;
  const { files } = useRoot({ project: projectId });
  const file = id ? files?.find((f) => f.id === id) : undefined;
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  useEffect(() => { setTitle(file ? file.name : "Canvas"); setRoute(id ?? ""); }, [file?.name, id]);
  if (!id) return <EmptyState icon="brush" title="No canvas">Open a canvas from Files, or make one: New, Canvas; or from a photo, Make a canvas.</EmptyState>;
  if (!files) return <div className="st-center"><Spinner /></div>;
  if (!file || file.deleted_at) return <EmptyState icon="brush" title="This canvas is gone">It was deleted or moved to the recycle bin.</EmptyState>;
  return <Editing key={file.id} active={focused} file={file} files={files} projectId={projectId} me={{ id: me?.id ?? "", name: me?.name ?? me?.email ?? "You" }} nameOf={(u) => (u === me?.id ? "You" : people.get(u) ?? "Someone")} />;
}

export function Editing({ file, files, projectId, me, nameOf, active, hosted }: { file: FileRec; files: FileRec[]; projectId: string; me: { id: string; name: string }; nameOf: (u: string) => string; active: boolean; hosted?: boolean }) {
  // The window's own token for the lock: a second window of the same person is someone else.
  const holder = useMemo(() => `w${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, []);
  const [doc, setDoc] = useState<CanvasBody>(() => file.body as unknown as CanvasBody);
  const [baseId, setBaseId] = useState<string | null>(() => file.refs?.find((r) => r.kind === "base")?.to ?? null);
  const [rev, setRev] = useState(0);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "waiting" | "saving" | "failed">("saved");
  const [flow, setFlow] = useState<{ start?: Partial<ReturnType<typeof draftOf>>; done: (id: string, body: PresetBody) => void } | null>(null);
  const history = useRef<{ past: CanvasBody[]; future: CanvasBody[]; at: number }>({ past: [], future: [], at: 0 });
  const [, tick] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ doc, baseId });
  latest.current = { doc, baseId };
  const held = useRef(false);

  // The lock: taken when the window opens, renewed while it is open, let go when it closes.
  const take = async () => {
    try {
      const r = await api.takeLock(file.id, holder);
      held.current = r.ok;
      setLockedBy(r.ok ? null : nameOf(r.lock.by));
      if (r.ok && lockedBy) { await loadRoot({ project: projectId }); }
    } catch (e) { toastError(e); }
  };
  useEffect(() => {
    void take();
    const t = setInterval(() => { if (held.current) void take(); }, RENEW_MS);
    const bye = () => { if (pending.current) { clearTimeout(pending.current); void save(); } void api.releaseLock(file.id, holder); };
    window.addEventListener("pagehide", bye);
    return () => { clearInterval(t); window.removeEventListener("pagehide", bye); bye(); };
  }, []);
  // Someone else had it: what the canvas is now is what the store has.
  useEffect(() => { if (lockedBy && file.body) { setDoc(file.body as unknown as CanvasBody); setBaseId(file.refs?.find((r) => r.kind === "base")?.to ?? null); setRev((r) => r + 1); } }, [lockedBy, file.updated_at]);

  const byId = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const base = baseOf(baseId ? byId.get(baseId) : undefined);
  const presets = presetsIn(files).map((p) => ({ id: p.id, name: p.name, body: p.body }));
  const photos: PlaceablePhoto[] = files.filter((f) => f.type === "photo" && f.photo?.stored.preview).sort((a, b) => (b.photo!.taken_at ?? "").localeCompare(a.photo!.taken_at ?? ""))
    .map((f) => ({ id: f.id, name: f.name, thumb: imageUrl(f.id, "thumbnail"), src: imageUrl(f.id, "preview") }));

  async function save() {
    pending.current = null;
    if (!held.current) return;
    const { doc: b, baseId: bid } = latest.current;
    setStatus("saving");
    try {
      await api.putFileLocked(file.id, { body: b, refs: canvasRefs(b, bid) }, holder);
      const input = { body: b, base: baseOf(bid ? byId.get(bid) : undefined), photoSrc: (pid: string) => imageUrl(pid, "preview") };
      // A canvas with a picture is shown cropped to it in a thumbnail (05-composition.md).
      const ctxF = { base: input.base, presets: new Map(presetsIn(files).map((p) => [p.id, p.body])) };
      const pf = pictureOf(b, ctxF), pr = pf ? rectOf(pf, ctxF) : null;
      const box = pr ? (pr.inner ?? pr) : null;
      const crop = pf && box && box.w <= 1 && box.h <= 1 ? { x: pf.cx - box.w / 2, y: pf.cy - box.h / 2, w: box.w, h: box.h } : undefined;
      const [render, thumb] = [await renderCanvas(input, 2048), await renderCanvas(input, 400, crop)];
      await api.putRender(file.id, "render", render, holder);
      await api.putRender(file.id, "thumbnail", thumb, holder);
      setStatus(pending.current ? "waiting" : "saved");
      void loadRoot({ project: projectId });
    } catch (e) {
      setStatus("failed");
      if (e instanceof api.ApiError && e.status === 423) { held.current = false; void take(); } else toastError(e);
    }
  }
  const schedule = () => { setStatus("waiting"); if (pending.current) clearTimeout(pending.current); pending.current = setTimeout(() => void save(), SAVE_AFTER_MS); };

  const change = (b: CanvasBody) => {
    // Changes close together (a drag) are one step of the history.
    const h = history.current, now = Date.now();
    if (now - h.at > 600) { h.past = [...h.past, latest.current.doc].slice(-HISTORY); h.future = []; }
    h.at = now;
    setDoc(b); latest.current = { ...latest.current, doc: b };
    tick((n) => n + 1);
    schedule();
  };
  const jump = (from: "past" | "future") => {
    const h = history.current, list = h[from];
    if (!list.length) return;
    const to = list[list.length - 1];
    h[from] = list.slice(0, -1);
    h[from === "past" ? "future" : "past"] = [...h[from === "past" ? "future" : "past"], latest.current.doc];
    h.at = 0;
    setDoc(to); latest.current = { ...latest.current, doc: to };
    setRev((r) => r + 1);
    schedule();
  };
  const setBase = (pid: string | null) => {
    setBaseId(pid); latest.current = { ...latest.current, baseId: pid };
    if (pid && latest.current.doc.surface.kind !== "photo") { const b: CanvasBody = { ...latest.current.doc, surface: { kind: "photo" } }; setDoc(b); latest.current = { ...latest.current, doc: b }; setRev((r) => r + 1); }
    schedule();
  };
  const copy = async () => {
    try { const c = await api.duplicateFile(file.id, { id: crypto.randomUUID() }); await loadRoot({ project: projectId }); launch({ app: "canvas", resource: { type: "canvas", id: c.id }, title: c.name }); }
    catch (e) { toastError(e); }
  };

  return (
    <>
      <CanvasEditor body={doc} rev={rev} base={base} presets={presets} photos={photos} photoSrc={(pid) => imageUrl(pid, "preview")}
        onChange={change} onBase={setBase} active={active} hosted={hosted} title={file.name} me={me} nameOf={nameOf}
        lock={lockedBy ? { by: lockedBy, onRetry: () => void take(), onCopy: () => void copy() } : null}
        undo={{ can: history.current.past.length > 0, run: () => jump("past") }} redo={{ can: history.current.future.length > 0, run: () => jump("future") }}
        onNewPreset={(start, then) => setFlow({ start: start ? { format: start.format, formatName: null, multiplier: start.multiplier, squeeze: start.squeeze, delivery: start.delivery, lenses: "primes", primes: [start.focal] } : undefined, done: (pid, body) => then(pid, start && focalsOf(body.lenses).includes(start.focal) ? start.focal : focalsOf(body.lenses)[0]) })}
        status={status === "saving" ? "Saving…" : status === "waiting" ? "Changed" : status === "failed" ? <strong>Not saved</strong> : lockedBy ? "Read-only" : "Saved"} />
      {flow && <PresetFlow projectId={projectId} files={files} start={flow.start} onCreated={(pid, body) => flow.done(pid, body)} onClose={() => setFlow(null)} />}
    </>
  );
}
