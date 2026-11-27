import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ref } from "./files.ts";
import { itemAt, itemTimes, placeError, progressionError, shotCover, shotError } from "./shot.ts";
import { fileType, checkFile, insideError } from "./index.ts";

const A = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6b", B = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6c", P = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6d";
const prog = { timing: { mode: "each" }, frame: null, overlayShown: true };

test("a shot: a content list only", () => {
  assert.equal(shotError({}, [{ kind: "content", to: A }]), null);
  assert.ok(shotError({ progression: null }, []), "no progression in a shot's body any more");
  assert.ok(shotError({}, [{ kind: "content", to: A, data: { ms: 1 } }]), "content stores nothing");
  assert.ok(checkFile(fileType("shot")!, {}, 3, [{ kind: "item", to: A, data: { ms: 1000 } }]).ok === false, "items belong to a progression");
});

test("a progression: items with their time, one overlay, its timing and default frame", () => {
  assert.equal(progressionError(prog, [{ kind: "item", to: A, data: { ms: 2000 } }, { kind: "item", to: B, data: { ms: 500, frame: "f24", move: { to: "f50", ease: true } } }, { kind: "overlay", to: B }]), null);
  assert.equal(progressionError(prog, [{ kind: "item", to: B, data: { ms: 4000, zoom: { mode: "steps", ease: false } } }]), null);
  assert.ok(progressionError(prog, [{ kind: "item", to: B, data: { ms: 4000, frame: "z0", zoom: { mode: "steps", ease: false } } }]), "a zoom shows every frame");
  assert.ok(progressionError(prog, [{ kind: "item", to: B, data: { ms: 4000, zoom: { mode: "fast", ease: false } } }]), "steps or smooth");
  assert.ok(progressionError(prog, [{ kind: "overlay", to: A }, { kind: "overlay", to: B }]), "one overlay");
  assert.ok(progressionError(prog, [{ kind: "item", to: A, data: { ms: 50 } }]), "too short");
  assert.ok(progressionError(prog, [{ kind: "item", to: A, data: { ms: 900, move: { to: "f50", ease: false } } }]), "a move starts at a frame");
  assert.ok(progressionError({ ...prog, timing: { mode: "even" } }, []), "a split needs a length");
  assert.equal(progressionError({ ...prog, timing: { mode: "ends", total: 9000 }, frame: { kind: "aspect", aspect: 2.39, size: 0.8, portrait: false } }, []), null);
  assert.ok(progressionError({ ...prog, frame: { kind: "aspect", aspect: 2.39 } }, []), "an aspect frame has a size");
});

test("a progression is made inside a shot only", () => {
  const t = fileType("progression")!;
  assert.equal(insideError(t, "shot"), null);
  assert.ok(insideError(t, null));
  assert.ok(insideError(t, "set"));
  assert.equal(insideError(fileType("canvas")!, null), null);
});

test("a shot saved at an older version reads as an empty body", () => {
  const r = checkFile(fileType("shot")!, { progression: null }, 2, []);
  assert.deepEqual(r.ok && r.body, {});
});

test("sets and locations: a content list only", () => {
  assert.equal(placeError("set", {}, [{ kind: "content", to: A }]), null);
  assert.ok(placeError("location", { address: "x" }, []));
  assert.ok(checkFile(fileType("location")!, {}, 1, [{ kind: "item", to: A, data: { ms: 1000 } }]).ok === false, "no items on a location");
});

test("times: each its own, split evenly, or the ends held twice as long; a zoom in steps counts per step", () => {
  const items = [{ ms: 1000 }, { ms: 2000 }, { ms: 3000 }, { ms: 4000 }];
  assert.deepEqual(itemTimes({ mode: "each" }, items), [1000, 2000, 3000, 4000]);
  assert.deepEqual(itemTimes({ mode: "even", total: 8000 }, items), [2000, 2000, 2000, 2000]);
  assert.deepEqual(itemTimes({ mode: "ends", total: 6000 }, items), [2000, 1000, 1000, 2000]);
  assert.deepEqual(itemTimes({ mode: "even", total: 6000 }, [{ ms: 1 }, { ms: 1, units: 4 }, { ms: 1 }]), [1000, 4000, 1000]);
  assert.deepEqual(itemTimes({ mode: "ends", total: 8000 }, [{ ms: 1, units: 4 }, { ms: 1 }]), [5714, 2286]);
});

test("what an item shows: a zoom in steps frame by frame, a smooth zoom from the first frame to the last", () => {
  const ids = ["z0", "z1", "z2", "z3"];
  assert.deepEqual(itemAt({ ms: 4000, zoom: { mode: "steps", ease: false } }, ids, 0.6), { frame: "z2", u: 0 });
  assert.deepEqual(itemAt({ ms: 4000, zoom: { mode: "steps", ease: false } }, ids, 1), { frame: "z3", u: 0 });
  assert.deepEqual(itemAt({ ms: 4000, zoom: { mode: "smooth", ease: true } }, ["z0", "z1"], 0.5), { frame: "z0", move: { to: "z1", ease: true }, u: 0.5 });
  assert.deepEqual(itemAt({ ms: 1000, frame: "f1" }, ids, 0.3), { frame: "f1", move: undefined, u: 0.3 });
});

test("the cover: the first photo, canvas or progression of the content; a progression shows its first item", () => {
  const types: Record<string, string> = { [A]: "photo", [B]: "canvas", [P]: "progression" };
  const typeOf = (id: string) => types[id] ?? null;
  const items: Ref[] = [{ kind: "item", to: B, data: { ms: 1000, frame: "f1" } }];
  assert.deepEqual(shotCover([{ kind: "content", to: P }, { kind: "content", to: A }], typeOf, () => items), { to: B, data: { ms: 1000, frame: "f1" }, progression: P });
  assert.equal(shotCover([{ kind: "content", to: P }, { kind: "content", to: A }], typeOf, () => []), null, "an empty progression first: no picture");
  assert.deepEqual(shotCover([{ kind: "content", to: "0b8e5e3e-6f3a-4c1e-9a2b-000000000000" }, { kind: "content", to: A }], typeOf), { to: A, data: null, progression: null });
  assert.equal(shotCover([], typeOf), null);
});
