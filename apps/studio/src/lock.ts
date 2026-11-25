// The edit lock of a file as a window holds it (docs/features/canvas.md, "The lock, editing and watching"): one
// lock per file, whichever window edits it. The window takes it when it opens and on Edit, renews it while it
// edits, lets it go on Stop editing and when it closes. A window that does not hold it watches: it reads the file
// again every few seconds and says who edits; in a project set to realtime it gets every change at once through
// the file's live room instead (live.ts). Used by the timeline and the shot; the canvas keeps its own copy with
// its renders and the stroke being drawn.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as api from "./api";
import type { FileRec } from "./api";
import { toastError } from "./hosts";

const RENEW_MS = 20_000;
const LOOK_MS = 5_000;
const SEND_MS = 150;
const MAX_SEND = 1_000_000;
/** What goes through the live room: the file's body and, for a file whose lists are references, the references. */
export interface LiveDoc { body: Record<string, unknown>; refs?: { kind: string; to: string; data?: Record<string, unknown> | null }[] }

export interface EditLock {
  /** This window's token for the lock. */
  holder: string;
  /** Whether this window edits. */
  editing: boolean;
  /** Who edits when this window does not (a name), or null. */
  by: string | null;
  /** Whether this window holds the lock right now (for saves made outside a render). */
  held: () => boolean;
  /** Take the lock (Edit); starts from the file as the server has it. */
  edit: () => Promise<void>;
  /** Let it go (Stop editing); `flush` saves what is pending first. */
  stop: (flush?: () => Promise<void>) => Promise<void>;
  /** A save was refused with 423: someone else has it now. */
  lost: () => void;
  /** The editor hands its state to the watchers (realtime projects only; at most every 150 ms, the last one always). */
  send: (doc: () => LiveDoc) => void;
  /** Whether the live room is connected. */
  live: boolean;
}

/**
 * Holds the lock of `file` for this window. `onFresh` gets the file as the server has it when this window starts
 * editing and, while it watches, whenever the file changed; `leave` saves what is pending as the window closes.
 */
export function useEditLock(file: FileRec, nameOf: (userId: string) => string, onFresh: (f: FileRec) => void, leave?: () => void, opts: { realtime?: boolean; onRemote?: (d: LiveDoc) => void; off?: boolean } = {}): EditLock {
  const holder = useMemo(() => `w${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, []);
  const [editing, setEditing] = useState(false);
  const [by, setBy] = useState<string | null>(null);
  const held = useRef(false);
  const seen = useRef(file.updated_at);
  const fresh = useRef(onFresh);
  fresh.current = onFresh;
  const leaving = useRef(leave);
  leaving.current = leave;
  const remote = useRef(opts.onRemote);
  remote.current = opts.onRemote;
  const sock = useRef<WebSocket | null>(null);
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  liveRef.current = live;
  const sending = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; doc: (() => LiveDoc) | null }>({ at: 0, timer: null, doc: null });

  const reread = async (always: boolean) => {
    const f = (await api.get<{ file: FileRec }>(`/api/files/${file.id}`)).file;
    if (!held.current) setBy(f.lock?.by ? nameOf(f.lock.by) : null);
    if (always || f.updated_at !== seen.current) { seen.current = f.updated_at; fresh.current(f); }
  };
  const take = async () => {
    try {
      const r = await api.takeLock(file.id, holder);
      const was = held.current;
      held.current = r.ok;
      if (r.ok && was && sock.current?.readyState === WebSocket.OPEN) sock.current.send(JSON.stringify({ type: "held" }));
      setEditing(r.ok);
      setBy(r.ok ? null : nameOf(r.lock.by ?? ""));
      if (r.ok && !was) await reread(true);
    } catch (e) { toastError(e); }
  };
  useEffect(() => {
    // A file that is not edited under a lock (a set, a location): this window simply edits.
    if (opts.off) { held.current = true; setEditing(true); return; }
    void take();
    const renew = setInterval(() => { if (held.current) void take(); }, RENEW_MS);
    const look = setInterval(() => { if (!held.current && !liveRef.current && !document.hidden) void reread(false).catch(() => {}); }, LOOK_MS);
    const bye = () => { leaving.current?.(); if (held.current) void api.releaseLock(file.id, holder); };
    window.addEventListener("pagehide", bye);
    return () => { clearInterval(renew); clearInterval(look); window.removeEventListener("pagehide", bye); bye(); };
  }, [file.id]);

  // The live room: opened again when this window starts or stops editing (its role changes), and after a drop. In every
  // project, so who edits is never stale (#426); the content itself streams only in a realtime project.
  const realtime = useRef(opts.realtime);
  realtime.current = opts.realtime;
  useEffect(() => {
    if (opts.off) return;
    let ws: WebSocket | null = null, done = false, retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const s = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/canvases/${file.id}/live?holder=${holder}`);
      ws = s; sock.current = s;
      s.onopen = () => { setLive(true); if (!held.current) void reread(false).catch(() => {}); };
      s.onmessage = (e) => {
        if (held.current) return;
        let m: { type?: string; body?: Record<string, unknown>; refs?: LiveDoc["refs"]; by?: string | null };
        try { m = JSON.parse(String(e.data)) as typeof m; } catch { return; }
        if (m.type === "doc" && m.body) { if (realtime.current) remote.current?.({ body: m.body, refs: m.refs }); }
        else if (m.type === "saved") void reread(false).catch(() => {});
        // Let go or run out: free to edit now, and the last save is read.
        else if (m.type === "editor") { setBy(m.by ? nameOf(m.by) : null); if (!m.by) void reread(false).catch(() => {}); }
      };
      s.onclose = () => { if (sock.current === s) { sock.current = null; setLive(false); } if (!done) retry = setTimeout(open, 3000); };
    };
    open();
    return () => { done = true; clearTimeout(retry); if (sock.current === ws) { sock.current = null; setLive(false); } ws?.close(); };
  }, [opts.off, editing, file.id]);
  const send = (doc: () => LiveDoc) => {
    if (!realtime.current) return;
    const st = sending.current;
    st.doc = doc;
    if (st.timer) return;
    st.timer = setTimeout(() => {
      st.timer = null; st.at = Date.now();
      const s = sock.current, d = st.doc;
      st.doc = null;
      if (!s || s.readyState !== WebSocket.OPEN || !held.current || !d) return;
      const data = JSON.stringify({ type: "doc", ...d() });
      // Too large to go whole: the watchers read it again after the save.
      s.send(data.length <= MAX_SEND ? data : JSON.stringify({ type: "saved" }));
    }, Math.max(0, SEND_MS - (Date.now() - st.at)));
  };

  return {
    holder, editing, by, send, live,
    held: () => held.current,
    edit: take,
    stop: async (flush) => {
      if (flush) await flush();
      held.current = false;
      await api.releaseLock(file.id, holder);
      setEditing(false); setBy(null);
    },
    lost: () => { held.current = false; setEditing(false); void take(); },
  };
}

