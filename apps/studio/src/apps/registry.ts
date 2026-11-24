import type { ComponentType } from "preact";
import type { IconName } from "@openclapper/design";
import * as wm from "../wm/wm";
import type { ResourceRef, Size, Win } from "../wm/wm";
import { BinApp } from "./BinApp";
import { FilesApp, LocationsApp, MediaApp, SetsApp, ShotsApp, filesFromRoute, mediaFromRoute } from "./FilesApp";
import { PhotoApp } from "./PhotoApp";
import { CanvasApp } from "./CanvasApp";
import { ShotApp } from "./ShotApp";
import { TimelineApp, timelineFromRoute } from "./TimelineApp";
import { MasterApp } from "./MasterApp";
import { LayoutsApp, layoutsFromRoute } from "./LayoutsApp";
import { DevicesApp } from "./DevicesApp";
import { PresetsApp } from "./PresetsApp";
import { ProjectApp } from "./ProjectApp";
import { SettingsApp } from "./SettingsApp";

/**
 * The Studio's app catalogue (docs/rewrite/09-shells.md): an app is a program that opens one or more
 * file types. The shell knows apps only through this registry; each build step adds the apps it builds.
 */
export interface OpenIntent { app: string; resource?: ResourceRef | null; title?: string; state?: unknown }

/** What every app component receives from the shell; nothing else crosses the window boundary. */
export interface AppProps {
  win: Win;
  focused: boolean;
  resource: ResourceRef | null;
  projectId: string;
  setTitle: (t: string) => void;
  /** What follows `#/<app>` in the address bar while this window has focus (a tab, a folder). */
  setRoute: (rest: string) => void;
  open: (intent: OpenIntent) => void;
  close: () => void;
}

export interface AppDef {
  id: string;
  name: string;
  glyph: IconName;
  /** 0 neutral, 1 to 8 categorical (the design system's app icon). */
  color: number;
  tier: "core" | "standard" | "extension";
  /** One window for the whole app; other apps have one window per file. */
  singleton: boolean;
  /** The file types a double-click opens in this app. */
  opens?: readonly string[];
  defaultSize: Size;
  minSize: Size;
  component: ComponentType<AppProps>;
  /** A deep link's `#/<app>/<rest>` as a launch: what the app's own `setRoute` wrote. */
  fromRoute?: (rest: string) => Pick<OpenIntent, "resource" | "state">;
  /** Shown in the launcher's search and the command palette next to the name. */
  about?: string;
}

