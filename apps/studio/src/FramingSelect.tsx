import { referencedFrame, type Presentation } from "@fielder/vocab";
import type { Photo } from "./api";
import { capturedFrameOf, frameOf, rigLabel, type FrameGeometry } from "./format";
import { Select } from "@fielder/ui";

/**
 * The frame an overlay or timeline clip is shown with: the framing it references (it follows
 * edits), else the copy it kept, else the photo's root frame.
 */
export const presentationFrame = (photo: Photo, pres: Presentation): FrameGeometry | null => referencedFrame(photo, pres) ?? frameOf(photo);

/** The presentation fields for a framing of the photo (null = as captured); the frame is kept as a fallback copy. */
export function framingPresentation(photo: Photo, framingId: string | null): Pick<Presentation, "frame" | "framing_id" | "label" | "rig_id" | "lens_mm"> {
  const f = framingId ? photo.framings.find((x) => x.id === framingId) : undefined;
  if (f) return { frame: f.frame, framing_id: f.id, label: f.name, rig_id: f.rig_id, lens_mm: f.lens_mm };
  return { frame: capturedFrameOf(photo), framing_id: null, label: rigLabel(photo), rig_id: null, lens_mm: photo.lens_mm || null };
}
/** A new overlay or clip starts on the photo's root framing. */
export const rootPresentation = (photo: Photo) => framingPresentation(photo, photo.root_framing_id);

const LEGACY = "__kept__";
/**
 * Pick a framing for a presentation: As captured or one of the photo's saved framings (made in the
 * shot view's Framing stage). A presentation from before #29 (rig + lens without a framing) shows
 * as "Kept: <label>" until another framing is picked.
 */
export function FramingSelect({ photo, value, onChange }: { photo: Photo; value: Presentation; onChange: (patch: Partial<Presentation>) => void }) {
  const linked = value.framing_id && photo.framings.some((f) => f.id === value.framing_id) ? value.framing_id : null;
  const legacy = !linked && (value.rig_id || (value.framing_id && !linked));
  const current = linked ?? (legacy ? LEGACY : "");
  const options = [
    { value: "", label: `As captured${photo.root_framing_id ? "" : " · root"}` },
    ...photo.framings.map((f) => ({ value: f.id, label: `${f.name}${photo.root_framing_id === f.id ? " · root" : ""}`, group: "Saved framings" })),
    ...(legacy ? [{ value: LEGACY, label: `Kept: ${value.label ?? "earlier frame"}` }] : []),
  ];
  return <Select label="Framing" icon="crop" width="100%" value={current} options={options} onChange={(v) => { if (v !== LEGACY) onChange(framingPresentation(photo, v || null)); }} />;
}
