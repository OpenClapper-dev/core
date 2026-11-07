import { bytes } from "./crypto.ts";

/**
 * Access layer (Mesh Profile 1.0.1 §3.7, §4.3): opcodes and the configuration messages the
 * phone needs to set a provisioned light up (#212). Light control itself is the Telink 0x26
 * message (#213), a one-byte opcode like AppKey Add.
 */
export const OP = {
  APPKEY_ADD: 0x00,
  COMPOSITION_DATA_STATUS: 0x02,
  APPKEY_STATUS: 0x8003,
  COMPOSITION_DATA_GET: 0x8008,
  MODEL_APP_BIND: 0x803d,
  MODEL_APP_STATUS: 0x803e,
  TELINK: 0x26,
} as const;

/** 1-byte opcodes are below 0x7f; 2-byte ones start with 0b10; vendor opcodes (0b11) are 3 bytes. */
export function encodeOpcode(op: number): number[] {
  if (op < 0x7f) return [op];
  if (op >= 0x8000 && op <= 0xbfff) return [op >> 8, op & 0xff];
  throw new Error(`opcode 0x${op.toString(16)} not supported`);
}

export const accessPdu = (op: number, params: Uint8Array | number[] = []) => bytes(encodeOpcode(op), params);

export interface Access { opcode: number; params: Uint8Array }

/** Vendor opcodes come back as op << 16 | company (as on the air: opcode byte, then the company id). */
export function parseAccess(pdu: Uint8Array): Access | null {
  if (!pdu.length) return null;
  const top = pdu[0] >> 6;
  if (top < 2) return pdu[0] === 0x7f ? null : { opcode: pdu[0], params: pdu.subarray(1) };
  if (top === 2) return pdu.length >= 2 ? { opcode: (pdu[0] << 8) | pdu[1], params: pdu.subarray(2) } : null;
  return pdu.length >= 3 ? { opcode: (pdu[0] << 16) | (pdu[1] << 8) | pdu[2], params: pdu.subarray(3) } : null;
}

const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const rd16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);

/** Two 12-bit key indexes in three bytes, NetKey index first (§4.3.1.1). */
export const packKeyIndexes = (netKeyIndex: number, appKeyIndex: number) => {
  const v = (netKeyIndex & 0xfff) | ((appKeyIndex & 0xfff) << 12);
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
};

export const appKeyAdd = (netKeyIndex: number, appKeyIndex: number, appKey: Uint8Array) => accessPdu(OP.APPKEY_ADD, bytes(packKeyIndexes(netKeyIndex, appKeyIndex), appKey));
export const compositionDataGet = (page = 0) => accessPdu(OP.COMPOSITION_DATA_GET, [page]);

/** A model: SIG ones by 16-bit id, vendor ones with their company id. */
export type ModelId = { sig: number } | { company: number; model: number };

export const modelAppBind = (elementAddress: number, appKeyIndex: number, m: ModelId) =>
  accessPdu(OP.MODEL_APP_BIND, bytes(le16(elementAddress), le16(appKeyIndex), "sig" in m ? le16(m.sig) : [...le16(m.company), ...le16(m.model)]));

export interface Composition {
  cid: number; pid: number; vid: number; crpl: number; features: number;
  elements: { location: number; models: ModelId[] }[];
}

/** Composition Data page 0 (after the page byte). */
export function parseComposition(d: Uint8Array): Composition | null {
  if (d.length < 10) return null;
  const c: Composition = { cid: rd16(d, 0), pid: rd16(d, 2), vid: rd16(d, 4), crpl: rd16(d, 6), features: rd16(d, 8), elements: [] };
  let o = 10;
  while (o + 4 <= d.length) {
    const location = rd16(d, o), numS = d[o + 2], numV = d[o + 3];
    o += 4;
    if (o + numS * 2 + numV * 4 > d.length) return null;
    const models: ModelId[] = [];
    for (let i = 0; i < numS; i++, o += 2) models.push({ sig: rd16(d, o) });
    for (let i = 0; i < numV; i++, o += 4) models.push({ company: rd16(d, o), model: rd16(d, o + 2) });
    c.elements.push({ location, models });
  }
  return c;
}

const CONFIG_SERVER = 0x0000, CONFIG_CLIENT = 0x0001;

/**
 * Every model to bind the AppKey to: all of them except the configuration models, which only take
 * the device key. The lights' 0x26 messages reach a vendor model, so binding everything is the
 * safe choice (MeshDeck and the Telink SDK do the same).
 */
export function bindTargets(c: Composition, primary: number): { element: number; model: ModelId }[] {
  return c.elements.flatMap((e, i) => e.models
    .filter((m) => !("sig" in m && (m.sig === CONFIG_SERVER || m.sig === CONFIG_CLIENT)))
    .map((model) => ({ element: primary + i, model })));
}

/** Status of AppKey Add / Model App Bind: 0 = success (§4.3.5). */
export const statusOf = (a: Access) => (a.opcode === OP.APPKEY_STATUS || a.opcode === OP.MODEL_APP_STATUS ? a.params[0] : null);
