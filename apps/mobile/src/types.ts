import type { Extra } from "@fielder/vocab";

export interface Preset {
  id: string;
  name: string;
  /** Camera body + recording format from @fielder/fov-math CAMERAS, or null for a custom sensor. */
  cameraId: string | null;
  formatId: string | null;
  /** Resolved active sensor area; source of truth for the math. */
  sensorWidthMm: number;
  sensorHeightMm: number;
  speedboosterFactor: number;
  /** Optional focal-length range of the lens on this rig (e.g. 18-35 zoom); null = any lens. */
  lensMinMm: number | null;
  lensMaxMm: number | null;
  createdAt: string;
  /** false until the Worker has acknowledged the PUT. */
  synced: boolean;
}

export interface LensRange { min: number; max: number }
export const lensRangeOf = (p: Preset | null | undefined): LensRange | null =>
  p && p.lensMinMm != null && p.lensMaxMm != null ? { min: p.lensMinMm, max: p.lensMaxMm } : null;

export type RigOrientation = "landscape" | "portrait";
/** Screen orientation the app locks to on launch; "auto" follows the sensor. */
export type OrientationLock = "auto" | "landscape" | "portrait";

/**
 * How a capture gets its position. "high": a fresh, precise fix (may wait up to 8 s when the signal
 * is poor); "low": whatever the phone has right now, never waits; "off": no GPS at all (the location
 * service is not used, photos carry no position).
 */
export type GpsMode = "high" | "low" | "off";
export const GPS_MODES: readonly GpsMode[] = ["high", "low", "off"];

/** Viewfinder HUD chips. "warnings" covers no project, no/poor GPS, sign-in and rig-wider-than-phone notices. */
export interface HudChips { project: boolean; rig: boolean; fov: boolean; gps: boolean; warnings: boolean }

export interface Settings {
  /** 35mm-equivalent focal length of the phone's main camera; from the photos' EXIF in "auto", typed in "manual". */
  phoneEquivalentFocalMm: number;
  /** Issue #26: "auto" takes the value from each capture's EXIF, "manual" keeps the typed one. */
  phoneCalibration: "auto" | "manual";
  /** The phone model the auto value came from (EXIF), for Setup; null before the first capture. */
  phoneModel: string | null;
  /** The viewfinder layout made on the dashboard (issue #49); null = the shipped default. */
  viewfinderLayoutId: string | null;
  borderColor: string;
  borderWidthPx: number;
  blackoutEnabled: boolean;
  blackoutColor: string;
  rigOrientation: RigOrientation;
  /** Digitally scale the preview so the rig frame fills the screen. */
  fitToFrame: boolean;
  orientationLock: OrientationLock;
  /** Draw a second, thin frame showing roughly what a human sees (a "normal" lens, in FF-equivalent mm). */
  humanViewEnabled: boolean;
  humanViewFocalMm: number;
  /** Human button: "cycle" steps off -> 35 -> 43 -> 50 -> off; "toggle" flips between off and humanViewFocalMm. */
  humanViewButton: "cycle" | "toggle";
  /** Skip the tag form after a capture: every shot (or finished sequence) goes straight into the upload queue. */
  directUpload: boolean;
  /** Record a detailed log on the phone that can be shared for debugging. */
  loggingEnabled: boolean;
  /** Which info chips the live view shows (Setup → Viewfinder); each is switched on its own. */
  hudChips: HudChips;
  /** "auto" follows the phone's dark mode; "sun" = light (daylight), "set" = dark. */
  theme: "auto" | "sun" | "set";
  gpsMode: GpsMode;
  /** Never touch the network: uploads and edits wait on the phone until this is switched off. */
  offlineMode: boolean;
}

/** Scouting tags entered in the review form after capture. Values are @fielder/vocab ids; null / [] / false = not specified. */
export interface ShotTags {
  name: string | null;
  /** Daylight phases the shot works in (subset of LIGHT). */
  light: string[];
  /** Lit artificially, independent of the daylight phases. */
  artificial: boolean;
  weather: string | null;
  int_ext: string | null;
  location_id: string | null;
  /** A spot within the location (issue #44); cleared when the location changes. */
  spot_id: string | null;
  shot_size: string | null;
  camera_support: string | null;
  /** Any subset of MOVEMENTS. */
  movement: string[];
  extra: Extra;
}

