/**
 * Properties (docs/rewrite/04-shots.md, 07-organisation.md): the metadata of a file apart from its
 * content. A project keeps one catalogue of definitions, each a file of the type `property` in its
 * Settings folder, attached to any number of file types. A value is one row of `property_values`
 * (file, definition, JSON value). This module is the rules both sides run: what a definition may
 * say, what a value of it may be, which choices a dependent choice offers, and the defaults a new
 * project starts with.
 */

export const FIELD_TYPES = ["text", "long", "number", "yesno", "choice", "multi", "date", "reference", "position"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_LABELS: Record<FieldType, string> = {
  text: "Text", long: "Long text", number: "Number", yesno: "Yes / no", choice: "Single choice", multi: "Multiple choice", date: "Date", reference: "Reference", position: "Position",
};

/** A colour of the design system's eight (1–8), none (0), or any as #rrggbb. */
export type Colour = number | string;
export interface ChoiceOption {
  /** Stays when the label changes, so values survive a rename. */
  id: string;
  label: string;
  color: Colour;
}
/** Where a property is shown: a file type, and whether it is hidden there (its values are kept). */
export interface Attachment { type: string; hidden?: boolean }

export interface PropertyDef {
  field: FieldType;
  /** For choices. */
  options?: ChoiceOption[];
  /** For a choice: its options depend on another single choice's value (line → station). Option ids of the parent → option ids of this one. */
  dependsOn?: { property: string; map: Record<string, string[]> } | null;
  /** For a reference: the file types it may point at (empty: any), and whether it holds several. */
  targets?: string[];
  many?: boolean;
  /** For a number: a unit shown after it. */
  unit?: string;
  /** Optional heading that groups properties in the list; visual only. */
  section?: string;
  attached: Attachment[];
  /** Place in the catalogue. */
  order: number;
}

/** A value as stored, per field type. Absent or null: no value (the row is removed). */
export type PropertyValue = string | number | boolean | string[] | { lat: number; lng: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const OPTION_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const MAX_OPTIONS = 200;
export const MAX_TEXT = 500;
export const MAX_LONG = 20_000;
export const MAX_REFERENCES = 200;
const TYPE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const colourOk = (c: unknown) => (typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 8) || (typeof c === "string" && HEX.test(c));
export const isChoice = (f: FieldType) => f === "choice" || f === "multi";

/** Null when the definition is valid, else what is wrong. */
export function definitionError(body: Record<string, unknown>): string | null {
  for (const k of Object.keys(body)) if (!["field", "options", "dependsOn", "targets", "many", "unit", "section", "attached", "order"].includes(k)) return `a property has no "${k}"`;
  const f = body.field;
  if (!(FIELD_TYPES as readonly unknown[]).includes(f)) return `field must be one of: ${FIELD_TYPES.join(", ")}`;
  const field = f as FieldType;
  if (!Array.isArray(body.attached) || body.attached.length > 40) return "attached must be a list of file types";
  const seen = new Set<string>();
  for (const a of body.attached) {
    if (!isObj(a) || typeof a.type !== "string" || !TYPE_ID.test(a.type)) return "each attachment names a file type";
    if (a.hidden !== undefined && typeof a.hidden !== "boolean") return "hidden is yes or no";
    if (seen.has(a.type)) return `${a.type} is attached twice`;
    seen.add(a.type);
  }
  if (typeof body.order !== "number" || !Number.isFinite(body.order)) return "order must be a number";
  if (body.section !== undefined && (typeof body.section !== "string" || body.section.length > 60)) return "section is a text of at most 60 characters";
  if (isChoice(field)) {
    if (!Array.isArray(body.options) || body.options.length > MAX_OPTIONS) return `a choice has a list of at most ${MAX_OPTIONS} options`;
    const ids = new Set<string>();
    for (const o of body.options) {
      if (!isObj(o) || typeof o.id !== "string" || !OPTION_ID.test(o.id)) return "each option has an id";
      if (typeof o.label !== "string" || !o.label.trim() || o.label.length > 80) return "each option has a label of at most 80 characters";
      if (!colourOk(o.color)) return "an option's colour is 0 to 8 or #rrggbb";
      if (ids.has(o.id)) return `option id ${o.id} is used twice`;
      ids.add(o.id);
    }
    if (body.dependsOn != null) {
      const d = body.dependsOn;
      if (!isObj(d) || typeof d.property !== "string" || !UUID.test(d.property) || !isObj(d.map)) return "dependsOn names a property and maps its options";
      for (const [k, list] of Object.entries(d.map)) if (!OPTION_ID.test(k) || !Array.isArray(list) || !list.every((x) => typeof x === "string" && ids.has(x))) return "dependsOn maps the parent's options to options of this property";
    }
  } else if (body.options !== undefined || body.dependsOn != null) return "only a choice has options";
  if (field === "reference") {
    if (body.targets !== undefined && !(Array.isArray(body.targets) && body.targets.length <= 20 && body.targets.every((t) => typeof t === "string" && TYPE_ID.test(t)))) return "targets is a list of file types";
    if (body.many !== undefined && typeof body.many !== "boolean") return "many is yes or no";
  } else if (body.targets !== undefined || body.many !== undefined) return "only a reference has targets";
  if (body.unit !== undefined && (field !== "number" || typeof body.unit !== "string" || body.unit.length > 12)) return "only a number has a unit, of at most 12 characters";
  return null;
}

/** Null when the value fits the definition, else what is wrong. `parent` is the value of the property this one depends on. */
export function valueError(def: PropertyDef, v: unknown, parent?: unknown): string | null {
  switch (def.field) {
    case "text": return typeof v === "string" && v.length <= MAX_TEXT && !v.includes("\n") ? null : `a text of one line, at most ${MAX_TEXT} characters`;
    case "long": return typeof v === "string" && v.length <= MAX_LONG ? null : `a text of at most ${MAX_LONG} characters`;
    case "number": return typeof v === "number" && Number.isFinite(v) ? null : "a number";
    case "yesno": return typeof v === "boolean" ? null : "yes or no";
    case "date": return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? null : "a date as YYYY-MM-DD";
    case "position": return isObj(v) && Object.keys(v).length === 2 && typeof v.lat === "number" && typeof v.lng === "number" && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180 ? null : "a position: latitude and longitude";
    case "reference": {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && UUID.test(x))) return "a list of file ids";
      if (!def.many && v.length > 1) return "one file";
      if (v.length > MAX_REFERENCES) return `at most ${MAX_REFERENCES} files`;
      return new Set(v).size === v.length ? null : "a file named twice";
    }
    case "choice": case "multi": {
      const allowed = allowedOptions(def, parent);
      const list = def.field === "choice" ? [v] : v;
      if (def.field === "choice" ? typeof v !== "string" : !Array.isArray(v)) return def.field === "choice" ? "one of the options" : "a list of options";
      for (const x of list as unknown[]) if (typeof x !== "string" || !allowed.some((o) => o.id === x)) return def.dependsOn ? "an option that fits the property it depends on" : "one of the options";
      return def.field === "multi" && new Set(list as string[]).size !== (list as string[]).length ? "an option named twice" : null;
    }
  }
}

