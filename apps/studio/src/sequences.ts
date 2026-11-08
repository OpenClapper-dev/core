import { useEffect, useState } from "preact/hooks";
import type { LightSequence } from "@openclapper/vocab";

/**
 * Light sequences (#304), first version: kept in this browser (localStorage) while the model is
 * still being tried; they move to the Worker once it settles. Every reader and write goes through
 * here, so that move touches one file.
 */
const KEY = "openclapper.sequences.v1";
const listeners = new Set<() => void>();

function read(): LightSequence[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as LightSequence[]) : [];
  } catch {
    return [];
  }
}

let cache: LightSequence[] = read();

export const getSequences = () => cache;

/** Replaces the list; false when the browser refused to store it (private window, full storage). */
export function saveSequences(next: LightSequence[]): boolean {
  cache = next;
  for (const cb of listeners) cb();
  try { localStorage.setItem(KEY, JSON.stringify(next)); return true; } catch { return false; }
}

export function upsertSequence(s: LightSequence): boolean {
  const stamped = { ...s, updatedAt: new Date().toISOString() };
  return saveSequences(cache.some((x) => x.id === s.id) ? cache.map((x) => (x.id === s.id ? stamped : x)) : [...cache, stamped]);
}

export const deleteSequence = (id: string) => saveSequences(cache.filter((x) => x.id !== id));

export function useSequences(): LightSequence[] {
  const [v, setV] = useState(cache);
  useEffect(() => { const cb = () => setV(cache); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  return v;
}
