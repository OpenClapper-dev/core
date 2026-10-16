import type { ComponentType } from "preact";
import type { AppIdV } from "@fielder/vocab";
import type { Route } from "../router";
import * as wm from "../wm/wm";
import type { ResourceRef, Size, Win } from "../wm/wm";
import { FilesApp } from "./FilesApp";
import { GalleryApp } from "./GalleryApp";
import { FieldsApp, LocationsApp, ProjectsApp, RigsApp, ViewfinderApp } from "./LibraryApps";
import { MetadataApp } from "./MetadataApp";
import { PlanApp } from "./PlanApp";
import { ShotApp } from "./ShotApp";
import { TimelineApp } from "./TimelineApp";
import { SettingsApp } from "./SettingsApp";

/** Every app the desktop can open: APP_IDS in packages/vocab (the Worker validates app shortcuts with it). */
export type AppId = AppIdV;

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

const def = (id: AppId, name: string, icon: string, singleton: boolean, defaultSize: Size, minSize: Size, component: ComponentType<AppProps>, accepts?: string[]): AppDef =>
  ({ id, name, icon, singleton, accepts, defaultSize, minSize, component });

/** The registry: every app of the desktop. */
export const APPS: Record<AppId, AppDef> = {
  gallery: def("gallery", "Gallery", "view-grid-outline", true, { w: 1100, h: 720 }, { w: 560, h: 360 }, GalleryApp),
  shot: def("shot", "Shot", "image-outline", false, { w: 1180, h: 760 }, { w: 640, h: 420 }, ShotApp, ["shot"]),
  // Timeline and Plan are single windows (the cut / day is picked inside): see TimelineApp.
  timeline: def("timeline", "Timeline", "filmstrip", true, { w: 1240, h: 780 }, { w: 720, h: 480 }, TimelineApp, ["timeline"]),
  plan: def("plan", "Plan", "calendar-clock", true, { w: 1180, h: 740 }, { w: 640, h: 420 }, PlanApp, ["day"]),
  metadata: def("metadata", "Metadata", "tag-multiple-outline", true, { w: 1180, h: 720 }, { w: 640, h: 420 }, MetadataApp),
  files: def("files", "Files", "folder-multiple-outline", true, { w: 1000, h: 660 }, { w: 560, h: 360 }, FilesApp, ["folder"]),
  projects: def("projects", "Projects", "folder-outline", true, { w: 980, h: 660 }, { w: 600, h: 400 }, ProjectsApp),
  fields: def("fields", "Fields", "form-textbox", true, { w: 1100, h: 700 }, { w: 640, h: 420 }, FieldsApp, ["field"]),
  rigs: def("rigs", "Rigs", "camera-outline", true, { w: 1100, h: 700 }, { w: 640, h: 420 }, RigsApp),
  locations: def("locations", "Locations", "map-marker-outline", true, { w: 1100, h: 700 }, { w: 640, h: 420 }, LocationsApp, ["location"]),
  viewfinder: def("viewfinder", "Viewfinder layouts", "cellphone", true, { w: 1180, h: 760 }, { w: 720, h: 480 }, ViewfinderApp),
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
