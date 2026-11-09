import { parseLightCommand, type FixtureLive, type ProvisionState, type ProxyState, type ScannedDevice, type ScanState } from "@openclapper/vocab";
import { adapterState, scan } from "../ble/link";
import { askBluetooth } from "../ble/permissions";
import { deviceId, deviceModel } from "../device";
import { log } from "../log";
import { onLinkClosed, onLinkMessage, onLinkOpen, sendOnLink } from "../preview";
import { hub, watchAppState } from "./hub";
import { getFixtures, onFixturesChange, syncFixtures } from "./library";
import { provisionFixture } from "./provisionFlow";
import { suggestKinds } from "./registry";

/**
 * The phone as the lights' proxy (#307): while on (the Proxy screen is open, screen awake), it holds
 * every paired fixture and runs what the Studio sends over the phone room's socket; it reports every
 * fixture's link, state and telemetry back, at most every STATE_EVERY_MS.
 */
const STATE_EVERY_MS = 200;

let running = false;
let release: (() => void) | null = null;
let paused = false;
/** (Re)takes a lease on every paired fixture, letting go of the previous one after. */
/** Sleeping devices are left out (#318): no connection attempts crowding the phone's Bluetooth. */
function lease() { const prev = release; release = hub.acquire(getFixtures().filter((f) => !f.asleep).map((f) => f.id), "proxy"); prev?.(); }
function pause() { paused = true; release?.(); release = null; }
function resumeLeases() { paused = false; if (running) lease(); }
let stopFns: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = 0;
/** Studio tabs open on the account, as the room last said (null: not heard yet, or the link is down). */
let studios: number | null = null;
export const studioTabs = () => studios;
const listeners = new Set<() => void>();

export const proxyRunning = () => running;
/** The Proxy screen re-renders on start, stop and every report. */
export function onProxyChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
const changed = () => { for (const cb of listeners) cb(); };

export function proxySnapshot(): ProxyState {
  const fixtures: FixtureLive[] = running ? getFixtures().map((f) => ({ id: f.id, ...hub.status(f.id), asleep: !!f.asleep })) : [];
  return { type: "lights.state", phone: { id: deviceId(), model: deviceModel() }, proxy: running, fixtures };
}

function sendNow() {
  timer = null;
  lastSent = Date.now();
  sendOnLink(proxySnapshot());
  changed();
}

/** Coalesces bursts (a slider drag on the Studio): one report now, then at most one per STATE_EVERY_MS. */
function report() {
  if (timer) return;
  const wait = Math.max(0, lastSent + STATE_EVERY_MS - Date.now());
  timer = setTimeout(sendNow, wait);
}

function onMessage(m: { type: string } & Record<string, unknown>) {
  if (m.type === "lights.studios") { studios = typeof m.count === "number" ? m.count : null; changed(); return; }
  if (!running) return;
  if (m.type === "lights.hello") { sendNow(); return; }
  if (m.type === "lights.sync") { void syncFixtures().then(sendNow); return; }
  if (m.type === "lights.reconnect") { reconnectAll(); return; }
  if (m.type === "lights.scan") { if (m.on === true) void startScan(); else stopScan("idle"); return; }
  if (m.type === "lights.provision") { if (typeof m.fixtureId === "string") void provision(m.fixtureId, m.fresh === true); return; }
  if (m.type !== "lights.command") return;
  const id = typeof m.fixtureId === "string" ? m.fixtureId : null;
  const cmd = parseLightCommand(m.command);
  if (!id || !cmd || !getFixtures().some((f) => f.id === id)) {
    log("warn", "proxy: command refused", { fixture: id, command: m.command });
    return;
  }
  hub.send(id, cmd).catch((err) => log("info", "proxy: command not sent", { fixture: id, op: cmd.op, error: err }));
}

// ---------------------------------------------------------------- pairing from the Studio (#307)

/** How long one scan runs; lights advertise every second or so. */
const SCAN_MS = 10_000;
let scanStop: (() => void) | null = null;
let scanFound: ScannedDevice[] = [];
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let scanLast = 0;

function sendScan(phase: ScanState["phase"], message?: string) {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  scanLast = Date.now();
  // Likely fixtures first, then by signal.
  const found = [...scanFound].sort((a, b) => Number(b.kinds.length > 0) - Number(a.kinds.length > 0) || (b.rssi ?? -999) - (a.rssi ?? -999));
  sendOnLink({ type: "lights.scan.state", phase, message, found } satisfies ScanState);
}

function stopScan(phase: "idle" | "done") {
  scanStop?.();
  scanStop = null;
  sendScan(phase);
}

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

/**
 * Pairs a mesh fixture the Studio created (or runs its setup again). The light needs the radio to
 * itself, so the proxy lets go of every connection meanwhile and takes them back after.
 */
async function provision(fixtureId: string, fresh: boolean) {
  const state = (s: Omit<ProvisionState, "type" | "fixtureId">) => sendOnLink({ type: "lights.provision.state", fixtureId, ...s } satisfies ProvisionState);
  if (provisioning) { state({ phase: "error", stage: null, resume: false, error: "Another light is being paired; wait for it." }); return; }
  provisioning = true;
  await syncFixtures();
  const f = getFixtures().find((x) => x.id === fixtureId);
  const resume = !!f?.mesh && !fresh;
  if (!f) { provisioning = false; state({ phase: "error", stage: null, resume, error: "The phone does not know this light yet; try again." }); return; }
  pause();
  let stage: ProvisionState["stage"] = null;
  try {
    state({ phase: "running", stage, resume });
    await provisionFixture(f, (s) => { stage = s; state({ phase: "running", stage: s, resume }); }, { fresh });
    state({ phase: "done", stage, resume });
  } catch (e) {
    log("warn", "proxy: pairing failed", { fixture: fixtureId, error: e });
    state({ phase: "error", stage, resume, error: e instanceof Error ? e.message : String(e) });
  } finally {
    provisioning = false;
    resumeLeases();
  }
}

/** Reconnect all (#318), from the Studio or the Proxy screen; not while a pairing has the radio. */
export function reconnectAll() {
  if (!running || paused) return;
  hub.reconnectAll();
}

/** Holds every paired fixture until stopped; a new pairing or a removed one re-leases. */
export function startProxy(): () => void {
  if (running) return stopProxy;
  running = true;
  watchAppState();
  lease();
  stopFns = [
    () => { release?.(); release = null; },
    onFixturesChange(() => { if (!paused) lease(); report(); }),
    hub.subscribe(report),
    onLinkMessage(onMessage),
    onLinkOpen(sendNow),
    onLinkClosed(() => { studios = null; changed(); }),
  ];
  log("info", "proxy on", { fixtures: getFixtures().length });
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
  sendNow(); // tells the Studio: proxy off
}
