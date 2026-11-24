import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionDef } from "@openclapper/model";
import { HARDWARE } from "./index.ts";

test("the extension registers itself", () => {
  assert.equal(extensionDef("hardware"), HARDWARE);
});
