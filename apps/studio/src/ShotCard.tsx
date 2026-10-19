import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { label, lightLabel } from "@fielder/vocab";
import type { Shot } from "./api";
import { cover, placeLabel, rigLabel, shotTitle } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { cx, ProjectTag, SeqBadge, StateMarker } from "@fielder/ui";

/** "Place · INT · Dusk / Night", falling back to the rig for untagged shots. */
export const shotSub = (s: Shot) => [placeLabel(s) || rigLabel(cover(s)), label(s.int_ext).toUpperCase(), lightLabel(s.light, s.artificial)].filter(Boolean).join(" · ");

/**
 * A card's cover. On a sequence the mouse scrubs it (issue #39, like Resolve's hover scrub): the
 * pointer's x picks the photo (n equal zones, left = first), a red line marks it, leaving shows the
 * cover again. The photos are preloaded on the first move, so the scrub does not flash.
 * `badges` gets the scrubbed photo's index (null when not scrubbing).
 */
export function ScrubCover({ shot, mask, badges }: { shot: Shot; mask: MaskMode; badges?: (i: number | null) => ComponentChildren }) {
  const [at, setAt] = useState<{ i: number; x: number } | null>(null);
  const preloaded = useRef(false);
  const n = shot.photos.length;
  const onMove = (e: PointerEvent) => {
    if (n < 2 || e.pointerType !== "mouse") return;
    if (!preloaded.current) { preloaded.current = true; for (const p of shot.photos) new Image().src = p.image_url; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = Math.min(0.9999, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.floor(fx * n);
    setAt((cur) => (cur && cur.i === i && Math.abs(cur.x - fx * 100) < 0.5 ? cur : { i, x: fx * 100 }));
  };
  return (
    <div class={cx("f-card__img", n > 1 && "scrub")} onPointerMove={onMove} onPointerLeave={() => setAt(null)}>
      <Framed photo={at ? shot.photos[at.i] : cover(shot)} mode={mask} />
      {at && <span class="scrub__line" style={{ left: `${at.x}%` }} />}
      {badges?.(at?.i ?? null)}
    </div>
  );
}

/** SEQ · n, and "3 / 7" next to it while the card is scrubbed. */
export function SeqBadges({ count, at }: { count: number; at: number | null }) {
  if (count < 2) return null;
  return <div class="f-card__tl"><SeqBadge count={count} />{at !== null && <span class="f-seq num">{at + 1} / {count}</span>}</div>;
}

/** Gallery card: SEQ badge top left, state marker top right, title, place line, project tag when browsing all projects. */
export function ShotCard({ shot, mask, project, focused, onClick, onFocus }: { shot: Shot; mask: MaskMode; project?: string | null; focused?: boolean; onClick: () => void; onFocus?: () => void }) {
  return (
    <button type="button" class={cx("f-card", focused && "is-focus")} role="gridcell" tabIndex={focused ? 0 : -1} data-shot={shot.id} onClick={onClick} onFocus={onFocus}>
      <ScrubCover shot={shot} mask={mask} badges={(at) => (
        <>
          <SeqBadges count={shot.photos.length} at={at} />
          <div class="f-card__tr"><StateMarker state={shot.state} iconOnly /></div>
        </>
      )} />
      <div class="f-card__body">
        <span class="f-card__title">{shotTitle(shot)}</span>
        <span class="f-card__sub">{shotSub(shot)}</span>
        {project && <ProjectTag icon="folder-outline" style={{ alignSelf: "flex-start" }} title={`Project: ${project}`}>{project}</ProjectTag>}
      </div>
    </button>
  );
}
