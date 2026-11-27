// The Canvas app (docs/features/canvas.md): one window per canvas. A window that edits holds the edit lock
// (others watch the canvas read-only as it changes), saves every change on its own a moment after it was
// made, uploads the render and thumbnail with each save, and keeps the history for undo and redo. Stop
// editing lets the lock go and keeps the window open as a viewer; Edit takes it again when it is free.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EmptyState, Spinner } from "@openclapper/design";
import { canvasRefs, focalsOf, type CanvasBody, type PresetBody } from "@openclapper/model";
import * as api from "../api";
import type { FileRec } from "../api";
import { CanvasEditor, type Draft, type PlaceablePhoto } from "../canvas/CanvasEditor";
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
import { StartScreen } from "./StartScreen";
import type { AppProps } from "./registry";

const SAVE_AFTER_MS = 700;
const RENEW_MS = 20_000;
const HISTORY = 100;
/** How often a viewer reads the canvas again (the project's "Every 5 seconds" live updates, or while the live socket is down). */
const POLL_MS = 5_000;
/** At most this often the editor sends the canvas, or the stroke being drawn, to the live room. */
const SEND_MS = 120;
/** Larger canvases are not sent whole: viewers read them again after each save. */
const MAX_SEND = 1_000_000;

export const baseOf = (f: FileRec | undefined): BasePhoto | null => (f && f.type === "photo" ? {
  id: f.id, name: f.name, src: imageUrl(f.id, "preview"), aspect: f.photo && f.photo.height ? f.photo.width / f.photo.height : 4 / 3,
  view: f.photo?.angle_of_view ? { horizontal: f.photo.angle_of_view.horizontal, vertical: f.photo.angle_of_view.vertical } : null,
} : null);

/** A canvas; opened without one, the start screen of the project's canvases (#426). */
export function CanvasApp(p: AppProps) {
  return p.win.resource?.type === "canvas" ? <CanvasView {...p} /> : <StartScreen winId={p.win.id} projectId={p.projectId} type="canvas" setTitle={p.setTitle} setRoute={p.setRoute} />;
}

function CanvasView({ win, projectId, setTitle, setRoute, focused }: AppProps) {
  const id = win.resource?.type === "canvas" ? win.resource.id : null;
  const { files } = useRoot({ project: projectId });
  const file = id ? files?.find((f) => f.id === id) : undefined;
  const user = useUser();
  const me = user.status === "signed-in" ? user.me.user : null;
  const project = useProjects().list?.find((p) => p.id === projectId);
  const people = usePeople(project?.workspace_id);
  useEffect(() => { setTitle(file ? file.name : "Canvas"); setRoute(id ?? ""); }, [file?.name, id]);
  if (!files) return <div className="st-center"><Spinner /></div>;
  if (!file || file.deleted_at) return <EmptyState icon="brush" title="This canvas is gone">It was deleted or moved to the recycle bin.</EmptyState>;
  return <Editing key={file.id} live={project?.canvas_live} active={focused} file={file} files={files} projectId={projectId} me={{ id: me?.id ?? "", name: me?.name ?? me?.email ?? "You" }} nameOf={(u) => (u === me?.id ? "You" : people.get(u) ?? "Someone")} />;
}

