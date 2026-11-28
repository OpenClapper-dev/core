/**
 * A piece of hardware in the account's device registry (docs/rewrite/08-extensions.md): a device file of the
 * account home whose kind is a hardware type. It replaces the first app's workspace "fixtures": hardware follows
 * its owner. The body names the catalogue model and how the phone reaches it; the mesh address and the battery
 * that powers a light are set only by the extension's routes (they keep cross-device rules).
 */
import { registerDeviceKind } from "@openclapper/model";
import { HARDWARE_TYPES, TYPE_LABELS, modelOf, type HardwareType } from "./catalogue.ts";
import { isBleAddress, MESH_UNICAST_MAX } from "./lighting.ts";

export interface HardwareBody {
  kind: HardwareType;
  /** The catalogue model's id (catalogue.ts). */
  model: string;
  /** Its Bluetooth address; null for a device reached over Wi-Fi. */
  address: string | null;
  /** Its place in the phone's mesh network; null until paired (mesh models only). */
  mesh: { network: string; unicast: number; elements: number } | null;
  /** The battery device a light runs on; null: a socket (lights without a battery of their own). */
  poweredBy: string | null;
  /** Asleep: the phone does not connect to it until woken. */
  asleep: boolean;
  /** A light kept on while nothing else holds it (#426, passive mode's override); absent: off. */
  keepOn?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Null when the body is a valid hardware device. */
export function hardwareError(input: object): string | null {
  const body = input as Record<string, unknown>;
  for (const k of Object.keys(body)) if (!["kind", "model", "address", "mesh", "poweredBy", "asleep", "keepOn"].includes(k)) return `a ${String(body.kind)} has no "${k}"`;
  const m = modelOf(body.model);
  if (!m) return "model is not in the catalogue";
  if (m.type !== body.kind) return `${m.brand} ${m.model} is a ${m.type}, not a ${String(body.kind)}`;
  if (m.transport === "wifi" ? body.address !== null : !isBleAddress(body.address)) return m.transport === "wifi" ? "a device reached over Wi-Fi has no Bluetooth address" : "address must be a Bluetooth address like AA:BB:CC:DD:EE:FF";
  if (body.mesh !== null) {
    if (m.transport !== "mesh") return `${m.model} is not paired through a mesh`;
    const n = body.mesh;
    if (!isRecord(n) || typeof n.network !== "string" || !UUID.test(n.network) || !whole(n.unicast, 1, MESH_UNICAST_MAX) || !whole(n.elements, 1, 255)) return "mesh holds a network id, a unicast address and a number of elements";
  }
  if (body.poweredBy !== null) {
    if (!m.takesBattery) return `${m.model} does not take a battery`;
    if (typeof body.poweredBy !== "string" || !UUID.test(body.poweredBy)) return "poweredBy is a battery's id or null";
  }
  if (typeof body.asleep !== "boolean") return "asleep is true or false";
  if (body.keepOn !== undefined && (typeof body.keepOn !== "boolean" || m.type !== "light")) return "keepOn is true or false, on a light";
  return null;
}

/** A new device's body: not paired into a mesh, on a socket, awake. */
export const newHardware = (model: string, address: string | null): HardwareBody => ({ kind: modelOf(model)!.type, model, address, mesh: null, poweredBy: null, asleep: false });

for (const kind of HARDWARE_TYPES) {
  registerDeviceKind({ kind, extension: "hardware", label: TYPE_LABELS[kind].label, plural: TYPE_LABELS[kind].plural, check: hardwareError, guarded: ["model", "address", "mesh", "poweredBy"] });
}
