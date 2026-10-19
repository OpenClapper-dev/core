/**
 * Shared vocabularies for shot metadata. Stored values are the lowercase ids;
 * `label()` gives the display string. Worker, mobile app and Studio all import this.
 */

/**
 * Daylight phases a shot works in. A shot stores any subset ("dusk or night both work").
 * Artificial light is a separate flag on the shot, independent of these and of INT/EXT.
 */
export const LIGHT = ["dawn", "day", "dusk", "night"] as const;
export type Light = (typeof LIGHT)[number];

/** "none" = not relevant / indoors. */
export const WEATHER = ["none", "sunny", "partly_cloudy", "cloudy", "rainy", "stormy", "foggy", "snow"] as const;
export type Weather = (typeof WEATHER)[number];

/** Screenplay convention: INT (interior) / EXT (exterior). */
export const INT_EXT = ["int", "ext"] as const;
export type IntExt = (typeof INT_EXT)[number];

export const SHOT_STATES = ["unreviewed", "approved", "archived"] as const;

/** Where a photo comes from: the phone camera (with rig framing), an uploaded image, or a sketch drawn in the Studio. */
export const PHOTO_SOURCES = ["camera", "upload", "drawn"] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

/**
 * Camera language of a shot, in the terms used on set. Size and support are single choices,
 * movement any subset (a Steadicam shot can pan and push in). Widest to tightest, then roughly
 * from fixed to free.
 */
export const SHOT_SIZES = ["ews", "ws", "mws", "ms", "mcu", "cu", "ecu"] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];
export const CAMERA_SUPPORTS = ["static", "handheld", "steadicam", "gimbal", "dolly", "slider", "crane", "drone", "vehicle"] as const;
export type CameraSupport = (typeof CAMERA_SUPPORTS)[number];
export const MOVEMENTS = ["pan", "tilt", "push_in", "pull_out", "tracking", "pedestal", "orbit", "zoom"] as const;
export type Movement = (typeof MOVEMENTS)[number];
/** The abbreviations a shot list uses ("MCU"). */
export const SHOT_SIZE_ABBR: Record<ShotSize, string> = { ews: "EWS", ws: "WS", mws: "MWS", ms: "MS", mcu: "MCU", cu: "CU", ecu: "ECU" };
export type ShotState = (typeof SHOT_STATES)[number];

const LABELS: Record<string, string> = {
  partly_cloudy: "Partly cloudy",
  int: "INT",
  ext: "EXT",
  ews: "Extreme wide",
  ws: "Wide",
  mws: "Medium wide",
  ms: "Medium",
  mcu: "Medium close-up",
  cu: "Close-up",
  ecu: "Extreme close-up",
  static: "Static (locked-off)",
  crane: "Crane / jib",
  vehicle: "Vehicle mount",
  pedestal: "Pedestal / boom",
};

/** "WS · Steadicam · Pan / Push in", or "" when none is set. */
export function cameraLabel(s: { shot_size: string | null; camera_support: string | null; movement: readonly string[] | null | undefined }): string {
  const size = s.shot_size ? SHOT_SIZE_ABBR[s.shot_size as ShotSize] ?? label(s.shot_size) : "";
  const moves = MOVEMENTS.filter((m) => s.movement?.includes(m)).map(label).join(" / ");
  return [size, label(s.camera_support), moves].filter(Boolean).join(" · ");
}

/** Display label for any vocabulary value ("partly_cloudy" -> "Partly cloudy", "dawn" -> "Dawn"). */
export function label(value: string | null | undefined): string {
  if (!value) return "";
  return LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

/** "Dusk / Night + Artificial", "Artificial", or "" when nothing is set. Phases are listed in LIGHT order. */
export function lightLabel(light: readonly string[] | null | undefined, artificial: boolean): string {
  const phases = LIGHT.filter((l) => light?.includes(l)).map(label).join(" / ");
  return [phases, artificial ? "Artificial" : ""].filter(Boolean).join(" + ");
}

/** Map-pin fills: fixed in both themes because pins sit on map tiles, not on a themed surface. */
export const STATE_COLORS: Record<ShotState, string> = {
  unreviewed: "#FFB000",
  approved: "#0F8A43",
  archived: "#6E6E76",
};

/**
 * Material Design Icons names, identical on both clients (MDI webfont in the Studio,
 * MaterialCommunityIcons on the phone). State and phase are never shown by colour alone.
 */
export const STATE_ICONS: Record<ShotState, string> = { unreviewed: "circle-half-full", approved: "check-circle", archived: "archive" };
export const PHASE_ICONS: Record<Light | "artificial", string> = {
  dawn: "weather-sunset-up",
  day: "weather-sunny",
  dusk: "weather-sunset-down",
  night: "weather-night",
  artificial: "lightbulb-on-outline",
};

export const isOneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/**
 * "Extra" metadata: a free-form JSON object on the shot. Field definitions that describe and
 * validate it per project come later; until then only the shape and size are checked.
 */
export type ExtraValue = string | number | boolean | null | ExtraValue[] | { [k: string]: ExtraValue };
export type Extra = Record<string, ExtraValue>;

const MAX_EXTRA_BYTES = 16 * 1024;

/** Validates an `extra` object. Returns the error or null. */
export function validateExtra(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "extra must be an object";
  if (JSON.stringify(v).length > MAX_EXTRA_BYTES) return "extra is too large";
  return null;
}

/** "U-Bahn: U4 · Station: Bayerischer Platz"; nested objects are flattened one level per key. */
export function extraLabel(extra: Extra | null | undefined): string {
  if (!extra) return "";
  const parts: string[] = [];
  const walk = (o: Extra) => {
    for (const [k, v] of Object.entries(o)) {
      if (v === null || v === "") continue;
      if (typeof v === "object" && !Array.isArray(v)) walk(v);
      else parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    }
  };
  walk(extra);
  return parts.join(" · ");
}
