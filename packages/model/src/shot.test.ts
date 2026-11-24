import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ref } from "./files.ts";
import { itemTimes, placeError, shotCover, shotError } from "./shot.ts";
import { fileType, checkFile } from "./index.ts";

const A = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6b", B = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6c";
const prog = { timing: { mode: "each" }, frame: null, overlayShown: true };

test("a shot: content alone, or a progression with items and one overlay", () => {
  assert.equal(shotError({ progression: null }, [{ kind: "content", to: A }]), null);
  assert.ok(shotError({ progression: null }, [{ kind: "item", to: A, data: { ms: 2000 } }]), "items need a progression");
  assert.equal(shotError({ progression: prog }, [{ kind: "item", to: A, data: { ms: 2000 } }, { kind: "item", to: B, data: { ms: 500, frame: "f24", move: { to: "f50", ease: true } } }, { kind: "overlay", to: B }]), null);
  assert.ok(shotError({ progression: prog }, [{ kind: "overlay", to: A }, { kind: "overlay", to: B }]), "one overlay");
  assert.ok(shotError({ progression: prog }, [{ kind: "item", to: A, data: { ms: 50 } }]), "too short");
  assert.ok(shotError({ progression: prog }, [{ kind: "item", to: A, data: { ms: 900, move: { to: "f50", ease: false } } }]), "a move starts at a frame");
  assert.ok(shotError({ progression: prog }, [{ kind: "content", to: A, data: { ms: 1 } }]), "content stores nothing");
  assert.ok(shotError({ progression: { ...prog, timing: { mode: "even" } } }, []), "a split needs a length");
  assert.equal(shotError({ progression: { ...prog, timing: { mode: "ends", total: 9000 }, frame: { kind: "aspect", aspect: 2.39, size: 0.8, portrait: false } } }, []), null);
  assert.ok(shotError({ progression: { ...prog, frame: { kind: "aspect", aspect: 2.39 } } }, []), "an aspect frame has a size");
});

test("a shot saved as {} before B6 is upgraded to no progression", () => {
  const r = checkFile(fileType("shot")!, {}, 1, []);
  assert.deepEqual(r.ok && r.body, { progression: null });
});

test("sets and locations: a content list only", () => {
  assert.equal(placeError("set", {}, [{ kind: "content", to: A }]), null);
  assert.ok(placeError("location", { address: "x" }, []));
  assert.ok(checkFile(fileType("location")!, {}, 1, [{ kind: "item", to: A, data: { ms: 1000 } }]).ok === false, "no items on a location");
});

test("times: each its own, split evenly, or the ends held twice as long", () => {
  const items = [{ ms: 1000 }, { ms: 2000 }, { ms: 3000 }, { ms: 4000 }];
  assert.deepEqual(itemTimes({ mode: "each" }, items), [1000, 2000, 3000, 4000]);
  assert.deepEqual(itemTimes({ mode: "even", total: 8000 }, items), [2000, 2000, 2000, 2000]);
  assert.deepEqual(itemTimes({ mode: "ends", total: 6000 }, items), [2000, 1000, 1000, 2000]);
});

test("the cover: the progression's first picture, else the first photo or canvas of the content", () => {
  const types: Record<string, string> = { [A]: "photo", [B]: "canvas" };
  const typeOf = (id: string) => types[id] ?? null;
  const refs: Ref[] = [{ kind: "content", to: A }, { kind: "item", to: B, data: { ms: 1000, frame: "f1" } }];
  assert.deepEqual(shotCover(refs, typeOf), { to: B, frame: "f1", rule: "progression" });
  assert.deepEqual(shotCover([{ kind: "content", to: "0b8e5e3e-6f3a-4c1e-9a2b-000000000000" }, { kind: "content", to: A }], typeOf), { to: A, rule: "content" });
  assert.equal(shotCover([], typeOf), null);
});
