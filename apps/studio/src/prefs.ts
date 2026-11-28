import { useEffect, useState } from "preact/hooks";
import { knownPreferences } from "@openclapper/model";
import { get, putFile, type FileRec } from "./api";
import { getTheme, onTheme, setTheme, type Theme } from "./theme";

/**
 * Personal preferences (docs/rewrite/09-shells.md): what follows the account, not the browser. They
 * are one file of the type `preferences` in the person's account home; this module is the only
 * place that knows. A copy is kept in the browser per account, so the desktop draws at once and
 * what was changed without a connection is not lost: it is saved when the server answers again.
 */
export type Edge = "bottom" | "top" | "left" | "right";

/** What a taskbar pin opens: an app, or a file by its id. */
export type Pin = { app: string } | { file: string };

export interface Prefs {
  theme: Theme;
  taskbarEdge: Edge;
  taskbarAlign: "start" | "center";
  /** The taskbar's pins per project, in order. A project without an entry gets the default pins. */
  pins: Record<string, Pin[]>;
  /** Where each desktop icon sits, per project: a file's id (or "bin") to its cell of the icon grid. */
  icons: Record<string, Record<string, { c: number; r: number }>>;
  /** The recycle bin has an icon on the desktop. */
  binOnDesktop: boolean;
  /** Taskbar items hidden (#426); the launcher and the task view always stay. */
  taskbarHide: TaskbarItem[];
  /** How a collection's colour is drawn on its photos and its tile: a bar below or to the left, a dot, or a frame. */
  collectionMark: "bar" | "barleft" | "dot" | "frame";
  /** How long a clip added to a timeline holds, unless the timeline has a value of its own. */
  clipHoldMs: number;
  /** A canvas made from a photo starts with the frame the photo was taken with. */
  canvasTakesFrame: boolean;
  /** The file browser's table per kind of list (folders, Photos, Shots, …): which columns show, in which order and how wide (#426). */
  columns: Record<string, ColumnSetup>;
  /** A light's parameters hidden per catalogue model (#426): in flows and on device cards, here and on the phone. */
  lightParamsHidden: Record<string, string[]>;
  /** What every flow keyframe's panel leaves out (#426): its time, margins, parameters. */
  keyframeFieldsHidden: string[];
}
export type TaskbarItem = "clock" | "account" | "theme" | "search" | "project";
export interface ColumnSetup { visible?: string[]; widths?: Record<string, number>; /** Every column's key in the user's order (#426); absent: the default order. */ order?: string[] }

export const DEFAULT_PREFS: Prefs = { lightParamsHidden: {}, keyframeFieldsHidden: [], columns: {}, taskbarHide: [], theme: "auto", taskbarEdge: "bottom", taskbarAlign: "start", pins: {}, icons: {}, binOnDesktop: true, collectionMark: "bar", clipHoldMs: 2000, canvasTakesFrame: true };
export type PrefsState = "local" | "loading" | "saved" | "saving" | "unsaved";

let prefs: Prefs = { ...DEFAULT_PREFS, theme: getTheme() };
let userId: string | null = null;
let fileId: string | null = null;
let state: PrefsState = "local";
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => { for (const cb of listeners) cb(); };
const cacheKey = () => `prefs.${userId ?? "none"}`;

function cache() { try { localStorage.setItem(cacheKey(), JSON.stringify({ fileId, prefs })); } catch { /* private mode: kept for this session */ } }
function readCache(): { fileId: string | null; prefs: Partial<Prefs> } | null {
  try { const raw = localStorage.getItem(cacheKey()); return raw ? (JSON.parse(raw) as { fileId: string | null; prefs: Partial<Prefs> }) : null; } catch { return null; }
}
function take(next: Prefs) {
  prefs = next;
  if (getTheme() !== prefs.theme) setTheme(prefs.theme);
  notify();
}

async function save() {
  if (!userId) return;
  const mine = userId;
  state = "saving"; notify();
  try {
    fileId ??= crypto.randomUUID();
    await putFile(fileId, { type: "preferences", home: true, name: "Preferences", body: knownPreferences(prefs as unknown as Record<string, unknown>) });
    if (userId !== mine) return;
    state = "saved";
    cache();
  } catch { if (userId === mine) state = "unsaved"; }
  notify();
}

/**
 * Called when someone is signed in: their preferences from this browser's copy at once, then from
 * their account. The account wins, except for what was changed here and could not be saved yet.
 */
export async function loadPrefs(id: string): Promise<void> {
  userId = id;
  const cached = readCache();
  fileId = cached?.fileId ?? null;
  state = "loading";
  take({ ...DEFAULT_PREFS, theme: getTheme(), ...cached?.prefs });
  try {
    const { files } = await get<{ files: FileRec[] }>("/api/files?home=1&type=preferences&body=1");
    if (userId !== id) return;
    // One file per account; were two made at once (two browsers, first sign-in), the older one counts.
    const file = [...files].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (file) { fileId = file.id; take({ ...DEFAULT_PREFS, ...(file.body as Partial<Prefs>) }); state = "saved"; cache(); }
    else { fileId = null; await save(); }
  } catch { if (userId === id) state = "unsaved"; }
  notify();
}

/** Nobody is signed in any more: back to the defaults, keeping the theme this browser shows. */
export function forgetPrefs() {
  clearTimeout(timer);
  userId = null; fileId = null; state = "local";
  prefs = { ...DEFAULT_PREFS, theme: getTheme() };
  notify();
}

export const getPrefs = () => prefs;
export function setPrefs(change: Partial<Prefs>) {
  prefs = { ...prefs, ...change };
  if (change.theme && getTheme() !== change.theme) setTheme(change.theme);
  if (userId) { cache(); state = "unsaved"; clearTimeout(timer); timer = setTimeout(() => void save(), 600); }
  notify();
}
// The theme has switches of its own (the taskbar, the palette); whatever sets it, it is a preference.
onTheme((t) => { if (prefs.theme !== t) setPrefs({ theme: t }); });
// A change made just before the page closes is sent on its way.
if (typeof window !== "undefined") window.addEventListener("pagehide", () => { if (state === "unsaved") { clearTimeout(timer); void save(); } });

export function usePrefs(): Prefs {
  const [, tick] = useState(0);
  useEffect(() => { const cb = () => tick((n) => n + 1); listeners.add(cb); cb(); return () => { listeners.delete(cb); }; }, []);
  return prefs;
}
/** Whether the preferences are with the account right now, for Settings to say so. */
export function usePrefsState(): PrefsState {
  usePrefs();
  return state;
}

export const samePin = (a: Pin, b: Pin) => ("app" in a ? "app" in b && a.app === b.app : "file" in b && a.file === b.file);
