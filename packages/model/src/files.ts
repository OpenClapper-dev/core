/**
 * Everything a user makes is a file (docs/rewrite/07-organisation.md, 10-conclusion.md). A file has
 * one row with the same columns for every type, and a body: the type's own document, saved whole.
 * This module is what the Worker and every client agree on: which types exist, where a file may
 * sit, what its body may hold and which references it may keep. The Worker runs these rules on
 * every save; a client runs them before it sends.
 *
 * A type is registered once (`registerFileType`). The core registers its own in types.ts; an
 * extension registers what it brings from its own entry point, so nothing here imports one.
 */

/** A project, or the account home of one user (files that follow a person into every project). */
export const ROOT_KINDS = ["project", "home"] as const;
export type RootKind = (typeof ROOT_KINDS)[number];

/** The folders every project has: they cannot be renamed, moved or binned. */
export const FIXED_FOLDERS = { desktop: "Desktop", settings: "Settings" } as const;
export type Fixed = keyof typeof FIXED_FOLDERS;
/** Fixed folders that take only the types bound to them (`onlyIn`); the Desktop takes anything. */
const BOUND_ONLY: readonly Fixed[] = ["settings"];
export const isFixed = (v: unknown): v is Fixed => typeof v === "string" && v in FIXED_FOLDERS;

export const MAX_FILE_NAME = 120;
/** Containers nest at most this deep, counted from the root (a top-level folder is 1). */
export const MAX_CONTAINER_DEPTH = 8;
/**
 * The largest body the Worker stores, in bytes of its JSON. D1 takes at most 2 000 000 bytes per
 * string and per row; the rest of the row and the bound statement need room too.
 */
export const MAX_BODY_BYTES = 1_500_000;
export const MAX_REFS = 2000;
/** The largest `data` of one reference, in bytes of its JSON. */
export const MAX_REF_DATA_BYTES = 2000;
/** How many files one request may move, bin, restore, purge or copy. */
export const MAX_BULK = 500;
/** Days a binned file is kept before the Worker's daily cron purges it. */
export const BIN_RETENTION_DAYS = 30;

/** Days left before a binned file is purged (0 = due), from its deleted_at. */
export function binDaysLeft(deletedAt: string, now = Date.now()): number {
  const age = (now - Date.parse(deletedAt)) / 86_400_000;
  return Math.max(0, Math.ceil(BIN_RETENTION_DAYS - age));
}

/**
 * What a pointer from one file to another is for. Nothing is stored on a reference but its order
 * and, where the kind needs it, a small `data` (an item's time, the frame it shows).
 */
export const REF_KINDS = ["content", "item", "clip", "overlay", "base", "placed", "property", "target"] as const;
export type RefKind = (typeof REF_KINDS)[number];

export interface Ref {
  kind: RefKind;
  /** The file pointed at. It may be gone: a reference never breaks the file that holds it. */
  to: string;
  data?: Record<string, unknown> | null;
}

export type Body = Record<string, unknown>;

export interface FileType {
  type: string;
  label: string;
  plural: string;
  roots: readonly RootKind[];
  /** A container: any type, or the listed ones. Absent: it holds no files. */
  holds?: "any" | readonly string[];
  /** It lives only in this fixed folder, and that folder takes only such types. */
  onlyIn?: Fixed;
  /** The kinds of reference a file of this type keeps, sent with the file. Absent: none. */
  refs?: readonly RefKind[];
  /**
   * Made only by its own routes, never through the general file route: a photo by uploading it (its
   * body never changes afterwards), a device by registering itself (its body can be changed).
   */
  made?: "upload" | "register" | "system";
  /** For these kinds of reference, the types a file pointed at may have (checked by the Worker, which knows them). Absent: any type. */
  refTargets?: Partial<Record<RefKind, readonly string[]>>;
  /**
   * Made only inside a file of these types, as its internal file (#426 feedback 4: a progression inside a
   * shot); never a file of its own, so it cannot be released. Absent: anywhere its roots allow.
   */
  insideOf?: readonly string[];
  /** Edited by one person at a time (05-composition.md): a save needs the edit lock, when someone holds it. */
  lockable?: boolean;
  /** The version of the body this code writes. Starts at 1; raised when the shape changes. */
  version: number;
  /** The body of a new file. */
  empty(): Body;
  /** Null when the body (at the current version) and the references are valid, else what is wrong. */
  check(body: Body, refs: readonly Ref[]): string | null;
  /** Brings a body stored at an older version to the current one. Needed once `version` is above 1. */
  upgrade?(body: Body, from: number): Body;
  /** A copy's body, where the body names files that were copied along (old id → new id). */
  remap?(body: Body, ids: ReadonlyMap<string, string>): Body;
}

const registry = new Map<string, FileType>();

/** Adds a type. Registering a name twice is a programming error, except with the very same object. */
export function registerFileType(t: FileType): void {
  const have = registry.get(t.type);
  if (have && have !== t) throw new Error(`file type "${t.type}" is registered twice`);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(t.type)) throw new Error(`file type "${t.type}": lower-case letters, digits and hyphens`);
  if (t.version > 1 && !t.upgrade) throw new Error(`file type "${t.type}" is at version ${t.version} and has no upgrade`);
  registry.set(t.type, t);
}

export const fileType = (type: unknown): FileType | undefined => (typeof type === "string" ? registry.get(type) : undefined);
export const fileTypes = (): FileType[] => [...registry.values()];
/** The types that can hold files (folders, collections). */
export const containerTypes = (): string[] => fileTypes().filter((t) => t.holds).map((t) => t.type);

