import { test } from "node:test";
import assert from "node:assert/strict";
import { hexOf, k2, ofHex } from "./crypto.ts";
import { decodeNetworkPdu, encodeNetworkPdu } from "./network.ts";

// Mesh Profile 1.0.1 §8.3: messages as [name, ctl, ttl, seq, src, dst, lower transport PDU, network PDU].
const NET_KEY = ofHex("7dd7364cd842ad18c17c2b820c84c3d6");
const FLOOD = k2(NET_KEY);
const FRIEND = k2(NET_KEY, ofHex("01120123450000072f"));
const IV = 0x12345678;
type Row = [string, boolean, number, number, number, number, string, string];
const FLOODING: Row[] = [
  ["#1", true, 0, 0x000001, 0x1201, 0xfffd, "034b50057e400000010000", "68eca487516765b5e5bfdacbaf6cb7fb6bff871f035444ce83a670df"],
  ["#2", true, 0, 0x014820, 0x2345, 0x1201, "04320308ba072f", "68d4c826296d7979d7dbc0c9b4d43eebec129d20a620d01e"],
  ["#3", true, 0, 0x2b3832, 0x2fe3, 0x1201, "04fa0205a6000a", "68da062bc96df253273086b8c5ee00bdd9cfcc62a2ddf572"],
  ["#6 seg 0", false, 4, 0x3129ab, 0x0003, 0x1201, "8026ac01ee9dddfd2169326d23f3afdf", "68cab5c5348a230afba8c63d4e686364979deaf4fd40961145939cda0e"],
  ["#6 seg 1", false, 4, 0x3129ac, 0x0003, 0x1201, "8026ac21cfdc18c52fdef772e0e17308", "681615b5dd4a846cae0c032bf0746f44f1b8cc8ce5edc57e55beed49c0"],
  ["#7", true, 0x0b, 0x014835, 0x2345, 0x0003, "00a6ac00000002", "68e476b5579c980d0d730f94d7f3509df987bb417eb7c05f"],
  ["#8", false, 4, 0x3129ad, 0x0003, 0x1201, "8026ac01ee9dddfd2169326d23f3afdf", "684daa6267c2cf0e2f91add6f06e66006844cec97f973105ae2534f958"],
  ["#9", true, 0x0b, 0x014836, 0x2345, 0x0003, "00a6ac00000003", "68aec467ed4901d85d806bbed248614f938067b0d983bb7b"],
];
const FRIENDSHIP: Row[] = [
  ["#4", true, 0, 0x000002, 0x1201, 0x2345, "0100", "5e84eba092380fb0e5d0ad970d579a4e88051c"],
  ["#5", true, 0, 0x014834, 0x2345, 0x1201, "02001234567800", "5eafd6f53c43db5c39da1792b1fee9ec74b786c56d3a9dee"],
  ["#10", true, 0, 0x000003, 0x1201, 0x2345, "0101", "5e7b786568759f7777ed355afaf66d899c1e3d"],
  ["#11", false, 3, 0x3129ad, 0x0003, 0x1201, "c026ac01ee9dddfd2169326d23f3afdf", "5e6ebfc021edf5d5e748a20ecfd98ddfd32de80befb400213d113813b5"],
];

for (const [rows, keys, label] of [[FLOODING, FLOOD, "flooding"], [FRIENDSHIP, FRIEND, "friendship"]] as const) {
  for (const [name, ctl, ttl, seq, src, dst, transport, pdu] of rows) {
    test(`§8.3 message ${name} (${label}): encoded byte for byte and decoded back`, () => {
      const m = { ctl, ttl, seq, src, dst, transport: ofHex(transport) };
      assert.equal(hexOf(encodeNetworkPdu(keys, IV, m)), pdu);
      const back = decodeNetworkPdu(keys, IV, ofHex(pdu))!;
      assert.deepEqual({ ...back, transport: hexOf(back.transport) }, { ...m, transport });
    });
  }
}

test("§8.3.22 message #22: the previous IV index (IVI bit 1)", () => {
  const m = { ctl: false, ttl: 3, seq: 0x07080b, src: 0x1234, dst: 0xb529, transport: ofHex("663871b904d431526316ca48a0") };
  const pdu = "e8d85caecef1e3ed31f3fdcf88a411135fea55df730b6b28e255";
  assert.equal(hexOf(encodeNetworkPdu(FLOOD, 0x12345677, m)), pdu);
  // A node already on 0x12345678 still reads it: IVI 1 points at the previous index.
  assert.equal(decodeNetworkPdu(FLOOD, 0x12345678, ofHex(pdu))?.seq, 0x07080b);
});

test("not ours: another NID, or a tampered PDU", () => {
  const pdu = ofHex(FLOODING[0][7]);
  assert.equal(decodeNetworkPdu(k2(ofHex("f7a2a44f8e8a8029064f173ddc1e2b00")), IV, pdu), null);
  pdu[20] ^= 0x40;
  assert.equal(decodeNetworkPdu(FLOOD, IV, pdu), null);
});
