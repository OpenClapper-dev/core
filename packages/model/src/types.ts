/**
 * The core's file types. Each build step adds the types it builds (docs/rewrite/10-conclusion.md);
 * a type that is not registered here yet cannot be saved.
 */
import { registerFileType, type Body, type FileType, type Ref } from "./files.ts";
import { canvasError, emptyCanvas, presetError, remapCanvas } from "./canvas.ts";
import { filterError } from "./filters.ts";
import { emptyShot, placeError, shotError } from "./shot.ts";
import { emptyTimeline, remapTimeline, timelineError } from "./timeline.ts";
import { BUILTIN_LAYOUTS, copyLayout, layoutError } from "./layout.ts";
import { defaultPattern, definitionError, MAX_DIGITS } from "./properties.ts";

const noKeys = (body: Body, what: string): string | null => {
  const extra = Object.keys(body);
  return extra.length ? `a ${what} has no "${extra[0]}"` : null;
};

/** Contains any files, and nests. Its sorting is the browser's choice, so it stores nothing of its own. */
export const FOLDER: FileType = {
  type: "folder", label: "Folder", plural: "Folders", roots: ["project", "home"], holds: "any", version: 1,
  empty: () => ({}),
  check: (body) => noKeys(body, "folder"),
};

/** What a shortcut may open besides a file: an app of the catalogue, by its id (docs/rewrite/09-shells.md). */
const APP_ID = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * A shortcut opens an app or a file that lives elsewhere; the Desktop folder shows them as icons.
 * It names an app in its body, or keeps one "target" reference: exactly one of the two.
 */
export const SHORTCUT: FileType = {
  type: "shortcut", label: "Shortcut", plural: "Shortcuts", roots: ["project"], refs: ["target"], version: 1,
  empty: () => ({ app: null }),
  check(body, refs: readonly Ref[]) {
    for (const k of Object.keys(body)) if (k !== "app") return `a shortcut has no "${k}"`;
    const app = body.app ?? null;
    if (app !== null && (typeof app !== "string" || !APP_ID.test(app))) return "app must be an app id";
    if (refs.length > 1) return "a shortcut points at one file";
    if ((app === null) === (refs.length === 0)) return "a shortcut opens an app or points at a file, one of the two";
    return null;
  },
};

registerFileType(FOLDER);
registerFileType(SHORTCUT);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const oneOf = (v: unknown, list: readonly string[]) => typeof v === "string" && list.includes(v);

/** What a person's preferences may hold; every key is optional, a missing one means the default. */
const PREFERENCE_RULES: Record<string, (v: unknown) => boolean> = {
  theme: (v) => oneOf(v, ["auto", "light", "dark"]),
  taskbarEdge: (v) => oneOf(v, ["bottom", "top", "left", "right"]),
  taskbarAlign: (v) => oneOf(v, ["start", "center"]),
  binOnDesktop: (v) => typeof v === "boolean",
  // How a collection's colour is drawn on its photos (docs/rewrite/ux-1-files.md).
  collectionMark: (v) => oneOf(v, ["bar", "barleft", "dot", "frame"]),
  // The camera's lenses by the phone's own names (0.5×, 1×) or by focal length (docs/rewrite/ux-5-phone.md).
  lensNames: (v) => oneOf(v, ["phone", "focal"]),
  // Collection mode asks for a name when a collection starts, when it ends, or never.
  askCollectionName: (v) => oneOf(v, ["never", "start", "end"]),
  // Originals wait for Wi-Fi on the phone; thumbnail and preview go at once.
  originalsOnWifi: (v) => typeof v === "boolean",
  // How long a clip added to a timeline holds, unless the timeline says otherwise (docs/features/timeline.md).
  // A canvas made from a photo starts with the frame the photo was taken with (docs/features/camera-layouts.md).
  canvasTakesFrame: (v) => typeof v === "boolean",
  clipHoldMs: (v) => typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 3_600_000,
  // The taskbar's pins per project: apps by id, files by id.
  pins: (v) => isRecord(v) && Object.entries(v).every(([project, list]) => UUID.test(project) && Array.isArray(list) && list.length <= 60
    && list.every((p) => isRecord(p) && Object.keys(p).length === 1 && (typeof p.app === "string" ? APP_ID.test(p.app) : typeof p.file === "string" && UUID.test(p.file)))),
  // Where each desktop icon sits, per project: a file's id (or "bin") to its cell of the icon grid.
  icons: (v) => isRecord(v) && Object.entries(v).every(([project, cells]) => UUID.test(project) && isRecord(cells) && Object.keys(cells).length <= 500
    && Object.entries(cells).every(([id, c]) => (id === "bin" || UUID.test(id)) && isRecord(c) && Number.isInteger(c.c) && Number.isInteger(c.r) && (c.c as number) >= 0 && (c.r as number) >= 0 && (c.c as number) < 1000 && (c.r as number) < 1000)),
};

