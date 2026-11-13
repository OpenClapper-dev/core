import { Fragment, type ComponentChildren, type JSX } from "preact";
import { cx } from "../util";

const fmt = (s: number) => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

/** Window template: horizontal lanes over time with a ruler, coloured items and a playhead. */
export interface TrackLayoutProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "selected" | "onSelect"> {
  toolbar?: ComponentChildren;
  lanes: {
    id: string;
    label: string;
    /** 1–8, categorical colour. */
    color?: number;
    items?: { id: string; start: number; end: number; label: string }[];
  }[];
  /** Seconds. */
  duration?: number;
  /** px per second. */
  scale?: number;
  /** Ruler label step, seconds. */
  tick?: number;
  playhead?: number;
  onSeek?: (t: number) => void;
  selected?: string;
  onSelect?: (id: string) => void;
  statusBar?: ComponentChildren;
}

export function TrackLayout({ toolbar, lanes = [], duration = 60, scale = 12, tick = 5, playhead = 0, onSeek, selected, onSelect, statusBar, className, ...rest }: TrackLayoutProps) {
  const width = duration * scale;
  const ticks: number[] = [];
  for (let s = 0; s <= duration; s += tick) ticks.push(s);
  const seek = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => { if (!onSeek) return; const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(duration, (e.clientX - r.left) / scale))); };
  return (
    <div className={cx("oc-app", className)} {...rest}>
      {toolbar}
      <div className="oc-tracks" style={{ gridTemplateRows: "var(--track-ruler-h)" }}>
        <div className="oc-tracks__corner" />
        <div className="oc-tracks__ruler" style={{ width }} onPointerDown={seek}>
          {ticks.map((s) => <span key={s} className="oc-tracks__tick" style={{ left: s * scale }}>{fmt(s)}</span>)}
          <span className="oc-tracks__playhead" style={{ left: playhead * scale, height: `calc(var(--track-ruler-h) + ${lanes.length} * var(--track-lane-h))` }} />
        </div>
        {lanes.map((l) => (
          <Fragment key={l.id}>
            <div className="oc-tracks__head"><span className="oc-tracks__swatch" style={{ background: `var(--cat-${l.color || 1})` }} />{l.label}</div>
            <div className="oc-tracks__lane" style={{ width }}>
              {(l.items || []).map((it) => (
                <button key={it.id} type="button" aria-pressed={selected === it.id} className={cx("oc-tracks__item", selected === it.id && "is-selected")}
                  style={{ left: it.start * scale, width: (it.end - it.start) * scale, color: `var(--cat-${l.color || 1})` }} onClick={() => onSelect && onSelect(it.id)}>
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      {statusBar}
    </div>
  );
}
