// What a flow's lanes show (docs/features/flows.md, "In the Studio"): a light's colour, the intensity graph, short
// labels of what a keyframe sets; and the view switches and keyframe size, kept per browser.
import { useState } from "preact/hooks";
import { DEFAULT_VIEW, LEVEL_STEPS, type FlowView, type LevelStep } from "@openclapper/ext-flows";
export { graphPoints, keyframeLevel, lightColour, shortLabel, VIEW_LABELS, type FlowView } from "@openclapper/ext-flows";

/** A per-browser setting (a viewer's convenience, not the flow's). */
function useLocal<T>(key: string, fallback: T, valid: (v: unknown) => boolean): [T, (v: T) => void] {
  const read = (): T => { try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : undefined; return v !== undefined && valid(v) ? (v as T) : fallback; } catch { return fallback; } };
  const [v, set] = useState(read);
  return [v, (next: T) => { set(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window */ } }];
}
/** The view switches; one added later (the stage's labels) starts at its default. */
export const useFlowView = (): [FlowView, (v: FlowView) => void] => { const [v, set] = useLocal<FlowView>("flows.view.v1", DEFAULT_VIEW, (x) => typeof x === "object" && x !== null); return [{ ...DEFAULT_VIEW, ...v }, set]; };
export const useKeyframeSize = () => useLocal<"s" | "m" | "l">("flows.kfSize.v1", "s", (v) => v === "s" || v === "m" || v === "l");
/** The height of every track (px); a track sized by hand keeps its own until this is set again. */
/** How far the time axis is stretched: 1 fits the flow's length into the window, more scrolls sideways (#426). */
export const ZOOM_MIN = 1, ZOOM_MAX = 32;
export const useZoom = () => useLocal<number>("flows.zoom.v1", 1, (v) => typeof v === "number" && v >= ZOOM_MIN && v <= ZOOM_MAX);
export const useTrackHeight = () => useLocal<number>("flows.trackHeight.v1", 64, (v) => typeof v === "number" && v >= 40 && v <= 240);
/** What an intensity drag snaps to, in percent (#426): 1 keeps the old feel; any percent can still be typed in. */
export const useLevelStep = () => useLocal<LevelStep>("flows.levelStep.v1", 1, (v) => (LEVEL_STEPS as readonly unknown[]).includes(v));

/**
 * The stage above the lanes (#426): shown or not, its height (px), dragged at the divider, and which of a flow's
 * stages is shown (by flow id; a viewer's choice, not the flow's).
 */
export interface StageLayout { on: boolean; h: number; shown?: Record<string, string> }
/** The stages shown, with this flow's: the most recent 50 flows, so the setting does not grow without end. */
export function keepShown(shown: Record<string, string> | undefined, flow: string, stage: string): Record<string, string> {
  const rest = Object.entries(shown ?? {}).filter(([k]) => k !== flow).slice(-49);
  return Object.fromEntries([...rest, [flow, stage]]);
}
export const useStageLayout = () => useLocal<StageLayout>("flows.stage.v1", { on: true, h: 360 }, (v) => typeof v === "object" && v !== null && typeof (v as StageLayout).h === "number");