/** What a new file is called until a naming pattern says otherwise. */
export const defaultName = (t: FileType): string => `New ${t.label.toLowerCase()}`;

/** Null when the name is fine, else what is wrong. Names are free text and need not be unique. */
export function nameError(v: unknown): string | null {
  if (typeof v !== "string" || v.trim().length === 0) return "name must be a non-empty string";
  if (v.trim().length > MAX_FILE_NAME) return `name is longer than ${MAX_FILE_NAME} characters`;
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).byteLength;

export type Checked = { ok: true; body: Body; version: number; refs: Ref[] | null } | { ok: false; error: string };

/**
 * A body and its references, checked for a save or after a load: upgraded from the version it was
 * written at, then held against the type's rules. `refs` null means "not sent": the type then
 * checks the body against none, so a type whose rule needs its references asks for them.
 */
export function checkFile(type: FileType, body: unknown, version: unknown, refs: unknown): Checked {
  const fail = (error: string): Checked => ({ ok: false, error });
  if (!isObject(body)) return fail("body must be an object");
  const v = version ?? type.version;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return fail("body_version must be a positive integer");
  if (v > type.version) return fail(`this ${type.label.toLowerCase()} was saved by a newer version of OpenClapper (body version ${v}, known ${type.version})`);
  let b = body;
  if (v < type.version) {
    try { b = type.upgrade!(body, v); } catch { return fail(`the body could not be upgraded from version ${v}`); }
    if (!isObject(b)) return fail(`the body could not be upgraded from version ${v}`);
  }
  let list: Ref[] | null = null;
  if (refs != null) {
    if (!Array.isArray(refs)) return fail("refs must be an array");
    if (refs.length > MAX_REFS) return fail(`at most ${MAX_REFS} references`);
    list = [];
    for (const [i, r] of refs.entries()) {
      if (!isObject(r)) return fail(`refs[${i}] must be an object`);
      if (typeof r.kind !== "string" || !(REF_KINDS as readonly string[]).includes(r.kind)) return fail(`refs[${i}].kind must be one of: ${REF_KINDS.join(", ")}`);
      // "property" references are written with a property's value, never with the file.
      if (r.kind === "property" || !(type.refs ?? []).includes(r.kind as RefKind)) return fail(`refs[${i}]: a ${type.label.toLowerCase()} keeps no "${r.kind}" references`);
      if (typeof r.to !== "string" || !UUID.test(r.to)) return fail(`refs[${i}].to must be a UUID`);
      if (r.data != null && !isObject(r.data)) return fail(`refs[${i}].data must be an object`);
      if (r.data != null && bytes(r.data) > MAX_REF_DATA_BYTES) return fail(`refs[${i}].data is too large`);
      list.push({ kind: r.kind as RefKind, to: r.to.toLowerCase(), data: (r.data as Record<string, unknown> | null | undefined) ?? null });
    }
  }
  const wrong = type.check(b, list ?? []);
  if (wrong) return fail(wrong);
  if (bytes(b) > MAX_BODY_BYTES) return fail(`the body is larger than ${MAX_BODY_BYTES} bytes`);
  return { ok: true, body: b, version: type.version, refs: list };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** What placing a file needs to know of the container it goes into; null is the top level of the root. */
export interface ContainerFacts { type: string; fixed: string | null }

/**
 * Null when a file of `child` may sit in `container` within a root of `root`, else why not.
 * Cycles and depth need the tree and are the Worker's part.
 */
export function placementError(child: FileType, container: ContainerFacts | null, root: RootKind): string | null {
  const what = child.label.toLowerCase();
  if (!child.roots.includes(root)) return root === "home" ? `a ${what} belongs to a project, not to an account home` : `a ${what} belongs to an account home, not to a project`;
  if (child.onlyIn && container?.fixed !== child.onlyIn) return `a ${what} lives in the ${FIXED_FOLDERS[child.onlyIn]} folder`;
  if (!container) return null;
  const into = fileType(container.type);
  if (!into?.holds) return `a ${(into?.label ?? container.type).toLowerCase()} cannot contain files`;
  if (isFixed(container.fixed) && BOUND_ONLY.includes(container.fixed) && child.onlyIn !== container.fixed) {
    const here = fileTypes().filter((t) => t.onlyIn === container.fixed).map((t) => t.plural.toLowerCase());
    return `the ${FIXED_FOLDERS[container.fixed]} folder holds only ${here.length ? here.join(" and ") : "what the project's settings put there"}`;
  }
  if (into.holds !== "any" && !into.holds.includes(child.type)) return `a ${into.label.toLowerCase()} holds only ${into.holds.map((t) => (fileType(t)?.plural ?? t).toLowerCase()).join(" and ")}`;
  return null;
}

/** Whether a file of this type can be an internal file: made inside another file, for its use (docs/rewrite/i1-interjection.md). */
export const canBeInternal = (t: FileType): boolean => !t.holds && !t.onlyIn;

/** Null when a file of `child` may be made inside a file of type `parent` (null: inside none), else why not. */
export function insideError(child: FileType, parent: string | null): string | null {
  if (!child.insideOf || (parent && child.insideOf.includes(parent))) return null;
  return `a ${child.label.toLowerCase()} is made inside a ${child.insideOf.map((t) => (fileType(t)?.label ?? t).toLowerCase()).join(" or ")}`;
}
