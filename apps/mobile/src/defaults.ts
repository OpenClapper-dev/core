import { OVERLAY_DEFAULTS } from "@fielder/fov-math";
import { PHONE } from "./phone.ts";
import type { Settings } from "./types.ts";

/** Human-view focal lengths (FF-equivalent mm) the Human button cycles through and Setup offers. */
export const HUMAN_STEPS = [35, 43, 50];

export const DEFAULT_SETTINGS: Settings = {
  phoneEquivalentFocalMm: PHONE.mainCameraEquivalentFocalMm,
  phoneCalibration: "auto",
  phoneModel: null,
  borderColor: OVERLAY_DEFAULTS.borderColor,
  borderWidthPx: OVERLAY_DEFAULTS.borderWidthPx,
  blackoutEnabled: OVERLAY_DEFAULTS.blackoutEnabled,
  blackoutColor: OVERLAY_DEFAULTS.blackoutColor,
  rigOrientation: "landscape",
  fitToFrame: false,
  orientationLock: "auto",
  humanViewEnabled: false,
  humanViewFocalMm: 50,
  humanViewButton: "cycle",
  directUpload: false,
  loggingEnabled: false,
  hudChips: { project: true, rig: true, fov: true, gps: true, warnings: true },
  theme: "auto",
  gpsMode: "high",
  offlineMode: false,
};