/**
 * A person's preferences (docs/rewrite/09-shells.md): one file in their account home, so theme,
 * taskbar, pins and the places of the desktop's icons follow the account to every browser. Window
 * layouts are not in it: they depend on the screen and stay with the browser.
 */
export const PREFERENCES: FileType = {
  type: "preferences", label: "Preferences", plural: "Preferences", roots: ["home"], version: 1,
  empty: () => ({}),
  check(body) {
    for (const [k, v] of Object.entries(body)) {
      const ok = PREFERENCE_RULES[k];
      if (!ok) return `preferences have no "${k}"`;
      if (!ok(v)) return `${k} is not valid`;
    }
    return null;
  },
};

registerFileType(PREFERENCES);

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A still image (docs/rewrite/01-media.md). It is made by uploading it (the photo routes), never
 * through the general file route, and what it stores about itself is read-only: the raw EXIF tags
 * of the original and a readout of the device and lens. Its other facts (sizes, time taken, angle
 * of view) are columns of the photos table.
 */
export const PHOTO: FileType = {
  type: "photo", label: "Photo", plural: "Photos", roots: ["project"], version: 1, made: "upload",
  empty: () => ({ exif: {}, readout: {} }),
  check(body) {
    for (const k of Object.keys(body)) if (k !== "exif" && k !== "readout") return `a photo has no "${k}"`;
    if (!isRecord(body.exif)) return "exif must be an object";
    for (const v of Object.values(body.exif)) if (!(typeof v === "string" || typeof v === "number" || (Array.isArray(v) && v.every((x) => typeof x === "number")))) return "exif values are text, numbers or lists of numbers";
    if (!isRecord(body.readout)) return "readout must be an object";
    for (const [k, v] of Object.entries(body.readout)) if (!["make", "model", "lens"].includes(k) || typeof v !== "string" || v.length > 120) return "readout holds make, model and lens as text";
    return null;
  },
};

/**
 * Photos that belong together (docs/rewrite/i1-interjection.md): contains only photos and does not
 * nest. It has a colour (one of the eight categorical ones, or any colour as #rrggbb), given at
 * random when it is made, and an order for the media library: by time taken, or set by hand.
 */
export const COLLECTION: FileType = {
  type: "collection", label: "Collection", plural: "Collections", roots: ["project"], holds: ["photo"], version: 1,
  empty: () => ({ color: 1, order: "time" }),
  check(body) {
    for (const k of Object.keys(body)) if (!["color", "order", "manual"].includes(k)) return `a collection has no "${k}"`;
    const c = body.color;
    if (!((typeof c === "number" && Number.isInteger(c) && c >= 1 && c <= 8) || (typeof c === "string" && HEX.test(c)))) return "color must be 1 to 8, or a colour as #rrggbb";
    if (body.order !== "time" && body.order !== "manual") return "order must be time or manual";
    if (body.manual !== undefined && !(Array.isArray(body.manual) && body.manual.length <= 5000 && body.manual.every((x) => typeof x === "string" && UUID.test(x)))) return "manual must be a list of photo ids";
    return null;
  },
};

registerFileType(PHOTO);
registerFileType(COLLECTION);

const KINDS = ["phone", "tablet"] as const;
const short = (v: unknown, max = 120) => typeof v === "string" && v.length <= max;
const size = (v: unknown) => isRecord(v) && Number.isInteger(v.w) && Number.isInteger(v.h) && (v.w as number) > 0 && (v.h as number) > 0 && (v.w as number) < 20000 && (v.h as number) < 20000;

/** One of a device's real lenses as its camera reports it (docs/rewrite/03-capture.md). */
export interface DeviceLens {
  /** The camera's own id for the lens. */
  id: string;
  /** The phone's own name for it (0.5×, 1×, 5×); the app shows it or the focal length, as the person prefers. */
  name: string;
  /** The 35 mm-equivalent focal length the camera reports; null when it reports none (no optics frame on that lens). */
  focal35: number | null;
  /** The zoom factor of the logical camera at which this lens takes over, where the camera reports one. */
  zoom: number | null;
}