/** The options a choice offers now: all, or for a dependent choice those its parent's value allows (none while the parent is empty). */
export function allowedOptions(def: PropertyDef, parent?: unknown): ChoiceOption[] {
  const all = def.options ?? [];
  if (!def.dependsOn) return all;
  const keys = Array.isArray(parent) ? parent : typeof parent === "string" ? [parent] : [];
  const ok = new Set(keys.flatMap((k) => def.dependsOn!.map[k as string] ?? []));
  return all.filter((o) => ok.has(o.id));
}

/** An empty value: no row. */
export const isEmptyValue = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** The files a value names (a reference), for the `refs` rows of kind "property". */
export const filesNamed = (def: PropertyDef, v: unknown): string[] => (def.field === "reference" && Array.isArray(v) ? (v as string[]) : []);

/** A value after its definition changed: kept when it still fits, else dropped (null). Options are matched by id, so renamed ones stay. */
export function fitValue(def: PropertyDef, v: unknown, parent?: unknown): PropertyValue | null {
  if (isEmptyValue(v)) return null;
  if (def.field === "multi" && Array.isArray(v)) {
    const ok = new Set(allowedOptions(def, parent).map((o) => o.id));
    const kept = (v as unknown[]).filter((x): x is string => typeof x === "string" && ok.has(x));
    return kept.length ? kept : null;
  }
  if (def.field === "reference" && Array.isArray(v) && !def.many) return valueError(def, v.slice(0, 1)) ? null : (v.slice(0, 1) as string[]);
  return valueError(def, v, parent) ? null : (v as PropertyValue);
}

