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

export type ScopeId = "global" | "wm" | "files" | "desktop" | "bin" | "photo" | "timeline" | "shot" | "flows";

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
  photo: { label: "Photo", with: [] },
  timeline: { label: "Timeline", with: [] },
  shot: { label: "Shot · progression", with: [] },
  flows: { label: "Flows (extension)", with: [] },
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
  { scope: "global", action: "palette", keys: ["Mod+k"], label: "Search files, apps and windows" },
  { scope: "global", action: "sheet", keys: ["?"], label: "All shortcuts" },
  { scope: "global", action: "goFiles", keys: ["f"], chord: "g", label: "Open Files" },
  { scope: "global", action: "goMedia", keys: ["m"], chord: "g", label: "Open Photos (Files)" },
  { scope: "global", action: "goProject", keys: ["p"], chord: "g", label: "Open the project's settings" },
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
  { scope: "files", action: "parent", keys: ["Backspace", "Alt+ArrowUp"], label: "Up to the folder above (in Media: back from a collection)" },
  { scope: "files", action: "rename", keys: ["F2"], label: "Rename" },
  { scope: "files", action: "remove", keys: ["Delete"], label: "Move to the recycle bin" },
  { scope: "files", action: "newFolder", keys: ["Shift+N"], label: "New folder here" },
  { scope: "files", action: "all", keys: ["Mod+a"], label: "Tick everything listed (Ctrl-click ticks one, Shift-click a range)" },
  { scope: "files", action: "clear", keys: ["Escape"], pass: true, label: "Clear the ticks" },
  { scope: "files", action: "drag", keys: ["Drag"], info: true, label: "Onto a folder, a collection, the tree or the path: move there · onto the desktop: into the Desktop folder · onto the recycle bin: delete · onto the taskbar: pin · image files from the computer: import" },
  { scope: "files", action: "menu", keys: ["Right-click"], info: true, label: "Open, rename, duplicate, collections (group, add to, take out, ungroup), move, shortcut on the desktop, pin, recycle bin" },

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

  // ---- Photo
  { scope: "photo", action: "prev", keys: ["ArrowLeft"], label: "Previous photo" },
  { scope: "photo", action: "next", keys: ["ArrowRight"], label: "Next photo" },

  // ---- Timeline (docs/features/timeline.md)
  { scope: "timeline", action: "play", keys: [" "], display: "Space", label: "Play or pause" },
  { scope: "timeline", action: "prev", keys: ["ArrowLeft"], label: "Previous clip" },
  { scope: "timeline", action: "next", keys: ["ArrowRight"], label: "Next clip" },
  { scope: "timeline", action: "first", keys: ["Home"], label: "First clip" },
  { scope: "timeline", action: "last", keys: ["End"], label: "Last clip" },
  { scope: "timeline", action: "moveEarlier", keys: ["Alt+ArrowLeft"], label: "Move the chosen clips earlier" },
  { scope: "timeline", action: "moveLater", keys: ["Alt+ArrowRight"], label: "Move the chosen clips later" },
  { scope: "timeline", action: "shorter", keys: ["-"], label: "Hold the chosen clips 0.5 s shorter" },
  { scope: "timeline", action: "longer", keys: ["+", "="], display: "+", label: "Hold the chosen clips 0.5 s longer" },
  { scope: "timeline", action: "hold", keys: ["d"], label: "Type the chosen clip's hold time" },
  { scope: "timeline", action: "placeholder", keys: ["p"], label: "A placeholder after the chosen clip" },
  { scope: "timeline", action: "chapter", keys: ["c"], label: "A chapter starts at the chosen clip (or no more)" },
  { scope: "timeline", action: "remove", keys: ["Delete", "Backspace"], display: "Delete", label: "Remove the chosen clips" },
  { scope: "timeline", action: "all", keys: ["Mod+a"], label: "Choose every clip" },
  { scope: "timeline", action: "undo", keys: ["Mod+z"], label: "Undo" },
  { scope: "timeline", action: "redo", keys: ["Mod+Z", "Mod+y"], display: "Mod+Shift+Z", label: "Redo" },
  { scope: "timeline", action: "pick", keys: ["Shift+Click"], info: true, label: "Choose several clips: Shift adds a range, Ctrl one more" },

  // ---- A shot's progression (docs/features/shots.md, #426 feedback 4); not while the shot is mounted in a timeline
  { scope: "shot", action: "play", keys: [" "], display: "Space", label: "Play or pause the progression" },
  { scope: "shot", action: "back", keys: ["ArrowLeft"], label: "Playhead 0.1 s back" },
  { scope: "shot", action: "forward", keys: ["ArrowRight"], label: "Playhead 0.1 s on" },
  { scope: "shot", action: "backMore", keys: ["Shift+ArrowLeft"], display: "Shift+←", label: "Playhead 1 s back" },
  { scope: "shot", action: "forwardMore", keys: ["Shift+ArrowRight"], display: "Shift+→", label: "Playhead 1 s on" },
  { scope: "shot", action: "start", keys: ["Home"], label: "Playhead to the start" },
  { scope: "shot", action: "end", keys: ["End"], label: "Playhead to the end" },
  { scope: "shot", action: "remove", keys: ["Delete", "Backspace"], display: "Delete", label: "Delete the chosen items" },
  { scope: "shot", action: "cut", keys: ["Mod+x"], label: "Cut the chosen items" },
  { scope: "shot", action: "copy", keys: ["Mod+c"], label: "Copy the chosen items" },
  { scope: "shot", action: "paste", keys: ["Mod+v"], label: "Paste after the chosen items, or at the playhead" },
  { scope: "shot", action: "duplicate", keys: ["Mod+d"], label: "Duplicate the chosen items" },
  { scope: "shot", action: "all", keys: ["Mod+a"], label: "Choose every item" },
  { scope: "shot", action: "undo", keys: ["Mod+z"], label: "Undo" },
  { scope: "shot", action: "redo", keys: ["Mod+Z", "Mod+y"], display: "Mod+Shift+Z", label: "Redo" },
  { scope: "shot", action: "clear", keys: ["Escape"], pass: true, label: "Clear the choice, or back to the playhead" },
  { scope: "shot", action: "pick", keys: ["Shift+Click", "Drag"], info: true, label: "Shift adds a range, Ctrl one more; drag over the track for a box, drag items to move them" },
  { scope: "shot", action: "zoom", keys: ["Mod+Wheel"], info: true, label: "Zoom the track" },

  // ---- Flows (docs/features/flows.md)
  { scope: "flows", action: "play", keys: [" "], display: "Space", label: "Play from the playhead; again: stop and go back to where play started" },
  { scope: "flows", action: "stopHere", keys: ["k"], label: "Stop where it is" },
  { scope: "flows", action: "selectMode", keys: ["v"], label: "Select mode: clicks select, never add" },
  { scope: "flows", action: "insertMode", keys: ["i"], label: "Insert mode: a click on a lane adds a keyframe" },
  { scope: "flows", action: "marker", keys: ["m"], label: "A marker at the playhead" },
  { scope: "flows", action: "markerRange", keys: ["M"], display: "Shift+M", label: "A range marker: in, then out" },
  { scope: "flows", action: "remove", keys: ["Delete", "Backspace"], display: "Delete", label: "Delete the selected keyframes and markers" },
  { scope: "flows", action: "all", keys: ["Mod+a"], label: "Select every keyframe and marker" },
  { scope: "flows", action: "clear", keys: ["Escape"], pass: true, label: "Clear the selection" },
  { scope: "flows", action: "add", keys: ["Alt+Click"], info: true, label: "Add a keyframe in Select mode too" },
  { scope: "flows", action: "pick", keys: ["Shift+Click", "Drag"], info: true, label: "Shift-click adds to the selection; drag over the lanes for a box" },
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
