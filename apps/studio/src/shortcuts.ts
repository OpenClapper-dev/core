/**
 * Every keyboard shortcut of the Studio (issue #32), in one place. Pages bind handlers to these
 * entries (`bind` in keys.ts) instead of writing key strings, so a key's meaning is visible here and
 * `shortcuts.test.ts` can assert that no key does two things where scopes are live together. The `?`
 * sheet, Settings › Shortcuts and docs/shortcuts.md are all rendered from this list.
 *
 * Keys use keys.ts names: `e.key` with modifier prefixes ("Mod+s", "Alt+ArrowUp", "Shift+N"). A
 * `chord: "g"` entry fires only right after G (G S, G T, …); every other plain letter is held back
 * then, so a page's own letter never swallows a section jump.
 */

export type ScopeId =
  | "global" | "wm" | "shots" | "shots.grid" | "shots.list" | "map" | "shot" | "framing" | "sequence" | "compose" | "draw" | "reframe"
  | "timeline" | "browser" | "clip" | "plan" | "metadata" | "rigs" | "rig" | "locations" | "fields" | "position" | "newshot" | "combobox" | "files" | "desktop" | "trash";

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
  shots: { label: "Shots", with: ["shots.grid", "shots.list", "map"] },
  "shots.grid": { label: "Shots · grid", with: ["shots"] },
  "shots.list": { label: "Shots · list", with: ["shots"] },
  map: { label: "Shots · map", with: ["shots"] },
  shot: { label: "Shot view", with: [] },
  framing: { label: "Shot view · Framing", with: [] },
  sequence: { label: "Shot view · Sequence", with: [] },
  compose: { label: "Shot view · Compose", with: ["draw"] },
  draw: { label: "Drawing (Compose, and overlays or sketches on the timeline stage)", with: ["compose"] },
  reframe: { label: "Re-framing a clip on the timeline stage", with: [] },
  timeline: { label: "Timeline", with: ["browser", "clip"] },
  browser: { label: "Timeline · shot browser", with: ["timeline"] },
  clip: { label: "Timeline · clip panel", with: ["timeline"] },
  plan: { label: "Plan", with: [] },
  metadata: { label: "Metadata", with: [] },
  rigs: { label: "Library · Rigs", with: [] },
  rig: { label: "Rig editor", with: [] },
  locations: { label: "Library · Locations", with: [] },
  fields: { label: "Library · Fields", with: [] },
  position: { label: "Shot view · Position", with: [] },
  newshot: { label: "New shot · drawing", with: [] },
  combobox: { label: "Combobox", with: [] },
  files: { label: "Files", with: [] },
  desktop: { label: "Desktop icons", with: [] },
  trash: { label: "Recycle bin", with: [] },
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

const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;

