import { fixtureKind } from "./lighting.ts";
import type { LightCommand } from "./lightProxy.ts";
import { commandsFor, inFade, nativeStep, sampleTrack, SEQUENCE_TICK_MS, type LightSequence, type SequenceSample } from "./lightSequence.ts";

/**
 * Playing a light sequence (#304, shared since #321): the Studio's preview through the proxy and the
 * phone's own run use this one implementation, so a sequence plays the same wherever it runs.
 */

export type SendLight = (fixtureId: string, cmd: LightCommand) => void;

/**
 * Samples every assigned, unmuted track at t and sends the difference to what its light last got.
 * While playing, a light that fades by itself gets one native fade per tile and nothing in between;
 * a light with switchable smoothing (NEEWER) jumps at keyframes and smooths inside fades.
 */
export class SequenceEmitter {
  private sent = new Map<string, SequenceSample | null>();
  private fadeKeys = new Map<string, string | null>();
  private smoothSent = new Map<string, boolean>();

  /** Forget what was sent: the next emit sends every value again. `smoothing` too unless false (a loop keeps it). */
  reset(smoothing = true) {
    this.sent.clear();
    this.fadeKeys.clear();
    if (smoothing) this.smoothSent.clear();
  }

  emit(seq: LightSequence, t: number, playback: boolean, send: SendLight) {
    for (const tr of seq.tracks) {
      if (!tr.fixtureId || tr.muted) continue;
      const caps = fixtureKind(tr.kindId)?.caps;
      const prev = this.sent.get(tr.id) ?? null;
      const step = playback && caps?.fade
        ? nativeStep(tr.keyframes, t, prev, this.fadeKeys.get(tr.id) ?? null)
        : { ...commandsFor(prev, sampleTrack(tr.keyframes, t)), key: null };
      if (caps?.smoothing) {
        const smooth = !playback || inFade(tr.keyframes, t);
        if (this.smoothSent.get(tr.id) !== smooth) { this.smoothSent.set(tr.id, smooth); send(tr.fixtureId, { op: "smooth", on: smooth }); }
      }
      this.sent.set(tr.id, step.sent);
      this.fadeKeys.set(tr.id, step.key);
      for (const c of step.commands) send(tr.fixtureId, c);
    }
  }
}

export interface PlayerClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

/**
 * Plays a sequence from a position on a clock: a tick every SEQUENCE_TICK_MS; at the end it loops
 * (sending everything again) or stops after sending the last state. `sequence` is read on every tick,
 * so the Studio's edits while playing take effect at once.
 */
export class SequencePlayer {
  readonly emitter = new SequenceEmitter();
  private timer: unknown = null;
  private running = false;
  private start = 0;

  private readonly sequence: () => LightSequence | null;
  private readonly send: SendLight;
  private readonly clock: PlayerClock;
  private readonly on: { tick?: (t: number) => void; end?: (t: number) => void };

  constructor(sequence: () => LightSequence | null, send: SendLight, clock: PlayerClock, on: { tick?: (t: number) => void; end?: (t: number) => void } = {}) {
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
    if (this.running) this.timer = this.clock.setInterval(() => this.tick(), SEQUENCE_TICK_MS);
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
