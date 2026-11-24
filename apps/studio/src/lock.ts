// The edit lock of a file as a window holds it (docs/features/canvas.md, "The lock, editing and watching"): one
// lock per file, whichever window edits it. The window takes it when it opens and on Edit, renews it while it
// edits, lets it go on Stop editing and when it closes. A window that does not hold it watches: it reads the file
// again every few seconds and says who edits. Used by the timeline and the shot; the canvas keeps its own copy
// with its live socket and renders.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as api from "./api";
import type { FileRec } from "./api";
import { toastError } from "./hosts";

const RENEW_MS = 20_000;
const LOOK_MS = 5_000;

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
}

/**
 * Holds the lock of `file` for this window. `onFresh` gets the file as the server has it when this window starts
 * editing and, while it watches, whenever the file changed; `leave` saves what is pending as the window closes.
 */
export function useEditLock(file: FileRec, nameOf: (userId: string) => string, onFresh: (f: FileRec) => void, leave?: () => void): EditLock {
  const holder = useMemo(() => `w${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, []);
  const [editing, setEditing] = useState(false);
  const [by, setBy] = useState<string | null>(null);
  const held = useRef(false);
  const seen = useRef(file.updated_at);
  const fresh = useRef(onFresh);
  fresh.current = onFresh;
  const leaving = useRef(leave);
  leaving.current = leave;

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
      setEditing(r.ok);
      setBy(r.ok ? null : nameOf(r.lock.by ?? ""));
      if (r.ok && !was) await reread(true);
    } catch (e) { toastError(e); }
  };
  useEffect(() => {
    void take();
    const renew = setInterval(() => { if (held.current) void take(); }, RENEW_MS);
    const look = setInterval(() => { if (!held.current && !document.hidden) void reread(false).catch(() => {}); }, LOOK_MS);
    const bye = () => { leaving.current?.(); if (held.current) void api.releaseLock(file.id, holder); };
    window.addEventListener("pagehide", bye);
    return () => { clearInterval(renew); clearInterval(look); window.removeEventListener("pagehide", bye); bye(); };
  }, [file.id]);

  return {
    holder, editing, by,
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

