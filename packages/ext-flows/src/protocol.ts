/**
 * The Flows extension's channel on the phone link (docs/features/flows.md): running a flow on the phone itself, as on
 * set, with no relay for its commands. A client saves the flow and names the revision it saved (the file's
 * updated_at); the proxy phone fetches exactly that and plays it on its own clock through its own connections.
 */
export const FLOWS_CHANNEL = "flows";

/** A client → the proxy phone. `hello` asks for the run's state now. */
export type FlowRequest =
  | { type: "run"; flow: string; revision: string; fromMs: number }
  | { type: "stop" }
  | { type: "hello" };

/** The proxy phone → every client: on every change, every RUN_REPORT_MS while playing, and on `hello`. `atMs` is the position when sent. */
export interface RunState {
  type: "state";
  phase: "idle" | "loading" | "playing" | "error";
  flow: string | null;
  name?: string;
  revision?: string;
  atMs: number;
  durationMs?: number;
  loop?: boolean;
  error?: string;
}
export const RUN_REPORT_MS = 250;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A request from the wire, or null when malformed. */
export function parseFlowRequest(v: unknown): FlowRequest | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (m.type === "stop" || m.type === "hello") return { type: m.type };
  if (m.type === "run" && typeof m.flow === "string" && UUID.test(m.flow) && typeof m.revision === "string" && m.revision.length <= 40 && typeof m.fromMs === "number" && Number.isFinite(m.fromMs) && m.fromMs >= 0) {
    return { type: "run", flow: m.flow, revision: m.revision, fromMs: m.fromMs };
  }
  return null;
}
