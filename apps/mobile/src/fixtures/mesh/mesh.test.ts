import { test } from "node:test";
import assert from "node:assert/strict";
import { appKeyAdd, bindTargets, compositionDataGet, modelAppBind, OP, packKeyIndexes, parseAccess, parseComposition } from "./access.ts";
import { hexOf, k2, k4, ofHex } from "./crypto.ts";
import { encodeAccessMessage, Inbox } from "./message.ts";
import { addAddresses, parseFilterStatus, parseSecureBeacon, PDU, proxyChunks, ProxyReassembler, setFilterType } from "./proxy.ts";
import { SEQ_BLOCK, SeqAllocator, type SeqState } from "./seq.ts";
import { encodeNetworkPdu } from "./network.ts";

const NET_KEY = ofHex("7dd7364cd842ad18c17c2b820c84c3d6");
const NET = k2(NET_KEY);
const DEV_KEY = ofHex("9d6dd0e96eb25dc19a40ed9914f8f03f");
const APP_KEY = ofHex("63964771734fbd76e3b40519d1d94a48");
const IV = 0x12345678;

function memStore(start: SeqState | null = null) {
  const s = { saved: start, saves: 0 };
  return { s, store: { load: () => s.saved, save: (x: SeqState) => { s.saved = x; s.saves++; } } };
}

test("access: AppKey Add as in §8.3.6 (indexes 0x456 and 0x123)", () => {
  assert.deepEqual(packKeyIndexes(0x456, 0x123), [0x56, 0x34, 0x12]);
  assert.equal(hexOf(appKeyAdd(0x456, 0x123, APP_KEY)), "0056341263964771734fbd76e3b40519d1d94a48");
  assert.equal(hexOf(compositionDataGet()), "800800");
  assert.equal(hexOf(modelAppBind(0x0002, 0, { sig: 0x1000 })), "803d020000000010");
  assert.equal(hexOf(modelAppBind(0x0002, 0, { company: 0x0211, model: 0x0001 })), "803d0200000011020100");
  assert.deepEqual(parseAccess(ofHex("8003000000")), { opcode: OP.APPKEY_STATUS, params: ofHex("000000") });
  assert.equal(parseAccess(ofHex("26aabb"))?.opcode, OP.TELINK);
});

test("composition data: elements, SIG and vendor models; configuration models are not bound", () => {
  // CID 0x0211, PID 1, VID 2, CRPL 0x10, features 3; one element with Config Server, Generic OnOff Server and a vendor model; a second with Light Lightness.
  const d = ofHex("1102010002001000030000000201000000101102010000000100" + "0013");
  const c = parseComposition(d)!;
  assert.equal(c.cid, 0x0211);
  assert.equal(c.elements.length, 2);
  assert.deepEqual(c.elements[0].models, [{ sig: 0x0000 }, { sig: 0x1000 }, { company: 0x0211, model: 0x0001 }]);
  assert.deepEqual(bindTargets(c, 0x0005), [
    { element: 5, model: { sig: 0x1000 } }, { element: 5, model: { company: 0x0211, model: 0x0001 } }, { element: 6, model: { sig: 0x1300 } },
  ]);
  assert.equal(parseComposition(ofHex("1102010002001000030000000201")), null);
});

test("§8.3.6 end to end: AppKey Add to a node, the same two network PDUs as the spec", () => {
  const { store } = memStore({ next: 0, reserved: 0x3129ab });
  const pdus = encodeAccessMessage({ net: NET, ivIndex: IV, src: 0x0003 }, new SeqAllocator(store), { dst: 0x1201, access: appKeyAdd(0x456, 0x123, APP_KEY), key: { kind: "device", key: DEV_KEY }, ttl: 4 });
  assert.deepEqual(pdus.map(hexOf), [
    "68cab5c5348a230afba8c63d4e686364979deaf4fd40961145939cda0e",
    "681615b5dd4a846cae0c032bf0746f44f1b8cc8ce5edc57e55beed49c0",
  ]);
});

test("a node's segmented reply reaches the phone, decrypted, with a Segment Acknowledgment", () => {
  // The node 0x1201 answers the phone 0x0003 with a long message under its device key.
  const node = new SeqAllocator(memStore({ next: 0, reserved: 500 }).store);
  const phone = new SeqAllocator(memStore().store);
  const reply = appKeyAdd(1, 2, APP_KEY);
  const pdus = encodeAccessMessage({ net: NET, ivIndex: IV, src: 0x1201 }, node, { dst: 0x0003, access: reply, key: { kind: "device", key: DEV_KEY } });
  assert.equal(pdus.length, 2);
  const inbox = new Inbox({ net: NET, ivIndex: IV, src: 0x0003 }, [], (src) => (src === 0x1201 ? DEV_KEY : undefined), phone);
  assert.equal(inbox.push(pdus[1]), null);
  const got = inbox.push(pdus[0])!;
  assert.equal(got.src, 0x1201);
  assert.equal(got.keyKind, "device");
  assert.equal(got.access.opcode, OP.APPKEY_ADD);
  assert.equal(got.ack?.length, 1);
});

