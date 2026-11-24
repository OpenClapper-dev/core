/**
 * The core's file types. Each build step adds the types it builds (docs/rewrite/10-conclusion.md);
 * a type that is not registered here yet cannot be saved.
 */
import { registerFileType, type Body, type FileType, type Ref } from "./files.ts";

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
