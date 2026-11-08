import { useEffect, useState } from "preact/hooks";

/**
 * The lights a sequence is playing right now (#304, #289), so the Devices app keeps its hands off
 * them: a manual change in the middle of a native fade would fight the light's own fade. This tab only.
 */
let playing = new Set<string>();
const listeners = new Set<() => void>();

export function setPlayingFixtures(ids: Iterable<string>) {
  playing = new Set(ids);
  for (const cb of listeners) cb();
}

export function usePlayingFixtures(): ReadonlySet<string> {
  const [v, setV] = useState(playing);
  useEffect(() => { const cb = () => setV(playing); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  return v;
}
