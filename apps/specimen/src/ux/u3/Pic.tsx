// A picture as a viewer shows it: a photo or a canvas, optionally through a frame, in one of the four view modes
// (Outline, Mask, Crop, Full; docs/rewrite/05-composition.md). Used for the stage, the strips and every thumbnail,
// so a frame looks the same everywhere. It fills the nearest box that has `container-type: size`.
import { AppIcon, Icon, cx } from "@openclapper/design";
import { TYPES, type FileRec } from "../u1/data";
import { picture } from "../u1/pictures";
import { DOCS, between, eqOf, frameOfDefault, rect, type DefFrame, type Doc, type Fr, type Ref } from "./model";

export type Mode = "outline" | "mask" | "crop" | "full";
export interface Seen { file?: FileRec; src?: string; frame?: Fr; eq?: number; source: "own" | "default" | "picture" | "none"; missing?: boolean }

/** What a reference shows: its picture, and the frame it is seen through (its own, the canvas's picture, or a progression's default). */
export function see(ref: Ref & { to?: string; ease?: boolean }, files: Map<string, FileRec>, docs: Record<string, Doc> = DOCS, def?: DefFrame | null, at = 0): Seen {
  const file = files.get(ref.file);
  if (!file || file.binned) return { file, source: "none", missing: true };
  const doc = file.type === "canvas" ? docs[file.id] : undefined, base = doc?.base ? files.get(doc.base) : file.type === "photo" ? file : undefined;
  const src = file.type === "photo" || file.type === "canvas" ? (base?.pic != null ? picture(base.pic) : file.pic != null ? picture(file.pic) : undefined) : undefined;
  const eq = eqOf(base);
  const own = doc?.frames.find((f) => f.id === ref.frame);
  const end = own && ref.to ? doc?.frames.find((f) => f.id === ref.to) : undefined;
  if (own) return { file, src, eq, frame: end ? between(own, end, at, ref.ease) : own, source: "own" };
  if (def && eq) return { file, src, eq, frame: frameOfDefault(def), source: "default" };
  const pic = doc?.frames.find((f) => f.id === doc.picture);
  return pic ? { file, src, eq, frame: pic, source: "picture" } : { file, src, eq, source: "none" };
}

/** The drawing a progression lays over every picture: a stand-in for the overlay canvas. */
export const Overlay = () => (
  <svg className="u3-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path d="M6 6h12M6 6v16M94 6h-12M94 6v16M6 94h12M6 94v-16M94 94h-12M94 94v-16" />
    <path d="M50 44v12M44 50h12" />
    <path className="u3-overlay__arrow" d="M30 84h40m-6 -5l6 5l-6 5" />
  </svg>
);

export function Pic({ seen, mode = "crop", overlay, others, label }: { seen: Seen; mode?: Mode; overlay?: boolean; others?: Fr[]; label?: boolean }) {
  const { file, src, frame, eq } = seen;
  if (seen.missing) return <span className="u3-pic u3-pic--none"><Icon name="warning" size={20} /></span>;
  if (!src) return <span className="u3-pic u3-pic--none">{file && <AppIcon glyph={TYPES[file.type].glyph} color={TYPES[file.type].color} size={48} />}</span>;
  const r = frame ? rect(frame, eq ?? 24) : undefined;
  if (!r || !frame) return <span className="u3-pic" style={{ "--a": 4 / 3 }}><img src={src} alt="" draggable={false} />{overlay && <Overlay />}</span>;
  const at = (f: Fr, q: { w: number; h: number }) => ({ left: `${(f.cx - q.w / 2) * 100}%`, top: `${(f.cy - q.h / 2) * 100}%`, width: `${q.w * 100}%`, height: `${q.h * 100}%` });
  if (mode === "crop") {
    // Fitted to the frame: the photo is scaled so the frame fills the box; a delivery aspect leaves its bars inside.
    return (
      <span className="u3-pic u3-pic--crop" style={{ "--a": (r.w * (4 / 3)) / r.h }}>
        <img src={src} alt="" draggable={false} style={{ width: `${100 / r.w}%`, height: `${100 / r.h}%`, left: `${(-(frame.cx - r.w / 2) / r.w) * 100}%`, top: `${(-(frame.cy - r.h / 2) / r.h) * 100}%` }} />
        {r.inner && <span className="u3-pic__bars" style={{ width: `${(r.inner.w / r.w) * 100}%`, height: `${(r.inner.h / r.h) * 100}%` }} />}
        {overlay && <span className="u3-pic__over" style={r.inner ? { width: `${(r.inner.w / r.w) * 100}%`, height: `${(r.inner.h / r.h) * 100}%` } : undefined}><Overlay /></span>}
      </span>
    );
  }
  const pic = r.inner ?? r;
  return (
    <span className={cx("u3-pic", `u3-pic--${mode}`)} style={{ "--a": 4 / 3 }}>
      <img src={src} alt="" draggable={false} />
      {mode === "mask" && <span className="u3-pic__mask" style={at(frame, pic)} />}
      {mode !== "full" && others?.filter((f) => f.id !== frame.id).map((f) => <span key={f.id} className="u3-pic__frame is-other" style={{ ...at(f, rect(f, eq ?? 24)), "--c": `var(--cat-${f.color})` }} />)}
      {mode !== "full" && <span className="u3-pic__frame" style={{ ...at(frame, r), "--c": `var(--cat-${frame.color})` }}>{label && <b>{frame.name}</b>}{r.inner && <i style={{ width: `${(r.inner.w / r.w) * 100}%`, height: `${(r.inner.h / r.h) * 100}%` }} />}</span>}
      {overlay && <span className="u3-pic__over" style={at(frame, pic)}><Overlay /></span>}
    </span>
  );
}
