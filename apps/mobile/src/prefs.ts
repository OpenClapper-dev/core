import { randomUUID } from "expo-crypto";
import { canCall, listFiles, putFile, type FileRec } from "./api";
import { signedInUserId } from "./auth";
import { log } from "./log";
import { persisted } from "./store";
import type { ThemeChoice } from "./ui/theme";

/**
 * The person's preferences (docs/rewrite/09-shells.md): one `preferences` file in the account home,
 * shared with the Studio. The phone reads and sets its own keys (theme, collection mark, camera)
 * and leaves the Studio's (taskbar, pins, icons) as they are: a save merges what was changed here
 * into the file as it is on the server. A copy is kept on the phone per account, so the app draws at
 * once and what was changed offline is saved when the server answers again.
 */
export interface Prefs {
  theme: ThemeChoice;
  /** How a collection's colour is drawn on its photos (the same preference as in the Studio). */
  collectionMark: "bar" | "barleft" | "dot" | "frame";
  /** The camera's lenses by the phone's own names (0.5×, 1×) or by focal length. */
  lensNames: "phone" | "focal";
  /** Collection mode asks for a name when a collection starts, ends, or never (the camera's collection mode, B8). */
  askCollectionName: "never" | "start" | "end";
}
export const DEFAULT_PREFS: Prefs = { theme: "auto", collectionMark: "bar", lensNames: "phone", askCollectionName: "never" };

interface Cached { userId: string | null; fileId: string | null; prefs: Prefs; dirty: (keyof Prefs)[] }
const cache = persisted<Cached>("prefs.v2", { userId: null, fileId: null, prefs: DEFAULT_PREFS, dirty: [] });

const pick = (body: Record<string, unknown> | undefined): Partial<Prefs> => {
  const out: Partial<Prefs> = {};
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) if (body && body[k] !== undefined) (out as Record<string, unknown>)[k] = body[k];
  return out;
};

export const getPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...cache.get().prefs });
export const usePrefs = (): Prefs => { const c = cache.use(); return { ...DEFAULT_PREFS, ...c.prefs }; };

let saving: Promise<void> | null = null;

/** Change preferences; saved to the account at once when it can be, else at the next sync. */
export function setPrefs(change: Partial<Prefs>) {
  cache.set((c) => ({ ...c, prefs: { ...c.prefs, ...change }, dirty: [...new Set([...c.dirty, ...(Object.keys(change) as (keyof Prefs)[])])] }));
  void syncPrefs();
}

/** The account's preferences file, the oldest if two were made at once (as the Studio picks it). */
async function fetchFile(): Promise<FileRec | null> {
  const files = await listFiles({ home: true }, { type: "preferences", body: true });
  return [...files].sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
}

/**
 * Brings the preferences in line with the account: what was changed on the phone is merged into the
 * file and saved, then the file's values are taken. Another account signing in starts from the defaults.
 */
export function syncPrefs(): Promise<void> {
  if (saving) return saving;
  saving = (async () => {
    const user = signedInUserId();
    if (!user || !canCall()) return;
    // Set before anyone signed in: they go to the account. Another account's: that account starts from its own.
    const was = cache.get().userId;
    if (was === null) cache.set((c) => ({ ...c, userId: user }));
    else if (was !== user) cache.set({ userId: user, fileId: null, prefs: { ...DEFAULT_PREFS, theme: cache.get().prefs.theme }, dirty: [] });
    try {
      const file = await fetchFile();
      const { dirty, prefs } = cache.get();
      const body = { ...file?.body } as Record<string, unknown>;
      if (dirty.length) {
        for (const k of dirty) body[k] = prefs[k];
        const id = file?.id ?? cache.get().fileId ?? randomUUID();
        await putFile(id, { type: "preferences", home: true, name: "Preferences", body });
        cache.set((c) => ({ ...c, fileId: id, dirty: c.dirty.filter((k) => !dirty.includes(k) || c.prefs[k] !== prefs[k]) }));
      }
      cache.set((c) => ({ ...c, fileId: file?.id ?? c.fileId, prefs: { ...DEFAULT_PREFS, ...pick(body), ...Object.fromEntries(c.dirty.map((k) => [k, c.prefs[k]])) } }));
    } catch (e) { log("warn", "prefs sync failed", e); }
  })().finally(() => { saving = null; });
  return saving;
}

/** Whether preferences changed here still wait to be saved to the account. */
export const usePrefsPending = (): boolean => cache.use().dirty.length > 0;
