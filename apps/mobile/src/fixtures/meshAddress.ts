import type { Fixture } from "./types.ts";

/**
 * Another mesh fixture of the same network whose unicast addresses overlap this one's
 * (each light takes one address per element, from its primary address on). An overlap means
 * commands for one light reach the other.
 */
export function overlapping(f: Fixture, all: Fixture[]): Fixture | null {
  if (!f.mesh) return null;
  const a = f.mesh;
  return all.find((o) => o.id !== f.id && o.mesh && o.mesh.networkId === a.networkId
    && o.mesh.unicast < a.unicast + a.elements && a.unicast < o.mesh.unicast + o.mesh.elements) ?? null;
}
