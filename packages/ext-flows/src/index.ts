/**
 * The Flows extension (docs/rewrite/08-extensions.md, docs/features/flows.md): timed programmes that drive what the
 * Hardware extension's devices expose, today's light sequences grown to cameras. A flow is a file of a project,
 * edited by one person at a time; it plays from the Studio through the proxy phone or on the phone itself.
 */
import { registerExtension, registerFileType, type ExtensionDef, type FileType } from "@openclapper/model";
import { EFFECTS, modelOf } from "@openclapper/ext-hardware";
import { FLOW_MAX_MS, parseFlowMarkers, parseFlowTracks, type Flow } from "./flow.ts";

export const FLOWS: ExtensionDef = {
  id: "flows",
  name: "Flows",
  about: "Timed programmes for lights and cameras, played from the Studio or the phone",
  needs: ["hardware"],
  brings: ["File type: flow", "Apps: Flows in the Studio, on the phone and tablet"],
};
registerExtension(FLOWS);

/** A flow's body: its length, whether it loops, its tracks and markers. The name is the file's. */
export type FlowBody = Omit<Flow, "id" | "name" | "updatedAt">;

const EFFECT_IDS = new Set<string>(EFFECTS.map((e) => e.id));
const isKind = (id: string) => { const m = modelOf(id); return m?.type === "light" || m?.type === "camera"; };

/** Null when a flow's body is valid. */
export function flowError(b: Record<string, unknown>): string | null {
  for (const k of Object.keys(b)) if (!["durationMs", "loop", "tracks", "markers"].includes(k)) return `a flow has no "${k}"`;
  if (typeof b.durationMs !== "number" || !Number.isInteger(b.durationMs) || b.durationMs < 1000 || b.durationMs > FLOW_MAX_MS) return `durationMs is 1000 to ${FLOW_MAX_MS}`;
  if (typeof b.loop !== "boolean") return "loop is true or false";
  const t = parseFlowTracks(b.tracks, b.durationMs, isKind, (id) => EFFECT_IDS.has(id));
  if ("error" in t) return t.error;
  if (new Set(t.tracks.map((x) => x.id)).size !== t.tracks.length) return "each track has its own id";
  const m = parseFlowMarkers(b.markers, b.durationMs, new Set(t.tracks.map((x) => x.id)));
  if ("error" in m) return m.error;
  return null;
}

export const emptyFlow = (): FlowBody => ({ durationMs: 30_000, loop: false, tracks: [], markers: [] });

/** A flow: a file of a project, lockable like a timeline (one editor, the others watch). */
export const FLOW: FileType = {
  type: "flow", label: "Flow", plural: "Flows", roots: ["project"], version: 1, lockable: true,
  empty: () => emptyFlow() as unknown as Record<string, unknown>,
  check: (body) => flowError(body),
};
registerFileType(FLOW);

export * from "./flow.ts";
export * from "./player.ts";
export * from "./protocol.ts";
export * from "./edit.ts";
export * from "./look.ts";
