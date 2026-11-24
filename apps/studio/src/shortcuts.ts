/**
 * Every keyboard shortcut of the Studio, in one place. Apps bind handlers to these
 * entries (`bind` in keys.ts) instead of writing key strings, so a key's meaning is visible here and
 * `shortcuts.test.ts` can assert that no key does two things where scopes are live together. The `?`
 * sheet, Settings › Shortcuts and docs/shortcuts.md are all rendered from this list.
 *
 * Keys use keys.ts names: `e.key` with modifier prefixes ("Mod+s", "Alt+ArrowUp", "Shift+N"). A
 * `chord: "g"` entry fires only right after G (G S, G T, …); every other plain letter is held back
 * then, so a page's own letter never swallows a section jump.
 */

export type ScopeId = "global" | "wm" | "files" | "desktop" | "bin";

export interface Scope {
  label: string;
  /** Scopes that can be live at the same time as this one (global always is). */
  with: readonly ScopeId[];
}

/**
 * Modal scopes own the keys while they are open: the page's map is disabled (the draw and re-frame
 * editors on the timeline stage, the rig editor). They are therefore not listed in each other's `with`.
 */
export const SCOPES: Record<ScopeId, Scope> = {
  global: { label: "Everywhere", with: [] },
  wm: { label: "Windows (always live, like Everywhere)", with: [] },
  files: { label: "Files", with: [] },
  desktop: { label: "Desktop icons", with: [] },
  bin: { label: "Recycle bin", with: [] },
};

export interface Shortcut {
  scope: ScopeId;
  /** The handler name a page binds (unique within its scope). */
  action: string;
  keys: readonly string[];
  label: string;
  /** Only right after G. */
  chord?: "g";
  /** How the keys read when listed, when the plain rendering would be noisy (1–0, ⇧ arrows). */
  display?: string;
  /** Handled by the element itself (grid, list box, text field) or a gesture: listed, never bound. */
  info?: true;
  /** The handler returns false when it does not apply, so another live entry may share the key. */
  pass?: true;
}

export const SHORTCUTS = [
  // ---- everywhere
  { scope: "global", action: "palette", keys: ["Mod+k"], label: "Go to… (command palette)" },
  { scope: "global", action: "sheet", keys: ["?"], label: "All shortcuts" },
  { scope: "global", action: "goFiles", keys: ["f"], chord: "g", label: "Open Files" },
  { scope: "global", action: "goProject", keys: ["p"], chord: "g", label: "Open Project" },
  { scope: "global", action: "goSettings", keys: [","], chord: "g", label: "Open Settings" },
  { scope: "global", action: "back", keys: ["Escape"], info: true, label: "Close or back out one level" },

  // ---- Windows (the desktop shell)
  { scope: "wm", action: "next", keys: ["Mod+`", "Mod+Alt+PageDown"], label: "Next window" },
  { scope: "wm", action: "prev", keys: ["Mod+Alt+PageUp"], label: "Previous window" },
  { scope: "wm", action: "close", keys: ["Mod+Alt+w"], label: "Close the window" },
  { scope: "wm", action: "minimize", keys: ["Mod+Alt+ArrowDown"], label: "Minimise the window" },
  { scope: "wm", action: "maximize", keys: ["Mod+Alt+ArrowUp"], label: "Maximise or restore the window" },
  { scope: "wm", action: "snapLeft", keys: ["Mod+Alt+ArrowLeft"], label: "Snap the window to the left half" },
  { scope: "wm", action: "snapRight", keys: ["Mod+Alt+ArrowRight"], label: "Snap the window to the right half" },
  { scope: "wm", action: "desktop", keys: ["Mod+Alt+d"], label: "Show the desktop (again: bring the windows back)" },
  // ---- Desktops (virtual desktops)
  { scope: "wm", action: "taskView", keys: ["Mod+Alt+v"], label: "Task view: every desktop and its windows" },
  { scope: "wm", action: "deskNext", keys: ["Mod+Alt+Shift+ArrowRight"], label: "Next desktop" },
  { scope: "wm", action: "deskPrev", keys: ["Mod+Alt+Shift+ArrowLeft"], label: "Previous desktop" },
  { scope: "wm", action: "deskNew", keys: ["Mod+Alt+n"], label: "New desktop (and go there)" },
  { scope: "wm", action: "deskGo", keys: ["Mod+Alt+1", "Mod+Alt+2", "Mod+Alt+3", "Mod+Alt+4", "Mod+Alt+5", "Mod+Alt+6", "Mod+Alt+7", "Mod+Alt+8", "Mod+Alt+9"], display: "⌘Alt 1–9", label: "Go to desktop 1–9" },
  { scope: "wm", action: "deskMove", keys: ["Mod+Alt+Shift+1", "Mod+Alt+Shift+2", "Mod+Alt+Shift+3", "Mod+Alt+Shift+4", "Mod+Alt+Shift+5", "Mod+Alt+Shift+6", "Mod+Alt+Shift+7", "Mod+Alt+Shift+8", "Mod+Alt+Shift+9"], display: "⌘Alt⇧ 1–9", label: "Move the window to desktop 1–9" },

  // ---- Files
  { scope: "files", action: "search", keys: ["/"], label: "Focus the search" },
  { scope: "files", action: "down", keys: ["j", "ArrowDown"], label: "Next file" },
  { scope: "files", action: "up", keys: ["k", "ArrowUp"], label: "Previous file" },
  { scope: "files", action: "open", keys: ["Enter"], label: "Open the file (a folder: go into it)" },
  { scope: "files", action: "parent", keys: ["Backspace", "Alt+ArrowUp"], label: "Up to the folder above" },
  { scope: "files", action: "rename", keys: ["F2"], label: "Rename" },
  { scope: "files", action: "remove", keys: ["Delete"], label: "Move to the recycle bin" },
  { scope: "files", action: "newFolder", keys: ["Shift+N"], label: "New folder here" },
  { scope: "files", action: "all", keys: ["Mod+a"], label: "Tick everything listed (Ctrl-click ticks one, Shift-click a range)" },
  { scope: "files", action: "clear", keys: ["Escape"], pass: true, label: "Clear the ticks" },
  { scope: "files", action: "drag", keys: ["Drag"], info: true, label: "Onto a folder, the tree or the path: move there · onto the desktop: into the Desktop folder · onto the recycle bin: delete · onto the taskbar: pin" },
  { scope: "files", action: "menu", keys: ["Right-click"], info: true, label: "Open, rename, duplicate, move, shortcut on the desktop, pin, recycle bin" },

  // ---- Desktop icons
  { scope: "desktop", action: "open", keys: ["Enter"], label: "Open the selected icon (or double-click it)" },
  { scope: "desktop", action: "all", keys: ["Mod+a"], label: "Select every icon" },
  { scope: "desktop", action: "clear", keys: ["Escape"], pass: true, label: "Clear the selection" },
  { scope: "desktop", action: "rename", keys: ["F2"], label: "Rename the selected icon" },
  { scope: "desktop", action: "remove", keys: ["Delete"], label: "Selected icons to the recycle bin" },
  { scope: "desktop", action: "left", keys: ["ArrowLeft"], label: "Select the icon to the left" },
  { scope: "desktop", action: "right", keys: ["ArrowRight"], label: "Select the icon to the right" },
  { scope: "desktop", action: "up", keys: ["ArrowUp"], label: "Select the icon above" },
  { scope: "desktop", action: "down", keys: ["ArrowDown"], label: "Select the icon below" },
  { scope: "desktop", action: "select", keys: ["Click", "Drag"], info: true, label: "Ctrl-click toggles, Shift-click adds; drag on the empty desktop to select with a rubber band" },
  { scope: "desktop", action: "drag", keys: ["Drag"], info: true, label: "Move the selected icons, each to a free cell · onto a folder icon: into that folder · onto the recycle bin: delete" },
  { scope: "desktop", action: "menu", keys: ["Right-click"], info: true, label: "On an icon: open, rename, show in Files, recycle bin · on the desktop: new folder, new shortcut, arrange" },

  // ---- Recycle bin
  { scope: "bin", action: "search", keys: ["/"], label: "Focus the search" },
  { scope: "bin", action: "all", keys: ["Mod+a"], label: "Select everything listed" },
  { scope: "bin", action: "restore", keys: ["r"], label: "Restore the selected entries (or double-click one)" },
  { scope: "bin", action: "purge", keys: ["Delete"], label: "Delete the selected entries for good" },
] as const satisfies readonly Shortcut[];

