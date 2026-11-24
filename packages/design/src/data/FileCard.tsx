import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { Spinner } from "../feedback/Spinner";
import { cx } from "../util";

/** How a collection's colour is drawn on its photos and its tile: a personal preference. */
export type CollectionMark = "bar" | "barleft" | "dot" | "frame";
/** Where a file's upload stands: queued, usable (the preview is there), or refused and waiting for a retry. */
export type UploadState = "waiting" | "preview" | "stuck";

const UPLOAD: Record<UploadState, { label: string; icon?: "cloud-upload" | "warning" }> = {
  waiting: { label: "Waiting to upload" },
  preview: { label: "Preview uploaded, the original follows", icon: "cloud-upload" },
  stuck: { label: "Upload stuck: it will be tried again", icon: "warning" },
};

/** The small badge on a picture that says how its upload stands. */
export function UploadBadge({ state, className, ...rest }: { state: UploadState } & JSX.HTMLAttributes<HTMLSpanElement>) {
  const u = UPLOAD[state];
  return <span role="img" aria-label={u.label} title={u.label} className={cx("oc-upload", `oc-upload--${state}`, className)} {...rest}>{u.icon ? <Icon name={u.icon} size={12} /> : <Spinner size={10} />}</span>;
}

/**
 * A file as a card in a grid: its picture or its type icon, its name and a line of facts. Clicking
 * and ticking are two things: a click makes the card the current one, the circle in its corner
 * ticks it for acting on several. The circle shows on hover, and on every card of a grid that has
 * ticks (`FileGrid` with `ticking`).
 *
 * A collection is a **stack** (`stack`: its pictures' sources): moving the pointer across it shows
 * each in turn under a line, with "n / count" in the corner, as on clips in an editor. A photo of a
 * collection, and the collection itself, carry the collection's colour (`tint`) as a `mark`.
 */
export interface FileCardProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "name" | "selected"> {
  name: string;
  meta?: ComponentChildren;
  /** The picture, or the file type's icon. */
  art: ComponentChildren;
  /** Art that is a picture gets the dark stage behind it; an icon the sunken surface. */
  picture?: boolean;
  /** A small mark over the art's corner (the type icon over a picture, a shortcut's arrow). */
  badge?: ComponentChildren;
  /** Ticked. */
  selected?: boolean;
  /** The current file: outlined. */
  current?: boolean;
  /** Something is dragged over it and may be dropped. */
  dropTarget?: boolean;
  onTick?: () => void;
  onOpen?: () => void;
  /** A collection: the pictures to scrub through (image sources, in order) and how many it holds. */
  stack?: { srcs: string[]; count: number };
  /** The collection's colour (any CSS colour) and how it is drawn. */
  tint?: string;
  mark?: CollectionMark;
  /** How the file's upload stands; absent when it is stored. */
  upload?: UploadState;
}

export function FileCard({ name, meta, art, picture, badge, selected, current, dropTarget, onTick, onOpen, stack, tint, mark = "bar", upload, className, style, ...rest }: FileCardProps) {
  const [scrub, setScrub] = useState<{ i: number; x: number } | null>(null);
  const move = (e: JSX.TargetedMouseEvent<HTMLSpanElement>) => {
    if (!stack || stack.srcs.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect(), x = Math.min(Math.max(e.clientX - r.left, 0), r.width - 1);
    setScrub({ i: Math.floor((x / r.width) * stack.srcs.length), x });
  };
  const shown = scrub && stack ? <img src={stack.srcs[scrub.i]} alt="" draggable={false} /> : art;
  return (
    <div role="option" tabIndex={0} aria-selected={!!selected}
      className={cx("oc-filecard", selected && "is-selected", current && "is-current", dropTarget && "is-drop", stack && "is-stack", tint && `oc-filecard--${mark}`, className)}
      style={tint ? { ...(typeof style === "object" ? style : {}), "--oc-coll": tint } : style} onDblClick={onOpen} {...rest}>
      <span className={cx("oc-filecard__art", picture && "oc-filecard__art--picture")} onMouseMove={move} onMouseLeave={() => setScrub(null)}>
        {shown}
        {badge && !scrub && <span className="oc-filecard__badge">{badge}</span>}
        {stack && <span className="oc-filecard__count">{scrub ? `${scrub.i + 1} / ${stack.count}` : stack.count}</span>}
        {scrub && <span className="oc-filecard__scrub" style={{ left: scrub.x }} />}
        {upload && <UploadBadge state={upload} className="oc-filecard__upload" />}
        {onTick && (
          <span role="checkbox" aria-checked={!!selected} aria-label={`Select ${name}`} tabIndex={0} className={cx("oc-filecard__tick", selected && "is-on")}
            onClick={(e) => { e.stopPropagation(); onTick(); }} onDblClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onTick(); } }}>
            {selected && <Icon name="check" size={12} />}
          </span>
        )}
      </span>
      <span className="oc-filecard__name" title={name}>{tint && mark === "dot" && <i className="oc-filecard__dot" />}{name}</span>
      {meta != null && <span className="oc-filecard__meta">{meta}</span>}
    </div>
  );
}

/** The grid that holds file cards. `ticking` shows every card's tick circle (something is ticked). */
export interface FileGridProps extends JSX.HTMLAttributes<HTMLDivElement> {
  ticking?: boolean;
  children?: ComponentChildren;
}

export function FileGrid({ ticking, children, className, ...rest }: FileGridProps) {
  return <div role="listbox" aria-multiselectable="true" className={cx("oc-filegrid", ticking && "is-ticking", className)} {...rest}>{children}</div>;
}

/** A collection's colour where it is named in a list or a property: a dot and the name. */
export function CollectionTag({ tint, children }: { tint: string; children?: ComponentChildren }) {
  return <span className="oc-colltag"><i style={{ background: tint }} />{children}</span>;
}
