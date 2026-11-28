/**
 * Passive mode (#426): on set, lights stay rigged and connected, so whatever nothing holds goes dark to save their
 * batteries. The proxy phone decides it for every awake light from what the clients tell it they hold:
 * - a flow holds the lights of its tracks while it is Live, plays or runs; switched to Passive, it puts them to 0
 *   whatever else holds them;
 * - hand control holds every light while the Hardware tab (phone) or the Devices app (Studio) is open;
 * - a light set to Keep on (its card) holds itself.
 * A light nothing holds is passive: intensity 0. It comes back at its last set intensity once held by hand again.
 */

/** What one client holds; sent again every CLAIM_EVERY_MS while it holds anything, forgotten after CLAIM_TTL_MS. */
export interface HardwareClaim { hand: boolean; flows: { devices: string[]; passive: boolean }[] }
export const CLAIM_EVERY_MS = 4000;
export const CLAIM_TTL_MS = 11_000;
/** After the proxy starts, how long it waits for the clients' claims before it puts anything to 0. */
export const PASSIVE_GRACE_MS = 6000;

/** How a light is held now: by a flow, by hand (or Keep on), put to 0 by a passive flow, or by nothing (passive). */
export type HoldMode = "flow" | "hand" | "flowOff" | "passive";

/** Each light's mode from the claims of every client and its own Keep on. */
export function holdModes(lights: readonly { id: string; keepOn?: boolean }[], claims: readonly HardwareClaim[]): Map<string, HoldMode> {
  const off = new Set<string>(), flow = new Set<string>();
  for (const c of claims) for (const f of c.flows) for (const d of f.devices) (f.passive ? off : flow).add(d);
  const hand = claims.some((c) => c.hand);
  return new Map(lights.map((l) => [l.id, off.has(l.id) ? "flowOff" : flow.has(l.id) ? "flow" : hand || l.keepOn ? "hand" : "passive"]));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A claim from the wire, or null when it is malformed. */
export function parseClaim(v: unknown): HardwareClaim | null {
  if (!isRecord(v) || typeof v.hand !== "boolean" || !Array.isArray(v.flows) || v.flows.length > 20) return null;
  const flows: HardwareClaim["flows"] = [];
  for (const f of v.flows) {
    if (!isRecord(f) || typeof f.passive !== "boolean" || !Array.isArray(f.devices) || f.devices.length > 200 || f.devices.some((d) => typeof d !== "string" || !UUID.test(d))) return null;
    flows.push({ devices: f.devices as string[], passive: f.passive });
  }
  return { hand: v.hand, flows };
}
