import { p256 } from "@noble/curves/nist.js";
import { aesCmac, bytes, ccmEncrypt, k1, s1, u16be, u32be, utf8 } from "./crypto.ts";

/**
 * Provisioning (Mesh Profile 1.0.1 §5.4) as the provisioner, over PB-GATT (#212): the phone
 * invites an unprovisioned light, exchanges P-256 public keys, proves both sides know the shared
 * secret, then sends the network key, the IV index and the light's unicast address encrypted with
 * a session key. Both end up with the light's device key, which configuring it needs. No OOB
 * authentication: the lights offer none. Checked against the specification's sample data.
 */
export const PB_GATT_SERVICE = "00001827-0000-1000-8000-00805f9b34fb";
export const PB_GATT_IN = "00002adb-0000-1000-8000-00805f9b34fb";
export const PB_GATT_OUT = "00002adc-0000-1000-8000-00805f9b34fb";

export const PROV = { INVITE: 0, CAPABILITIES: 1, START: 2, PUBLIC_KEY: 3, INPUT_COMPLETE: 4, CONFIRMATION: 5, RANDOM: 6, DATA: 7, COMPLETE: 8, FAILED: 9 } as const;

/** What a Provisioning Failed carries (§5.4.1.10). */
export const PROV_ERRORS: Record<number, string> = {
  1: "invalid PDU", 2: "invalid format", 3: "unexpected PDU", 4: "confirmation failed", 5: "out of resources",
  6: "decryption failed", 7: "unexpected error", 8: "cannot assign addresses",
};

export interface DeviceCapabilities {
  elements: number; algorithms: number; publicKeyType: number; staticOob: number;
  outputOobSize: number; outputOobAction: number; inputOobSize: number; inputOobAction: number;
}

export function parseCapabilities(p: Uint8Array): DeviceCapabilities | null {
  if (p.length !== 11) return null;
  return {
    elements: p[0], algorithms: (p[1] << 8) | p[2], publicKeyType: p[3], staticOob: p[4],
    outputOobSize: p[5], outputOobAction: (p[6] << 8) | p[7], inputOobSize: p[8], inputOobAction: (p[9] << 8) | p[10],
  };
}

const ZERO_AUTH = new Uint8Array(16);

export const confirmationKeyOf = (secret: Uint8Array, confirmationSalt: Uint8Array) => k1(secret, confirmationSalt, utf8("prck"));
export const confirmationOf = (key: Uint8Array, random: Uint8Array, auth = ZERO_AUTH) => aesCmac(key, bytes(random, auth));

/** Session key, session nonce (13 bytes) and the device key, from the shared secret and both randoms. */
export function sessionOf(secret: Uint8Array, confirmationSalt: Uint8Array, randomProvisioner: Uint8Array, randomDevice: Uint8Array) {
  const salt = s1(bytes(confirmationSalt, randomProvisioner, randomDevice));
  return {
    sessionKey: k1(secret, salt, utf8("prsk")),
    sessionNonce: k1(secret, salt, utf8("prsn")).subarray(3),
    devKey: k1(secret, salt, utf8("prdk")),
  };
}

export interface ProvisioningData { netKey: Uint8Array; netKeyIndex: number; flags: number; ivIndex: number; unicast: number }

/** NetKey, key index, flags, IV index, unicast address: 25 bytes, big-endian. */
export const provisioningDataOf = (d: ProvisioningData) => bytes(d.netKey, u16be(d.netKeyIndex), [d.flags], u32be(d.ivIndex), u16be(d.unicast));

/** The light's half of a P-256 key without the 0x04 prefix (X ‖ Y), as PB-GATT carries it. */
export const publicKeyOf = (privateKey: Uint8Array) => p256.getPublicKey(privateKey, false).subarray(1);

/** The ECDH shared secret's X coordinate. Throws on a key that is not on the curve. */
export const sharedSecretOf = (privateKey: Uint8Array, peerPublic: Uint8Array) => p256.getSharedSecret(privateKey, bytes([0x04], peerPublic)).subarray(1);