/**
 * A registered piece of hardware (docs/rewrite/03-capture.md): in the core a phone or tablet running
 * the app. It registers itself (the device route), tied to a fingerprint of the hardware, and keeps
 * what it reports current: model, real lenses, screen. Which apps are its tabs is the person's
 * choice, from the phone or the Studio. It lives in the account home and is made only by
 * registering; its body can be changed (its tabs).
 */
export const DEVICE: FileType = {
  type: "device", label: "Device", plural: "Devices", roots: ["home"], version: 1, made: "register",
  empty: () => ({ kind: "phone", make: "", model: "", lenses: [], screen: null, camera: null, tabs: [], app: "", layout: "viewfinder" }),
  check(body) {
    for (const k of Object.keys(body)) if (!["kind", "make", "model", "lenses", "screen", "camera", "tabs", "app", "layout"].includes(k)) return `a device has no "${k}"`;
    if (!(KINDS as readonly unknown[]).includes(body.kind)) return "kind must be phone or tablet";
    if (!short(body.make) || !short(body.model) || !short(body.app, 60)) return "make, model and app are text";
    if (!Array.isArray(body.lenses) || body.lenses.length > 16) return "lenses must be a list of at most 16";
    for (const l of body.lenses) {
      if (!isRecord(l) || !short(l.id, 60) || !short(l.name, 20)) return "a lens has an id and a name";
      if (!(l.focal35 === null || (typeof l.focal35 === "number" && l.focal35 > 0 && l.focal35 < 2000))) return "a lens's focal35 is a positive number or null";
      if (!(l.zoom === null || (typeof l.zoom === "number" && l.zoom > 0 && l.zoom < 1000))) return "a lens's zoom is a positive number or null";
    }
    if (!(body.screen === null || (isRecord(body.screen) && size(body.screen.portrait) && size(body.screen.landscape)))) return "screen holds portrait and landscape sizes";
    if (!Array.isArray(body.tabs) || body.tabs.length > 20 || !body.tabs.every((t) => typeof t === "string" && APP_ID.test(t))) return "tabs must be a list of app ids";
    // The camera's area per orientation (bars and picture, without the tab bar): the layout editor previews at it.
    if (!(body.camera === undefined || body.camera === null || (isRecord(body.camera) && size(body.camera.portrait) && size(body.camera.landscape)))) return "camera holds portrait and landscape sizes";
    // The camera layout in use: a built-in one or a layout file of the account home.
    if (!(body.layout === undefined || body.layout === "camera" || body.layout === "viewfinder" || (typeof body.layout === "string" && UUID.test(body.layout)))) return "layout is camera, viewfinder or a layout's id";
    return null;
  },
};

registerFileType(DEVICE);

/**
 * A camera layout (03-capture.md, ux-6-devices.md): bars of controls per orientation, a look and options. A
 * file of the account home, like the devices it is designed for; the built-in Camera and Viewfinder are not files.
 */
export const LAYOUT: FileType = {
  type: "layout", label: "Camera layout", plural: "Camera layouts", roots: ["home"], version: 1,
  empty: () => copyLayout(BUILTIN_LAYOUTS.viewfinder.body) as unknown as Body,
  check: (body) => layoutError(body),
};
registerFileType(LAYOUT);

/**
 * A property definition (docs/rewrite/07-organisation.md, "Properties in detail"): one entry of the
 * project's catalogue, a file in the Settings folder. Its name is the property's name; its values on
 * files are rows of `property_values` (properties.ts has the rules).
 */
export const PROPERTY: FileType = {
  type: "property", label: "Property", plural: "Properties", roots: ["project"], onlyIn: "settings", version: 1,
  empty: () => ({ field: "text", attached: [], order: 0 }),
  check: (body) => definitionError(body),
};

