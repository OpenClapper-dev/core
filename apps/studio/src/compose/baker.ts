/**
 * The bakery (epic #275): one flattened image per step for the phone, made here because only the
 * Studio can draw the stack. It watches the loaded shots and bakes every step whose bake is
 * missing or stale (vocab `bakeHash`), one at a time in the background, so a layer edit, a
 * framing change or migrated data reach the phone without anyone opening the shot. A step that
 * shows no layers needs no bake. A project that bakes approved shots only holds the others back.
 */
import { bakeHash, bakeKey, bakeWaits, layersAt } from "@openclapper/vocab";
import { putBake, type Shot } from "../api";
import * as data from "../data";
import { steps, stepStale } from "../format";
import { renderStep } from "./render";
import { loadShotLayers } from "./stack";

/** Bake the stale steps of one shot; returns the shot as the server last answered (or the input). */
export async function bakeShot(shot: Shot, onShot: (s: Shot) => void): Promise<Shot> {
  if (bakeWaits(shot)) return shot;
  const stale = steps(shot).filter((st) => stepStale(shot, st));
  if (!stale.length) return shot;
  const layers = await loadShotLayers(shot);
  let cur = shot;
  for (const st of stale) {
    // The hash of what is drawn: the fetched layers, which the server stores with the same versions.
    const hash = bakeHash(st, layers);
    if (!hash) continue;
    const blob = await renderStep(st.photo, st.frame, layersAt(layers, st));
    cur = await putBake(shot.id, bakeKey(st), hash, blob);
    onShot(cur);
  }
  return cur;
}

const failed = new Map<string, number>();
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Look for stale steps a moment after the shots changed; at most one shot is baked at a time. */
function schedule(delay = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void run(); }, delay);
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const now = Date.now();
      // A shot that failed waits a few minutes before the next attempt (a missing photo, a network error).
      const next = (data.getData().shots ?? []).find((s) => (failed.get(s.id) ?? 0) < now && !bakeWaits(s) && steps(s).some((st) => stepStale(s, st)));
      if (!next) break;
      // The shot list only, not data.updated: a bake changes no counts.
      try { await bakeShot(next, (s) => data.setShots((cur) => (cur ?? []).map((x) => (x.id === s.id ? s : x)))); failed.delete(next.id); }
      catch { failed.set(next.id, Date.now() + 5 * 60_000); }
    }
  } finally { running = false; }
}

/** Start watching the data store (once, from the shell); returns the stop function. */
export function startBakery(): () => void {
  let last = data.getData().shots;
  schedule(3000);
  const id = setInterval(() => {
    const now = data.getData().shots;
    if (now !== last) { last = now; schedule(); }
  }, 1000);
  return () => { clearInterval(id); if (timer) clearTimeout(timer); };
}
