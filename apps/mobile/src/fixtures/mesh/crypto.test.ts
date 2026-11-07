import { test } from "node:test";
import assert from "node:assert/strict";
import { beaconKey, ccmDecrypt, ccmEncrypt, hexOf, k1, k2, k3, k4, ofHex, s1, utf8 } from "./crypto.ts";

// Mesh Profile 1.0.1 §8.1 and §8.2 sample data.
test("§8.1.1 s1", () => assert.equal(hexOf(s1("test")), "b73cefbd641ef2ea598c2b6efb62f79c"));

test("§8.1.2 k1", () => {
  assert.equal(hexOf(k1(ofHex("3216d1509884b533248541792b877f98"), ofHex("2ba14ffa0df84a2831938d57d276cab4"), ofHex("5a09d60797eeb4478aada59db3352a0d"))), "f6ed15a8934afbe7d83e8dcb57fcf5d7");
});

test("§8.1.3 and §8.2.2 k2 (flooding)", () => {
  const a = k2(ofHex("f7a2a44f8e8a8029064f173ddc1e2b00"));
  assert.deepEqual([a.nid, hexOf(a.encKey), hexOf(a.privKey)], [0x7f, "9f589181a0f50de73c8070c7a6d27f46", "4c715bd4a64b938f99b453351653124f"]);
  const b = k2(ofHex("7dd7364cd842ad18c17c2b820c84c3d6"));
  assert.deepEqual([b.nid, hexOf(b.encKey), hexOf(b.privKey)], [0x68, "0953fa93e7caac9638f58820220a398e", "8b84eedec100067d670971dd2aa700cf"]);
});

test("§8.1.4 k2 (friendship credentials)", () => {
  const a = k2(ofHex("f7a2a44f8e8a8029064f173ddc1e2b00"), ofHex("010203040506070809"));
  assert.deepEqual([a.nid, hexOf(a.encKey), hexOf(a.privKey)], [0x73, "11efec0642774992510fb5929646df49", "d4d7cc0dfa772d836a8df9df5510d7a7"]);
});

test("§8.1.5 and §8.2.4 k3 (Network ID)", () => {
  assert.equal(hexOf(k3(ofHex("f7a2a44f8e8a8029064f173ddc1e2b00"))), "ff046958233db014");
  assert.equal(hexOf(k3(ofHex("7dd7364cd842ad18c17c2b820c84c3d6"))), "3ecaff672f673370");
});

test("§8.1.6 and §8.2.1 k4 (AID)", () => {
  assert.equal(k4(ofHex("3216d1509884b533248541792b877f98")), 0x38);
  assert.equal(k4(ofHex("63964771734fbd76e3b40519d1d94a48")), 0x26);
});

test("§8.2.6 beacon key", () => assert.equal(hexOf(beaconKey(ofHex("7dd7364cd842ad18c17c2b820c84c3d6"))), "5423d967da639a99cb02231a83f7d254"));

test("CCM: RFC 3610 packet vector #1 shape round trip, and a wrong MIC is refused", () => {
  const key = ofHex("0953fa93e7caac9638f58820220a398e");
  const nonce = ofHex("00800000011201000012345678");
  const plain = utf8("hello mesh, 25 bytes long");
  for (const mic of [4, 8] as const) {
    const sealed = ccmEncrypt(key, nonce, plain, mic);
    assert.equal(sealed.length, plain.length + mic);
    assert.deepEqual(ccmDecrypt(key, nonce, sealed, mic), plain);
    sealed[0] ^= 1;
    assert.equal(ccmDecrypt(key, nonce, sealed, mic), null);
  }
});
