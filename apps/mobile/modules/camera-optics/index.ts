import { requireOptionalNativeModule } from "expo";

/** One camera's optics from Camera2: the physical focal length, the sensor's active area and the 35 mm equivalent. */
export interface CameraOptics {
  /** The Camera2 id, the same as the camera library's device ids (logical and physical cameras). */
  id: string;
  /** Physical focal length in mm. */
  focal: number | null;
  sensorW: number | null;
  sensorH: number | null;
  /** 35 mm equivalent: focal × 43.27 ÷ the active sensor diagonal. */
  focal35: number | null;
}

const native = requireOptionalNativeModule<{ lenses(): CameraOptics[] }>("CameraOptics");

/**
 * Every camera's optics, logical and physical (#426); empty in a build without the module (an older dev client),
 * so the caller can tell "not known" from a value.
 */
export function cameraOptics(): CameraOptics[] {
  try { return native?.lenses() ?? []; } catch { return []; }
}
