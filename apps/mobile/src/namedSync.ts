import { api, ApiError } from "./api";
import { log } from "./log";
import type { LocationEntry, ProjectEntry, SpotEntry } from "./types";

/**
 * Locations, spots and projects work the same way: created on the phone with a client UUID (possibly
 * offline), unique by name on the server, and the server list is the source of truth.
 */
interface Named { id: string; name: string; synced: boolean }
interface Remote<T extends Named> { put: (x: T) => Promise<unknown>; list: () => Promise<T[]>; what: string }

const LOCATIONS: Remote<LocationEntry> = { put: api.putLocation, list: api.listLocations, what: "location" };
const SPOTS: Remote<SpotEntry> = { put: api.putSpot, list: api.listSpots, what: "spot" };
const PROJECTS: Remote<ProjectEntry> = { put: api.putProject, list: api.listProjects, what: "project" };

export interface SyncResult<T> {
  /** Authoritative server list. */
  items: T[];
  /** Local ids that clashed with an existing name on the server -> the id to use instead. */
  remap: Record<string, string>;
}

const existingIdOf = (err: unknown): string | undefined => {
  const id = err instanceof ApiError && err.status === 409 ? (err.body as { existing_id?: unknown } | null)?.existing_id : undefined;
  return typeof id === "string" ? id : undefined;
};

/**
 * Push entries created offline, then pull the server list. A name clash (409) adopts the
 * existing entry instead of failing. Returns null when offline.
 */
async function sync<T extends Named>(remote: Remote<T>, local: T[]): Promise<SyncResult<T> | null> {
  const remap: Record<string, string> = {};
  try {
    for (const x of local.filter((l) => !l.synced)) {
      try {
        await remote.put(x);
      } catch (err) {
        const existing = existingIdOf(err);
        if (existing) { remap[x.id] = existing; continue; }
        // One entry the server rejects (e.g. a name too long) must not block the others.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status)) {
          log("warn", `${remote.what} rejected`, { name: x.name, error: err.message });
          continue;
        }
        throw err;
      }
    }
    return { items: await remote.list(), remap };
  } catch (err) {
    console.warn(`${remote.what} sync failed`, err);
    return null;
  }
}

/**
 * Make sure an entry exists on the server before something references it (edits, not uploads).
 * Returns the id to use: the entry's own id, or the existing one on a name clash.
 */
async function ensure<T extends Named>(remote: Remote<T>, x: T): Promise<string> {
  if (x.synced) return x.id;
  try {
    await remote.put(x);
    return x.id;
  } catch (err) {
    const existing = existingIdOf(err);
    if (existing) return existing;
    throw err;
  }
}

export const syncLocations = (local: LocationEntry[]) => sync(LOCATIONS, local);
export const ensureLocation = (l: LocationEntry) => ensure(LOCATIONS, l);
export const syncSpots = (local: SpotEntry[]) => sync(SPOTS, local);
export const ensureSpot = (x: SpotEntry) => ensure(SPOTS, x);
export const syncProjects = (local: ProjectEntry[]) => sync(PROJECTS, local);
