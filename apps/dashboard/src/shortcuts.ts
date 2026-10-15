/**
 * Every keyboard shortcut of the dashboard (issue #32), in one place. Pages bind handlers to these
 * entries (`bind` in keys.ts) instead of writing key strings, so a key's meaning is visible here and
 * `shortcuts.test.ts` can assert that no key does two things where scopes are live together. The `?`
 * sheet, Settings › Shortcuts, the hint bar and docs/shortcuts.md are all rendered from this list.
 *
 * Keys use keys.ts names: `e.key` with modifier prefixes ("Mod+s", "Alt+ArrowUp", "Shift+N"). A
 * `chord: "g"` entry fires only right after G (G S, G T, …); every other plain letter is held back
 * then, so a page's own letter never swallows a section jump.
 */

export type ScopeId =
  | "global" | "shots" | "shots.grid" | "shots.list" | "map" | "shot" | "framing" | "compose" | "draw" | "reframe"
  | "timeline" | "browser" | "clip" | "plan" | "metadata" | "rigs" | "rig" | "locations" | "fields" | "position" | "newshot" | "combobox";

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
  shots: { label: "Shots", with: ["shots.grid", "shots.list", "map"] },
  "shots.grid": { label: "Shots · grid", with: ["shots"] },
  "shots.list": { label: "Shots · list", with: ["shots"] },
  map: { label: "Shots · map", with: ["shots"] },
  shot: { label: "Shot view", with: [] },
  framing: { label: "Shot view · Framing", with: [] },
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
};

export interface Shortcut {
  scope: ScopeId;
  /** The handler name a page binds (unique within its scope). */
  action: string;
  keys: readonly string[];
  label: string;
  /** Short label for the hint bar under the page; entries without one are only in the full lists. */
  hint?: string;
  /** Only right after G. */
  chord?: "g";
  /** How the keys read when listed, when the plain rendering would be noisy (1–0, ⇧ arrows). */
  display?: string;
  /** The keys the hint bar shows for this entry, when it stands for several (← / → for previous and next). */
  hintKeys?: string;
  /** Handled by the element itself (grid, list box, text field) or a gesture: listed, never bound. */
  info?: true;
  /** The handler returns false when it does not apply, so another live entry may share the key. */
  pass?: true;
}

const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;