export const SHORTCUTS = [
  // ---- everywhere
  { scope: "global", action: "palette", keys: ["Mod+k"], label: "Go to… (command palette)" },
  { scope: "global", action: "sheet", keys: ["?"], label: "All shortcuts" },
  { scope: "global", action: "goShots", keys: ["s"], chord: "g", label: "Open the Gallery (shots)" },
  { scope: "global", action: "goTimeline", keys: ["t"], chord: "g", label: "Open Timeline" },
  { scope: "global", action: "goPlan", keys: ["p"], chord: "g", label: "Open Plan" },
  { scope: "global", action: "goMetadata", keys: ["d"], chord: "g", label: "Open Metadata" },
  { scope: "global", action: "goFiles", keys: ["f"], chord: "g", label: "Open Files" },
  { scope: "global", action: "goLibrary", keys: ["l"], chord: "g", label: "Open Projects (the library)" },
  { scope: "global", action: "goMap", keys: ["m"], chord: "g", label: "Shots on the map" },
  { scope: "global", action: "back", keys: ["Escape"], info: true, label: "Close or back out one level" },

  // ---- Windows (the desktop shell, epic #72)
  { scope: "wm", action: "next", keys: ["Mod+`", "Mod+Alt+PageDown"], label: "Next window" },
  { scope: "wm", action: "prev", keys: ["Mod+Alt+PageUp"], label: "Previous window" },
  { scope: "wm", action: "close", keys: ["Mod+Alt+w"], label: "Close the window" },
  { scope: "wm", action: "minimize", keys: ["Mod+Alt+ArrowDown"], label: "Minimize the window" },
  { scope: "wm", action: "maximize", keys: ["Mod+Alt+ArrowUp"], label: "Maximize or restore the window" },
  { scope: "wm", action: "snapLeft", keys: ["Mod+Alt+ArrowLeft"], label: "Snap the window to the left half" },
  { scope: "wm", action: "snapRight", keys: ["Mod+Alt+ArrowRight"], label: "Snap the window to the right half" },
  { scope: "wm", action: "desktop", keys: ["Mod+Alt+d"], label: "Show the desktop (again: bring the windows back)" },
  // ---- Workspaces (virtual desktops, epic #90)
  { scope: "wm", action: "taskView", keys: ["Mod+Alt+v"], label: "Task view: every workspace and its windows" },
  { scope: "wm", action: "wsNext", keys: ["Mod+Alt+Shift+ArrowRight"], label: "Next workspace" },
  { scope: "wm", action: "wsPrev", keys: ["Mod+Alt+Shift+ArrowLeft"], label: "Previous workspace" },
  { scope: "wm", action: "wsNew", keys: ["Mod+Alt+n"], label: "New workspace (and go there)" },
  { scope: "wm", action: "wsGo", keys: ["Mod+Alt+1", "Mod+Alt+2", "Mod+Alt+3", "Mod+Alt+4", "Mod+Alt+5", "Mod+Alt+6", "Mod+Alt+7", "Mod+Alt+8", "Mod+Alt+9"], label: "Go to workspace 1–9" },
  { scope: "wm", action: "wsMove", keys: ["Mod+Alt+Shift+1", "Mod+Alt+Shift+2", "Mod+Alt+Shift+3", "Mod+Alt+Shift+4", "Mod+Alt+Shift+5", "Mod+Alt+Shift+6", "Mod+Alt+Shift+7", "Mod+Alt+Shift+8", "Mod+Alt+Shift+9"], label: "Move the window to workspace 1–9" },

  // ---- Shots
  { scope: "shots", action: "search", keys: ["/"], label: "Focus the search" },
  { scope: "shots", action: "filter", keys: ["f"], label: "Filter panel" },
  { scope: "shots", action: "frameMode", keys: ["m"], label: "Cycle the frame mode" },
  { scope: "shots", action: "newShot", keys: ["Shift+N"], label: "New shot (upload or draw)" },
  { scope: "shots", action: "leaveSearch", keys: ["Escape"], pass: true, label: "Leave the search field" },
  { scope: "shots.grid", action: "move", keys: [...arrows], info: true, display: "← ↑ → ↓", label: "Move in the grid" },
  { scope: "shots.grid", action: "open", keys: ["Enter"], info: true, label: "Open the shot" },
  { scope: "shots.list", action: "down", keys: ["j", "ArrowDown"], label: "Next row" },
  { scope: "shots.list", action: "up", keys: ["k", "ArrowUp"], label: "Previous row" },
  { scope: "shots.list", action: "select", keys: ["x"], label: "Select the row" },
  { scope: "shots.list", action: "range", keys: ["Shift+X"], label: "Select a range" },
  { scope: "shots.list", action: "open", keys: ["Enter"], label: "Open the shot" },
  { scope: "shots.list", action: "bulk", keys: ["b"], label: "Bulk edit the selected shots" },
  { scope: "shots.list", action: "move", keys: ["Shift+M"], label: "Move the selected shots to a project" },
  { scope: "shots.list", action: "remove", keys: ["Delete"], label: "Move the selected shots to the recycle bin" },
  { scope: "shots.list", action: "clear", keys: ["Escape"], pass: true, label: "Close bulk edit · clear the selection" },
  { scope: "map", action: "move", keys: ["ArrowUp", "ArrowDown"], info: true, label: "Move in the list" },
  { scope: "map", action: "open", keys: ["Enter"], info: true, label: "Open the shot" },

  // ---- Shot view
  { scope: "shot", action: "prev", keys: ["ArrowLeft"], label: "Previous shot" },
  { scope: "shot", action: "next", keys: ["ArrowRight"], label: "Next shot" },
  { scope: "shot", action: "prevPhoto", keys: [","], label: "Previous photo of a sequence" },
  { scope: "shot", action: "nextPhoto", keys: ["."], label: "Next photo of a sequence" },
  { scope: "shot", action: "approve", keys: ["a"], label: "Approve" },
  { scope: "shot", action: "archive", keys: ["e"], label: "Archive (archived: back to review)" },
  { scope: "shot", action: "framing", keys: ["r"], label: "Framing stage" },
  { scope: "shot", action: "compose", keys: ["c"], label: "Compose stage" },
  { scope: "shot", action: "sequence", keys: ["s"], label: "Sequence stage" },
  { scope: "shot", action: "frameMode", keys: ["m"], label: "Cycle the frame mode" },
  { scope: "shot", action: "back", keys: ["Escape"], label: "Back to where the shot was opened" },
  { scope: "framing", action: "drag", keys: ["Drag"], info: true, label: "Move the frame" },
  { scope: "framing", action: "lensDown", keys: ["ArrowLeft"], label: "Shorter lens" },
  { scope: "framing", action: "lensUp", keys: ["ArrowRight"], label: "Longer lens" },
  { scope: "framing", action: "nudge", keys: arrows.map((k) => `Shift+${k}`), display: "⇧ arrows", label: "Nudge the frame by 1 %" },
  { scope: "framing", action: "save", keys: ["Mod+s"], label: "Save the framing" },
  { scope: "framing", action: "back", keys: ["Escape"], label: "Back to the photo" },
  { scope: "sequence", action: "prevStep", keys: [","], label: "Previous step" },
  { scope: "sequence", action: "nextStep", keys: ["."], label: "Next step" },
  { scope: "sequence", action: "earlier", keys: ["Alt+ArrowLeft"], label: "Move the step earlier" },
  { scope: "sequence", action: "later", keys: ["Alt+ArrowRight"], label: "Move the step later" },
  { scope: "sequence", action: "remove", keys: ["Delete"], label: "Remove the step" },
  { scope: "sequence", action: "save", keys: ["Mod+s"], label: "Save now (changes autosave)" },
  { scope: "sequence", action: "back", keys: ["Escape"], label: "Back to the photo" },
  { scope: "compose", action: "prevPhoto", keys: [","], label: "Previous photo of a sequence" },
  { scope: "compose", action: "nextPhoto", keys: ["."], label: "Next photo of a sequence" },
  { scope: "position", action: "drag", keys: ["Drag"], info: true, label: "Move the pin" },
  { scope: "position", action: "save", keys: ["Enter"], label: "Save the position" },
  { scope: "position", action: "cancel", keys: ["Escape"], label: "Cancel" },

  // ---- Drawing: Compose and inline overlays or sketches
  { scope: "draw", action: "select", keys: ["v"], label: "Select / move" },
  { scope: "draw", action: "pen", keys: ["p"], label: "Freehand" },
  { scope: "draw", action: "line", keys: ["l"], label: "Line" },
  { scope: "draw", action: "arrow", keys: ["a"], label: "Arrow" },
  { scope: "draw", action: "rect", keys: ["r"], label: "Rectangle" },
  { scope: "draw", action: "ellipse", keys: ["o"], label: "Ellipse" },
  { scope: "draw", action: "text", keys: ["t"], label: "Text" },
  { scope: "draw", action: "stencil", keys: ["s"], label: "Stencil" },
  { scope: "draw", action: "eraser", keys: ["e"], label: "Eraser" },
  { scope: "draw", action: "colour", keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], display: "1 – 0", label: "Colour" },
  { scope: "draw", action: "undo", keys: ["Mod+z"], label: "Undo" },
  { scope: "draw", action: "redo", keys: ["Mod+Z", "Mod+y"], label: "Redo" },
  { scope: "draw", action: "remove", keys: ["Delete", "Backspace"], label: "Remove the selected shape" },
  { scope: "draw", action: "nudge", keys: [...arrows], display: "← ↑ → ↓", label: "Nudge the selected shape" },
  { scope: "draw", action: "save", keys: ["Mod+s"], label: "Save now (inline drawings also save on their own)" },
  { scope: "draw", action: "escape", keys: ["Escape"], label: "Stop editing text · deselect · leave" },
  { scope: "reframe", action: "drag", keys: ["Drag"], info: true, label: "Move the frame on the stage" },
  { scope: "reframe", action: "lensDown", keys: ["ArrowLeft"], label: "Shorter lens" },
  { scope: "reframe", action: "lensUp", keys: ["ArrowRight"], label: "Longer lens" },
  { scope: "reframe", action: "nudge", keys: arrows.map((k) => `Shift+${k}`), display: "⇧ arrows", label: "Nudge the frame by 1 %" },
  { scope: "reframe", action: "done", keys: ["Escape"], label: "Done" },

  // ---- Timeline (the cut, with the shot browser or the clip panel beside it)
  { scope: "timeline", action: "prev", keys: ["ArrowLeft"], label: "Previous clip" },
  { scope: "timeline", action: "next", keys: ["ArrowRight"], label: "Next clip" },
  { scope: "timeline", action: "first", keys: ["Home"], label: "First clip" },
  { scope: "timeline", action: "last", keys: ["End"], label: "Last clip" },
  { scope: "timeline", action: "play", keys: [" "], label: "Play / pause" },
  { scope: "timeline", action: "earlier", keys: ["Alt+ArrowLeft"], label: "Move the clip earlier" },
  { scope: "timeline", action: "later", keys: ["Alt+ArrowRight"], label: "Move the clip later" },
  { scope: "timeline", action: "drag", keys: ["Drag"], info: true, label: "Shots into the strip · reorder clips · scrub along the ruler" },
  { scope: "timeline", action: "panel", keys: ["n"], label: "Shot browser ⇄ clip panel" },
  { scope: "timeline", action: "placeholder", keys: ["p"], label: "Placeholder clip" },
  { scope: "timeline", action: "reframe", keys: ["r"], label: "Re-frame the clip on the stage" },
  { scope: "timeline", action: "compose", keys: ["c"], label: "Draw the clip's overlay (or sketch it)" },
  { scope: "timeline", action: "open", keys: ["Enter"], label: "Open the clip's shot" },
  { scope: "timeline", action: "range", keys: ["Shift+Click"], info: true, display: "⇧ click", label: "Select a range of clips (right-click: Make a sequence…)" },
  { scope: "timeline", action: "newTimeline", keys: ["Shift+N"], label: "New timeline" },
  { scope: "timeline", action: "menu", keys: ["Right-click"], info: true, label: "Actions on shots, clips and timelines" },
  { scope: "browser", action: "approve", keys: ["a"], label: "Approve the selected shot" },
  { scope: "browser", action: "archive", keys: ["e"], label: "Archive the selected shot (archived: back to review)" },
  { scope: "clip", action: "approve", keys: ["a"], label: "Approve the clip's shot" },
  { scope: "clip", action: "archive", keys: ["e"], label: "Archive the clip's shot (archived: back to review)" },
  { scope: "clip", action: "hold", keys: ["d"], label: "Focus the hold time" },
  { scope: "clip", action: "remove", keys: ["Delete"], label: "Remove the clip" },

  // ---- Plan
  { scope: "plan", action: "down", keys: ["ArrowDown"], label: "Next planned shot" },
  { scope: "plan", action: "up", keys: ["ArrowUp"], label: "Previous planned shot" },
  { scope: "plan", action: "later", keys: ["Alt+ArrowDown"], label: "Move later in the day" },
  { scope: "plan", action: "earlier", keys: ["Alt+ArrowUp"], label: "Move earlier in the day" },
  { scope: "plan", action: "time", keys: ["t"], label: "Planned time" },
  { scope: "plan", action: "remove", keys: ["Delete"], label: "Remove from the day" },
  { scope: "plan", action: "add", keys: ["n"], label: "Add shots" },
  { scope: "plan", action: "closeAdd", keys: ["Escape"], label: "Close the Add shots panel" },
  { scope: "plan", action: "newDay", keys: ["Shift+N"], label: "New shooting day" },
  { scope: "plan", action: "open", keys: ["Enter"], label: "Open the shot" },

  // ---- Metadata board
  { scope: "metadata", action: "drag", keys: ["Drag"], info: true, label: "Set the value" },
  { scope: "metadata", action: "dragBack", keys: ["Drag back"], info: true, label: "Clear the value" },
  { scope: "metadata", action: "open", keys: ["Double-click"], info: true, label: "Open the shot" },

  // ---- Library
  { scope: "rigs", action: "down", keys: ["j", "ArrowDown"], label: "Next rig" },
  { scope: "rigs", action: "up", keys: ["k", "ArrowUp"], label: "Previous rig" },
  { scope: "rigs", action: "open", keys: ["Enter"], label: "Edit the rig" },
  { scope: "rig", action: "save", keys: ["Mod+s"], label: "Save the rig" },
  { scope: "rig", action: "close", keys: ["Escape"], label: "Close the editor" },
  { scope: "locations", action: "search", keys: ["/"], label: "Filter the locations" },
  { scope: "locations", action: "down", keys: ["j", "ArrowDown"], label: "Next location" },
  { scope: "locations", action: "up", keys: ["k", "ArrowUp"], label: "Previous location" },
  { scope: "locations", action: "rename", keys: ["F2"], label: "Rename" },
  { scope: "locations", action: "pin", keys: ["p"], label: "Set the position" },
  { scope: "locations", action: "open", keys: ["Enter"], label: "Show its shots" },
  { scope: "locations", action: "remove", keys: ["Delete"], label: "Move to the recycle bin" },
  { scope: "fields", action: "save", keys: ["Mod+s"], label: "Save the field" },
  { scope: "fields", action: "indent", keys: ["Tab"], info: true, label: "Indent in the JSON editor" },
  { scope: "fields", action: "leave", keys: ["Escape"], label: "Leave the editor" },

  // ---- Files (the desktop's explorer)
  { scope: "files", action: "search", keys: ["/"], label: "Focus the search" },
  { scope: "files", action: "down", keys: ["j", "ArrowDown"], label: "Next item" },
  { scope: "files", action: "up", keys: ["k", "ArrowUp"], label: "Previous item" },
  { scope: "files", action: "open", keys: ["Enter"], label: "Open the item (a folder: go into it)" },
  { scope: "files", action: "parent", keys: ["Backspace", "Alt+ArrowUp"], label: "Up to the parent folder" },
  { scope: "files", action: "rename", keys: ["F2"], label: "Rename" },
  { scope: "files", action: "remove", keys: ["Delete"], label: "Move to the recycle bin" },
  { scope: "files", action: "newFolder", keys: ["Shift+N"], label: "New folder here" },
  { scope: "files", action: "all", keys: ["Mod+a"], label: "Select everything listed (Ctrl-click toggles, Shift-click extends)" },
  { scope: "files", action: "drag", keys: ["Drag"], info: true, label: "Onto a folder: move there · onto the desktop: into the Desktop folder · onto the recycle bin: delete" },
  { scope: "files", action: "menu", keys: ["Right-click"], info: true, label: "Open, rename, move, move to the desktop, shortcut on the desktop, recycle bin" },

  // ---- Desktop icons (handled by the focused icon itself)
  { scope: "desktop", action: "open", keys: ["Enter"], info: true, label: "Open the focused icon (or double-click it)" },
  { scope: "desktop", action: "drag", keys: ["Drag"], info: true, label: "Move the selected icons, each to a free cell · files dragged from Files move into the Desktop folder" },
  { scope: "desktop", action: "menu", keys: ["Right-click"], info: true, label: "On an icon: open, rename, remove · on the desktop: new folder, new shortcut, arrange" },
  { scope: "desktop", action: "all", keys: ["Mod+a"], label: "Select every icon" },
  { scope: "desktop", action: "clear", keys: ["Escape"], label: "Clear the selection" },
  { scope: "desktop", action: "rename", keys: ["F2"], label: "Rename the selected icon (a real file or folder itself, else the shortcut)" },
  { scope: "desktop", action: "remove", keys: ["Delete"], label: "Selected files to the recycle bin, selected shortcuts off the desktop" },
  { scope: "desktop", action: "left", keys: ["ArrowLeft"], label: "Select the icon to the left" },
  { scope: "desktop", action: "right", keys: ["ArrowRight"], label: "Select the icon to the right" },
  { scope: "desktop", action: "up", keys: ["ArrowUp"], label: "Select the icon above" },
  { scope: "desktop", action: "down", keys: ["ArrowDown"], label: "Select the icon below" },
  { scope: "desktop", action: "select", keys: ["Click", "Drag"], info: true, label: "Ctrl-click toggles, Shift-click adds; drag on the empty desktop to select with a rubber band" },
  { scope: "desktop", action: "folder", keys: ["Drag"], info: true, label: "Icons onto a folder icon: move them into that folder (apps stay)" },
  { scope: "desktop", action: "bin", keys: ["Drag"], info: true, label: "An icon or a file from Files onto the recycle bin: remove the shortcut, or bin the file" },
  // ---- Recycle bin (epic #90)
  { scope: "trash", action: "search", keys: ["/"], label: "Focus the search" },
  { scope: "trash", action: "all", keys: ["Mod+a"], label: "Select everything listed" },
  { scope: "trash", action: "restore", keys: ["r"], label: "Restore the selected items (or double-click one)" },
  { scope: "trash", action: "purge", keys: ["Delete"], label: "Delete the selected items permanently" },

  // ---- Dialogs and controls
  { scope: "newshot", action: "undo", keys: ["Mod+z"], label: "Undo the last shape" },
  { scope: "newshot", action: "remove", keys: ["Delete"], label: "Remove the selected shape" },
  { scope: "combobox", action: "move", keys: ["ArrowUp", "ArrowDown"], info: true, label: "Move" },
  { scope: "combobox", action: "take", keys: ["Enter", "Tab"], info: true, label: "Take the highlighted entry" },
  { scope: "combobox", action: "cancel", keys: ["Escape"], info: true, label: "Cancel" },
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
    "Generated from `apps/studio/src/shortcuts.ts` (issue #32); `shortcuts.test.ts` fails when this file drifts. Regenerate with `node apps/studio/src/shortcuts.docs.ts > docs/shortcuts.md`.",
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
