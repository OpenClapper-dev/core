/**
 * Phone camera defaults until the first capture calibrates the real phone from its EXIF
 * (calibration.ts, issue #26). 25 mm is a typical main camera (and the Motorola Edge 50 Pro's).
 * The preview is the sensor's native 4:3 frame; expo-camera does not apply a digital zoom at
 * zoom=0, so the 4:3 preview shows the main camera's full field of view.
 */
export const PHONE = {
  mainCameraEquivalentFocalMm: 25,
  sensorAspect: 4 / 3,
} as const;
