import { test } from "node:test";
import assert from "node:assert/strict";
import type { VfOrientation } from "@openclapper/vocab";
import { applyDrop, insertIndex } from "./vfDnd.ts";

const o: VfOrientation = {
  bars: [
    { id: "a", edge: "end", items: [{ control: "lens" }, { control: "zoom" }] },
    { id: "b", edge: "end", items: [{ control: "uploads" }, { control: "shutter" }, { control: "rig" }] },
  ],
};
const ctl = (x: VfOrientation) => x.bars.map((b) => `${b.id}:${b.items.map((i) => i.control).join(",")}`);

test("an item moves within its bar, both directions", () => {
  assert.deepEqual(ctl(applyDrop(o, { kind: "item", control: "uploads" }, { kind: "item", barId: "b", index: 3 })), ["a:lens,zoom", "b:shutter,rig,uploads"]);
  assert.deepEqual(ctl(applyDrop(o, { kind: "item", control: "rig" }, { kind: "item", barId: "b", index: 0 })), ["a:lens,zoom", "b:rig,uploads,shutter"]);
  assert.deepEqual(ctl(applyDrop(o, { kind: "item", control: "shutter" }, { kind: "item", barId: "b", index: 2 })), ["a:lens,zoom", "b:uploads,shutter,rig"]);
});

test("an item moves to another bar, keeping its options", () => {
  const withOpt: VfOrientation = { bars: [{ ...o.bars[0], items: [{ control: "lens", display: "carousel" }, { control: "zoom" }] }, o.bars[1]] };
  const r = applyDrop(withOpt, { kind: "item", control: "lens" }, { kind: "item", barId: "b", index: 1 });
  assert.deepEqual(ctl(r), ["a:zoom", "b:uploads,lens,shutter,rig"]);
  assert.equal(r.bars[1].items[1].display, "carousel");
});

test("a new control lands where it is dropped, once", () => {
  assert.deepEqual(ctl(applyDrop(o, { kind: "new", item: { control: "fit" } }, { kind: "item", barId: "a", index: 1 })), ["a:lens,fit,zoom", "b:uploads,shutter,rig"]);
  assert.equal(applyDrop(o, { kind: "new", item: { control: "rig" } }, { kind: "item", barId: "a", index: 0 }), o);
});

test("bars reorder; mismatched drops change nothing", () => {
  assert.deepEqual(ctl(applyDrop(o, { kind: "bar", barId: "a" }, { kind: "bar", index: 2 })), ["b:uploads,shutter,rig", "a:lens,zoom"]);
  assert.deepEqual(ctl(applyDrop(o, { kind: "bar", barId: "b" }, { kind: "bar", index: 0 })), ["b:uploads,shutter,rig", "a:lens,zoom"]);
  assert.equal(applyDrop(o, { kind: "bar", barId: "a" }, { kind: "item", barId: "b", index: 0 }), o);
  assert.equal(applyDrop(o, { kind: "item", control: "lens" }, { kind: "bar", index: 0 }), o);
});

test("insert index: before the first child whose middle is past the pointer", () => {
  const boxes = [{ start: 0, end: 50 }, { start: 50, end: 100 }, { start: 100, end: 150 }];
  assert.equal(insertIndex(10, boxes), 0);
  assert.equal(insertIndex(60, boxes), 1);
  assert.equal(insertIndex(140, boxes), 3);
  assert.equal(insertIndex(5, []), 0);
});
