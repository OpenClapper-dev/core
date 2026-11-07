import { test } from "node:test";
import assert from "node:assert/strict";
import { hexOf, k2, ofHex } from "./crypto.ts";
import { decodeNetworkPdu } from "./network.ts";
import { decryptAccess, encryptAccess, lowerPdus, Reassembler, segmentAck, seqAuthOf } from "./transport.ts";

// Mesh Profile 1.0.1 §8.3.6, Message #6: a Config AppKey Add with the device key, in two segments.
const DEV_KEY = ofHex("9d6dd0e96eb25dc19a40ed9914f8f03f");
const IV = 0x12345678;
const ACCESS = "0056341263964771734fbd76e3b40519d1d94a48";
const UPPER = "ee9dddfd2169326d23f3afdfcfdc18c52fdef772e0e17308";
const LOWER = ["8026ac01ee9dddfd2169326d23f3afdf", "8026ac21cfdc18c52fdef772e0e17308"];
const PDUS = ["68cab5c5348a230afba8c63d4e686364979deaf4fd40961145939cda0e", "681615b5dd4a846cae0c032bf0746f44f1b8cc8ce5edc57e55beed49c0"];
const at = { seq: 0x3129ab, src: 0x0003, dst: 0x1201, ivIndex: IV };

test("§8.3.6 upper transport: device key encryption", () => {
  assert.equal(hexOf(encryptAccess(DEV_KEY, "device", at, ofHex(ACCESS))), UPPER);
  assert.equal(hexOf(decryptAccess(DEV_KEY, "device", at, ofHex(UPPER))!), ACCESS);
  assert.equal(decryptAccess(DEV_KEY, "app", at, ofHex(UPPER)), null);
});

test("§8.3.6 lower transport: two segments", () => {
  assert.deepEqual(lowerPdus(ofHex(UPPER), { akf: false, aid: 0 }, at.seq).map(hexOf), LOWER);
});

test("short messages stay in one PDU: the Telink command (1 + 10 bytes + MIC) fits", () => {
  const upper = new Uint8Array(15);
  const [one] = lowerPdus(upper, { akf: true, aid: 0x26 }, 1);
  assert.equal(one.length, 16);
  assert.equal(one[0], 0x40 | 0x26);
  assert.equal(lowerPdus(new Uint8Array(16), { akf: true, aid: 0 }, 1).length, 2);
});

test("incoming: segments in any order, decrypted with the SeqAuth of the first", () => {
  const net = k2(ofHex("7dd7364cd842ad18c17c2b820c84c3d6"));
  const r = new Reassembler();
  const msgs = PDUS.map((p) => decodeNetworkPdu(net, IV, ofHex(p))!);
  assert.equal(r.push(msgs[1]), null);
  const done = r.push(msgs[0])!;
  assert.equal(hexOf(done.upper), UPPER);
  assert.equal(done.seqAuth, 0x3129ab);
  assert.deepEqual(done.ack, { seqZero: 0x09ab, blockAck: 3 });
  assert.equal(hexOf(decryptAccess(DEV_KEY, "device", { ...at, seq: done.seqAuth }, done.upper)!), ACCESS);
});

test("§8.3.7 segment acknowledgment, and SeqAuth across a SeqZero wrap", () => {
  assert.equal(hexOf(segmentAck(0x09ab, 2, true)), "00a6ac00000002");
  assert.equal(seqAuthOf(0x3129ac, 0x09ab), 0x3129ab);
  assert.equal(seqAuthOf(0x004001, 0x1fff), 0x003fff);
});
