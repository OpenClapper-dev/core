export type Stage = "photo" | "rigs" | "position" | "compose";
export type LibrarySection = "projects" | "fields" | "rigs" | "locations" | "viewfinder";
export const LIBRARY_SECTIONS: readonly LibrarySection[] = ["projects", "fields", "rigs", "locations", "viewfinder"];

/**
 * A position in a cut (issue #35): the playhead (`t`, seconds) and the inline tool open on the
 * clip under it (`tool`). The Timeline reports it into its window's route while you work; read on load.
 */
import { META_FIELDS, type MetaField } from "./MetadataPage";

export type CutTool = "reframe" | "overlay" | "sketch";
export interface CutPosition { ms: number; tool: CutTool | null }

function parseCutPosition(q: URLSearchParams): CutPosition | null {
  const t = Number(q.get("t"));
  const tool = q.get("tool");
  const ok = tool === "reframe" || tool === "overlay" || tool === "sketch" ? tool : null;
  if (!q.has("t") && !ok) return null;
  return { ms: Number.isFinite(t) && t > 0 ? Math.round(t * 10) * 100 : 0, tool: ok };
}
function cutQuery(at: CutPosition | null | undefined): string {
  if (!at) return "";
  const q = new URLSearchParams();
  if (at.ms > 0) q.set("t", (at.ms / 1000).toFixed(1));
  if (at.tool) q.set("tool", at.tool);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Everything the URL hash can address, so deep links survive a reload. */
export type Route =
  | { page: "shots"; viewId: string | null }
  | { page: "shot"; shotId: string; stage: Stage }
  | { page: "plan"; dayId: string | null }
  | { page: "metadata"; field: MetaField }
  | { page: "timeline"; timelineId: string | null; at?: CutPosition | null }
  | { page: "settings"; tab: SettingsTab }
  | { page: "library"; section: LibrarySection; id: string | null }
  | { page: "files"; folderId: string | null }
  | { page: "trash" };

export type SettingsTab = "general" | "shortcuts";

export const DEFAULT_ROUTE: Route = { page: "shots", viewId: null };

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case "shots":
      if (parts[1]) {
        const st = q.get("stage");
        return { page: "shot", shotId: parts[1], stage: st === "rigs" || st === "position" || st === "compose" ? st : "photo" };
      }
      return { page: "shots", viewId: q.get("view") };
    case "plan": return { page: "plan", dayId: parts[1] ?? null };
    case "metadata": return { page: "metadata", field: (META_FIELDS as readonly string[]).includes(parts[1]) ? (parts[1] as MetaField) : "location" };
    case "timeline": return { page: "timeline", timelineId: parts[1] ?? null, at: parts[1] ? parseCutPosition(q) : null };
    case "settings": return { page: "settings", tab: parts[1] === "shortcuts" ? "shortcuts" : "general" };
    case "files": return { page: "files", folderId: parts[1] ?? null };
    case "trash": return { page: "trash" };
    case "library": {
      const section = (LIBRARY_SECTIONS as readonly string[]).includes(parts[1]) ? (parts[1] as LibrarySection) : "projects";
      return { page: "library", section, id: parts[2] ?? null };
    }
    default: return DEFAULT_ROUTE;
  }
}

export function routeHash(r: Route): string {
  switch (r.page) {
    case "shots": return r.viewId ? `#/shots?view=${r.viewId}` : "#/shots";
    case "shot": return `#/shots/${r.shotId}${r.stage === "photo" ? "" : `?stage=${r.stage}`}`;
    case "plan": return r.dayId ? `#/plan/${r.dayId}` : "#/plan";
    case "metadata": return `#/metadata/${r.field}`;
    case "timeline": return r.timelineId ? `#/timeline/${r.timelineId}${cutQuery(r.at)}` : "#/timeline";
    case "settings": return r.tab === "shortcuts" ? "#/settings/shortcuts" : "#/settings";
    case "library": return `#/library/${r.section}${r.id ? `/${r.id}` : ""}`;
    case "files": return r.folderId ? `#/files/${r.folderId}` : "#/files";
    case "trash": return "#/trash";
  }
}
