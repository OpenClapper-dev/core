/**
 * Phone camera defaults until the first capture calibrates the real phone from its EXIF
 * (calibration.ts, issue #26). 25 mm is a typical main camera (and the Motorola Edge 50 Pro's).
 * The preview is the sensor's native 4:3 frame; at zoom 1 it shows the main camera's full field of
 * view, and other zooms scale it (zoom.ts).
 */
export const PHONE = {
  mainCameraEquivalentFocalMm: 25,
  sensorAspect: 4 / 3,
} as const;
