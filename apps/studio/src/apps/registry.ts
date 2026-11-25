import type { ComponentType } from "preact";
import type { IconName } from "@openclapper/design";
import * as wm from "../wm/wm";
import type { ResourceRef, Size, Win } from "../wm/wm";
import { BinApp } from "./BinApp";
import { FilesApp, filesFromRoute } from "./FilesApp";
import { PhotoApp } from "./PhotoApp";
import { CanvasApp } from "./CanvasApp";
import { ShotApp } from "./ShotApp";
import { TimelineApp, timelineFromRoute } from "./TimelineApp";
import { LayoutsApp, layoutsFromRoute } from "./LayoutsApp";
import { DevicesApp } from "./DevicesApp";
import { PresetsApp } from "./PresetsApp";
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
  /** 0 neutral, 1 to 8 categorical, 10 to 18 the outlined tile in a colour (the design system's app icon); every app its own (#426). */
  color: number;
  tier: "core" | "standard" | "extension";
  /** The extension that brings it: listed only while the project has it on; a window of it says it needs it. */
  extension?: string;
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
  { id: "photo", name: "Photo", glyph: "image", color: 4, tier: "core", singleton: false, opens: ["photo"], defaultSize: { w: 1100, h: 760 }, minSize: { w: 480, h: 360 }, component: PhotoApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "photo", id: rest } : null }), about: "One photo with its facts" },
  { id: "files", name: "Files", glyph: "folder", color: 5, tier: "core", singleton: false, opens: ["folder", "collection", "filter"], defaultSize: { w: 1040, h: 660 }, minSize: { w: 560, h: 360 }, component: FilesApp,
    fromRoute: filesFromRoute, about: "Folders of the project and of your home; photos, shots, sets and locations" },
  { id: "shot", name: "Shot", glyph: "slate", color: 1, tier: "core", singleton: false, opens: ["shot"], defaultSize: { w: 1280, h: 820 }, minSize: { w: 720, h: 480 }, component: ShotApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "shot", id: rest } : null }), about: "A shot: its properties, content and progression" },
  { id: "set", name: "Set", glyph: "home", color: 2, tier: "core", singleton: false, opens: ["set"], defaultSize: { w: 1100, h: 720 }, minSize: { w: 640, h: 420 }, component: ShotApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "set", id: rest } : null }), about: "A set: the place in the story, with what describes it" },
  { id: "location", name: "Location", glyph: "location", color: 3, tier: "core", singleton: false, opens: ["location"], defaultSize: { w: 1100, h: 720 }, minSize: { w: 640, h: 420 }, component: ShotApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "location", id: rest } : null }), about: "A location: the real place, with what was gathered there" },
  { id: "timeline", name: "Timeline", glyph: "timeline", color: 6, tier: "standard", singleton: false, opens: ["timeline"], defaultSize: { w: 1320, h: 840 }, minSize: { w: 760, h: 500 }, component: TimelineApp,
    fromRoute: timelineFromRoute, about: "A rough cut: clips with hold times, played back" },
  { id: "layouts", name: "Camera layouts", glyph: "camera-layout", color: 13, tier: "core", singleton: true, opens: ["layout"], defaultSize: { w: 1280, h: 820 }, minSize: { w: 760, h: 520 }, component: LayoutsApp,
    fromRoute: layoutsFromRoute, about: "Which controls the phone's camera shows, and where" },
  { id: "devices", name: "Devices", glyph: "mobile", color: 16, tier: "core", singleton: true, opens: ["device"], defaultSize: { w: 1040, h: 720 }, minSize: { w: 600, h: 400 }, component: DevicesApp, about: "Your phones and tablets: their tabs and camera layout" },
  { id: "canvas", name: "Canvas", glyph: "brush", color: 7, tier: "core", singleton: false, opens: ["canvas"], defaultSize: { w: 1280, h: 820 }, minSize: { w: 720, h: 480 }, component: CanvasApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "canvas", id: rest } : null }), about: "Draw, place photos and frame them" },
  { id: "presets", name: "Optics presets", glyph: "lens", color: 8, tier: "standard", singleton: true, opens: ["preset"], defaultSize: { w: 1000, h: 640 }, minSize: { w: 560, h: 380 }, component: PresetsApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "preset", id: rest } : null }), about: "Cameras with their lenses, for frames on a canvas" },
  { id: "bin", name: "Recycle bin", glyph: "trash", color: 10, tier: "core", singleton: true, defaultSize: { w: 900, h: 560 }, minSize: { w: 520, h: 320 }, component: BinApp, about: "What was deleted, for 30 days" },
  { id: "settings", name: "Settings", glyph: "settings", color: 0, tier: "core", singleton: true, opens: ["settings", "preferences", "property", "naming"], defaultSize: { w: 900, h: 640 }, minSize: { w: 480, h: 360 }, component: SettingsApp,
    fromRoute: (rest) => ({ state: { tab: rest } }), about: "Yours, the project's and all projects: appearance, account, shortcuts, properties, naming, extensions" },
];

let active: readonly string[] = [];
/** The extensions the current project has on; the shell sets it when the project or its switches change. */
export function setActiveExtensions(list: readonly string[]) { active = list; }
export const extensionOn = (id: string | undefined): boolean => !id || active.includes(id);
export const activeExtensions = (): readonly string[] => active;
/** Adds an app an extension brings (from the client's extensions.ts). */
export function registerApp(def: AppDef) {
  const i = APPS.findIndex((a) => a.id === def.id);
  if (i >= 0) APPS[i] = def; else APPS.push(def);
}

/** The apps to offer in the current project: the core's and those of the extensions it has on. */
export const apps = (): readonly AppDef[] => APPS.filter((a) => extensionOn(a.extension));
export const appDef = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);
/** The app registered for a file type, if any. */
export const appFor = (fileType: string): AppDef | undefined => APPS.find((a) => a.opens?.includes(fileType) && extensionOn(a.extension)) ?? APPS.find((a) => a.opens?.includes(fileType));

/** Open an app window with the registry's defaults; the one place wm.open is fed app metadata. */
export function launch(intent: OpenIntent): string | null {
  const d = appDef(intent.app);
  if (!d) return null;
  return wm.open({ app: d.id, resource: intent.resource ?? null, title: intent.title ?? d.name, singleton: d.singleton, size: d.defaultSize, minSize: d.minSize, state: intent.state });
}
