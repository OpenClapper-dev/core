import { FIXTURE_KINDS, fixtureKind } from "@openclapper/vocab";
import type { Driver } from "./types.ts";

/**
 * The phone's drivers by id (FixtureKind.driver). Empty until the first protocol lands: NEEWER
 * lights (#209), the PS099S battery (#210), Aputure over the mesh (#213). A new model is a kind in
 * packages/vocab/src/lighting.ts plus, when its protocol is new, one driver file registered here.
 */
const DRIVERS: Record<string, Driver> = {};

export const driverFor = (kindId: string): Driver | undefined => {
  const kind = fixtureKind(kindId);
  return kind ? DRIVERS[kind.driver] : undefined;
};

/** What a scan sees of a device. */
export interface Advert { name: string | null; serviceUUIDs: string[] | null }

const MESH_PROVISIONING = "00001827-0000-1000-8000-00805f9b34fb";
const MESH_PROXY = "00001828-0000-1000-8000-00805f9b34fb";
const NEEWER_SERVICE = "69400001-b5a3-f393-e0a9-e50e24dcca99";

const NEEWER_LIGHTS = ["neewer-fs230b", "neewer-fs300b"];

/**
 * The kinds a scanned device may be, most likely first; empty when nothing points to one. Only a
 * suggestion: names vary by firmware, so the person pairing always confirms the model.
 */
export function suggestKinds(a: Advert): string[] {
  const name = a.name ?? "";
  const services = (a.serviceUUIDs ?? []).map((s) => s.toLowerCase());
  if (services.includes(MESH_PROVISIONING) || services.includes(MESH_PROXY) || /aputure|sidus/i.test(name)) return ["aputure-mc"];
  if (services.includes(NEEWER_SERVICE) || /neewer|^nw[-_ ]/i.test(name)) {
    if (/ps0?99|batt/i.test(name)) return ["neewer-ps099s", ...NEEWER_LIGHTS];
    if (/fs[- ]?300/i.test(name)) return ["neewer-fs300b", "neewer-fs230b", "neewer-ps099s"];
    return [...NEEWER_LIGHTS, "neewer-ps099s"];
  }
  return [];
}

/** Every kind, for picking one by hand. */
export const ALL_KINDS = FIXTURE_KINDS;
