import { setLogging } from "./log";
import { setOfflineMode } from "./net";
import { persisted } from "./store";

/**
 * What belongs to this phone rather than to the account: offline mode, keeping the project on the
 * phone, the debug log. Applied at start, before the first request.
 */
export interface LocalSettings {
  /** No requests at all; photos wait in the queue. */
  offlineMode: boolean;
  /** Keep the active project's thumbnails and previews on the phone (Media without a connection). */
  keepProject: boolean;
  logging: boolean;
}

export const settings = persisted<LocalSettings>("settings.v2", { offlineMode: false, keepProject: false, logging: false });

export function setSettings(change: Partial<LocalSettings>) {
  settings.set((s) => ({ ...s, ...change }));
  apply();
}

/** Puts the stored switches into effect. */
export function apply() {
  const s = settings.get();
  setLogging(s.logging);
  setOfflineMode(s.offlineMode);
}
