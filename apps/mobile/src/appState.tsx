import { createContext, useContext } from "react";
import type { Shot, ShootingDay } from "./api";
import type { ShotsData } from "./shots";
import type { LivePreview } from "./preview";
import type { ViewfinderLayout, VfLook, VfOptions } from "@fielder/vocab";
import type { LayoutEntry, LocationEntry, ProjectEntry, Settings, SpotEntry, ViewSettings } from "./types";

/** The five tabs. Everything else is a pushed full screen (Route) or a sheet. */
export type Tab = "shoot" | "history" | "shots" | "day" | "setup";

/**
 * Full screens pushed over the tabs (tab bar hidden). Android back pops one. Screens with their
 * own photo or map are routes; single choices are sheets.
 */
export type Route =
  | { name: "uploads" }
  | { name: "offline" }
  | { name: "shot"; shotId: string; /** The list it was opened from, for swiping to the neighbours. */ list: string[] }
  | { name: "position"; shotId: string; photoId: string }
  | { name: "mapFocus"; shotId: string }
  | { name: "step"; day: ShootingDay; shots: Shot[]; index: number }
  | { name: "rigs" }
  | { name: "rigEditor"; rigId: string | null }
  | { name: "viewfinderSettings" }
  | { name: "captureSettings" }
  | { name: "calibration" }
  | { name: "account" }
  | { name: "password" }
  | { name: "debugLog" };

export type ShotsView = "grid" | "map";

export interface AppState {
  /** The phone's settings with the current layout's look and options on top (issue #68). */
  settings: ViewSettings;
  /** Changes the phone's own settings only; the look and options are edited with `editLayout`. */
  setSettings: (u: Settings | ((s: Settings) => Settings)) => void;
  /** The layout Shoot uses (the dashboard's preview while one runs), and its cached entry (null = the built-in Default, read-only). */
  layout: ViewfinderLayout;
  layoutEntry: LayoutEntry | null;
  /** Change the current layout's look or options; saved on the phone at once, sent with the next flush. */
  editLayout: (patch: { look?: Partial<VfLook>; options?: Partial<VfOptions> }) => void;
  /** The Default can't be changed: make an editable copy and switch to it. */
  copyDefaultLayout: () => void;
  project: ProjectEntry | null;
  projects: ProjectEntry[];
  shots: ShotsData;
  locations: LocationEntry[];
  setLocations: (l: LocationEntry[]) => void;
  spots: SpotEntry[];
  setSpots: (l: SpotEntry[]) => void;
  /** Viewfinder layouts from the dashboard (cached; refreshed by every flush). */
  layouts: LayoutEntry[];
  /** The dashboard is showing a layout on this phone (issue #50): Shoot renders it, inert. */
  preview: LivePreview | null;
  exitPreview: () => void;
  /** Shots at a location (uploaded + queued). */
  countAt: (locationId: string) => number;
  tab: Tab;
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  pop: () => void;
  openProjectSheet: () => void;
  signIn: () => void;
  shotsView: ShotsView;
  setShotsView: (v: ShotsView) => void;
  /** Pin to focus when the Shots map opens. */
  mapFocus: string | null;
  /** Shots tab, Map view, this shot's pin focused. */
  showOnMap: (shotId: string) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside App");
  return v;
}