/** Whether a property is shown on a file of this type. */
export const shownOn = (def: PropertyDef, type: string) => def.attached.some((a) => a.type === type && !a.hidden);
export const attachedTo = (def: PropertyDef, type: string) => def.attached.some((a) => a.type === type);

/** A value as a person reads it, for lists, search and the board. */
export function valueText(def: PropertyDef, v: unknown, nameOf: (id: string) => string | undefined = () => undefined): string {
  if (isEmptyValue(v)) return "";
  switch (def.field) {
    case "yesno": return v ? "Yes" : "No";
    case "choice": return def.options?.find((o) => o.id === v)?.label ?? "";
    case "multi": return (v as string[]).map((x) => def.options?.find((o) => o.id === x)?.label).filter(Boolean).join(", ");
    case "reference": return (v as string[]).map((id) => nameOf(id) ?? "Missing file").join(", ");
    case "position": { const p = v as { lat: number; lng: number }; return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`; }
    case "number": return `${v}${def.unit ? ` ${def.unit}` : ""}`;
    default: return String(v);
  }
}

// ---------- The template of a new project ----------

/** An option id from its label. */
export const optionId = (label: string, taken: Iterable<string> = []): string => {
  const base = label.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "option";
  const used = new Set(taken);
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
};
const opts = (list: [string, Colour][]): ChoiceOption[] => { const ids: string[] = []; return list.map(([label, color]) => { const id = optionId(label, ids); ids.push(id); return { id, label, color }; }); };

/**
 * What a new project starts with (07-organisation.md, "Default template"): for shots a typical shot
 * list, for a canvas its kind, "Set" on shots (09a). Every one can be changed, hidden or deleted.
 */
export const TEMPLATE: { name: string; def: Omit<PropertyDef, "order"> }[] = [
  { name: "Scene", def: { field: "text", section: "Script", attached: [{ type: "shot" }] } },
  { name: "Shot no.", def: { field: "text", section: "Script", attached: [{ type: "shot" }] } },
  { name: "Set", def: { field: "reference", targets: ["set"], many: false, section: "Script", attached: [{ type: "shot" }] } },
  { name: "INT / EXT", def: { field: "choice", options: opts([["INT", 6], ["EXT", 4]]), section: "Script", attached: [{ type: "shot" }, { type: "set" }] } },
  { name: "Day / Night", def: { field: "choice", options: opts([["Day", 3], ["Night", 1], ["Dusk", 2], ["Dawn", 7]]), section: "Script", attached: [{ type: "shot" }, { type: "set" }] } },
  { name: "Shot size", def: { field: "choice", options: opts([["EWS", 1], ["WS", 6], ["MS", 4], ["MCU", 3], ["CU", 2], ["ECU", 7]]), section: "Camera", attached: [{ type: "shot" }] } },
  { name: "Angle", def: { field: "choice", options: opts([["Eye level", 0], ["High", 6], ["Low", 2], ["Top", 7], ["Dutch", 8]]), section: "Camera", attached: [{ type: "shot" }] } },
  { name: "Movement", def: { field: "multi", options: opts([["Static", 0], ["Pan", 6], ["Tilt", 4], ["Push in", 2], ["Pull out", 5], ["Tracking", 3], ["Crane", 7]]), section: "Camera", attached: [{ type: "shot" }] } },
  { name: "Support", def: { field: "choice", options: opts([["Tripod", 0], ["Handheld", 2], ["Dolly", 6], ["Gimbal", 4], ["Slider", 3], ["Crane", 7], ["Drone", 5]]), section: "Camera", attached: [{ type: "shot" }] } },
  { name: "Lens", def: { field: "text", section: "Camera", attached: [{ type: "shot" }] } },
  { name: "Kind", def: { field: "choice", options: opts([["Floor plan", 6], ["Lighting diagram", 2], ["Blocking", 3], ["Storyboard", 4]]), attached: [{ type: "canvas" }] } },
];

// ---------- Naming patterns ----------

/** Tokens of a naming pattern (04-shots.md, "Names"). Facts of a photo only work on photos. */
export const NAME_TOKENS: Record<string, { label: string; photoOnly?: boolean }> = {
  type: { label: "The file type (Shot, Photo)" },
  counter: { label: "A running number per project and file type" },
  date: { label: "The date it was made, YYYY-MM-DD" },
  time: { label: "The time it was made, HH-MM" },
  device: { label: "The device that took the photo", photoOnly: true },
  focal: { label: "The lens's 35 mm focal length", photoOnly: true },
};
export const MAX_DIGITS = 6;

/** What is wrong with a pattern on a file type, one line per problem; empty when it can be used. */
export function patternProblems(pattern: string, type: string): string[] {
  const out = new Set<string>();
  if (!pattern.trim()) out.add("The pattern is empty.");
  if (pattern.length > 80) out.add("The pattern is longer than 80 characters.");
  for (const m of pattern.matchAll(/\{([^{}]*)\}/g)) {
    const t = NAME_TOKENS[m[1]];
    if (!t) out.add(`{${m[1]}} is not a token.`);
    else if (t.photoOnly && type !== "photo") out.add(`{${m[1]}} only works on photos.`);
  }
  if (/[{}]/.test(pattern.replace(/\{[^{}]*\}/g, ""))) out.add("A brace without its partner.");
  return [...out];
}

export interface NameFacts { type: string; label: string; counter: number; at: Date; device?: string | null; focal?: number | null }

/** The name a pattern gives; a fact that is missing leaves its token out. Collapses what that leaves (double spaces, a dangling separator). */
export function renderName(pattern: string, digits: number, f: NameFacts): string {
  const pad = (n: number, d = 2) => String(n).padStart(d, "0");
  const value = (t: string): string => {
    switch (t) {
      case "type": return f.label;
      case "counter": return String(f.counter).padStart(Math.max(1, Math.min(MAX_DIGITS, digits)), "0");
      case "date": return `${f.at.getFullYear()}-${pad(f.at.getMonth() + 1)}-${pad(f.at.getDate())}`;
      case "time": return `${pad(f.at.getHours())}-${pad(f.at.getMinutes())}`;
      case "device": return f.device ?? "";
      case "focal": return f.focal ? `${Math.round(f.focal)}mm` : "";
      default: return "";
    }
  };
  const name = pattern.replace(/\{([^{}]*)\}/g, (_, t: string) => value(t)).replace(/\s{2,}/g, " ").replace(/^[\s·_-]+|[\s·_-]+$/g, "").trim();
  return (name || `${f.label} ${f.counter}`).slice(0, 120);
}

/** The pattern every type starts with: "Shot 012", "Photo 0142". */
export const defaultPattern = (type: string): { pattern: string; digits: number } => ({ pattern: "{type} {counter}", digits: type === "photo" ? 4 : 3 });

// ---------- Search ----------

/** Text folded for search: case and accents ignored, so "uber" and "über" find "Über". */
export const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss");

/** Whether every word of the query is in the name or in one of the values' text. */
export function matchesSearch(query: string, texts: readonly string[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.map(fold).join("\n");
  return words.every((w) => hay.includes(w));
}
