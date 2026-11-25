// What a flow's lanes show (docs/features/flows.md, "In the Studio"): a light's colour, the intensity graph, short
// labels of what a keyframe sets; and the view switches and keyframe size, kept per browser.
import { useState } from "preact/hooks";
import { DEFAULT_VIEW, type FlowView } from "@openclapper/ext-flows";
export { graphPoints, keyframeLevel, lightColour, shortLabel, VIEW_LABELS, type FlowView } from "@openclapper/ext-flows";

/** A per-browser setting (a viewer's convenience, not the flow's). */
function useLocal<T>(key: string, fallback: T, valid: (v: unknown) => boolean): [T, (v: T) => void] {
  const read = (): T => { try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : undefined; return v !== undefined && valid(v) ? (v as T) : fallback; } catch { return fallback; } };
  const [v, set] = useState(read);
  return [v, (next: T) => { set(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window */ } }];
}
export const useFlowView = () => useLocal<FlowView>("flows.view.v1", DEFAULT_VIEW, (v) => typeof v === "object" && v !== null);
export const useKeyframeSize = () => useLocal<"s" | "m" | "l">("flows.kfSize.v1", "s", (v) => v === "s" || v === "m" || v === "l");
/** The height of every track (px); a track sized by hand keeps its own until this is set again. */
/** How far the time axis is stretched: 1 fits the flow's length into the window, more scrolls sideways (#426). */
export const ZOOM_MIN = 1, ZOOM_MAX = 32;
export const useZoom = () => useLocal<number>("flows.zoom.v1", 1, (v) => typeof v === "number" && v >= ZOOM_MIN && v <= ZOOM_MAX);
export const useTrackHeight = () => useLocal<number>("flows.trackHeight.v1", 64, (v) => typeof v === "number" && v >= 40 && v <= 240);

