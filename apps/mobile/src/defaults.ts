import { PHONE } from "./phone.ts";
import type { Settings } from "./types.ts";


export const DEFAULT_SETTINGS: Settings = {
  phoneEquivalentFocalMm: PHONE.mainCameraEquivalentFocalMm,
  phoneCalibration: "auto",
  phoneModel: null,
  viewfinderLayoutId: null,
  rigOrientation: "landscape",
  fitToFrame: false,
  orientationLock: "auto",
  humanViewEnabled: false,
  humanViewFocalMm: 50,
  directUpload: false,
  loggingEnabled: false,
  theme: "auto",
  gpsMode: "high",
  offlineMode: false,
};