export function Editing({ file, files, projectId, me, nameOf, active, hosted, live, backdrop }: { file: FileRec; files: FileRec[]; projectId: string; me: { id: string; name: string }; nameOf: (u: string) => string; active: boolean; hosted?: boolean; live?: api.CanvasLive; backdrop?: ComponentChildren }) {
  // The window's own token for the lock: a second window of the same person is someone else.
  const holder = useMemo(() => `w${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, []);
  const [doc, setDoc] = useState<CanvasBody>(() => file.body as unknown as CanvasBody);
  const [baseId, setBaseId] = useState<string | null>(() => file.refs?.find((r) => r.kind === "base")?.to ?? null);
  const [rev, setRev] = useState(0);
  // Whether this window edits; when it does not, who does (null: nobody).
  const [editing, setEditing] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "waiting" | "saving" | "failed">("saved");
  const [flow, setFlow] = useState<{ start?: Partial<ReturnType<typeof draftOf>>; done: (id: string, body: PresetBody) => void } | null>(null);
  const history = useRef<{ past: CanvasBody[]; future: CanvasBody[]; at: number }>({ past: [], future: [], at: 0 });
  const [, tick] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ doc, baseId });
  latest.current = { doc, baseId };
  const held = useRef(false);

  const seen = useRef(file.updated_at);
  // The live room (projects set to realtime): this window's socket, and what a viewer gets from it.
  const sock = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  connectedRef.current = connected;
  const [remoteDraft, setRemoteDraft] = useState<Draft | null>(null);
  const sendState = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; draft: Draft | null; doc: boolean }>({ at: 0, timer: null, draft: null, doc: false });

  /** Shows the canvas as the server has it now, and who edits it; the start of an edit and each look of a viewer. */
  const reread = async (always: boolean) => {
    const f = (await api.get<{ file: FileRec }>(`/api/files/${file.id}`)).file;
    if (!held.current) setLockedBy(f.lock?.by ? nameOf(f.lock.by) : null);
    if ((always || f.updated_at !== seen.current) && f.body) {
      seen.current = f.updated_at;
      const b = f.body as unknown as CanvasBody, bid = f.refs?.find((r) => r.kind === "base")?.to ?? null;
      setDoc(b); setBaseId(bid); latest.current = { doc: b, baseId: bid }; setRev((r) => r + 1);
    }
  };
  // The lock: taken when the window opens and on Edit, renewed while the window edits, let go on Stop editing and when it closes.
  const take = async () => {
    try {
      const r = await api.takeLock(file.id, holder);
      const was = held.current;
      held.current = r.ok;
      setEditing(r.ok);
      if (r.ok && was && sock.current?.readyState === WebSocket.OPEN) sock.current.send(JSON.stringify({ type: "held" }));
      setLockedBy(r.ok ? null : nameOf(r.lock.by));
      // Starting to edit: from what the canvas is now, not from what a viewer last saw.
      if (r.ok && !was) { history.current = { past: [], future: [], at: 0 }; await reread(true); }
    } catch (e) { toastError(e); }
  };
  const stop = async () => {
    if (pending.current) { clearTimeout(pending.current); await save(); }
    held.current = false;
    // Let go first: the live socket that opens next must find the lock free and make this window a viewer.
    await api.releaseLock(file.id, holder);
    setEditing(false); setLockedBy(null);
  };
  const apply = (b: CanvasBody, bid: string | null) => { setDoc(b); setBaseId(bid); latest.current = { doc: b, baseId: bid }; setRev((r) => r + 1); };

  // The live socket: the editor when this window holds the lock, else a viewer; opened again on Edit and Stop editing, and
  // after a drop. In every project, so who edits is never stale (#426); strokes and the canvas stream only in a realtime one.
  const streaming = useRef(live === "realtime");
  streaming.current = live === "realtime";
  useEffect(() => {
    let ws: WebSocket | null = null, done = false, retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const s = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/canvases/${file.id}/live?holder=${holder}`);
      ws = s; sock.current = s;
      s.onopen = () => { setConnected(true); if (!held.current) void reread(false).catch(() => {}); };
      s.onmessage = (e) => {
        if (held.current) return;
        let m: { type?: string; body?: CanvasBody; base?: string | null; draft?: Draft | null; by?: string | null };
        try { m = JSON.parse(String(e.data)) as typeof m; } catch { return; }
        if (m.type === "doc" && m.body) { if (streaming.current) { apply(m.body, m.base ?? null); setRemoteDraft(null); } }
        else if (m.type === "draft") { if (streaming.current) setRemoteDraft(m.draft ?? null); }
        else if (m.type === "saved") void reread(false).catch(() => {});
        else if (m.type === "editor") { setLockedBy(m.by ? nameOf(m.by) : null); if (!m.by) { setRemoteDraft(null); void reread(false).catch(() => {}); } }
      };
      s.onclose = () => { if (sock.current === s) { sock.current = null; setConnected(false); } if (!done) retry = setTimeout(open, 3000); };
    };
    open();
    return () => { done = true; clearTimeout(retry); if (sock.current === ws) { sock.current = null; setConnected(false); } ws?.close(); };
  }, [editing]);
  /** Sends the canvas (or the stroke being drawn) to the viewers, at most every SEND_MS; the last state always goes. */
  const send = (what: { doc: true } | { draft: Draft | null }) => {
    if (!streaming.current) return;
    const st = sendState.current;
    if ("doc" in what) { st.doc = true; st.draft = null; } else st.draft = what.draft;
    if (st.timer) return;
    st.timer = setTimeout(() => {
      st.timer = null; st.at = Date.now();
      const s = sock.current;
      if (!s || s.readyState !== WebSocket.OPEN || !held.current) { st.doc = false; return; }
      if (st.doc) {
        st.doc = false;
        const data = JSON.stringify({ type: "doc", body: latest.current.doc, base: latest.current.baseId });
        if (data.length <= MAX_SEND) s.send(data);
      } else s.send(JSON.stringify({ type: "draft", draft: st.draft }));
    }, Math.max(0, SEND_MS - (Date.now() - st.at)));
  };

  useEffect(() => {
    void take();
    // (A viewer with a live socket gets every change from it; the reading below is for "every 5 seconds" and for a dropped socket.)
    const renew = setInterval(() => { if (held.current) void take(); }, RENEW_MS);
    // A viewer reads the canvas again every few seconds, while its page is shown.
    const look = setInterval(() => { if (!held.current && !connectedRef.current && !document.hidden) void reread(false).catch(() => {}); }, POLL_MS);
    const bye = () => { if (pending.current) { clearTimeout(pending.current); void save(); } if (held.current) void api.releaseLock(file.id, holder); };
    window.addEventListener("pagehide", bye);
    return () => { clearInterval(renew); clearInterval(look); window.removeEventListener("pagehide", bye); bye(); };
  }, []);

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
      seen.current = (await api.putFileLocked(file.id, { body: b, refs: canvasRefs(b, bid) }, holder)).updated_at;
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
      // Too large to go whole over the live socket: viewers read it again now.
      if (sock.current?.readyState === WebSocket.OPEN && JSON.stringify(b).length > MAX_SEND - 100) sock.current.send(JSON.stringify({ type: "saved" }));
      void loadRoot({ project: projectId });
    } catch (e) {
      setStatus("failed");
      if (e instanceof api.ApiError && e.status === 423) { held.current = false; void take(); } else toastError(e);
    }
  }
  const schedule = () => { setStatus("waiting"); if (pending.current) clearTimeout(pending.current); pending.current = setTimeout(() => void save(), SAVE_AFTER_MS); };

  const change = (b: CanvasBody) => {
    if (!held.current) return;
    // Changes close together (a drag) are one step of the history.
    const h = history.current, now = Date.now();
    if (now - h.at > 600) { h.past = [...h.past, latest.current.doc].slice(-HISTORY); h.future = []; }
    h.at = now;
    setDoc(b); latest.current = { ...latest.current, doc: b };
    tick((n) => n + 1);
    schedule();
    send({ doc: true });
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
    send({ doc: true });
  };
  const setBase = (pid: string | null) => {
    setBaseId(pid); latest.current = { ...latest.current, baseId: pid };
    if (pid && latest.current.doc.surface.kind !== "photo") { const b: CanvasBody = { ...latest.current.doc, surface: { kind: "photo" } }; setDoc(b); latest.current = { ...latest.current, doc: b }; setRev((r) => r + 1); }
    schedule();
    send({ doc: true });
  };

  return (
    <>
      <CanvasEditor body={doc} rev={rev} base={base} presets={presets} photos={photos} photoSrc={(pid) => imageUrl(pid, "preview")}
        onChange={change} onBase={setBase} active={active} hosted={hosted} title={file.name} me={me} nameOf={nameOf} backdrop={backdrop}
        access={editing ? { editing: true, onStop: () => void stop() } : { editing: false, by: lockedBy, onEdit: () => void take() }}
        onDraft={(d) => send({ draft: d })} remoteDraft={editing ? null : remoteDraft}
        undo={{ can: history.current.past.length > 0, run: () => jump("past") }} redo={{ can: history.current.future.length > 0, run: () => jump("future") }}
        onNewPreset={(start, then) => setFlow({ start: start ? { format: start.format, formatName: null, multiplier: start.multiplier, squeeze: start.squeeze, delivery: start.delivery, lenses: "primes", primes: [start.focal] } : undefined, done: (pid, body) => then(pid, start && focalsOf(body.lenses).includes(start.focal) ? start.focal : focalsOf(body.lenses)[0]) })}
        status={status === "saving" ? "Saving…" : status === "waiting" ? "Changed" : status === "failed" ? <strong>Not saved</strong> : !editing ? (connected ? "Read-only, live" : "Read-only, read again every 5 s") : connected ? "Saved · live" : "Saved"} />
      {flow && <PresetFlow projectId={projectId} files={files} start={flow.start} onCreated={(pid, body) => flow.done(pid, body)} onClose={() => setFlow(null)} />}
    </>
  );
}
