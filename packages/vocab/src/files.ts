/**
 * Folders and desktop shortcuts (epic #72): the resource types that are "files", the apps a
 * desktop shortcut may open, and the shape a desktop item must have. The Worker validates with
 * these; the dashboard's Files app and desktop render with them.
 */

/** Resources that can sit in a folder or on the desktop. Rigs, layouts and devices are global: they are apps, not files. */
export const FILE_RESOURCE_TYPES = ["shot", "timeline", "day", "view", "location", "field"] as const;
export type FileResourceType = (typeof FILE_RESOURCE_TYPES)[number];

export const DESKTOP_ITEM_KINDS = ["resource", "folder", "app"] as const;
export type DesktopItemKind = (typeof DESKTOP_ITEM_KINDS)[number];

/** Every app of the dashboard desktop (the shell's registry uses the same ids). */
export const APP_IDS = ["gallery", "shot", "timeline", "plan", "metadata", "files", "projects", "fields", "rigs", "locations", "viewfinder", "settings"] as const;
export type AppIdV = (typeof APP_IDS)[number];

/** Folder nesting limit, counted from the root (a top-level folder has depth 1). */
export const MAX_FOLDER_DEPTH = 8;
export const MAX_FOLDER_NAME = 80;
export const MAX_DESKTOP_LABEL = 80;

/** How each file type is named and drawn, and which app opens it. */
export const FILE_TYPE_META: Record<FileResourceType, { label: string; plural: string; icon: string; app: AppIdV }> = {
  shot: { label: "Shot", plural: "Shots", icon: "image-outline", app: "shot" },
  timeline: { label: "Timeline", plural: "Timelines", icon: "filmstrip", app: "timeline" },
  day: { label: "Shooting day", plural: "Shooting days", icon: "calendar-outline", app: "plan" },
  view: { label: "View", plural: "Views", icon: "filter-variant", app: "gallery" },
  location: { label: "Location", plural: "Locations", icon: "map-marker-outline", app: "locations" },
  field: { label: "Field", plural: "Fields", icon: "form-textbox", app: "fields" },
};

export const isFileResourceType = (v: unknown): v is FileResourceType => typeof v === "string" && (FILE_RESOURCE_TYPES as readonly string[]).includes(v);
export const isAppId = (v: unknown): v is AppIdV => typeof v === "string" && (APP_IDS as readonly string[]).includes(v);

export interface DesktopItemInput {
  kind: DesktopItemKind;
  resource_type?: FileResourceType | null;
  resource_id?: string | null;
  folder_id?: string | null;
  app_id?: AppIdV | null;
  label?: string | null;
  x: number;
  y: number;
}

/**
 * Checks a desktop item's shape: exactly the target fields of its kind, a known app or type, a
 * short label, a finite position. Returns an error message, or null when it is fine. Ids are
 * format-checked by the caller (the Worker's assertUuid).
 */
export function validateDesktopItem(v: unknown): string | null {
  if (!v || typeof v !== "object") return "must be an object";
  const o = v as Record<string, unknown>;
  if (!(DESKTOP_ITEM_KINDS as readonly unknown[]).includes(o.kind)) return `kind must be one of: ${DESKTOP_ITEM_KINDS.join(", ")}`;
  const has = (k: string) => o[k] !== undefined && o[k] !== null;
  const want = { resource: ["resource_type", "resource_id"], folder: ["folder_id"], app: ["app_id"] }[o.kind as DesktopItemKind];
  for (const k of ["resource_type", "resource_id", "folder_id", "app_id"]) {
    if (want.includes(k) && !has(k)) return `${k} is required for a ${o.kind as string} item`;
    if (!want.includes(k) && has(k)) return `${k} is not allowed on a ${o.kind as string} item`;
  }
  if (o.kind === "resource" && !isFileResourceType(o.resource_type)) return `resource_type must be one of: ${FILE_RESOURCE_TYPES.join(", ")}`;
  if (o.kind === "app" && !isAppId(o.app_id)) return `app_id must be one of: ${APP_IDS.join(", ")}`;
  if (has("label") && (typeof o.label !== "string" || o.label.trim().length === 0 || o.label.length > MAX_DESKTOP_LABEL)) return `label must be a non-empty string of at most ${MAX_DESKTOP_LABEL} characters`;
  for (const k of ["x", "y"]) {
    const n = o[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100_000) return `${k} must be a number between 0 and 100000`;
  }
  return null;
}