type Entry = (typeof SHORTCUTS)[number];
/** The actions a scope offers, for type-checked binding. */
export type ActionOf<S extends ScopeId> = Exclude<Extract<Entry, { scope: S }>, { info: true }>["action"];

export const shortcutsOf = (scope: ScopeId): readonly Shortcut[] => SHORTCUTS.filter((s) => s.scope === scope);
export const shortcut = (scope: ScopeId, action: string): Shortcut | undefined => SHORTCUTS.find((s) => s.scope === scope && s.action === action);

const NAMES: Record<string, string> = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "↵", Escape: "Esc", " ": "Space", Delete: "Del",
  Backspace: "⌫", Home: "Home", End: "End", Tab: "Tab",
};
/** One key as people read it: "Mod+s" → "⌘S", "Shift+N" → "⇧N", "Alt+ArrowUp" → "Alt ↑". */
export function keyLabel(k: string): string {
  const parts = k.split("+");
  const key = parts.pop()!;
  const mods = parts.map((m) => (m === "Mod" ? "⌘" : m === "Shift" ? "⇧" : m === "Alt" ? "Alt " : m));
  // A shifted letter is named by its upper case in keys.ts ("Mod+Z" is ⌘⇧Z).
  const shifted = key.length === 1 && key !== key.toLowerCase() && !parts.includes("Shift") ? "⇧" : "";
  return `${mods.join("")}${shifted}${NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key)}`;
}
/** How an entry's keys are listed. */
export const keysLabel = (s: Shortcut): string => s.display ?? `${s.chord ? "G " : ""}${s.keys.map(keyLabel).join(" / ")}`;

/** docs/shortcuts.md, generated so it cannot drift (shortcuts.test.ts compares it). */
export function shortcutsMarkdown(): string {
  const out = [
    "# Keyboard shortcuts (Studio)",
    "",
    "Generated from `apps/studio/src/shortcuts.ts`; `shortcuts.test.ts` fails when this file drifts. Regenerate with `node apps/studio/src/shortcuts.docs.ts > docs/shortcuts.md`.",
    "The same list is in the app: `?`, and Settings › Shortcuts. Single keys never fire while you type in a field; plain letters wait while a G jump is pending.",
    "",
  ];
  for (const id of Object.keys(SCOPES) as ScopeId[]) {
    const list = shortcutsOf(id);
    if (!list.length) continue;
    out.push(`## ${SCOPES[id].label}`, "", "| Keys | What |", "| --- | --- |");
    for (const s of list) out.push(`| ${keysLabel(s).replace(/\|/g, "\\|")} | ${s.label} |`);
    out.push("");
  }
  return out.join("\n");
}
