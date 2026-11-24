import { test } from "node:test";
import assert from "node:assert/strict";
import { overlapping } from "./meshAddress.ts";
import type { Fixture } from "./types.ts";

const mc = (id: string, unicast: number, elements: number, networkId = "n1"): Fixture =>
  ({ id, label: id, kindId: "aputure-mc", address: "DC:2C:26:00:00:00", mesh: { networkId, unicast, elements }, createdAt: "", synced: true });

test("a 3-element light at 2 overlaps one at 3; side by side does not", () => {
  const a = mc("MC 1", 2, 3), b = mc("MC 3", 3, 3);
  assert.equal(overlapping(a, [a, b])?.id, "MC 3");
  assert.equal(overlapping(b, [a, b])?.id, "MC 1");
  const c = mc("MC 4", 6, 3);
  assert.equal(overlapping(c, [a, b, c]), null);
  // Recorded with one element, MC 1 at 2 sits next to MC 3 at 3.
  assert.equal(overlapping(mc("MC 1", 2, 1), [mc("MC 1", 2, 1), b]), null);
  assert.equal(overlapping(mc("x", 3, 3, "n2"), [a]), null);
});
