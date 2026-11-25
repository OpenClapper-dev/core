import { setLogging } from "./log";
import { setOfflineMode } from "./net";
import { persisted } from "./store";

/**
 * What belongs to this phone rather than to the account: offline mode, keeping the project on the
 * phone, the debug log. Applied at start, before the first request.
 */
export interface LocalSettings {
  /** No requests at all; photos wait in the queue. */
  offlineMode: boolean;
  /** Keep the active project's thumbnails and previews on the phone (Media without a connection). */
  keepProject: boolean;
  logging: boolean;
  /** How large the camera's buttons are on this device (#426): small on a phone, large on a tablet. */
  cameraButtons?: CameraButtonSize;
}
export type CameraButtonSize = "s" | "m" | "l";
/** The camera's button sizes (dp): the button, its icon, the shutter. */
export const CAMERA_BUTTONS: Record<CameraButtonSize, { size: number; icon: number; shutter: number }> = {
  s: { size: 40, icon: 18, shutter: 64 },
  m: { size: 48, icon: 22, shutter: 76 },
  l: { size: 60, icon: 28, shutter: 92 },
};

export const settings = persisted<LocalSettings>("settings.v2", { offlineMode: false, keepProject: false, logging: false });
/** This device's camera button sizes. */
export const useCameraButtons = () => CAMERA_BUTTONS[settings.use().cameraButtons ?? "m"] ?? CAMERA_BUTTONS.m;

export function setSettings(change: Partial<LocalSettings>) {
  settings.set((s) => ({ ...s, ...change }));
  apply();
}

/** Puts the stored switches into effect. */
export function apply() {
  const s = settings.get();
  setLogging(s.logging);
  setOfflineMode(s.offlineMode);
}
