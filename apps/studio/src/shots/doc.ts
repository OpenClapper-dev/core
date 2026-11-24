// What a shot, a set or a location holds, as the window edits it (docs/features/shots.md): the content list,
// and for a shot the progression's items, its overlay and its settings. Changes show at once and are saved
// a moment later as one PUT of the file's references and body; the store reads the project again after.
import { useEffect, useRef, useState } from "preact/hooks";
import { newProgression, type ItemData, type Progression, type ShotBody } from "@openclapper/model";
import * as api from "../api";
import type { FileRec } from "../api";
import { loadRoot } from "../files";
import { toastError } from "../hosts";

/** An item of a progression: the picture it shows and its data; `key` only tells items apart while editing. */
export interface Item { key: string; to: string; data: ItemData }
export interface Doc { content: string[]; items: Item[]; overlay: string | null; progression: Progression | null }

const SAVE_AFTER_MS = 400;
let keys = 0;
export const itemKey = () => `i${++keys}`;

export function docOf(f: FileRec): Doc {
  const refs = f.refs ?? [];
  const body = (f.body ?? {}) as Partial<ShotBody>;
  return {
    content: refs.filter((r) => r.kind === "content").map((r) => r.to),
    items: refs.filter((r) => r.kind === "item").map((r) => ({ key: itemKey(), to: r.to, data: (r.data ?? { ms: 2000 }) as unknown as ItemData })),
    overlay: refs.find((r) => r.kind === "overlay")?.to ?? null,
    progression: body.progression ?? null,
  };
}

const refsOf = (d: Doc, shot: boolean) => [
  ...d.content.map((to) => ({ kind: "content", to })),
  ...(shot && d.progression ? [...d.items.map((i) => ({ kind: "item", to: i.to, data: i.data as unknown as Record<string, unknown> })), ...(d.overlay ? [{ kind: "overlay", to: d.overlay }] : [])] : []),
];

/** The window's copy of a file's lists: changed at once, saved shortly after, replaced when the file changed elsewhere and nothing is pending. */
export function useDoc(f: FileRec) {
  const shot = f.type === "shot";
  const [doc, setDoc] = useState<Doc>(() => docOf(f));
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(doc);
  latest.current = doc;
  useEffect(() => { if (!pending.current) setDoc(docOf(f)); }, [f.id, f.updated_at]);
  const save = async () => {
    pending.current = null;
    const d = latest.current;
    try { await api.putFile(f.id, { refs: refsOf(d, shot), ...(shot ? { body: { progression: d.progression } } : {}) }); }
    catch (e) { toastError(e); }
    finally { await loadRoot({ project: f.project_id! }); }
  };
  useEffect(() => () => { if (pending.current) { clearTimeout(pending.current); void save(); } }, []);
  const change = (next: Doc | ((d: Doc) => Doc)) => {
    const d = typeof next === "function" ? next(latest.current) : next;
    latest.current = d; setDoc(d);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };
  /** Saves now what is pending (before something that reads the server, such as binning). */
  const flush = async () => { if (pending.current) { clearTimeout(pending.current); await save(); } };
  return { doc, change, flush, startProgression: () => change((d) => ({ ...d, progression: d.progression ?? newProgression() })) };
}
