// A picture as the shot window shows it (docs/features/shots.md): the surface's image, through its frame in one
// of the view modes (Outline, Mask, Crop, Full), with the overlay stretched to the frame. Fills the nearest box
// with `container-type: size` (.sh-box); every thumbnail and the stage use it, so a frame looks the same everywhere.
import { AppIcon, Icon, colorCss, cx } from "@openclapper/design";
import { kindOf } from "../fileKinds";
import { beyond, type Mode, type Rect, type Seen } from "./picture";

const at = (r: Rect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

export function Pic({ seen, mode = "crop", overlay, label }: { seen: Seen; mode?: Mode; overlay?: string | null; label?: boolean }) {
  const { file, src, rect, inner } = seen;
  if (seen.missing) return <span className="sh-pic sh-pic--none"><Icon name="warning" size={20} /></span>;
  if (!src) { const k = file ? kindOf(file.type) : null; return <span className="sh-pic sh-pic--none">{k && <AppIcon glyph={k.glyph} color={k.color} size={40} />}</span>; }
  // An overlay not rendered yet (its first save is under way) shows nothing rather than a broken image.
  const over = overlay ? <img key={overlay} className="sh-pic__over" src={overlay} alt="" draggable={false} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : null;
  if (!rect) return <span className="sh-pic" style={{ "--a": seen.aspect }}><img src={src} alt="" draggable={false} />{over && <span className="sh-pic__overbox" style={{ inset: 0 }}>{over}</span>}</span>;
  const pic = inner ? { x: rect.x + (rect.w * (1 - inner.w)) / 2, y: rect.y + (rect.h * (1 - inner.h)) / 2, w: rect.w * inner.w, h: rect.h * inner.h } : rect;
  if (mode === "crop") {
    // Fitted to the frame: the surface is scaled so the frame fills the box; a delivery leaves its bars; beyond the surface is hatched.
    return (
      <span className={cx("sh-pic sh-pic--crop", beyond(seen) && "is-beyond")} style={{ "--a": (rect.w * seen.aspect) / rect.h }}>
        <img src={src} alt="" draggable={false} style={{ width: `${100 / rect.w}%`, height: `${100 / rect.h}%`, left: `${(-rect.x / rect.w) * 100}%`, top: `${(-rect.y / rect.h) * 100}%` }} />
        {inner && <span className="sh-pic__bars" style={{ width: `${inner.w * 100}%`, height: `${inner.h * 100}%` }} />}
        {over && <span className="sh-pic__overbox" style={{ left: `${((1 - (inner?.w ?? 1)) / 2) * 100}%`, top: `${((1 - (inner?.h ?? 1)) / 2) * 100}%`, width: `${(inner?.w ?? 1) * 100}%`, height: `${(inner?.h ?? 1) * 100}%` }}>{over}</span>}
      </span>
    );
  }
  return (
    <span className={cx("sh-pic", `sh-pic--${mode}`, beyond(seen) && "is-beyond")} style={{ "--a": seen.aspect }}>
      <img src={src} alt="" draggable={false} />
      {mode === "mask" && <span className="sh-pic__mask" style={at(pic)} />}
      {mode !== "full" && seen.others?.map((o, i) => <span key={i} className="sh-pic__frame is-other" style={{ ...at(o.rect), "--c": colorCss(o.color) }} />)}
      {mode !== "full" && <span className="sh-pic__frame" style={{ ...at(rect), "--c": colorCss(seen.color ?? 0) }}>{label && seen.name && <b>{seen.name}</b>}{inner && <i style={{ width: `${inner.w * 100}%`, height: `${inner.h * 100}%` }} />}</span>}
      {over && <span className="sh-pic__overbox" style={at(pic)}>{over}</span>}
    </span>
  );
}
