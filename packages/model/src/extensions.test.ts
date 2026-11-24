import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionsError, registerExtension, switchExtension } from "./extensions.ts";

registerExtension({ id: "base-x", name: "Base", about: "", needs: [], brings: [] });
registerExtension({ id: "top-x", name: "Top", about: "", needs: ["base-x"], brings: [] });

test("a list must hold what its extensions need", () => {
  assert.equal(extensionsError([]), null);
  assert.equal(extensionsError(["base-x", "top-x"]), null);
  assert.match(extensionsError(["top-x"])!, /needs Base/);
  assert.match(extensionsError(["base-x", "base-x"])!, /twice/);
  assert.equal(extensionsError(["unknown-ext"]), null);
  assert.ok(extensionsError("x"));
});

test("switching follows the needs both ways", () => {
  assert.deepEqual(switchExtension([], "top-x", true).sort(), ["base-x", "top-x"]);
  assert.deepEqual(switchExtension(["base-x", "top-x"], "base-x", false), []);
  assert.deepEqual(switchExtension(["base-x", "top-x"], "top-x", false), ["base-x"]);
});

test("a device of a registered kind is checked by that kind's rules", async () => {
  const { registerDeviceKind } = await import("./extensions.ts");
  const { checkFile, fileType } = await import("./index.ts");
  registerDeviceKind({ kind: "gadget-x", extension: "base-x", label: "Gadget", plural: "Gadgets", check: (b) => (typeof b.model === "string" ? null : "a gadget has a model") });
  assert.equal(checkFile(fileType("device")!, { kind: "gadget-x", model: "G1" }, 1, null).ok, true);
  assert.equal(checkFile(fileType("device")!, { kind: "gadget-x" }, 1, null).ok, false);
  assert.throws(() => registerDeviceKind({ kind: "phone", extension: "base-x", label: "", plural: "", check: () => null }));
});
