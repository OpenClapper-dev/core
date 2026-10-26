import type { ComponentChildren, JSX } from "preact";
import { withCentre } from "@openclapper/vocab";
import type { Photo } from "./api";
import { frameLayout, frameOf, imageAspect, type FrameGeometry, type FrameMode, type PctRect } from "./format";
import { cx, Img } from "@openclapper/ui";

export type MaskMode = FrameMode;

const pct = (r: PctRect) => ({ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` });

/**
 * Renders a photo with its rig frame re-applied from the stored geometry.
 * The frame is centred; fractions > 1 mean the rig saw more than the phone, in
 * which case the photo is shrunk inside the frame exactly like in the app.
 * "fit" crops the photo to the frame instead.
 */
/**
 * `maxHeight` (a CSS length, e.g. "88vh") sizes the box to fit both the available width and that
 * height while keeping the photo's aspect ratio; without it the box fills its parent's width.
 * The box always has the photo's aspect ratio (or the frame's in fit mode) so the percentage
 * geometry of frame and tints lines up with the image.
 */
export function Framed({ photo, mode, className, maxHeight, frame, imgStyle, src, children }: { photo: Photo; mode: MaskMode; className?: string; maxHeight?: string; /** Draw this frame instead of the stored one (rig explorer). */ frame?: FrameGeometry | null; /** Extra style on the <img> (the compose editor's look filter). */ imgStyle?: JSX.CSSProperties; /** Another image of the same size (an overlay render). */ src?: string; /** Tags drawn on the photo (positioned inside the box). */ children?: ComponentChildren }) {
  const f = frame ?? frameOf(photo);
  const img = src ?? photo.image_url;
  const photoAspect = imageAspect(photo);
  const l = f && mode !== "off" ? frameLayout(f, mode, photoAspect) : null;
  const aspect = l?.aspect ?? photoAspect;
  // No inline height: thumbnails fix theirs in CSS; elsewhere the aspect ratio gives it. The width is
  // explicit with maxHeight, so the box never depends on a shrink-to-fit parent (its children are absolute).
  const style = { aspectRatio: String(aspect), width: maxHeight ? `min(100%, calc(${maxHeight} * ${aspect}))` : undefined };
  if (!l) return <div class={`framed ${className ?? ""}`} style={style}><Img src={img} alt="" loading="lazy" style={imgStyle} />{children}</div>;

  const fullImg = l.img.left === 0 && l.img.width === 100 && l.img.height === 100;
  return (
    <div class={`framed ${className ?? ""} ${l.shrunk ? "is-beyond" : ""}`} style={style}>
      <Img src={img} alt="" loading="lazy" style={fullImg ? imgStyle : { inset: "auto", ...pct(l.img), ...imgStyle }} />
      {mode === "mask" && l.frame && (
        <>
          {/* Four bands around the frame; a re-framed frame is off-centre, so each side has its own size. */}
          <div class="tint" style={{ left: 0, top: 0, right: 0, height: `${l.frame.top}%` }} />
          <div class="tint" style={{ left: 0, top: `${l.frame.top + l.frame.height}%`, right: 0, bottom: 0 }} />
          <div class="tint" style={{ left: 0, top: `${l.frame.top}%`, width: `${l.frame.left}%`, height: `${l.frame.height}%` }} />
          <div class="tint" style={{ left: `${l.frame.left + l.frame.width}%`, right: 0, top: `${l.frame.top}%`, height: `${l.frame.height}%` }} />
        </>
      )}
      {l.frame && <div class={`frame ${l.shrunk ? "dashed" : ""}`} style={pct(l.frame)} />}
      {children}
    </div>
  );
}

/** Where the photo sits inside a Framed box (% of the box) and the box's aspect ratio, for things drawn in photo coordinates. */
export function framedLayout(photo: Photo, mode: MaskMode, frame?: FrameGeometry | null): { img: PctRect; aspect: number } {
  const f = frame ?? frameOf(photo);
  const photoAspect = imageAspect(photo);
  const l = f && mode !== "off" ? frameLayout(f, mode, photoAspect) : null;
  return { img: l?.img ?? { left: 0, top: 0, width: 100, height: 100 }, aspect: l?.aspect ?? photoAspect };
}

/**
 * Small list thumbnail (map list): the photo cropped to a 4:3 box with a thin frame line on top,
 * no tints. Unlike Framed it never shrinks the photo, so rows stay one height.
 */
export function FramedThumb({ photo, mode }: { photo: Photo; mode: MaskMode }) {
  const f = frameOf(photo);
  const l = f && mode !== "off" && mode !== "fit" ? frameLayout(f, "frame", imageAspect(photo)) : null;
  return (
    <div class="framed" style={{ aspectRatio: "4 / 3" }}>
      <Img src={photo.image_url} alt="" loading="lazy" style={{ objectFit: "cover" }} />
      {l?.frame && <div class={cx("f-framed__frame f-framed__frame--thin", mode === "mask" && "f-framed__frame--mask")} style={pct(l.frame)} />}
    </div>
  );
}

/** Crop the photo to the rig frame in the browser and trigger a download. */
export async function downloadCrop(photo: Photo): Promise<void> {
  const f = frameOf(photo);
  const res = await fetch(photo.image_url, { credentials: "same-origin" });
  const bitmap = await createImageBitmap(await res.blob());
  const c = f ? withCentre(f) : { width_fraction: 1, height_fraction: 1, x: 0.5, y: 0.5 };
  const wf = Math.min(1, c.width_fraction);
  const hf = Math.min(1, c.height_fraction);
  const sw = Math.round(bitmap.width * wf), sh = Math.round(bitmap.height * hf);
  // The crop follows the root framing's centre (issue #29).
  const sx = Math.round(Math.max(0, Math.min(bitmap.width - sw, c.x * bitmap.width - sw / 2))), sy = Math.round(Math.max(0, Math.min(bitmap.height - sh, c.y * bitmap.height - sh / 2)));
  const canvas = document.createElement("canvas");
  canvas.width = sw; canvas.height = sh;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `openclapper-${photo.timestamp.replace(/[:.]/g, "-")}-framed.jpg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
