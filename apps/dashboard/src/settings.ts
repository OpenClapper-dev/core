import { useEffect, useState } from "preact/hooks";
import type { ShotState } from "./api";

/**
 * Dashboard preferences (Settings page). Kept per browser in localStorage["settings"], like the
 * theme and the frame mode; a missing or unknown value falls back to the default, so new
 * settings need no migration.
 */
export interface Settings {
  /** Review state a shot made with New shot starts in. */
  newShotState: Extract<ShotState, "approved" | "unreviewed">;
  /**
   * While a clip is edited inline on the timeline stage (issue #31): "pin" holds the playhead on that
   * clip until you are done; "leave" lets you select, step or scrub away, which ends the edit (it is
   * saved first).
   */
  inlinePlayhead: "pin" | "leave";
  /** Removing a photo of a sequence block (issue #37): "photo" drops just that photo, "block" the whole sequence. */
  seqRemove: "photo" | "block";
  /**
   * Issue #51: landing on a clip that shows an overlay opens it in the inline editor right away, like a
   * video editor. Moving away then always ends the edit (inlinePlayhead acts as "leave").
   */
  autoOverlay: boolean;
}
export const DEFAULT_SETTINGS: Settings = { newShotState: "approved", inlinePlayhead: "pin", seqRemove: "photo", autoOverlay: false };

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem("settings") ?? "{}") as Partial<Settings>;
    return {
      newShotState: raw.newShotState === "unreviewed" ? "unreviewed" : DEFAULT_SETTINGS.newShotState,
      inlinePlayhead: raw.inlinePlayhead === "leave" ? "leave" : DEFAULT_SETTINGS.inlinePlayhead,
      seqRemove: raw.seqRemove === "block" ? "block" : DEFAULT_SETTINGS.seqRemove,
      autoOverlay: raw.autoOverlay === true,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
let current = read();
const listeners = new Set<(s: Settings) => void>();
export const getSettings = () => current;
export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem("settings", JSON.stringify(current)); } catch { /* private mode: kept for this session */ }
  for (const cb of listeners) cb(current);
}
/** The settings as state; re-renders when they change anywhere. */
export function useSettings(): Settings {
  const [s, setS] = useState(current);
  useEffect(() => { listeners.add(setS); return () => { listeners.delete(setS); }; }, []);
  return s;
}
