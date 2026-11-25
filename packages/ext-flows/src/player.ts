import { controlCommand, fixtureKind, modelOf, type LightCommand, type Value } from "@openclapper/ext-hardware";
import { commandsFor, inFade, nativeStep, sampleControls, sampleTrack, FLOW_TICK_MS, type Flow, type SequenceSample } from "./flow.ts";

/**
 * Playing a flow (docs/features/flows.md; #304, shared since #321): the Studio's preview through the proxy and the
 * phone's own run use this one implementation, so a flow plays the same wherever it runs.
 */

export type SendLight = (device: string, cmd: LightCommand) => void;

/**
 * Samples every assigned, unmuted track at t and sends the difference to what its light last got.
 * While playing, a light that fades by itself gets one native fade per tile and nothing in between;
 * a light with switchable smoothing (NEEWER) jumps at keyframes and smooths inside fades.
 */
export class FlowEmitter {
  private sent = new Map<string, SequenceSample | null>();
  private fadeKeys = new Map<string, string | null>();
  private smoothSent = new Map<string, boolean>();
  private controlsSent = new Map<string, Record<string, Value>>();

  /** Forget what was sent: the next emit sends every value again. `smoothing` too unless false (a loop keeps it). */
  reset(smoothing = true) {
    this.sent.clear();
    this.fadeKeys.clear();
    this.controlsSent.clear();
    if (smoothing) this.smoothSent.clear();
  }

  emit(seq: Flow, t: number, playback: boolean, send: SendLight) {
    for (const tr of seq.tracks) {
      if (!tr.device || tr.muted) continue;
      const model = modelOf(tr.model);
      if (model?.type === "camera") {
        // A camera track: the controls its keyframes hold, sent when they change (they jump). Recording starts and
        // stops only while the flow plays: scrubbing with Live on must not start a take.
        const now = sampleControls(tr.keyframes, t), before = this.controlsSent.get(tr.id) ?? {};
        if (!playback) { delete now.record; if ("record" in before) now.record = before.record; }
        for (const [id, v] of Object.entries(now)) {
          if (before[id] === v) continue;
          const c = model.controls.find((x) => x.id === id);
          const cmd = c && controlCommand(model, c, v, undefined);
          if (cmd) send(tr.device, cmd);
        }
        this.controlsSent.set(tr.id, now);
        continue;
      }
      const caps = fixtureKind(tr.model)?.caps;
      const prev = this.sent.get(tr.id) ?? null;
      const step = playback && caps?.fade
        ? nativeStep(tr.keyframes, t, prev, this.fadeKeys.get(tr.id) ?? null)
        : { ...commandsFor(prev, sampleTrack(tr.keyframes, t)), key: null };
      if (caps?.smoothing) {
        const smooth = !playback || inFade(tr.keyframes, t);
        if (this.smoothSent.get(tr.id) !== smooth) { this.smoothSent.set(tr.id, smooth); send(tr.device, { op: "smooth", on: smooth }); }
      }
      this.sent.set(tr.id, step.sent);
      this.fadeKeys.set(tr.id, step.key);
      for (const c of step.commands) send(tr.device, c);
    }
  }
}

export interface PlayerClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

/**
 * Plays a sequence from a position on a clock: a tick every FLOW_TICK_MS; at the end it loops
 * (sending everything again) or stops after sending the last state. `sequence` is read on every tick,
 * so the Studio's edits while playing take effect at once.
 */
export class FlowPlayer {
  readonly emitter = new FlowEmitter();
  private timer: unknown = null;
  private running = false;
  private start = 0;

  private readonly sequence: () => Flow | null;
  private readonly send: SendLight;
  private readonly clock: PlayerClock;
  private readonly on: { tick?: (t: number) => void; end?: (t: number) => void };

  constructor(sequence: () => Flow | null, send: SendLight, clock: PlayerClock, on: { tick?: (t: number) => void; end?: (t: number) => void } = {}) {
    this.sequence = sequence;
    this.send = send;
    this.clock = clock;
    this.on = on;
  }

  get playing() { return this.running; }

  /** Where it is now, in ms from the start of the sequence (0 when stopped). */
  position(): number {
    const s = this.sequence();
    if (!this.playing || !s) return 0;
    return Math.min(s.durationMs, this.clock.now() - this.start);
  }

  play(fromMs: number) {
    this.stop();
    this.emitter.reset();
    this.start = this.clock.now() - fromMs;
    this.running = true;
    this.tick();
    if (this.running) this.timer = this.clock.setInterval(() => this.tick(), FLOW_TICK_MS);
  }

  stop() {
    if (this.timer != null) this.clock.clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  private tick() {
    const s = this.sequence();
    if (!s) { this.stop(); return; }
    let t = this.clock.now() - this.start;
    if (t >= s.durationMs) {
      if (s.loop && s.durationMs > 0) {
        const n = Math.floor(t / s.durationMs);
        this.start += n * s.durationMs;
        t -= n * s.durationMs;
        this.emitter.reset(false);
      } else {
        this.emitter.emit(s, s.durationMs, true, this.send);
        this.stop();
        this.on.end?.(s.durationMs);
        return;
      }
    }
    this.emitter.emit(s, t, true, this.send);
    this.on.tick?.(t);
  }
}
