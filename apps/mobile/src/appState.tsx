import { createContext, useContext } from "react";
import type { Shot, ShootingDay } from "./api";
import type { ShotsData } from "./shots";
import type { LocationEntry, ProjectEntry, Settings, SpotEntry } from "./types";

/** The five tabs. Everything else is a pushed full screen (Route) or a sheet. */
export type Tab = "shoot" | "review" | "shots" | "day" | "setup";

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
  | { name: "debugLog" };

export type ShotsView = "grid" | "map";

export interface AppState {
  settings: Settings;
  setSettings: (u: Settings | ((s: Settings) => Settings)) => void;
  project: ProjectEntry | null;
  projects: ProjectEntry[];
  shots: ShotsData;
  locations: LocationEntry[];
  setLocations: (l: LocationEntry[]) => void;
  spots: SpotEntry[];
  setSpots: (l: SpotEntry[]) => void;
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