test("an app-key message (the Telink command shape): one PDU, decrypted by AID", () => {
  const seq = new SeqAllocator(memStore().store);
  const access = Uint8Array.from([0x26, 0x8d, 7, 0, 0, 0, 0, 0, 0, 1, 0x8c]);
  const aid = k4(APP_KEY);
  const pdus = encodeAccessMessage({ net: NET, ivIndex: IV, src: 0x0001 }, seq, { dst: 0x0002, access, key: { kind: "app", key: APP_KEY, aid } });
  assert.equal(pdus.length, 1);
  const inbox = new Inbox({ net: NET, ivIndex: IV, src: 0x0002 }, [{ key: APP_KEY, aid }], () => undefined, seq);
  const got = inbox.push(pdus[0])!;
  assert.deepEqual([got.access.opcode, hexOf(got.access.params)], [0x26, "8d0700000000000001 8c".replace(" ", "")]);
  assert.equal(got.ack, null);
});

test("proxy PDUs at MTU 23 split and join back; a lost first part drops the rest", () => {
  const net = ofHex("68cab5c5348a230afba8c63d4e686364979deaf4fd40961145939cda0e");
  const chunks = proxyChunks(PDU.NETWORK, net, 23);
  // 29 bytes: 19 + 10 of payload, each behind the 1-byte proxy header.
  assert.deepEqual(chunks.map((c) => c.length), [20, 11]);
  assert.deepEqual(chunks.map((c) => c[0] >> 6), [1, 3]);
  const r = new ProxyReassembler();
  assert.equal(r.push(chunks[0]), null);
  assert.equal(hexOf(r.push(chunks[1])!.payload), hexOf(net));
  assert.equal(r.push(chunks[1]), null);
  assert.deepEqual(proxyChunks(PDU.NETWORK, net, 247).length, 1);
  assert.deepEqual(r.push(proxyChunks(PDU.BEACON, ofHex("0100"), 23)[0]), { type: PDU.BEACON, payload: ofHex("0100") });
});

test("proxy filter: set to an accept list, add the phone, read the status back", () => {
  const o = { seq: 1, src: 0x0001 };
  const set = setFilterType(NET, IV, o);
  assert.equal(set.length, 1 + 6 + 2 + 2 + 8);
  const add = addAddresses(NET, IV, { ...o, seq: 2 }, [0x0001]);
  assert.equal(add.length, 1 + 6 + 2 + 3 + 8);
  // What a proxy answers: Filter Status, accept list, one address; also read with a 4-byte MIC.
  for (const micLen of [8, 4] as const) {
    const status = encodeNetworkPdu(NET, IV, { ctl: true, ttl: 0, seq: 9, src: 0x0002, dst: 0, transport: Uint8Array.of(0x03, 0x00, 0x00, 0x01) }, "proxy", micLen);
    assert.deepEqual(parseFilterStatus(NET, IV, status), { type: 0, listSize: 1 });
  }
});

test("§8.4.3 Secure Network Beacon: IV index read, another network or a forgery refused", () => {
  const beacon = ofHex("01003ecaff672f673370123456788ea261582f364f6f");
  assert.deepEqual(parseSecureBeacon(NET_KEY, beacon), { keyRefresh: false, ivUpdate: false, ivIndex: 0x12345678 });
  assert.equal(parseSecureBeacon(ofHex("f7a2a44f8e8a8029064f173ddc1e2b00"), beacon), null);
  beacon[13] ^= 1;
  assert.equal(parseSecureBeacon(NET_KEY, beacon), null);
});

test("sequence numbers: saved before use, resumed past the block after a restart", () => {
  const { s, store } = memStore();
  const a = new SeqAllocator(store);
  assert.equal(a.take(), 0);
  assert.equal(s.saved!.reserved, 1 + SEQ_BLOCK);
  for (let i = 0; i < SEQ_BLOCK; i++) a.take();
  assert.equal(s.saves, 1); // the first block covers 0..128
  const used = a.take(3);
  assert.equal(s.saves, 2);
  // Killed here: the next run starts after everything that may have gone out.
  const b = new SeqAllocator(store);
  assert.ok(b.take() > used + 2);
  assert.throws(() => new SeqAllocator({ load: () => ({ next: 0, reserved: 0xffffff }), save: () => {} }).take(2), /used up/);
});
