import type { ComponentType } from "preact";
import type { Route } from "../router";
import * as wm from "../wm/wm";
import type { ResourceRef, Size, Win } from "../wm/wm";
import { Placeholder } from "./Placeholder";
import { SettingsApp } from "./SettingsApp";

/** Every app the desktop can open. Moves to packages/vocab with phase 3 (app shortcuts are validated server-side). */
export type AppId = "gallery" | "shot" | "timeline" | "plan" | "metadata" | "files" | "projects" | "fields" | "rigs" | "locations" | "viewfinder" | "settings";

/** What every app component receives from the shell; nothing else crosses the window boundary. */
export interface AppProps {
  win: Win;
  focused: boolean;
  resource: ResourceRef | null;
  setTitle: (t: string) => void;
  /** Mirror app state into the URL; the bridge shows it while this window is focused. */
  replaceRoute: (r: Route) => void;
  open: (intent: { app: AppId; resource?: ResourceRef; state?: unknown; title?: string }) => void;
  close: () => void;
}

export interface AppDef {
  id: AppId;
  name: string;
  icon: string;
  /** One window for the whole app; per-resource apps (shot, timeline, …) dedupe on the resource instead. */
  singleton: boolean;
  /** Resource types this app opens (the Files app routes double-clicks with it; phase 6). */
  accepts?: string[];
  defaultSize: Size;
  minSize: Size;
  component: ComponentType<AppProps>;
}

const def = (id: AppId, name: string, icon: string, singleton: boolean, defaultSize: Size, minSize: Size, component: ComponentType<AppProps> = Placeholder, accepts?: string[]): AppDef =>
  ({ id, name, icon, singleton, accepts, defaultSize, minSize, component });

/** The registry; only Settings has its real component in phase 1, the rest arrive with phases 4–6. */
export const APPS: Record<AppId, AppDef> = {
  gallery: def("gallery", "Gallery", "view-grid-outline", true, { w: 1100, h: 720 }, { w: 560, h: 360 }),
  shot: def("shot", "Shot", "image-outline", false, { w: 1100, h: 720 }, { w: 560, h: 400 }, Placeholder, ["shot"]),
  timeline: def("timeline", "Timeline", "filmstrip", false, { w: 1200, h: 760 }, { w: 640, h: 440 }, Placeholder, ["timeline"]),
  plan: def("plan", "Plan", "calendar-clock", false, { w: 1100, h: 720 }, { w: 600, h: 400 }, Placeholder, ["day"]),
  metadata: def("metadata", "Metadata", "tag-multiple-outline", true, { w: 1100, h: 700 }, { w: 600, h: 400 }),
  files: def("files", "Files", "folder-multiple-outline", true, { w: 960, h: 640 }, { w: 520, h: 360 }, Placeholder, ["folder"]),
  projects: def("projects", "Projects", "folder-outline", true, { w: 900, h: 620 }, { w: 520, h: 360 }),
  fields: def("fields", "Fields", "form-textbox", true, { w: 900, h: 620 }, { w: 520, h: 360 }, Placeholder, ["field"]),
  rigs: def("rigs", "Rigs", "camera-outline", true, { w: 960, h: 640 }, { w: 520, h: 360 }),
  locations: def("locations", "Locations", "map-marker-outline", true, { w: 960, h: 640 }, { w: 520, h: 360 }, Placeholder, ["location"]),
  viewfinder: def("viewfinder", "Viewfinder layouts", "cellphone", true, { w: 900, h: 620 }, { w: 520, h: 360 }),
  settings: def("settings", "Settings", "cog-outline", true, { w: 820, h: 620 }, { w: 480, h: 360 }, SettingsApp),
};

export const appDef = (id: string): AppDef | undefined => APPS[id as AppId];

/** Open an app window with the registry's defaults; the one place wm.open is fed app metadata. */
export function launch(intent: { app: AppId; resource?: ResourceRef | null; title?: string; state?: unknown }): string {
  const d = APPS[intent.app];
  return wm.open({
    app: d.id,
    resource: intent.resource ?? null,
    title: intent.title ?? d.name,
    singleton: d.singleton,
    size: d.defaultSize,
    minSize: d.minSize,
    state: intent.state,
  });
}
