import { useEffect, useState } from "react";
import {
  HARDWARE_CHANNEL, parseHardwareRequest, type FixtureLive, type HardwareProvision, type HardwareReport, type HardwareRequest, type HardwareScan, type HardwareState,
  type LightCommand, type ScannedDevice,
} from "@openclapper/ext-hardware";
import { canCall } from "../../api";
import { device } from "../../device";
import { onChannel, onLinkOpen, sendLink } from "../../link";
import { log } from "../../log";
import { adapterState, scan } from "./ble/link";
import { askBluetooth } from "./ble/permissions";
import { suggestKinds } from "./bt/registry";
import { hub, watchAppState } from "./hub";
import { getDevices, getFixtures, onDevicesChange, syncDevices } from "./library";
import { provisionFixture } from "./provisionFlow";

/**
 * The phone as proxy (docs/features/hardware.md): while the Hardware app is open with its proxy switch on (screen
 * kept awake), the phone holds every awake device and runs what the Studio and the account's other phones send on
 * the link's `hardware` channel; it reports every device's link, state and telemetry, at most every STATE_EVERY_MS.
 * The phone's own screens use the same requests: run here when this phone is the proxy, else sent on the link.
 */
const STATE_EVERY_MS = 200;

let running = false;
let release: (() => void) | null = null;
let paused = false;
/** (Re)takes a lease on every awake device, letting go of the previous one after. Sleeping devices get no connection attempts. */
function lease() { const prev = release; release = hub.acquire(getFixtures().filter((f) => !f.asleep).map((f) => f.id), "proxy"); prev?.(); }
function pause() { paused = true; release?.(); release = null; }
function resumeLeases() { paused = false; if (running) lease(); }
let stopFns: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = 0;

/* ---------- What every screen of the phone reads: this phone's own state, or the proxy phone's over the link. ---------- */

let remote: HardwareState | null = null;
let scanState: HardwareScan | null = null;
let provisionState: HardwareProvision | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const cb of listeners) cb(); };

