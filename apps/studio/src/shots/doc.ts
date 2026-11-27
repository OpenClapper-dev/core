// What a shot, a set, a location or a progression holds, as a window edits it (docs/features/shots.md): a content
// list, or a progression's items, overlay and settings. Changes show at once and are saved a moment later as one PUT
// of the file's references (and a progression's body); the store reads the project again after. A shot is edited
// under its lock (lock.ts): only the window that holds it changes it or its progressions, and their saves carry the
// token. The shot's live room streams its content to watchers; a progression's save tells them to read again.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Progression } from "@openclapper/model";
import * as api from "../api";
import type { FileRec } from "../api";
import { loadRoot } from "../files";
import { toastError } from "../hosts";
import type { EditLock, LiveDoc } from "../lock";
import { itemsOf, overlayOf, progressionBody, type Item } from "./progression";

export { itemKey, type Item } from "./progression";

/** A shot's, set's or location's content list. */
export interface Doc { content: string[] }
/** A progression: its settings, its items and its overlay. */
export interface ProgDoc { body: Progression; items: Item[]; overlay: string | null }

const SAVE_AFTER_MS = 400;

export const docOf = (f: Pick<FileRec, "refs">): Doc => ({ content: (f.refs ?? []).filter((r) => r.kind === "content").map((r) => r.to) });
const contentRefs = (d: Doc) => d.content.map((to) => ({ kind: "content", to }));
export const progDocOf = (f: Pick<FileRec, "refs" | "body">): ProgDoc => ({ body: progressionBody(f), items: itemsOf(f), overlay: overlayOf(f) });
/** What a progression saves: its body and its references. */
export const progChange = (d: ProgDoc) => ({
  body: d.body as unknown as Record<string, unknown>,
  refs: [...d.items.map((i) => ({ kind: "item", to: i.to, data: i.data as unknown as Record<string, unknown> })), ...(d.overlay ? [{ kind: "overlay", to: d.overlay }] : [])],
});

/**
 * A window's copy of one file: changed at once, saved shortly after, replaced when the file changed elsewhere and
 * nothing is pending. `live` is what the shot's room streams to watchers (the shot's own window only).
 */
function useSaved<D>(f: FileRec | undefined, read: (f: FileRec) => D, write: (d: D) => Record<string, unknown>, lock?: { current: EditLock | null }, live?: (d: D) => LiveDoc) {
  const [doc, setDoc] = useState<D | null>(() => (f ? read(f) : null));
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(doc);
  latest.current = doc;
  const file = useRef(f), target = useRef(f);
  file.current = f;
  useEffect(() => { if (!pending.current) setDoc(f ? read(f) : null); }, [f?.id, f?.updated_at]);
  const save = async () => {
    pending.current = null;
    const d = latest.current, l = lock?.current, at = target.current;
    if (!d || !at || (l && !l.held())) return;
    try { await (l ? api.putFileLocked(at.id, write(d), l.holder) : api.putFile(at.id, write(d))); }
    catch (e) { if (l && e instanceof api.ApiError && e.status === 423) l.lost(); else toastError(e); }
    finally { await loadRoot({ project: at.project_id! }); }
  };
  useEffect(() => () => { if (pending.current) { clearTimeout(pending.current); void save(); } }, [f?.id]);
  const change = (next: D | ((d: D) => D)) => {
    // Watching: someone else edits it (or nobody, until Edit).
    if (lock?.current && !lock.current.editing) return;
    if (!latest.current) return;
    const d = typeof next === "function" ? (next as (d: D) => D)(latest.current) : next;
    latest.current = d; setDoc(d); target.current = file.current;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(), SAVE_AFTER_MS);
    if (live) lock?.current?.send(() => live(latest.current!));
  };
  /** What the server or the live room says the file is now (while watching, or on starting to edit). */
  const reset = (x: Pick<FileRec, "body" | "refs">) => { if (pending.current || !file.current) return; const d = read({ ...file.current, ...x }); latest.current = d; setDoc(d); };
  /** Saves now what is pending (before something that reads the server, such as binning). */
  const flush = async () => { if (pending.current) { clearTimeout(pending.current); await save(); } };
  return { doc, change, flush, reset };
}

/** A shot's, set's or location's content list as its window edits it. */
export function useDoc(f: FileRec, lock?: { current: EditLock | null }) {
  const s = useSaved(f, docOf, (d) => ({ refs: contentRefs(d) }), lock, (d) => ({ body: {}, refs: contentRefs(d) }));
  return { ...s, doc: s.doc ?? docOf(f), change: s.change as (next: Doc | ((d: Doc) => Doc)) => void };
}

/** One progression of a shot as the shot's window edits it, under the shot's lock. */
export function useProgDoc(p: FileRec | undefined, lock?: { current: EditLock | null }) {
  return useSaved(p, progDocOf, progChange, lock);
}
