import assert from "node:assert/strict";
import { test } from "node:test";
import type { Clip } from "@openclapper/model";
import { at, blocksOf, chaptersOf, filmOf, moveClips, type CutFile } from "./cut.ts";

const files = new Map<string, CutFile>([
  ["p1", { id: "p1", type: "photo", name: "Photo", deleted_at: null }],
  ["s1", { id: "s1", type: "shot", name: "Zoom", deleted_at: null, body: { progression: { timing: { mode: "even", total: 3000 }, frame: null, overlayShown: true } },
    refs: [{ kind: "item", to: "c1", data: { ms: 500 } }, { kind: "item", to: "c1", data: { ms: 500, frame: "f2" } }, { kind: "item", to: "c1", data: { ms: 500, frame: "f3" } }, { kind: "overlay", to: "o1", data: null }] }],
  ["s2", { id: "s2", type: "shot", name: "Still", deleted_at: null, refs: [{ kind: "content", to: "gone", data: null }, { kind: "content", to: "p1", data: null }] }],
  ["c1", { id: "c1", type: "canvas", name: "Series", deleted_at: null }],
  ["x", { id: "x", type: "photo", name: "Binned", deleted_at: "2026-11-24" }],
]);
const clips: Clip[] = [
  { id: "a", file: "p1", ms: 2000, chapter: { title: "One", color: 3 } },
  { id: "b", file: "s1", ms: 9999 },
  { id: "c", file: null, ms: 1500, title: "Insert" },
  { id: "d", file: "s2", ms: 1000, chapter: { title: "Two", color: 4 } },
  { id: "e", file: "x", ms: 500 },
];

test("a shot with a progression plays it at its own timing; the clip's own time does not count", () => {
  const b = blocksOf(clips, files);
  assert.deepEqual(b.map((x) => [x.start, x.len, x.fixed]), [[0, 2000, false], [2000, 3000, true], [5000, 1500, false], [6500, 1000, false], [7500, 500, false]]);
  assert.deepEqual(b[1].segs.map((s) => [s.ms, s.ref?.frame, s.overlay]), [[1000, undefined, "o1"], [1000, "f2", "o1"], [1000, "f3", "o1"]]);
  assert.equal(b[3].segs[0].ref?.to, "p1", "a shot without a progression shows its first picture that is there");
  assert.deepEqual([b[2].segs[0].kind, b[4].segs[0].kind], ["placeholder", "missing"]);
});

test("where a time falls, the chapters, the film strip", () => {
  const b = blocksOf(clips, files);
  const h = at(b, 3500)!;
  assert.equal(h.block.clip.id, "b");
  assert.equal(h.seg.ref?.frame, "f2");
  assert.equal(Math.round(h.u * 100), 50);
  assert.deepEqual(chaptersOf(b).map((c) => [c.title, c.start, c.len]), [["One", 0, 6500], ["Two", 6500, 1500]]);
  assert.deepEqual(filmOf([1, 2, 3, 4, 5, 6, 7], 3), [1, 4, 7]);
  assert.deepEqual(filmOf([1, 2], 5), [1, 2]);
});

test("moving several clips keeps their order", () => {
  assert.deepEqual(moveClips(clips, ["a", "c"], 4).map((c) => c.id), ["b", "d", "a", "c", "e"]);
  assert.deepEqual(moveClips(clips, ["d"], 0).map((c) => c.id), ["d", "a", "b", "c", "e"]);
});