/** One captured image. Rig/lens framing and GPS are per photo (a sequence can change lens). */
export interface PhotoMetadata {
  id: string;
  /** Position inside the shot, 0-based. */
  ordinal: number;
  timestamp: string;
  /** Both null when captured without a position (GPS off, or no fix at all). */
  lat: number | null;
  lon: number | null;
  gps_accuracy_m: number | null;
  /** Set by hand on the phone before upload. */
  position_corrected?: boolean;
  lens_mm: number;
  preset_id: string | null;
  width: number;
  height: number;
  /** Rig/lens snapshot incl. `frame` fractions, so the dashboard can re-apply the mask. */
  framing: Record<string, unknown>;
  /** Phone model, EXIF focal lengths, GPS extras. */
  device: Record<string, unknown>;
}

/** What POST /api/shots receives: the shot's tags plus its photos. */
export interface ShotMetadata extends ShotTags {
  id: string;
  project_id: string;
  /** A review decision made on the phone before upload (absent = unreviewed). */
  state?: "unreviewed" | "approved" | "archived";
  photos: PhotoMetadata[];
}

/** A named place; lives on the server, cached locally so the form works offline. Shared by all projects. */
export interface LocationEntry {
  id: string;
  /** Locations belong to one project (issue #44). */
  projectId: string;
  name: string;
  createdAt: string;
  /** false until the Worker has acknowledged the PUT. */
  synced: boolean;
}

/** A viewfinder layout as cached from the server (issue #49). */
export interface LayoutEntry { id: string; name: string; layout: unknown }

/** A named place within a location (issue #44). Created on the phone like locations, offline too. */
export interface SpotEntry {
  id: string;
  locationId: string;
  name: string;
  createdAt: string;
  /** false until the Worker has acknowledged the PUT. */
  synced: boolean;
}

/** Every shot belongs to one; the active one is chosen once and remembered. Cached locally like locations. */
export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: string;
  /** Extra-field definitions the project uses, in order (see /vocab fields.ts). */
  fieldIds?: string[];
  /** false until the Worker has acknowledged the PUT. */
  synced: boolean;
}

export interface PendingUpload {
  metadata: ShotMetadata;
  /** Persistent local copy of each photo's low-res JPEG, by photo id. */
  files: Record<string, string>;
  attempts: number;
  lastError?: string;
  /** Rejected by the server repeatedly: kept on the phone, only retried by hand (Setup → Uploads). */
  stuck?: boolean;
  /** Tags or state changed after a part was already sent: the upload ends with a PATCH (the server keeps the tags of an existing shot). */
  editedAfterSend?: boolean;
  /** At least one part reached the server. */
  sent?: boolean;
}
/** Changes to an uploaded shot made without a connection; replayed in order by flush(). */
export interface PendingEdit {
  shotId: string;
  /** Tag and state changes merged (later wins). */
  patch: Partial<ShotTags> & { state?: ShotMetadata["state"] };
  /** Hand-set positions, in order. */
  positions: { photoId: string; lat: number; lon: number; all: boolean }[];
  at: string;
}

/** A shot that left the queue (Uploads → Uploaded, kept 7 days). */
export interface UploadRecord { id: string; projectId: string; name: string | null; photos: number; capturedAt: string; uploadedAt: string }

/** One captured photo waiting for the tag form or the queue. */
export interface DraftPhoto {
  /** Local file (temp for single captures, persistent for sequences). */
  uri: string;
  meta: PhotoMetadata;
  /** Rig frame relative to the photo, for the preview. */
  frame: { width: number; height: number };
}

/** A capture (one photo) or a sequence (many) that is not queued yet. */
export interface CaptureDraft {
  shotId: string;
  photos: DraftPhoto[];
}
