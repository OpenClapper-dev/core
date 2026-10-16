import test from "node:test";
import assert from "node:assert/strict";
import { GLOBAL, liveMaps, register, setFocusSource, type KeyMap } from "./keyboard.ts";

const map = (name: string): { current: KeyMap } => ({ current: { [name]: () => {} } });
const names = () => liveMaps().map((m) => Object.keys(m)[0]);

test("only the focused window's maps are live, before the global ones", () => {
  let focused: string | null = "A";
  setFocusSource(() => focused);
  const offs = [register("A", map("a1")), register(GLOBAL, map("g")), register("B", map("b1")), register("A", map("a2"))];
  assert.deepEqual(names(), ["a1", "a2", "g"]);
  focused = "B";
  assert.deepEqual(names(), ["b1", "g"]);
  focused = null; // the desktop has focus
  assert.deepEqual(names(), ["g"]);
  offs[0]();
  focused = "A";
  assert.deepEqual(names(), ["a2", "g"]);
  for (const off of offs) off();
  assert.deepEqual(names(), []);
});