/** How new files of one type are named (04-shots.md, "Names"): a pattern with tokens and the digits of its counter. A file in Settings, one per file type. */
export const NAMING: FileType = {
  type: "naming", label: "Naming pattern", plural: "Naming patterns", roots: ["project"], onlyIn: "settings", version: 1,
  empty: () => ({ for: "shot", ...defaultPattern("shot") }),
  check(body) {
    for (const k of Object.keys(body)) if (!["for", "pattern", "digits"].includes(k)) return `a naming pattern has no "${k}"`;
    if (typeof body.for !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(body.for)) return "for names a file type";
    if (typeof body.pattern !== "string" || body.pattern.length > 80) return "pattern is a text of at most 80 characters";
    if (!Number.isInteger(body.digits) || (body.digits as number) < 1 || (body.digits as number) > MAX_DIGITS) return `digits is 1 to ${MAX_DIGITS}`;
    return null;
  },
};

/** A saved query over the project's files (filters.ts); opening it lists what matches now. */
export const FILTER: FileType = {
  type: "filter", label: "Filter", plural: "Filters", roots: ["project"], version: 1,
  empty: () => ({ match: "all", rules: [] }),
  check: (body) => filterError(body),
};

/**
 * A shot (04-shots.md): an intent, a file with properties, a content list ("content" references, in
 * order) and at most one progression (its "item" references, an "overlay" reference, and its settings
 * in the body). Items and the overlay show pictures only; the Worker checks the types (`refTargets`).
 * Version 2: the body went from {} to { progression }.
 */
export const SHOT: FileType = {
  type: "shot", label: "Shot", plural: "Shots", roots: ["project"], refs: ["content", "item", "overlay"], version: 2, lockable: true,
  refTargets: { item: ["photo", "canvas"], overlay: ["canvas"] },
  empty: () => emptyShot() as unknown as Body,
  check: (body, refs) => shotError(body, refs),
  upgrade: (body) => ({ progression: null, ...body }),
};

/** A set (09a-places.md): the place in the story where a scene plays (Motiv). Properties and a content list. */
export const SET: FileType = {
  type: "set", label: "Set", plural: "Sets", roots: ["project"], refs: ["content"], version: 1,
  empty: () => ({}),
  check: (body, refs) => placeError("set", body, refs),
};

/** A location (09a-places.md): the real place where it is filmed (Drehort). Properties (address, position) and a content list. */
export const LOCATION: FileType = {
  type: "location", label: "Location", plural: "Locations", roots: ["project"], refs: ["content"], version: 1,
  empty: () => ({}),
  check: (body, refs) => placeError("location", body, refs),
};

registerFileType(PROPERTY);
registerFileType(NAMING);
registerFileType(FILTER);
registerFileType(SHOT);
registerFileType(SET);
registerFileType(LOCATION);

/**
 * A canvas (docs/rewrite/05-composition.md): one tool for drawing, placing pictures and framing. Its
 * surface is blank or a base photo (the "base" reference); placed pictures keep "placed" references.
 * One editor at a time.
 */
export const CANVAS: FileType = {
  type: "canvas", label: "Canvas", plural: "Canvases", roots: ["project"], refs: ["base", "placed"], version: 1, lockable: true,
  empty: () => emptyCanvas() as unknown as Body,
  check: (body, refs) => canvasError(body, refs),
  remap: (body, ids) => remapCanvas(body, ids),
};

/**
 * An optics preset (docs/rewrite/02-optics.md): a named camera with its lenses. What shapes the
 * picture never changes; lenses are added, and removed only where no frame uses them (the Worker
 * checks that against the frames of the project).
 */
export const PRESET: FileType = {
  type: "preset", label: "Optics preset", plural: "Optics presets", roots: ["project"], version: 1,
  empty: () => ({ format: [36, 24], formatName: "Full frame (135)", multiplier: 1, squeeze: 1, delivery: null, lenses: { kind: "primes", primes: [24, 35, 50, 85] }, archived: false }),
  check: (body) => presetError(body),
};

/**
 * A timeline (06-timeline.md): a rough cut of clips in order, edited by one person at a time. The clips are in
 * the body; each clip with a file keeps a "clip" reference, which shows a photo, a canvas or a shot (`refTargets`).
 */
export const TIMELINE: FileType = {
  type: "timeline", label: "Timeline", plural: "Timelines", roots: ["project"], refs: ["clip"], version: 1, lockable: true,
  refTargets: { clip: ["photo", "canvas", "shot"] },
  empty: () => emptyTimeline() as unknown as Body,
  check: (body, refs) => timelineError(body, refs),
  remap: (body, ids) => remapTimeline(body, ids),
};

registerFileType(CANVAS);
registerFileType(TIMELINE);
registerFileType(PRESET);