/** The two directions of a PB-GATT bearer: whole provisioning PDUs (the bearer splits and joins). */
export interface ProvisioningIo {
  send(pdu: Uint8Array): Promise<void>;
  /** The next provisioning PDU from the light; rejects on timeout. */
  receive(timeoutMs: number): Promise<Uint8Array>;
}

export type ProvisioningStep = "invite" | "keys" | "confirm" | "data" | "complete";

export interface ProvisionOptions extends ProvisioningData {
  /** Seconds the light identifies itself (blinks) while being provisioned. */
  attention?: number;
  /** Random bytes (expo-crypto on the phone, fixed values in tests). */
  random: (n: number) => Uint8Array;
  /** A fixed private key for tests; generated from `random` otherwise. */
  privateKey?: Uint8Array;
  onStep?: (s: ProvisioningStep) => void;
  timeoutMs?: number;
}

export class ProvisioningError extends Error {}

export interface Provisioned { devKey: Uint8Array; elements: number; capabilities: DeviceCapabilities }

/** Runs the whole exchange; rejects with a ProvisioningError saying where it stopped. */
export async function provision(io: ProvisioningIo, o: ProvisionOptions): Promise<Provisioned> {
  const timeout = o.timeoutMs ?? 10_000;
  const expect = async (type: number, what: string): Promise<Uint8Array> => {
    let pdu: Uint8Array;
    try { pdu = await io.receive(timeout); } catch { throw new ProvisioningError(`no ${what} from the light`); }
    if (pdu[0] === PROV.FAILED) throw new ProvisioningError(`the light refused: ${PROV_ERRORS[pdu[1]] ?? `error ${pdu[1]}`}`);
    if (pdu[0] !== type) throw new ProvisioningError(`expected ${what}, got PDU type ${pdu[0]}`);
    return pdu.subarray(1);
  };

  o.onStep?.("invite");
  const invite = [o.attention ?? 5];
  await io.send(bytes([PROV.INVITE], invite));
  const capsBytes = await expect(PROV.CAPABILITIES, "capabilities");
  const caps = parseCapabilities(capsBytes);
  if (!caps) throw new ProvisioningError("unreadable capabilities");
  if (!(caps.algorithms & 1)) throw new ProvisioningError("the light does not offer the P-256/CMAC algorithm");
  if (caps.publicKeyType & 1) throw new ProvisioningError("the light wants its public key read out of band, which is not supported");
  // Algorithm 0 (P-256, CMAC), public key in band, no OOB authentication.
  const start = [0, 0, 0, 0, 0];
  await io.send(bytes([PROV.START], start));

  o.onStep?.("keys");
  const priv = o.privateKey ?? p256.utils.randomSecretKey(o.random(48));
  const ours = publicKeyOf(priv);
  await io.send(bytes([PROV.PUBLIC_KEY], ours));
  const theirs = await expect(PROV.PUBLIC_KEY, "public key");
  if (theirs.length !== 64) throw new ProvisioningError("the light's public key has the wrong length");
  if (theirs.every((v, i) => v === ours[i])) throw new ProvisioningError("the light echoed our public key");
  let secret: Uint8Array;
  try { secret = sharedSecretOf(priv, theirs); } catch { throw new ProvisioningError("the light's public key is not on the curve"); }

  o.onStep?.("confirm");
  const confSalt = s1(bytes(invite, capsBytes, start, ours, theirs));
  const confKey = confirmationKeyOf(secret, confSalt);
  const randomP = o.random(16);
  await io.send(bytes([PROV.CONFIRMATION], confirmationOf(confKey, randomP)));
  const confD = await expect(PROV.CONFIRMATION, "confirmation");
  await io.send(bytes([PROV.RANDOM], randomP));
  const randomD = await expect(PROV.RANDOM, "random");
  if (!confirmationOf(confKey, randomD).every((v, i) => v === confD[i])) throw new ProvisioningError("the light's confirmation does not match");

  o.onStep?.("data");
  const s = sessionOf(secret, confSalt, randomP, randomD);
  await io.send(bytes([PROV.DATA], ccmEncrypt(s.sessionKey, s.sessionNonce, provisioningDataOf(o), 8)));
  await expect(PROV.COMPLETE, "completion");
  o.onStep?.("complete");
  return { devKey: s.devKey, elements: caps.elements, capabilities: caps };
}
