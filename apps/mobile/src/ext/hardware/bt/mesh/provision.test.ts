import { test } from "node:test";
import assert from "node:assert/strict";
import { bytes, ccmDecrypt, hexOf, ofHex, s1 } from "./crypto.ts";
import { confirmationKeyOf, confirmationOf, parseCapabilities, PROV, provision, ProvisioningError, publicKeyOf, sessionOf, sharedSecretOf, type ProvisioningIo } from "./provision.ts";

// Mesh Profile 1.0.1 §8.7 provisioning sample data (as Telink's SDK tests it).
const PROV_PRIV = ofHex("06a516693c9aa31a6084545d0c5db641b48572b97203ddffb7ac73f7d0457663");
const DEV_PRIV = ofHex("529aa0670d72cd6497502ed473502b037e8803b5c60829a5a3caa219505530ba");
const PROV_PUB = "2c31a47b5779809ef44cb5eaaf5c3e43d5f8faad4a8794cb987e9b03745c78dd919512183898dfbecd52e2408e43871fd021109117bd3ed4eaf8437743715d4f";
const DEV_PUB = "f465e43ff23d3f1b9dc7dfc04da8758184dbc966204796eccf0d6cf5e16500cc0201d048bcbbd899eeefc424164e33c201c2b010ca6b4d43a8a155cad8ecb279";
const SECRET = "ab85843a2f6d883f62e5684b38e307335fe6e1945ecd19604105c6f23221eb69";
const RANDOM_P = ofHex("8b19ac31d58b124c946209b5db1021b9");
const RANDOM_D = ofHex("55a2a2bca04cd32ff6f346bd0a0c1a3a");
const CAPS = "0100010000000000000000";
const DATA = { netKey: ofHex("efb2255e6422d330088e09bb015ed707"), netKeyIndex: 0x0567, flags: 0, ivIndex: 0x01020304, unicast: 0x0b0c };

test("§8.7 key pairs and the ECDH secret", () => {
  assert.equal(hexOf(publicKeyOf(PROV_PRIV)), PROV_PUB);
  assert.equal(hexOf(publicKeyOf(DEV_PRIV)), DEV_PUB);
  assert.equal(hexOf(sharedSecretOf(PROV_PRIV, ofHex(DEV_PUB))), SECRET);
  assert.equal(hexOf(sharedSecretOf(DEV_PRIV, ofHex(PROV_PUB))), SECRET);
});

test("§8.7 confirmation, session key, nonce and device key", () => {
  const salt = s1(bytes([0], ofHex(CAPS), [0, 0, 0, 0, 0], ofHex(PROV_PUB), ofHex(DEV_PUB)));
  assert.equal(hexOf(salt), "5faabe187337c71cc6c973369dcaa79a");
  const key = confirmationKeyOf(ofHex(SECRET), salt);
  assert.equal(hexOf(key), "e31fe046c68ec339c425fc6629f0336f");
  assert.equal(hexOf(confirmationOf(key, RANDOM_P)), "b38a114dfdca1fe153bd2c1e0dc46ac2");
  assert.equal(hexOf(confirmationOf(key, RANDOM_D)), "eeba521c196b52cc2e37aa40329f554e");
  const s = sessionOf(ofHex(SECRET), salt, RANDOM_P, RANDOM_D);
  assert.deepEqual([hexOf(s.sessionKey), hexOf(s.sessionNonce), hexOf(s.devKey)], ["c80253af86b33dfa450bbdb2a191fea3", "da7ddbe78b5f62b81d6847487e", "0520adad5e0142aa3e325087b4ec16d8"]);
});

/** A light that answers like the specification's device. */
function fakeLight(opts: { failAt?: number; wrongConfirmation?: boolean } = {}) {
  const sent: Uint8Array[] = [];
  const queue: Uint8Array[] = [];
  let inputs: Uint8Array[] = [];
  let confKey = new Uint8Array(16), salt = new Uint8Array(16), randomP = new Uint8Array(16);
  const reply = (p: Uint8Array) => queue.push(p);
  const io: ProvisioningIo = {
    async send(pdu) {
      sent.push(pdu);
      const body = pdu.subarray(1);
      if (opts.failAt === pdu[0]) { reply(Uint8Array.of(PROV.FAILED, 4)); return; }
      switch (pdu[0]) {
        case PROV.INVITE: inputs = [body, ofHex(CAPS)]; reply(bytes([PROV.CAPABILITIES], ofHex(CAPS))); break;
        case PROV.START: inputs.push(body); break;
        case PROV.PUBLIC_KEY: {
          inputs.push(body, ofHex(DEV_PUB));
          salt = s1(bytes(...inputs));
          confKey = confirmationKeyOf(sharedSecretOf(DEV_PRIV, body), salt);
          reply(bytes([PROV.PUBLIC_KEY], ofHex(DEV_PUB)));
          break;
        }
        case PROV.CONFIRMATION: reply(bytes([PROV.CONFIRMATION], confirmationOf(confKey, opts.wrongConfirmation ? new Uint8Array(16) : RANDOM_D))); break;
        case PROV.RANDOM: randomP = body; reply(bytes([PROV.RANDOM], RANDOM_D)); break;
        case PROV.DATA: {
          const s = sessionOf(sharedSecretOf(DEV_PRIV, inputs[3]), salt, randomP, RANDOM_D);
          reply(ccmDecrypt(s.sessionKey, s.sessionNonce, body, 8) ? Uint8Array.of(PROV.COMPLETE) : Uint8Array.of(PROV.FAILED, 6));
          break;
        }
      }
    },
    async receive() { const p = queue.shift(); if (!p) throw new Error("timeout"); return p; },
  };
  return { io, sent };
}

test("§8.7 the whole exchange: the provisioner's PDUs match the sample data byte for byte", async () => {
  const { io, sent } = fakeLight();
  const steps: string[] = [];
  const done = await provision(io, { ...DATA, attention: 0, privateKey: PROV_PRIV, random: () => RANDOM_P, onStep: (s) => steps.push(s) });
  assert.equal(hexOf(done.devKey), "0520adad5e0142aa3e325087b4ec16d8");
  assert.equal(done.elements, 1);
  assert.deepEqual(sent.map((p) => p[0]), [PROV.INVITE, PROV.START, PROV.PUBLIC_KEY, PROV.CONFIRMATION, PROV.RANDOM, PROV.DATA]);
  assert.equal(hexOf(sent[2].subarray(1)), PROV_PUB);
  assert.equal(hexOf(sent[3].subarray(1)), "b38a114dfdca1fe153bd2c1e0dc46ac2");
  assert.equal(hexOf(sent[5].subarray(1)), "d0bd7f4a89a2ff6222af59a90a60ad58acfe3123356f5cec2973e0ec50783b10c7");
  assert.deepEqual(steps, ["invite", "keys", "confirm", "data", "complete"]);
});

test("refusals and a forged confirmation stop the exchange with a reason", async () => {
  await assert.rejects(provision(fakeLight({ failAt: PROV.START }).io, { ...DATA, random: () => RANDOM_P, privateKey: PROV_PRIV }), (e: Error) => e instanceof ProvisioningError && /confirmation failed/.test(e.message));
  await assert.rejects(provision(fakeLight({ wrongConfirmation: true }).io, { ...DATA, random: () => RANDOM_P, privateKey: PROV_PRIV }), /does not match/);
  assert.equal(parseCapabilities(ofHex("0100")), null);
});
