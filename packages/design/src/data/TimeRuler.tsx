import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { cx } from "../util";

/** Seconds between labelled ticks, from fine to coarse; the first that leaves 64 px between labels is taken. */
const MAJORS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
/** How many parts a major step is cut into by unlabelled ticks. */
const DIVS: Record<number, number> = { 0.1: 2, 0.2: 2, 0.5: 5, 1: 10, 2: 4, 5: 5, 10: 5, 15: 3, 30: 6, 60: 6, 120: 4, 300: 5, 600: 6, 1200: 4 };

/** A time on a ruler: "0:05" from whole seconds, "0:00.5" below them. */
export function rulerLabel(s: number, fine: boolean): string {
  const t = Math.max(0, s), m = Math.floor(t / 60), r = t - m * 60;
  return fine ? `${m}:${r.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.round(r)).padStart(2, "0")}`;
}

/** The ticks of a ruler `seconds` long at `scale` px a second: labelled majors 64 px apart or more, minors between. */
export function rulerTicks(seconds: number, scale: number): { s: number; major: boolean; half: boolean }[] {
  const major = MAJORS.find((m) => m * scale >= 64) ?? MAJORS[MAJORS.length - 1];
  let minor = major / DIVS[major];
  if (minor * scale < 7) minor = major / 2;
  const n = Math.floor(seconds / minor + 1e-6), out: { s: number; major: boolean; half: boolean }[] = [];
  const on = (s: number, step: number) => Math.abs(s / step - Math.round(s / step)) < 1e-6;
  for (let k = 0; k <= n; k++) { const s = k * minor; out.push({ s, major: on(s, major), half: on(s, major / 2) }); }
  return out;
}

/**
 * Seeking by pointer on a time scale: a press on the ruler (or the playhead's knob) seeks, dragging scrubs.
 * `ref` goes on the ruler; time 0 is its left edge plus `pad`.
 */
export function useTimeScrub(scale: number, onSeek: (ms: number) => void, pad = 0): { ref: RefObject<HTMLDivElement>; start: (e: JSX.TargetedPointerEvent<HTMLElement>) => void } {
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ scale, onSeek, pad });
  live.current = { scale, onSeek, pad };
  const start = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !ref.current) return;
    e.preventDefault(); e.stopPropagation();
    const to = (x: number) => { const r = ref.current?.getBoundingClientRect(); if (r) live.current.onSeek(Math.max(0, ((x - r.left - live.current.pad) / live.current.scale) * 1000)); };
    to(e.clientX);
    const move = (m: PointerEvent) => to(m.clientX);
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  return { ref, start };
}

export interface TimeRulerProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "ref"> {
  /** px per second. */
  scale: number;
  /** How many seconds the ruler shows. */
  seconds: number;
  /** px before time 0. */
  pad?: number;
  /** From `useTimeScrub`: press to seek, drag to scrub. */
  scrub?: ReturnType<typeof useTimeScrub>;
}

/** A time ruler over lanes: labelled major ticks and minor ones, chosen for the zoom (Timeline, progressions). */
export function TimeRuler({ scale, seconds, pad = 0, scrub, className, ...rest }: TimeRulerProps) {
  const ticks = rulerTicks(seconds, scale), fine = ticks.some((t) => t.major && t.s % 1 > 1e-6);
  return (
    <div ref={scrub?.ref} className={cx("oc-ruler", className)} title="Click or drag to move the playhead" onPointerDown={scrub?.start} {...rest}>
      {ticks.map((t) => <span key={t.s} className={cx("oc-ruler__tick", t.major && "is-major", t.half && "is-half")} style={{ left: pad + t.s * scale }}>{t.major && <em>{rulerLabel(t.s, fine)}</em>}</span>)}
    </div>
  );
}

/** The playhead: a line down the lanes from a knob on the ruler that scrubs. `left` in px within the positioned lanes. */
export function Playhead({ left, scrub, className }: { left: number; scrub?: ReturnType<typeof useTimeScrub>; className?: string }) {
  return <i className={cx("oc-playhead", className)} style={{ left }}><b title="Drag to scrub" onPointerDown={scrub?.start} /></i>;
}
