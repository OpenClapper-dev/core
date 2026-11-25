import type { IconName } from "@openclapper/design";
import { fileType } from "@openclapper/model";
import type { FileRec } from "./api";
import { appDef } from "./apps/registry";

/**
 * How each file type looks in the Studio: its glyph and its colour (0 neutral, 1 to 8 categorical).
 * Names come from the shared model; a type without an entry here still shows, as a plain file.
 */
const LOOK: Record<string, { glyph: IconName; color: number }> = {
  folder: { glyph: "folder", color: 5 },
  shortcut: { glyph: "shortcut", color: 0 },
  preferences: { glyph: "settings", color: 0 },
  settings: { glyph: "settings", color: 2 },
  device: { glyph: "mobile", color: 6 },
  layout: { glyph: "camera-layout", color: 3 },
  photo: { glyph: "image", color: 4 },
  collection: { glyph: "layers", color: 4 },
  shot: { glyph: "slate", color: 1 },
  filter: { glyph: "filter", color: 8 },
  property: { glyph: "tag", color: 0 },
  naming: { glyph: "edit", color: 0 },
  // Types of later steps, named already by properties and naming patterns.
  canvas: { glyph: "brush", color: 7 },
  preset: { glyph: "lens", color: 6 },
  set: { glyph: "home", color: 2 },
  location: { glyph: "location", color: 3 },
  timeline: { glyph: "timeline", color: 6 },
};
/** How an extension's file type looks (from its extensions.ts entry). */
export function registerFileLook(type: string, look: { glyph: IconName; color: number }) { LOOK[type] = look; }
/** Labels of types later steps register, so a property can be attached to them before they exist. */
const LATER: Record<string, [string, string]> = { timeline: ["Timeline", "Timelines"] };

export interface Kind { label: string; plural: string; glyph: IconName; color: number; holds: boolean }

export function kindOf(type: string): Kind {
  const t = fileType(type);
  return { label: t?.label ?? LATER[type]?.[0] ?? type, plural: t?.plural ?? LATER[type]?.[1] ?? type, holds: !!t?.holds, ...(LOOK[type] ?? { glyph: "file" as IconName, color: 0 }) };
}

/** What a shortcut opens: an app, a file of the same root, or nothing any more. */
export type Target = { app: string } | { file: FileRec } | null;
export function targetOf(f: FileRec, files: ReadonlyMap<string, FileRec>): Target {
  if (f.type !== "shortcut") return { file: f };
  const app = f.body?.app;
  if (typeof app === "string") return appDef(app) ? { app } : null;
  const to = f.refs?.find((r) => r.kind === "target")?.to;
  const file = to ? files.get(to) : undefined;
  return file ? { file } : null;
}

/** How a file shows as an icon or a row: a shortcut takes the look of what it opens. */
const PAGE_GLYPH: Record<string, IconName> = { general: "slate", properties: "tag", naming: "edit", customizations: "sliders", extensions: "extension", appearance: "palette", account: "user", shortcuts: "keyboard" };
/** The fixed folders' own glyphs: a first-class folder like an OS's Desktop, not a padlock. */
const FIXED_GLYPH: Record<string, IconName> = { desktop: "desktop", settings: "settings" };
export const fixedGlyph = (fixed: string): IconName => FIXED_GLYPH[fixed] ?? "folder";

export function lookOf(f: FileRec, files: ReadonlyMap<string, FileRec>): { glyph: IconName; color: number; shortcut: boolean; broken: boolean } {
  if (f.fixed && f.type === "folder") return { glyph: fixedGlyph(f.fixed), color: 5, shortcut: false, broken: false };
  // A settings page (#426): its page's glyph; the person's in one colour, the project's in another.
  if (f.type === "settings") return { glyph: PAGE_GLYPH[(f.body as { page?: string } | undefined)?.page ?? ""] ?? "settings", color: f.home ? 8 : 2, shortcut: false, broken: false };
  if (f.type !== "shortcut") return { ...kindOf(f.type), shortcut: false, broken: false };
  const t = targetOf(f, files);
  if (!t) return { glyph: "shortcut", color: 0, shortcut: true, broken: true };
  if ("app" in t) { const d = appDef(t.app)!; return { glyph: d.glyph, color: d.color, shortcut: true, broken: false }; }
  return { ...kindOf(t.file.type), shortcut: true, broken: false };
}
