import { test } from "node:test";
import assert from "node:assert/strict";
import { k2, k4, ofHex } from "./crypto.ts";
import { configureNode } from "./configure.ts";
import { FakeProxyNode } from "./fakeNode.testlib.ts";
import { MeshSession, MeshTimeout, type NetworkKeys } from "./session.ts";
import { SeqAllocator } from "./seq.ts";
import { compositionDataGet, OP } from "./access.ts";

const NET_KEY = ofHex("7dd7364cd842ad18c17c2b820c84c3d6");
const APP_KEY = ofHex("63964771734fbd76e3b40519d1d94a48");
const DEV_KEY = ofHex("0520adad5e0142aa3e325087b4ec16d8");
// One element: Config Server, Generic OnOff Server and a Telink vendor model (0x0211:0x0000).
const COMPOSITION = ofHex("1102010002001000030000000201000000101102" + "0000");
const PHONE = 0x0001, LIGHT = 0x0002;

function setup(o: { dropFirst?: number; ivStored?: number } = {}) {
  const node = new FakeProxyNode({ netKey: NET_KEY, ivIndex: 0x12345678, unicast: LIGHT, devKey: DEV_KEY, composition: COMPOSITION, dropFirst: o.dropFirst });
  const ivSeen: number[] = [];
  const net: NetworkKeys = { netKey: NET_KEY, net: k2(NET_KEY), appKey: APP_KEY, aid: k4(APP_KEY), ivIndex: o.ivStored ?? 0x12345678, src: PHONE, devKeyOf: (u) => (u === LIGHT ? DEV_KEY : undefined) };
  const s = new MeshSession(node.link(), net, new SeqAllocator({ load: () => null, save: () => {} }), { setupWaitMs: 200, onIvIndex: (iv) => ivSeen.push(iv) });
  return { node, s, ivSeen };
}

test("start: the IV index from the proxy's beacon, then the accept list with the phone's address", async () => {
  const { node, s, ivSeen } = setup({ ivStored: 0 });
  await s.start();
  assert.equal(s.ivIndex, 0x12345678);
  assert.deepEqual(ivSeen, [0x12345678]);
  assert.deepEqual(node.filter, { type: 0, addresses: [PHONE] });
});

test("configure a provisioned light: composition, AppKey, every model bound but the Config Server", async () => {
  const { node, s } = setup();
  await s.start();
  const progress: string[] = [];
  const r = await configureNode(s, { unicast: LIGHT, devKey: DEV_KEY }, { netKeyIndex: 0, appKeyIndex: 0, appKey: APP_KEY }, (d, t) => progress.push(`${d}/${t}`));
  assert.deepEqual(node.appKey, APP_KEY);
  assert.equal(r.boundModels, 2);
  assert.deepEqual(node.binds, ["0010", "11020000"]);
  assert.deepEqual(progress, ["0/3", "1/3", "2/3", "3/3"]);
  // The AppKey Add (20 bytes) went out in two segments and was reassembled by the light.
  assert.ok(node.received.some((m) => m.access.opcode === OP.APPKEY_ADD));
});

test("silence is repeated with fresh sequence numbers, then given up", async () => {
  const { node, s } = setup({ dropFirst: 1 });
  await s.start();
  const r = await s.request({ dst: LIGHT, access: compositionDataGet(0), key: { kind: "device", key: DEV_KEY } }, (m) => m.access.opcode === OP.COMPOSITION_DATA_STATUS, 100);
  assert.equal(r.src, LIGHT);
  assert.equal(node.received.length, 2);
  const mute = setup({ dropFirst: 99 });
  await mute.s.start();
  await assert.rejects(mute.s.request({ dst: LIGHT, access: compositionDataGet(0), key: { kind: "device", key: DEV_KEY } }, () => true, 50, 2), MeshTimeout);
});
