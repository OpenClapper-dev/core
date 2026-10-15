import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIEWFINDER_LAYOUT, unplaced, validateViewfinderLayout, type ViewfinderLayout } from "./viewfinder.ts";

const copy = (): ViewfinderLayout => JSON.parse(JSON.stringify(DEFAULT_VIEWFINDER_LAYOUT));

test("the shipped layout is valid and places every control", () => {
  assert.equal(validateViewfinderLayout(DEFAULT_VIEWFINDER_LAYOUT), null);
  assert.deepEqual(unplaced(DEFAULT_VIEWFINDER_LAYOUT.portrait), []);
});

test("a layout needs the shutter once and each control at most once", () => {
  const noShutter = copy();
  noShutter.landscape.bars[1].items = noShutter.landscape.bars[1].items.filter((i) => i.control !== "shutter");
  assert.match(validateViewfinderLayout(noShutter)!, /landscape: the shutter must be placed/);
  const twice = copy();
  twice.portrait.bars[0].items.push({ control: "rig" });
  assert.match(validateViewfinderLayout(twice)!, /rig is placed twice/);
  const badEdge = copy() as unknown as { portrait: { bars: { edge: string }[] } };
  badEdge.portrait.bars[0].edge = "middle";
  assert.match(validateViewfinderLayout(badEdge)!, /edge/);
});