const APPS: AppDef[] = [
  { id: "media", name: "Media", glyph: "image", color: 4, tier: "core", singleton: true, defaultSize: { w: 1100, h: 700 }, minSize: { w: 560, h: 360 }, component: MediaApp,
    fromRoute: mediaFromRoute, about: "Photos and collections; import" },
  { id: "shots", name: "Shots", glyph: "slate", color: 1, tier: "core", singleton: true, defaultSize: { w: 1100, h: 680 }, minSize: { w: 560, h: 360 }, component: ShotsApp,
    fromRoute: filesFromRoute, about: "The shot list: shots with their properties, as a list or a board" },
  { id: "sets", name: "Sets", glyph: "home", color: 2, tier: "core", singleton: true, defaultSize: { w: 1100, h: 680 }, minSize: { w: 560, h: 360 }, component: SetsApp,
    fromRoute: filesFromRoute, about: "The places in the story where scenes play" },
  { id: "locations", name: "Locations", glyph: "location", color: 3, tier: "core", singleton: true, defaultSize: { w: 1100, h: 680 }, minSize: { w: 560, h: 360 }, component: LocationsApp,
    fromRoute: filesFromRoute, about: "The real places where it is filmed, on a map" },
  { id: "photo", name: "Photo", glyph: "image", color: 4, tier: "core", singleton: false, opens: ["photo"], defaultSize: { w: 1100, h: 760 }, minSize: { w: 480, h: 360 }, component: PhotoApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "photo", id: rest } : null }), about: "One photo with its facts" },
  { id: "files", name: "Files", glyph: "folder", color: 5, tier: "core", singleton: true, opens: ["folder", "collection", "filter"], defaultSize: { w: 1040, h: 660 }, minSize: { w: 560, h: 360 }, component: FilesApp,
    fromRoute: filesFromRoute, about: "Folders of the project and of your home" },
  { id: "shot", name: "Shot", glyph: "slate", color: 1, tier: "core", singleton: false, opens: ["shot"], defaultSize: { w: 1280, h: 820 }, minSize: { w: 720, h: 480 }, component: ShotApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "shot", id: rest } : null }), about: "A shot: its properties, content and progression" },
  { id: "set", name: "Set", glyph: "home", color: 2, tier: "core", singleton: false, opens: ["set"], defaultSize: { w: 1100, h: 720 }, minSize: { w: 640, h: 420 }, component: ShotApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "set", id: rest } : null }), about: "A set: the place in the story, with what describes it" },
  { id: "location", name: "Location", glyph: "location", color: 3, tier: "core", singleton: false, opens: ["location"], defaultSize: { w: 1100, h: 720 }, minSize: { w: 640, h: 420 }, component: ShotApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "location", id: rest } : null }), about: "A location: the real place, with what was gathered there" },
  { id: "timeline", name: "Timeline", glyph: "timeline", color: 6, tier: "standard", singleton: false, opens: ["timeline"], defaultSize: { w: 1320, h: 840 }, minSize: { w: 760, h: 500 }, component: TimelineApp,
    fromRoute: timelineFromRoute, about: "A rough cut: clips with hold times, played back" },
  { id: "master", name: "Master timeline", glyph: "film", color: 1, tier: "standard", singleton: true, defaultSize: { w: 1280, h: 800 }, minSize: { w: 720, h: 480 }, component: MasterApp, about: "The project's timelines in order, played end to end" },
  { id: "layouts", name: "Camera layouts", glyph: "camera-layout", color: 3, tier: "core", singleton: true, opens: ["layout"], defaultSize: { w: 1280, h: 820 }, minSize: { w: 760, h: 520 }, component: LayoutsApp,
    fromRoute: layoutsFromRoute, about: "Which controls the phone's camera shows, and where" },
  { id: "devices", name: "Devices", glyph: "mobile", color: 6, tier: "core", singleton: true, opens: ["device"], defaultSize: { w: 1040, h: 720 }, minSize: { w: 600, h: 400 }, component: DevicesApp, about: "Your phones and tablets: their tabs and camera layout" },
  { id: "canvas", name: "Canvas", glyph: "brush", color: 7, tier: "core", singleton: false, opens: ["canvas"], defaultSize: { w: 1280, h: 820 }, minSize: { w: 720, h: 480 }, component: CanvasApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "canvas", id: rest } : null }), about: "Draw, place photos and frame them" },
  { id: "presets", name: "Optics presets", glyph: "lens", color: 6, tier: "standard", singleton: true, opens: ["preset"], defaultSize: { w: 1000, h: 640 }, minSize: { w: 560, h: 380 }, component: PresetsApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "preset", id: rest } : null }), about: "Cameras with their lenses, for frames on a canvas" },
  { id: "bin", name: "Recycle bin", glyph: "trash", color: 0, tier: "core", singleton: true, defaultSize: { w: 900, h: 560 }, minSize: { w: 520, h: 320 }, component: BinApp, about: "What was deleted, for 30 days" },
  { id: "project", name: "Project", glyph: "slate", color: 2, tier: "core", singleton: true, defaultSize: { w: 860, h: 600 }, minSize: { w: 520, h: 360 }, component: ProjectApp,
    fromRoute: (rest) => ({ state: { tab: rest } }), about: "This project and all projects" },
  { id: "settings", name: "Settings", glyph: "settings", color: 0, tier: "core", singleton: true, opens: ["preferences"], defaultSize: { w: 820, h: 600 }, minSize: { w: 480, h: 360 }, component: SettingsApp,
    fromRoute: (rest) => ({ state: { tab: rest } }), about: "Appearance, account, shortcuts" },
];

export const apps = (): readonly AppDef[] => APPS;
export const appDef = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
/** The app registered for a file type, if any. */
export const appFor = (fileType: string): AppDef | undefined => APPS.find((a) => a.opens?.includes(fileType));

/** Open an app window with the registry's defaults; the one place wm.open is fed app metadata. */
export function launch(intent: OpenIntent): string | null {
  const d = appDef(intent.app);
  if (!d) return null;
  return wm.open({ app: d.id, resource: intent.resource ?? null, title: intent.title ?? d.name, singleton: d.singleton, size: d.defaultSize, minSize: d.minSize, state: intent.state });
}
