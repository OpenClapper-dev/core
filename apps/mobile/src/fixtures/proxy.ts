import { parseLightCommand, type FixtureLive, type ProxyState } from "@openclapper/vocab";
import { deviceId, deviceModel } from "../device";
import { log } from "../log";
import { onLinkClosed, onLinkMessage, onLinkOpen, sendOnLink } from "../preview";
import { hub, watchAppState } from "./hub";
import { getFixtures, onFixturesChange } from "./library";

/**
 * The phone as the lights' proxy (#307): while on (the Proxy screen is open, screen awake), it holds
 * every paired fixture and runs what the Studio sends over the phone room's socket; it reports every
 * fixture's link, state and telemetry back, at most every STATE_EVERY_MS.
 */
const STATE_EVERY_MS = 200;

let running = false;
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
  const fixtures: FixtureLive[] = running ? getFixtures().map((f) => ({ id: f.id, ...hub.status(f.id) })) : [];
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
  if (m.type !== "lights.command") return;
  const id = typeof m.fixtureId === "string" ? m.fixtureId : null;
  const cmd = parseLightCommand(m.command);
  if (!id || !cmd || !getFixtures().some((f) => f.id === id)) {
    log("warn", "proxy: command refused", { fixture: id, command: m.command });
    return;
  }
  hub.send(id, cmd).catch((err) => log("info", "proxy: command not sent", { fixture: id, op: cmd.op, error: err }));
}

/** Holds every paired fixture until stopped; a new pairing or a removed one re-leases. */
export function startProxy(): () => void {
  if (running) return stopProxy;
  running = true;
  watchAppState();
  let release = hub.acquire(getFixtures().map((f) => f.id), "proxy");
  stopFns = [
    () => release(),
    onFixturesChange(() => { const prev = release; release = hub.acquire(getFixtures().map((f) => f.id), "proxy"); prev(); report(); }),
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
  if (timer) { clearTimeout(timer); timer = null; }
  log("info", "proxy off");
  sendNow(); // tells the Studio: proxy off
}
