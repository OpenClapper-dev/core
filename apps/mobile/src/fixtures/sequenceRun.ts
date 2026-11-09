import { RUN_REPORT_MS, SequencePlayer, type LightSequence, type RunState } from "@openclapper/vocab";
import { api } from "../api";
import { log } from "../log";
import { hub } from "./hub";

/**
 * A sequence running on the phone itself (#321): the Studio names a sequence and the revision it
 * just saved; the phone fetches exactly that, then plays it on its own clock through its own
 * connections (vocab/sequencePlayer.ts, the same player as the Studio's preview). No relay for the
 * commands. It keeps playing when the Studio goes away; the Proxy screen shows it and can stop it.
 */

/** The server may answer the previous revision for a moment after the Studio's save; asked again this often. */
const FETCH_TRIES = 4;
const FETCH_GAP_MS = 400;

let seq: LightSequence | null = null;
let state: RunState = { type: "lights.run.state", phase: "idle", sequenceId: null, atMs: 0 };
let reportTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by every run and stop: a fetch that finishes after it was superseded is dropped. */
let gen = 0;
const listeners = new Set<(s: RunState) => void>();

const player = new SequencePlayer(
  () => seq,
  (id, cmd) => { hub.send(id, cmd).catch((e) => log("debug", "run: command not sent", { fixture: id, op: cmd.op, error: e })); },
  { now: () => Date.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) },
  { end: (t) => { set({ phase: "idle", atMs: t }); log("info", "run: finished", { sequence: seq?.id }); } },
);

/** The run's state now, with the current position while playing. */
export function runState(): RunState {
  return state.phase === "playing" ? { ...state, atMs: player.position() } : state;
}

/** Called on every change of phase (the proxy reports it; the Proxy screen shows it). */
export function onRunChange(cb: (s: RunState) => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

function set(patch: Partial<RunState>) {
  state = { ...state, ...patch };
  if (state.phase === "playing" && !reportTimer) reportTimer = setInterval(() => { for (const cb of listeners) cb(runState()); }, RUN_REPORT_MS);
  if (state.phase !== "playing" && reportTimer) { clearInterval(reportTimer); reportTimer = null; }
  for (const cb of listeners) cb(runState());
}

export async function runSequence(sequenceId: string, revision: string, fromMs: number) {
  const mine = ++gen;
  player.stop();
  set({ phase: "loading", sequenceId, revision, atMs: fromMs, error: undefined, name: undefined });
  let got: LightSequence | null = null;
  try {
    for (let i = 0; i < FETCH_TRIES && !got; i++) {
      if (i) await new Promise((r) => setTimeout(r, FETCH_GAP_MS));
      const s = await api.getLightSequence(sequenceId);
      if (s.updatedAt === revision) got = s;
    }
  } catch (e) {
    if (mine !== gen) return;
    log("warn", "run: sequence not fetched", { sequence: sequenceId, error: e });
    set({ phase: "error", error: `The phone could not fetch the sequence: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (mine !== gen) return;
  if (!got) { set({ phase: "error", error: "The phone got another version of the sequence than the Studio saved; try again." }); return; }
  seq = got;
  const from = Math.min(Math.max(0, fromMs), got.durationMs);
  log("info", "run: playing", { sequence: got.id, revision, from });
  set({ phase: "playing", name: got.name, durationMs: got.durationMs, loop: got.loop, atMs: from });
  player.play(from);
}

export function stopRun() {
  gen++;
  if (state.phase === "idle" && !player.playing) return;
  const at = player.position();
  player.stop();
  log("info", "run: stopped", { sequence: state.sequenceId, at });
  set({ phase: "idle", atMs: at, error: undefined });
}
