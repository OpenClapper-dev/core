import { File, Paths } from "expo-file-system";

/**
 * Background log for debugging on the phone. Off by default (Setup → Debug log). While on, it
 * records explicit events (capture, GPS, uploads, sync, API calls) plus console warnings/errors
 * and uncaught JS errors, keeps the newest MAX_ENTRIES in a file so they survive a crash or
 * restart, and can be shared as plain text (e.g. pasted into a chat with an AI agent).
 */
export type Level = "debug" | "info" | "warn" | "error";
interface Entry { t: string; level: Level; event: string; data?: unknown }

const MAX_ENTRIES = 3000;
const file = new File(Paths.document, "fielder-log.jsonl");
let enabled = false;
let entries: Entry[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Entry[] {
  if (entries) return entries;
  entries = [];
  try {
    if (file.exists) {
      for (const line of file.textSync().split("\n")) {
        if (!line) continue;
        try { entries.push(JSON.parse(line) as Entry); } catch { /* torn line after a crash */ }
      }
    }
  } catch { /* unreadable: start fresh */ }
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  return entries;
}

function persistSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try { file.write((entries ?? []).map((e) => JSON.stringify(e)).join("\n") + "\n"); } catch { /* disk full etc. */ }
  }, 1500);
}

/** Errors and other class instances do not survive JSON.stringify; flatten them. */
function plain(v: unknown): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack?.split("\n").slice(0, 6).join("\n") };
  return v;
}

export function log(level: Level, event: string, data?: unknown) {
  if (!enabled) return;
  const list = load();
  list.push({ t: new Date().toISOString(), level, event, ...(data === undefined ? {} : { data: plain(data) }) });
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
  persistSoon();
}

export const isLogging = () => enabled;
export const logCount = () => load().length;

export function clearLog() {
  entries = [];
  try { if (file.exists) file.delete(); } catch { /* ignore */ }
}

/** Plain-text dump, oldest first, with a header describing the device and app state. */
export function logText(header: Record<string, unknown>): string {
  const lines = load().map((e) => `${e.t} ${e.level.toUpperCase().padEnd(5)} ${e.event}${e.data === undefined ? "" : ` ${safeJson(e.data)}`}`);
  return [`# OpenClapper debug log (${lines.length} entries)`, ...Object.entries(header).map(([k, v]) => `# ${k}: ${typeof v === "string" ? v : safeJson(v)}`), "", ...lines].join("\n");
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Console and uncaught-error hooks are installed once and only record while logging is on.
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  for (const level of ["warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(level, "console", args.map(plain));
      orig(...args);
    };
  }
  const g = globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
  const prev = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    log("error", fatal ? "uncaught (fatal)" : "uncaught", e);
    if (entries && flushTimer) { clearTimeout(flushTimer); flushTimer = null; try { file.write(entries.map((x) => JSON.stringify(x)).join("\n") + "\n"); } catch { /* ignore */ } }
    prev?.(e, fatal);
  });
}

export function setLogging(on: boolean) {
  if (on && !enabled) { hook(); enabled = true; log("info", "logging on"); }
  else if (!on && enabled) { log("info", "logging off"); enabled = false; }
}
