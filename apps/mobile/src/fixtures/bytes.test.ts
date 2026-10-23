import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBase64, fromHex, toBase64, toHex } from "./bytes.ts";

test("base64 round trips every length and matches Node's encoder", () => {
  for (let n = 0; n < 40; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    const b64 = toBase64(b);
    assert.equal(b64, Buffer.from(b).toString("base64"));
    assert.deepEqual(fromBase64(b64), b);
  }
});

test("hex for the debug log", () => {
  assert.equal(toHex(Uint8Array.of(0x78, 0x8d, 0x08, 0)), "78 8d 08 00");
  assert.deepEqual(fromHex("78 8D 08"), Uint8Array.of(0x78, 0x8d, 0x08));
  assert.throws(() => fromHex("7"));
});
