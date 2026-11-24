import type { ComponentType } from "preact";
import type { IconName } from "@openclapper/design";
import * as wm from "../wm/wm";
import type { ResourceRef, Size, Win } from "../wm/wm";
import { BinApp } from "./BinApp";
import { FilesApp, MediaApp, filesFromRoute, mediaFromRoute } from "./FilesApp";
import { PhotoApp } from "./PhotoApp";
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
  { id: "photo", name: "Photo", glyph: "image", color: 4, tier: "core", singleton: false, opens: ["photo"], defaultSize: { w: 1100, h: 760 }, minSize: { w: 480, h: 360 }, component: PhotoApp,
    fromRoute: (rest) => ({ resource: rest ? { type: "photo", id: rest } : null }), about: "One photo with its facts" },
  { id: "files", name: "Files", glyph: "folder", color: 5, tier: "core", singleton: true, opens: ["folder", "collection"], defaultSize: { w: 1040, h: 660 }, minSize: { w: 560, h: 360 }, component: FilesApp,
    fromRoute: filesFromRoute, about: "Folders of the project and of your home" },
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
