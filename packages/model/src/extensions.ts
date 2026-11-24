/**
 * Extensions (docs/rewrite/08-extensions.md): packages of expert features, compiled in and off until a
 * project switches them on. The core offers registration points and never imports an extension; each
 * client's `extensions.ts` is the one place that does (scripts/check-extensions.mjs enforces it).
 * Switched off, an extension's files stay where they are and show as needing it.
 */

export interface ExtensionDef {
  /** Lower-case id, stored in a project's list of enabled extensions. */
  id: string;
  name: string;
  /** One line: what it is for. */
  about: string;
  /** Extensions it needs on; switching one of those off switches this one off. */
  needs: readonly string[];
  /** What it brings, as short phrases for the project's switch (device types, apps, file types, camera controls). */
  brings: readonly string[];
}

const registry = new Map<string, ExtensionDef>();

/** Adds an extension; the same id twice is a programming error, except with the very same object. */
export function registerExtension(e: ExtensionDef): void {
  const have = registry.get(e.id);
  if (have && have !== e) throw new Error(`extension "${e.id}" is registered twice`);
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(e.id)) throw new Error(`extension "${e.id}": lower-case letters, digits and hyphens`);
  registry.set(e.id, e);
}
export const extensionDef = (id: string): ExtensionDef | undefined => registry.get(id);
export const extensionDefs = (): ExtensionDef[] => [...registry.values()];

export const MAX_EXTENSIONS = 20;

/**
 * Null when a project's list of enabled extensions is valid. Ids the build does not know are allowed
 * (a newer client may have saved them; they stay stored and do nothing here); each one needed is on too.
 */
export function extensionsError(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > MAX_EXTENSIONS) return `extensions must be a list of at most ${MAX_EXTENSIONS} ids`;
  if (!v.every((x) => typeof x === "string" && /^[a-z][a-z0-9-]{1,30}$/.test(x))) return "an extension id is lower-case letters, digits and hyphens";
  if (new Set(v).size !== v.length) return "an extension is listed twice";
  for (const id of v as string[]) for (const n of registry.get(id)?.needs ?? []) if (!v.includes(n)) return `${registry.get(id)!.name} needs ${registry.get(n)?.name ?? n}`;
  return null;
}

/** The list with one extension switched on (with what it needs) or off (with what needs it). */
export function switchExtension(list: readonly string[], id: string, on: boolean): string[] {
  const next = new Set(list);
  if (on) {
    const add = (x: string) => { if (next.has(x)) return; next.add(x); for (const n of registry.get(x)?.needs ?? []) add(n); };
    add(id);
  } else {
    const drop = (x: string) => { if (!next.delete(x)) return; for (const e of registry.values()) if (e.needs.includes(x)) drop(e.id); };
    drop(id);
  }
  return [...next];
}

/**
 * Further kinds of device (08-extensions.md, "Devices: one word, one registry"). The core knows phones and
 * tablets; an extension adds the kinds it brings with the rules for their bodies. A device of a kind
 * whose extension is off keeps its file; it is shown as needing the extension.
 */
export interface DeviceKind {
  kind: string;
  /** The extension that brings it. */
  extension: string;
  label: string;
  plural: string;
  /** Null when the body is valid for this kind. */
  check(body: Record<string, unknown>): string | null;
}

const kinds = new Map<string, DeviceKind>();
export function registerDeviceKind(k: DeviceKind): void {
  const have = kinds.get(k.kind);
  if (have && have !== k) throw new Error(`device kind "${k.kind}" is registered twice`);
  if (k.kind === "phone" || k.kind === "tablet") throw new Error("phone and tablet are the core's");
  kinds.set(k.kind, k);
}
export const deviceKind = (kind: unknown): DeviceKind | undefined => (typeof kind === "string" ? kinds.get(kind) : undefined);
export const deviceKinds = (): DeviceKind[] => [...kinds.values()];
