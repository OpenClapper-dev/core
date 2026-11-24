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
