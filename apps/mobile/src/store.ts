import { useEffect, useState } from "react";
import { kv } from "./kv";

/**
 * A value the screens share and the phone keeps across restarts: read once from the key-value
 * store, written back on every change, and re-rendered wherever `use()` reads it.
 */
export interface Persisted<T> {
  get(): T;
  set(next: T | ((cur: T) => T)): void;
  subscribe(cb: () => void): () => void;
  use(): T;
}

export function persisted<T>(key: string, fallback: T, valid: (v: unknown) => boolean = () => true): Persisted<T> {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  const get = (): T => {
    if (value === undefined) {
      try { const raw = kv.getItemSync(key); const v = raw ? (JSON.parse(raw) as unknown) : undefined; value = v !== undefined && valid(v) ? (v as T) : fallback; } catch { value = fallback; }
    }
    return value;
  };
  const p: Persisted<T> = {
    get,
    set(next) {
      value = typeof next === "function" ? (next as (cur: T) => T)(get()) : next;
      try { kv.setItemSync(key, JSON.stringify(value)); } catch (e) { console.warn("kv write", key, e); }
      for (const cb of listeners) cb();
    },
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    use() {
      const [v, setV] = useState(get);
      useEffect(() => { setV(get()); return p.subscribe(() => setV(get())); }, []);
      return v;
    },
  };
  return p;
}
