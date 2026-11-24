import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deriveRecoveryKey, open, seal, sealedParams } from "./keySeal.ts";

// A cheap KDF so the test is fast; the parameters travel inside the blob either way.
const FAST = { n: 2 ** 4, r: 8, p: 1 };
const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
const iv = Uint8Array.from({ length: 12 }, (_, i) => 100 + i);

test("a sealed backup opens with the passphrase, for its own network only", async () => {
  const k = await deriveRecoveryKey("correct horse battery", salt, FAST);
  const blob = seal(k, "net-1", '{"netKey":"00"}', iv);
  assert.ok(!blob.includes("netKey"));
  assert.equal(open(k, "net-1", blob), '{"netKey":"00"}');
  assert.equal(open(k, "net-2", blob), null);

  const wrong = await deriveRecoveryKey("wrong horse battery", salt, FAST);
  assert.equal(open(wrong, "net-1", blob), null);
});

test("a restoring phone derives the same key from the blob's parameters", async () => {
  const k = await deriveRecoveryKey("correct horse battery", salt, FAST);
  const blob = seal(k, "net-1", "secret", iv);
  const p = sealedParams(blob);
  const again = await deriveRecoveryKey("correct horse battery", p.salt, p);
  assert.equal(again.key, k.key);
  assert.equal(open(again, "net-1", blob), "secret");
  assert.throws(() => sealedParams('{"v":2}'));
});
