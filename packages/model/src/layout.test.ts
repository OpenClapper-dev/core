import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_LAYOUTS, copyLayout, layoutError, unplaced } from "./layout.ts";
import { checkFile, fileType } from "./index.ts";

const body = () => copyLayout(BUILTIN_LAYOUTS.viewfinder.body) as unknown as Record<string, unknown> & ReturnType<typeof copyLayout>;

test("the built-in layouts are valid and place the shutter in each orientation", () => {
  for (const b of Object.values(BUILTIN_LAYOUTS)) assert.equal(layoutError(b.body as unknown as Record<string, unknown>), null);
  assert.equal(checkFile(fileType("layout")!, body(), 1, []).ok, true);
});

test("a layout needs its shutter, places a control once, and gives options only where they fit", () => {
  const b = body();
  b.portrait.bars = b.portrait.bars.map((x) => ({ ...x, items: x.items.filter((i) => i.control !== "shutter") }));
  assert.match(layoutError(b)!, /shutter is needed/);
  const c = body();
  c.landscape.bars[0].items.push({ control: "read-project" });
  assert.match(layoutError(c)!, /placed twice/);
  const d = body();
  d.portrait.bars[1].items[0] = { control: "layout", display: "stepped" };
  assert.match(layoutError(d)!, /only a strip/);
  const e = body();
  e.look.frameColor = "red";
  assert.ok(layoutError(e));
});

test("what an arrangement does not place yet", () => {
  const u = unplaced(BUILTIN_LAYOUTS.camera.body.portrait);
  assert.ok(u.includes("frame") && u.includes("focal") && !u.includes("shutter"));
});

test("a device keeps its camera layout and its camera's area", () => {
  const t = fileType("device")!;
  const dev = { kind: "phone", make: "G", model: "P", lenses: [], screen: null, camera: { portrait: { w: 412, h: 760 }, landscape: { w: 860, h: 380 } }, tabs: ["camera"], app: "1", layout: "camera" };
  assert.equal(checkFile(t, dev, 1, null).ok, true);
  assert.equal(checkFile(t, { ...dev, layout: "mine" }, 1, null).ok, false);
});
