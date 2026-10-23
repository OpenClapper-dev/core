import type { Curve, LightState } from "@openclapper/vocab";

/**
 * Lights (epic #206): the phone's side. "Fixture" because "device" already means this phone
 * (src/device.ts). A fixture is a light or the battery; its kind (packages/vocab/src/lighting.ts)
 * says what it can do, its driver how to reach it.
 */
export interface Fixture {
  id: string;
  label: string;
  kindId: string;
  /** Bluetooth address as Android reports it; NEEWER frames carry it too. */
  address: string;
  /** Set once a mesh fixture is provisioned (#212). */
  mesh: { networkId: string; unicast: number; elements: number } | null;
  createdAt: string;
  /** false until the Worker has acknowledged the PUT. */
  synced: boolean;
}

/** One change to a fixture, in normalised units: intensity, saturation 0..1, hue 0..360, kelvin. */
export type Command =
  | { op: "power"; on: boolean }
  | { op: "intensity"; value: number }
  | { op: "cct"; kelvin: number; gm: number }
  | { op: "hsi"; h: number; s: number; i: number }
  | { op: "curve"; curve: Curve }
  | { op: "status" };

/** What a fixture reported last; `state` is what a light says it shows. */
export interface Telemetry {
  at: number;
  battery?: number;
  volts?: number;
  watts?: number;
  minutesLeft?: number;
  state?: LightState;
}

/** One open Bluetooth connection, as ble/link.ts gives it to a driver (a fake one in tests). */
export interface Link {
  address: string;
  mtu: number;
  write(service: string, characteristic: string, bytes: Uint8Array, withResponse: boolean): Promise<void>;
  /** Resolves once notifications are on; the function turns them off. */
  notify(service: string, characteristic: string, cb: (bytes: Uint8Array) => void): Promise<() => void>;
  onDisconnect(cb: (error: unknown) => void): () => void;
  close(): Promise<void>;
}

/** A driver's live handle on one link. */
export interface Session {
  send(fixture: Fixture, cmd: Command): Promise<void>;
  close(): Promise<void>;
}

/** How a family of fixtures is reached: one file per driver in fixtures/drivers (#209 on). */
export interface Driver {
  id: string;
  /**
   * Which connection serves the fixture: its own address (GATT), or one per mesh network
   * ("mesh:<networkId>"), shared by every light of that network through one proxy node.
   */
  linkKey(fixture: Fixture): string;
  /** Pause between two writes on one link; a newer command of the same op replaces a queued one. */
  rate: { minIntervalMs: number };
  /** Addresses to try for a link, best first (a mesh link can use any node of its network). */
  addressesFor(linkKey: string, fixtures: Fixture[]): string[];
  open(link: Link, fixtures: Fixture[], sink: (fixtureId: string, t: Telemetry) => void): Promise<Session>;
}