export const proxyRunning = () => running;
export function snapshot(): HardwareState {
  const f = device.get().file;
  const devices: FixtureLive[] = running ? getFixtures().map((x) => ({ id: x.id, ...hub.status(x.id), asleep: !!x.asleep })) : [];
  return { type: "state", phone: { id: f?.id ?? "", name: f?.name ?? "" }, proxy: running, devices };
}
/** The state to show: this phone's when it is the proxy, else the last report of another phone that is. */
export const currentState = (): HardwareState | null => (running ? snapshot() : remote?.proxy ? remote : null);
export function useHardware() {
  const [, tick] = useState(0);
  useEffect(() => { const cb = () => tick((t) => t + 1); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  return { state: currentState(), running, scan: scanState, provision: provisionState };
}

function report(m: HardwareReport) {
  sendLink({ ch: HARDWARE_CHANNEL, ...m });
  if (m.type === "scan.state") scanState = m;
  if (m.type === "provision.state") provisionState = m;
  changed();
}
function sendNow() { timer = null; lastSent = Date.now(); report(snapshot()); }
/** Coalesces bursts (a slider drag): one report now, then at most one per STATE_EVERY_MS. */
function soon() { if (timer) return; timer = setTimeout(sendNow, Math.max(0, lastSent + STATE_EVERY_MS - Date.now())); }

/** A request from this phone's own screens: run here when this phone is the proxy, else sent to the one that is. */
export function request(r: HardwareRequest) {
  if (running) handle(r);
  else sendLink({ ch: HARDWARE_CHANNEL, ...r });
}
export const command = (deviceId: string, c: LightCommand) => request({ type: "command", device: deviceId, command: c });

function handle(r: HardwareRequest) {
  switch (r.type) {
    case "hello": sendNow(); return;
    case "sync": void syncDevices().then(sendNow); return;
    case "reconnect": reconnectAll(); return;
    case "scan": if (r.on) void startScan(); else stopScan("idle"); return;
    case "provision": void provision(r.device, !!r.fresh); return;
    case "command":
      if (!getDevices().some((d) => d.id === r.device)) { log("warn", "proxy: command for an unknown device", { device: r.device }); return; }
      hub.send(r.device, r.command).catch((err) => log("info", "proxy: command not sent", { device: r.device, op: r.command.op, error: err }));
  }
}

/** Everything on the channel: requests (acted on only while this phone is the proxy) and other phones' reports. */
onChannel(HARDWARE_CHANNEL, (m) => {
  if (m.type === "state") {
    // Another phone's state: shown here while this one is not the proxy.
    if (!running) { remote = m as unknown as HardwareState; changed(); }
    return;
  }
  if (m.type === "scan.state") { if (!running) { scanState = m as unknown as HardwareScan; changed(); } return; }
  if (m.type === "provision.state") { if (!running) { provisionState = m as unknown as HardwareProvision; changed(); } return; }
  if (!running) return;
  const r = parseHardwareRequest(m);
  if (!r) { log("warn", "proxy: request refused", { type: m.type }); return; }
  handle(r);
});

/* ---------- Pairing: a scan for nearby devices, and the mesh provisioning. ---------- */

/** How long one scan runs; lights advertise every second or so. */
const SCAN_MS = 10_000;
let scanStop: (() => void) | null = null;
let scanFound: ScannedDevice[] = [];
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let scanLast = 0;

function sendScan(phase: HardwareScan["phase"], message?: string) {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  scanLast = Date.now();
  // Likely devices first, then by signal.
  const found = [...scanFound].sort((a, b) => Number(b.kinds.length > 0) - Number(a.kinds.length > 0) || (b.rssi ?? -999) - (a.rssi ?? -999));
  report({ type: "scan.state", phase, ...(message ? { message } : {}), found });
}
function stopScan(phase: "idle" | "done") { scanStop?.(); scanStop = null; sendScan(phase); }

async function startScan() {
  scanStop?.();
  scanFound = [];
  sendScan("scanning");
  if (!(await askBluetooth())) { sendScan("error", "Bluetooth permission denied on the phone: allow “Nearby devices” for OpenClapper."); return; }
  const adapter = await adapterState().catch(() => "unknown" as const);
  if (adapter !== "on") { sendScan("error", adapter === "off" ? "Bluetooth is off on the phone." : `Bluetooth is not available on the phone (${adapter}).`); return; }
  log("info", "proxy: scan started");
  const end = setTimeout(() => stopScan("done"), SCAN_MS);
  const halt = scan(
    (d) => {
      const kinds = suggestKinds(d);
      if (!d.name && !kinds.length) return;
      const old = scanFound.find((x) => x.address === d.address);
      const next: ScannedDevice = { address: d.address, name: d.name ?? old?.name ?? null, rssi: d.rssi ?? old?.rssi ?? null, kinds: kinds.length ? kinds : old?.kinds ?? [] };
      scanFound = old ? scanFound.map((x) => (x.address === d.address ? next : x)) : [...scanFound, next];
      // At most every 300 ms: advertisements arrive many times a second.
      if (!scanTimer) scanTimer = setTimeout(() => sendScan("scanning"), Math.max(0, scanLast + 300 - Date.now()));
    },
    (e) => { log("warn", "proxy: scan failed", e); scanStop?.(); scanStop = null; sendScan("error", `Scan failed: ${e instanceof Error ? e.message : String(e)}`); },
  );
  scanStop = () => { clearTimeout(end); halt(); };
}

let provisioning = false;
/** Pairs a mesh light into the phone's network (or runs its setup again). The light needs the radio to itself, so every connection is let go meanwhile. */
async function provision(deviceId: string, fresh: boolean) {
  const state = (s: Omit<HardwareProvision, "type" | "device">) => report({ type: "provision.state", device: deviceId, ...s });
  if (provisioning) { state({ phase: "error", stage: null, resume: false, error: "Another light is being paired; wait for it." }); return; }
  // The light's place in the network is stored on the server as it is paired: without it the address could be handed out twice.
  if (!canCall()) { state({ phase: "error", stage: null, resume: false, error: "Pairing needs a connection to the server." }); return; }
  provisioning = true;
  await syncDevices();
  const f = getFixtures().find((x) => x.id === deviceId);
  const resume = !!f?.mesh && !fresh;
  if (!f) { provisioning = false; state({ phase: "error", stage: null, resume, error: "The phone does not know this light yet; try again." }); return; }
  pause();
  let stage: HardwareProvision["stage"] = null;
  try {
    state({ phase: "running", stage, resume });
    await provisionFixture(f, (s) => { stage = s; state({ phase: "running", stage: s, resume }); }, { fresh });
    state({ phase: "done", stage, resume });
  } catch (e) {
    log("warn", "proxy: pairing failed", { device: deviceId, error: e });
    state({ phase: "error", stage, resume, error: e instanceof Error ? e.message : String(e) });
  } finally {
    provisioning = false;
    resumeLeases();
  }
}

/** Reconnect all: drops every connection and connects again, one by one; not while a pairing has the radio. */
export function reconnectAll() {
  if (!running || paused) return;
  hub.reconnectAll();
}

/** Holds every awake device until stopped; a change of the device list re-leases. */
export function startProxy(): () => void {
  if (running) return stopProxy;
  running = true;
  remote = null;
  watchAppState();
  lease();
  stopFns = [
    () => { release?.(); release = null; },
    onDevicesChange(() => { if (!paused) lease(); soon(); }),
    hub.subscribe(soon),
    onLinkOpen(sendNow),
  ];
  log("info", "proxy on", { devices: getDevices().length });
  sendNow();
  return stopProxy;
}

export function stopProxy() {
  if (!running) return;
  running = false;
  for (const fn of stopFns) fn();
  stopFns = [];
  scanStop?.(); scanStop = null;
  if (timer) { clearTimeout(timer); timer = null; }
  log("info", "proxy off");
  sendNow(); // tells the others: proxy off
}

/** Asks whichever phone is the proxy for its state (a screen just opened). */
export const hello = () => { if (!running) sendLink({ ch: HARDWARE_CHANNEL, type: "hello" }); };
