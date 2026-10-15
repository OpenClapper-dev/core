import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIEWFINDER_LAYOUT } from "@fielder/vocab";
import { edgeExtent, resolveLayout } from "./vfLayout.ts";

test("the default layout keeps the old chrome sizes", () => {
  // Portrait: 10 + lens 56 + 10 + shutter row 76 + 12 + 2 (the old CHROME_H).
  assert.equal(edgeExtent(DEFAULT_VIEWFINDER_LAYOUT.portrait, "end", true), 166);
  assert.equal(edgeExtent(DEFAULT_VIEWFINDER_LAYOUT.portrait, "start", true), 0);
  // Landscape: the 80 dp lens column after the cutout pad, the 80 dp control column.
  assert.equal(edgeExtent(DEFAULT_VIEWFINDER_LAYOUT.landscape, "start", false, 24), 104);
  assert.equal(edgeExtent(DEFAULT_VIEWFINDER_LAYOUT.landscape, "end", false), 80);
});

test("an unknown or broken layout falls back to the default", () => {
  assert.equal(resolveLayout(null, []), DEFAULT_VIEWFINDER_LAYOUT);
  assert.equal(resolveLayout("x", [{ id: "x", layout: { v: 1 } }]), DEFAULT_VIEWFINDER_LAYOUT);
  const mine = { ...DEFAULT_VIEWFINDER_LAYOUT, portrait: { bars: [{ id: "a", edge: "end" as const, items: [{ control: "shutter" as const }] }] } };
  assert.equal(resolveLayout("x", [{ id: "x", layout: mine }]), mine);
});
