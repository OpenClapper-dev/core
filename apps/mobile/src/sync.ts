import { AppState } from "react-native";
import { canCall } from "./api";
import { isSignedIn, onAuthChange } from "./auth";
import { syncDevice } from "./device";
import { log } from "./log";
import { isOnline, onOnlineChange } from "./net";
import { syncPrefs } from "./prefs";
import { syncProjects } from "./projects";

/**
 * Brings the phone and the server in line: projects first (a project made on the phone must exist
 * before its photos), then the preferences, the device, and whatever else registered a step (the
 * upload queue). Runs at start, on sign-in, when the app comes to the front, when the server answers
 * again, and every RETRY_MS while it does not.
 */
const RETRY_MS = 20_000;
const steps: (() => Promise<void>)[] = [];
/** Adds a step that runs after projects, preferences and device. */
export const onSync = (step: () => Promise<void>) => { steps.push(step); };

let running: Promise<void> | null = null;
export function syncAll(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!canCall()) return;
    await syncProjects();
    await Promise.all([syncPrefs(), syncDevice()]);
    for (const s of steps) { try { await s(); } catch (e) { log("warn", "sync step failed", e); } }
  })().finally(() => { running = null; });
  return running;
}

let started = false;
/** Starts the triggers once. */
export function startSync() {
  if (started) return;
  started = true;
  void syncAll();
  onAuthChange(() => { if (isSignedIn()) void syncAll(); });
  AppState.addEventListener("change", (s) => { if (s === "active") void syncAll(); });
  onOnlineChange((v) => { if (v) void syncAll(); });
  setInterval(() => { if (!isOnline() && isSignedIn()) void syncAll(); }, RETRY_MS);
}
