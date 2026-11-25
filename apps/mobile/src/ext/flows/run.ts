import { useEffect, useState } from "react";
import { FLOWS_CHANNEL, FlowPlayer, parseFlowRequest, RUN_REPORT_MS, type Flow, type FlowBody, type FlowRequest, type RunState } from "@openclapper/ext-flows";
import { getFile } from "../../api";
import { onChannel, onLinkOpen, sendLink } from "../../link";
import { log } from "../../log";
import { hub } from "../hardware/hub";
import { onLetGo, proxyRunning } from "../hardware/proxy";

/**
 * A flow running on the phone itself (docs/features/flows.md, "Running on the phone"; #321): a client names a flow and
 * the revision it saved; the proxy phone fetches exactly that and plays it on its own clock through its own
 * connections, with the same player as the Studio. It keeps playing when the Studio goes away; it stops when the
 * proxy lets go of its connections (switched off, or a pairing takes the radio).
 */
const FETCH_TRIES = 4;
const FETCH_GAP_MS = 400;

let flow: Flow | null = null;
let state: RunState = { type: "state", phase: "idle", flow: null, atMs: 0 };
let reportTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by every run and stop: a fetch that finishes after it was superseded is dropped. */
let gen = 0;
/** The run of another phone that is the proxy, as it reports it (this phone is not). */
let remote: RunState | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const cb of listeners) cb(); };

const player = new FlowPlayer(
  () => flow,
  (id, cmd) => { hub.send(id, cmd).catch((e) => log("debug", "run: command not sent", { device: id, op: cmd.op, error: e })); },
  { now: () => Date.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) },
  { end: (t) => { set({ phase: "idle", atMs: t }); log("info", "run: finished", { flow: flow?.id }); } },
);

/** This phone's run now, with its position while playing. */
export const runState = (): RunState => (state.phase === "playing" ? { ...state, atMs: player.position() } : state);
const report = () => { sendLink({ ch: FLOWS_CHANNEL, ...runState() }); changed(); };
function set(patch: Partial<RunState>) {
  state = { ...state, ...patch };
  if (state.phase === "playing" && !reportTimer) reportTimer = setInterval(report, RUN_REPORT_MS);
  if (state.phase !== "playing" && reportTimer) { clearInterval(reportTimer); reportTimer = null; }
  report();
}

async function run(id: string, revision: string, fromMs: number) {
  const mine = ++gen;
  player.stop();
  set({ phase: "loading", flow: id, revision, atMs: fromMs, error: undefined, name: undefined });
  let got: Flow | null = null;
  try {
    for (let i = 0; i < FETCH_TRIES && !got; i++) {
      if (i) await new Promise((r) => setTimeout(r, FETCH_GAP_MS));
      const f = await getFile(id);
      if (f.updated_at === revision && f.type === "flow") got = { id: f.id, name: f.name, updatedAt: f.updated_at, ...(f.body as unknown as FlowBody) };
    }
  } catch (e) {
    if (mine !== gen) return;
    log("warn", "run: flow not fetched", { flow: id, error: e });
    set({ phase: "error", error: `The phone could not fetch the flow: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (mine !== gen) return;
  if (!got) { set({ phase: "error", error: "The phone got another version of the flow than was saved; try again." }); return; }
  flow = got;
  const from = Math.min(Math.max(0, fromMs), got.durationMs);
  log("info", "run: playing", { flow: got.id, revision, from });
  set({ phase: "playing", name: got.name, durationMs: got.durationMs, loop: got.loop, atMs: from });
  player.play(from);
}

function stop() {
  gen++;
  if (state.phase === "idle" && !player.playing) return;
  const at = player.position();
  player.stop();
  log("info", "run: stopped", { flow: state.flow, at });
  set({ phase: "idle", atMs: at, error: undefined });
}

function handle(r: FlowRequest) {
  if (r.type === "hello") report();
  else if (r.type === "stop") stop();
  else void run(r.flow, r.revision, r.fromMs);
}

/** A request from this phone's screens: run here when this phone is the proxy, else sent to the one that is. */
export function request(r: FlowRequest) {
  if (proxyRunning()) handle(r);
  else sendLink({ ch: FLOWS_CHANNEL, ...r });
}

onChannel(FLOWS_CHANNEL, (m) => {
  if (m.type === "state") { if (!proxyRunning()) { remote = m as unknown as RunState; changed(); } return; }
  if (!proxyRunning()) return;
  const r = parseFlowRequest(m);
  if (r) handle(r); else log("warn", "run: request refused", { type: m.type });
});
onLinkOpen(() => { if (proxyRunning()) report(); });
// The run needs the proxy's connections (and its screen kept on).
onLetGo(() => stop());

/** The run to show: this phone's when it is the proxy, else the proxy phone's as it reports it. */
export function useRun(): RunState | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const cb = () => tick((n) => n + 1);
    listeners.add(cb);
    if (!proxyRunning()) sendLink({ ch: FLOWS_CHANNEL, type: "hello" });
    // The position moves between reports.
    const h = setInterval(cb, 250);
    return () => { listeners.delete(cb); clearInterval(h); };
  }, []);
  return proxyRunning() ? runState() : remote;
}
