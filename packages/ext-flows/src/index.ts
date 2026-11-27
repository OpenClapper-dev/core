/**
 * The Flows extension (docs/rewrite/08-extensions.md, docs/features/flows.md): timed programmes that drive what the
 * Hardware extension's devices expose, today's light sequences grown to cameras. A flow is a file of a project,
 * edited by one person at a time; it plays from the Studio through the proxy phone or on the phone itself.
 */
import { registerExtension, registerFileType, type ExtensionDef, type FileType } from "@openclapper/model";
import { EFFECTS, modelOf } from "@openclapper/ext-hardware";
import { FLOW_MAX_MS, parseFlowMarkers, parseFlowTracks, type Flow } from "./flow.ts";
import { stagesError, stagesFromV1, type FlowStage } from "./stage.ts";

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
  for (const k of Object.keys(b)) if (!["durationMs", "loop", "tracks", "markers", "stages"].includes(k)) return `a flow has no "${k}"`;
  if (typeof b.durationMs !== "number" || !Number.isInteger(b.durationMs) || b.durationMs < 1000 || b.durationMs > FLOW_MAX_MS) return `durationMs is 1000 to ${FLOW_MAX_MS}`;
  if (typeof b.loop !== "boolean") return "loop is true or false";
  const t = parseFlowTracks(b.tracks, b.durationMs, isKind, (id) => EFFECT_IDS.has(id));
  if ("error" in t) return t.error;
  if (new Set(t.tracks.map((x) => x.id)).size !== t.tracks.length) return "each track has its own id";
  const m = parseFlowMarkers(b.markers, b.durationMs, new Set(t.tracks.map((x) => x.id)));
  if ("error" in m) return m.error;
  if (b.stages !== undefined) return stagesError(b.stages, t.tracks);
  return null;
}

export const emptyFlow = (): FlowBody => ({ durationMs: 30_000, loop: false, tracks: [], markers: [] });

/**
 * A flow: a file of a project, lockable like a timeline (one editor, the others watch).
 * Version 2 (#426): the one optional `stage` became a list of `stages` (stagesFromV1).
 */
export const FLOW: FileType = {
  type: "flow", label: "Flow", plural: "Flows", roots: ["project"], version: 2, lockable: true,
  empty: () => emptyFlow() as unknown as Record<string, unknown>,
  check: (body) => flowError(body),
  upgrade: (body, from) => (from < 2 ? stagesFromV1(body) : body),
  // A copy whose stages' underlay photos were copied along shows the copies.
  remap: (body, ids) => {
    const stages = body.stages as FlowStage[] | undefined;
    if (!stages?.some((s) => s.underlay && ids.has(s.underlay.photo))) return body;
    return { ...body, stages: stages.map((s) => { const to = s.underlay && ids.get(s.underlay.photo); return to ? { ...s, underlay: { ...s.underlay!, photo: to } } : s; }) };
  },
};

/**
 * A flow's body as this code reads it, from a file saved at `version` (absent: the current one). The server upgrades
 * a stored body only when it is saved again, so a client reading an older one brings it up to date as the server would.
 */
export function flowBodyOf(body: unknown, version?: number): FlowBody {
  const b = { ...emptyFlow(), ...(body as Partial<FlowBody> | undefined) } as unknown as Record<string, unknown>;
  return (version !== undefined && version < FLOW.version ? FLOW.upgrade!(b, version) : b) as unknown as FlowBody;
}
registerFileType(FLOW);

export * from "./flow.ts";
export * from "./player.ts";
export * from "./protocol.ts";
export * from "./edit.ts";
export * from "./look.ts";
export * from "./stage.ts";
