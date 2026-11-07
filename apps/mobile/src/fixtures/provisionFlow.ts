import * as Crypto from "expo-crypto";
import { adapterState, connect, scan } from "../ble/link";
import { askBluetooth } from "../ble/permissions";
import { log } from "../log";
import { configureNode } from "./mesh/configure";
import { PB_GATT_IN, PB_GATT_OUT, PB_GATT_SERVICE, provision, ProvisioningError, type ProvisioningIo } from "./mesh/provision";
import { PDU, proxyChunks, ProxyReassembler } from "./mesh/proxy";
import { MeshSession } from "./mesh/session";
import { saveFixture } from "./library";
import { APP_KEY_INDEX, appKeyOf, ensureNetwork, getMeshNetworks, NET_KEY_INDEX, netKeyOf, networkKeys, nodeState, rememberNode, saveMeshNetwork, seqFor, type MeshNetwork } from "./meshNetworks";
import type { Fixture, Link } from "./types";

/** The steps the provisioning screen shows, in order. */
export const STAGES = ["find", "invite", "keys", "confirm", "data", "reconnect", "configure"] as const;
export type Stage = (typeof STAGES)[number];

const PROXY_UUID = "00001828-0000-1000-8000-00805f9b34fb";
const PROV_UUID = PB_GATT_SERVICE;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What the light advertises right now: unprovisioned (1827), already in a network (1828), or not seen. */
async function lookFor(address: string, ms: number): Promise<"unprovisioned" | "provisioned" | "missing"> {
  return new Promise((resolve) => {
    let seen: "unprovisioned" | "provisioned" | null = null;
    const stop = scan((d) => {
      if (d.address !== address) return;
      const svc = (d.serviceUUIDs ?? []).map((u) => u.toLowerCase());
      if (svc.includes(PROV_UUID)) { seen = "unprovisioned"; finish(); } else if (svc.includes(PROXY_UUID)) seen ??= "provisioned";
    }, (e) => log("warn", "provision scan failed", e));
    const t = setTimeout(finish, ms);
    function finish() { clearTimeout(t); stop(); resolve(seen ?? "missing"); }
  });
}

/** PB-GATT: provisioning PDUs as proxy PDUs of type 3 over the provisioning service. */
async function bearer(link: Link): Promise<ProvisioningIo & { close(): void }> {
  const queue: Uint8Array[] = [];
  let waiter: ((p: Uint8Array) => void) | null = null;
  const parts = new ProxyReassembler();
  const stop = await link.notify(PB_GATT_SERVICE, PB_GATT_OUT, (b) => {
    const p = parts.push(b);
    if (!p || p.type !== PDU.PROVISIONING) return;
    if (waiter) { const w = waiter; waiter = null; w(p.payload); } else queue.push(p.payload);
  });
  return {
    async send(pdu) { for (const c of proxyChunks(PDU.PROVISIONING, pdu, link.mtu)) await link.write(PB_GATT_SERVICE, PB_GATT_IN, c, false); },
    receive: (ms) => new Promise((resolve, reject) => {
      const q = queue.shift();
      if (q) { resolve(q); return; }
      const t = setTimeout(() => { waiter = null; reject(new Error("timeout")); }, ms);
      waiter = (p) => { clearTimeout(t); resolve(p); };
    }),
    close: stop,
  };
}

async function connectWithRetry(address: string, tries: number): Promise<Link> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try { return await connect(address); } catch (e) { last = e; await wait(2000); }
  }
  throw new Error(`the light did not come back after provisioning: ${last instanceof Error ? last.message : String(last)}`);
}

/**
 * Pairs a mesh fixture with the phone's network (#212): provisions it when it is still
 * unprovisioned, then configures it through its proxy. Resumable: a light provisioned earlier but
 * not configured (the app was closed, the light went out of range) only gets the second half.
 */
export async function provisionFixture(f: Fixture, onStage: (s: Stage) => void): Promise<Fixture> {
  if (!(await askBluetooth())) throw new Error("Bluetooth permission denied. Allow “Nearby devices” for OpenClapper in Android settings.");
  if ((await adapterState().catch(() => "unknown")) !== "on") throw new Error("Bluetooth is off.");
  let network: MeshNetwork = f.mesh ? getMeshNetworks().find((n) => n.id === f.mesh!.networkId) ?? (await ensureNetwork()) : await ensureNetwork();
  let fixture = f;

  const resume = f.mesh && f.mesh.networkId === network.id && nodeState(network.id, f.mesh.unicast);
  if (!resume) {
    onStage("find");
    const found = await lookFor(f.address, 10_000);
    if (found === "missing") throw new Error("The light was not found. Is it on and close to the phone?");
    if (found === "provisioned") throw new Error("This light is still in another mesh network (Sidus Link). Remove it there (light settings → remove) or reset it on the light, then try again.");

    const netKey = netKeyOf(network.id);
    if (!netKey) throw new Error("The network's keys are not on this phone.");
    const unicast = network.nextUnicast;
    const link = await connect(f.address);
    const io = await bearer(link);
    try {
      const done = await provision(io, {
        netKey, netKeyIndex: NET_KEY_INDEX, flags: 0, ivIndex: network.ivIndex, unicast,
        random: (n) => Crypto.getRandomBytes(n),
        onStep: (s) => { if (s !== "complete") onStage(s === "invite" ? "invite" : s); },
      });
      // The device key first: without it the light could never be configured or reset remotely.
      rememberNode(network.id, unicast, done.devKey);
      log("info", "mesh: provisioned", { fixture: f.id, unicast, elements: done.elements });
      network = { ...network, nextUnicast: unicast + Math.max(1, done.elements) };
      await saveMeshNetwork(network);
      fixture = { ...f, mesh: { networkId: network.id, unicast, elements: Math.max(1, done.elements) } };
      await saveFixture(fixture);
    } catch (e) {
      log("warn", "mesh: provisioning failed", { fixture: f.id, error: e });
      throw e instanceof ProvisioningError ? new Error(`Provisioning stopped: ${e.message}.`) : e;
    } finally {
      io.close();
      await link.close();
    }
    // The light restarts as a proxy node of the new network.
    await wait(2500);
  }

  onStage("reconnect");
  const mesh = fixture.mesh!;
  const keys = networkKeys(network);
  const appKey = appKeyOf(network.id);
  const devKey = keys?.devKeyOf(mesh.unicast);
  if (!keys || !appKey || !devKey) throw new Error("The network's keys are not on this phone.");
  const link = await connectWithRetry(fixture.address, 5);
  const session = new MeshSession(link, keys, seqFor(network.id), { log, onIvIndex: (iv) => { network = { ...network, ivIndex: iv }; void saveMeshNetwork(network); } });
  try {
    await session.start();
    onStage("configure");
    const r = await configureNode(session, { unicast: mesh.unicast, devKey }, { netKeyIndex: NET_KEY_INDEX, appKeyIndex: APP_KEY_INDEX, appKey });
    log("info", "mesh: configured", { fixture: f.id, models: r.boundModels, failed: r.failedModels, cid: r.composition.cid.toString(16), pid: r.composition.pid.toString(16) });
    rememberNode(network.id, mesh.unicast, devKey, true);
  } finally {
    await session.close();
    await link.close();
  }
  return fixture;
}