export const SHORTCUTS = [
  // ---- everywhere
  { scope: "global", action: "palette", keys: ["Mod+k"], label: "Go to… (command palette)", hint: "Go to" },
  { scope: "global", action: "sheet", keys: ["?"], label: "All shortcuts" },
  { scope: "global", action: "sidebar", keys: ["Mod+b"], label: "Collapse or expand the sidebar" },
  { scope: "global", action: "goShots", keys: ["s"], chord: "g", label: "Go to Shots" },
  { scope: "global", action: "goTimeline", keys: ["t"], chord: "g", label: "Go to Timeline" },
  { scope: "global", action: "goPlan", keys: ["p"], chord: "g", label: "Go to Plan" },
  { scope: "global", action: "goLibrary", keys: ["l"], chord: "g", label: "Go to the Library" },
  { scope: "global", action: "goMap", keys: ["m"], chord: "g", label: "Shots on the map" },
  { scope: "global", action: "back", keys: ["Escape"], info: true, label: "Close or back out one level" },

  // ---- Shots
  { scope: "shots", action: "search", keys: ["/"], label: "Focus the search", hint: "Search" },
  { scope: "shots", action: "filter", keys: ["f"], label: "Filter panel", hint: "Filter" },
  { scope: "shots", action: "frameMode", keys: ["m"], label: "Cycle the frame mode", hint: "Frame mode" },
  { scope: "shots", action: "newShot", keys: ["Shift+N"], label: "New shot (upload or draw)" },
  { scope: "shots", action: "leaveSearch", keys: ["Escape"], pass: true, label: "Leave the search field" },
  { scope: "shots.grid", action: "move", keys: [...arrows], info: true, display: "← ↑ → ↓", label: "Move in the grid", hint: "Move" },
  { scope: "shots.grid", action: "open", keys: ["Enter"], info: true, label: "Open the shot", hint: "Open" },
  { scope: "shots.list", action: "down", keys: ["j", "ArrowDown"], label: "Next row", hint: "Move" },
  { scope: "shots.list", action: "up", keys: ["k", "ArrowUp"], label: "Previous row" },
  { scope: "shots.list", action: "select", keys: ["x"], label: "Select the row", hint: "Select" },
  { scope: "shots.list", action: "range", keys: ["Shift+X"], label: "Select a range", hint: "Select range" },
  { scope: "shots.list", action: "open", keys: ["Enter"], label: "Open the shot", hint: "Open" },
  { scope: "shots.list", action: "bulk", keys: ["b"], label: "Bulk edit the selected shots", hint: "Bulk edit" },
  { scope: "shots.list", action: "move", keys: ["Shift+M"], label: "Move the selected shots to a project", hint: "Move selected" },
  { scope: "shots.list", action: "remove", keys: ["Delete"], label: "Delete the selected shots", hint: "Delete selected" },
  { scope: "shots.list", action: "clear", keys: ["Escape"], pass: true, label: "Close bulk edit · clear the selection" },
  { scope: "map", action: "move", keys: ["ArrowUp", "ArrowDown"], info: true, label: "Move in the list", hint: "Move in list" },
  { scope: "map", action: "open", keys: ["Enter"], info: true, label: "Open the shot", hint: "Open" },

  // ---- Shot view
  { scope: "shot", action: "prev", keys: ["ArrowLeft"], label: "Previous shot" },
  { scope: "shot", action: "next", keys: ["ArrowRight"], label: "Next shot", hintKeys: "← / →", hint: "Shots" },
  { scope: "shot", action: "prevPhoto", keys: [","], label: "Previous photo of a sequence" },
  { scope: "shot", action: "nextPhoto", keys: ["."], label: "Next photo of a sequence", hintKeys: ", / .", hint: "Photos" },
  { scope: "shot", action: "approve", keys: ["a"], label: "Approve", hint: "Approve" },
  { scope: "shot", action: "archive", keys: ["e"], label: "Archive (archived: back to review)", hint: "Archive" },
  { scope: "shot", action: "framing", keys: ["r"], label: "Framing stage", hint: "Framing" },
  { scope: "shot", action: "compose", keys: ["c"], label: "Compose stage", hint: "Compose" },
  { scope: "shot", action: "frameMode", keys: ["m"], label: "Cycle the frame mode", hint: "Frame mode" },
  { scope: "shot", action: "back", keys: ["Escape"], label: "Back to where the shot was opened", hint: "Close" },
  { scope: "framing", action: "drag", keys: ["Drag"], info: true, label: "Move the frame", hint: "Move the frame" },
  { scope: "framing", action: "lensDown", keys: ["ArrowLeft"], label: "Shorter lens" },
  { scope: "framing", action: "lensUp", keys: ["ArrowRight"], label: "Longer lens", hintKeys: "← / →", hint: "Lens" },
  { scope: "framing", action: "nudge", keys: arrows.map((k) => `Shift+${k}`), display: "⇧ arrows", label: "Nudge the frame by 1 %", hint: "Nudge" },
  { scope: "framing", action: "save", keys: ["Mod+s"], label: "Save the framing", hint: "Save framing" },
  { scope: "framing", action: "back", keys: ["Escape"], label: "Back to the photo", hint: "Back to photo" },
  { scope: "compose", action: "prevPhoto", keys: [","], label: "Previous photo of a sequence" },
  { scope: "compose", action: "nextPhoto", keys: ["."], label: "Next photo of a sequence", hintKeys: ", / .", hint: "Photos" },
  { scope: "position", action: "drag", keys: ["Drag"], info: true, label: "Move the pin", hint: "Move pin" },
  { scope: "position", action: "save", keys: ["Enter"], label: "Save the position", hint: "Save position" },
  { scope: "position", action: "cancel", keys: ["Escape"], label: "Cancel", hint: "Cancel" },

  // ---- Drawing: Compose and inline overlays or sketches
  { scope: "draw", action: "select", keys: ["v"], label: "Select / move", hintKeys: "V P L A R O T S E", hint: "Tools" },
  { scope: "draw", action: "pen", keys: ["p"], label: "Freehand" },
  { scope: "draw", action: "line", keys: ["l"], label: "Line" },
  { scope: "draw", action: "arrow", keys: ["a"], label: "Arrow" },
  { scope: "draw", action: "rect", keys: ["r"], label: "Rectangle" },
  { scope: "draw", action: "ellipse", keys: ["o"], label: "Ellipse" },
  { scope: "draw", action: "text", keys: ["t"], label: "Text" },
  { scope: "draw", action: "stencil", keys: ["s"], label: "Stencil" },
  { scope: "draw", action: "eraser", keys: ["e"], label: "Eraser" },
  { scope: "draw", action: "colour", keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], display: "1 – 0", label: "Colour", hint: "Colour" },
  { scope: "draw", action: "undo", keys: ["Mod+z"], label: "Undo", hint: "Undo" },
  { scope: "draw", action: "redo", keys: ["Mod+Z", "Mod+y"], label: "Redo" },
  { scope: "draw", action: "remove", keys: ["Delete", "Backspace"], label: "Remove the selected shape", hint: "Remove shape" },
  { scope: "draw", action: "nudge", keys: [...arrows], display: "← ↑ → ↓", label: "Nudge the selected shape" },
  { scope: "draw", action: "save", keys: ["Mod+s"], label: "Save now (inline drawings also save on their own)", hint: "Save" },
  { scope: "draw", action: "escape", keys: ["Escape"], label: "Stop editing text · deselect · leave", hint: "Back" },
  { scope: "reframe", action: "drag", keys: ["Drag"], info: true, label: "Move the frame on the stage", hint: "Move the frame" },
  { scope: "reframe", action: "lensDown", keys: ["ArrowLeft"], label: "Shorter lens" },
  { scope: "reframe", action: "lensUp", keys: ["ArrowRight"], label: "Longer lens", hintKeys: "← / →", hint: "Lens" },
  { scope: "reframe", action: "nudge", keys: arrows.map((k) => `Shift+${k}`), display: "⇧ arrows", label: "Nudge the frame by 1 %", hint: "Nudge" },
  { scope: "reframe", action: "done", keys: ["Escape"], label: "Done", hint: "Done" },

  // ---- Timeline (the cut, with the shot browser or the clip panel beside it)
  { scope: "timeline", action: "prev", keys: ["ArrowLeft"], label: "Previous clip" },
  { scope: "timeline", action: "next", keys: ["ArrowRight"], label: "Next clip", hintKeys: "← / →", hint: "Clip" },
  { scope: "timeline", action: "first", keys: ["Home"], label: "First clip" },
  { scope: "timeline", action: "last", keys: ["End"], label: "Last clip" },
  { scope: "timeline", action: "play", keys: [" "], label: "Play / pause", hint: "Play" },
  { scope: "timeline", action: "earlier", keys: ["Alt+ArrowLeft"], label: "Move the clip earlier" },
  { scope: "timeline", action: "later", keys: ["Alt+ArrowRight"], label: "Move the clip later" },
  { scope: "timeline", action: "drag", keys: ["Drag"], info: true, label: "Shots into the strip · reorder clips · scrub along the ruler", hint: "Add / reorder" },
  { scope: "timeline", action: "panel", keys: ["n"], label: "Shot browser ⇄ clip panel", hint: "Shots panel" },
  { scope: "timeline", action: "placeholder", keys: ["p"], label: "Placeholder clip", hint: "Placeholder" },
  { scope: "timeline", action: "reframe", keys: ["r"], label: "Re-frame the clip on the stage" },
  { scope: "timeline", action: "compose", keys: ["c"], label: "Draw the clip's overlay (or sketch it)", hintKeys: "R / C", hint: "Re-frame / compose" },
  { scope: "timeline", action: "open", keys: ["Enter"], label: "Open the clip's shot" },
  { scope: "timeline", action: "newTimeline", keys: ["Shift+N"], label: "New timeline", hint: "New timeline" },
  { scope: "timeline", action: "menu", keys: ["Right-click"], info: true, label: "Actions on shots, clips and timelines", hint: "Actions" },
  { scope: "browser", action: "approve", keys: ["a"], label: "Approve the selected shot" },
  { scope: "browser", action: "archive", keys: ["e"], label: "Archive the selected shot (archived: back to review)", hintKeys: "A / E", hint: "Approve / archive" },
  { scope: "clip", action: "approve", keys: ["a"], label: "Approve the clip's shot" },
  { scope: "clip", action: "archive", keys: ["e"], label: "Archive the clip's shot (archived: back to review)", hintKeys: "A / E", hint: "Approve / archive" },
  { scope: "clip", action: "hold", keys: ["d"], label: "Focus the hold time" },
  { scope: "clip", action: "remove", keys: ["Delete"], label: "Remove the clip" },

  // ---- Plan
  { scope: "plan", action: "down", keys: ["ArrowDown"], label: "Next planned shot" },
  { scope: "plan", action: "up", keys: ["ArrowUp"], label: "Previous planned shot", hintKeys: "↑ / ↓", hint: "Shots" },
  { scope: "plan", action: "later", keys: ["Alt+ArrowDown"], label: "Move later in the day" },
  { scope: "plan", action: "earlier", keys: ["Alt+ArrowUp"], label: "Move earlier in the day", hintKeys: "Alt ↑ / ↓", hint: "Reorder" },
  { scope: "plan", action: "time", keys: ["t"], label: "Planned time", hint: "Planned time" },
  { scope: "plan", action: "remove", keys: ["Delete"], label: "Remove from the day", hint: "Remove" },
  { scope: "plan", action: "add", keys: ["n"], label: "Add shots", hint: "Add shots" },
  { scope: "plan", action: "closeAdd", keys: ["Escape"], label: "Close the Add shots panel" },
  { scope: "plan", action: "newDay", keys: ["Shift+N"], label: "New shooting day", hint: "New day" },
  { scope: "plan", action: "open", keys: ["Enter"], label: "Open the shot", hint: "Open shot" },

  // ---- Metadata board
  { scope: "metadata", action: "drag", keys: ["Drag"], info: true, label: "Set the value", hint: "Set the value" },
  { scope: "metadata", action: "dragBack", keys: ["Drag back"], info: true, label: "Clear the value", hint: "Clear it" },
  { scope: "metadata", action: "open", keys: ["Double-click"], info: true, label: "Open the shot", hint: "Open shot" },

  // ---- Library
  { scope: "rigs", action: "down", keys: ["j", "ArrowDown"], label: "Next rig", hint: "Move" },
  { scope: "rigs", action: "up", keys: ["k", "ArrowUp"], label: "Previous rig" },
  { scope: "rigs", action: "open", keys: ["Enter"], label: "Edit the rig", hint: "Edit" },
  { scope: "rig", action: "save", keys: ["Mod+s"], label: "Save the rig", hint: "Save rig" },
  { scope: "rig", action: "close", keys: ["Escape"], label: "Close the editor", hint: "Close editor" },
  { scope: "locations", action: "search", keys: ["/"], label: "Filter the locations", hint: "Filter" },
  { scope: "locations", action: "down", keys: ["j", "ArrowDown"], label: "Next location", hint: "Move" },
  { scope: "locations", action: "up", keys: ["k", "ArrowUp"], label: "Previous location" },
  { scope: "locations", action: "rename", keys: ["F2"], label: "Rename", hint: "Rename" },
  { scope: "locations", action: "pin", keys: ["p"], label: "Set the position", hint: "Position" },
  { scope: "locations", action: "open", keys: ["Enter"], label: "Show its shots", hint: "Show shots" },
  { scope: "locations", action: "remove", keys: ["Delete"], label: "Delete", hint: "Delete" },
  { scope: "fields", action: "save", keys: ["Mod+s"], label: "Save the field", hint: "Save field" },
  { scope: "fields", action: "indent", keys: ["Tab"], info: true, label: "Indent in the JSON editor", hint: "Indent" },
  { scope: "fields", action: "leave", keys: ["Escape"], label: "Leave the editor", hint: "Leave editor" },

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

/** The hint bar for a page: the entries with a hint, in the given scopes' order, with merged displays. */
export function hintsFor(...scopes: ScopeId[]): { k: string; t: string }[] {
  return scopes.flatMap((sc) => shortcutsOf(sc).filter((s) => s.hint).map((s) => ({ k: s.hintKeys ?? keysLabel(s), t: s.hint! })));
}

/** docs/shortcuts.md, generated so it cannot drift (shortcuts.test.ts compares it). */
export function shortcutsMarkdown(): string {
  const out = [
    "# Keyboard shortcuts (dashboard)",
    "",
    "Generated from `apps/dashboard/src/shortcuts.ts` (issue #32); `shortcuts.test.ts` fails when this file drifts. Regenerate with `node apps/dashboard/src/shortcuts.docs.ts > docs/shortcuts.md`.",
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
