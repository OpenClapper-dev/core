// A light's colour as a swatch that opens a field to pick it by eye (#426): hue across, saturation up. Used by the
// device controls and by a flow's colour keyframe; the sliders beside it stay for exact values.
import { HueSatField, Popover, cx } from "@openclapper/design";
import { hsiCss } from "@openclapper/ext-hardware";

export function ColourSwatch({ hue, sat, onChange, disabled, className, align }: { hue: number; sat: number; onChange: (hue: number, sat: number) => void; disabled?: boolean; className?: string; align?: "start" | "end" }) {
  return (
    <Popover maxWidth={300} align={align} className="hw-pick"
      trigger={<button type="button" className={cx("hw-pick__swatch", className)} style={{ background: hsiCss(hue, sat) }} disabled={disabled} aria-label="Pick the colour" title={disabled ? undefined : "Pick the colour on a field"} />}>
      <HueSatField hue={hue} sat={sat} onChange={onChange} />
      <p className="hw-pick__now"><i style={{ background: hsiCss(hue, sat) }} aria-hidden="true" /><b>{Math.round(hue)}°</b><span>·</span><b>{Math.round(sat * 100)} %</b></p>
    </Popover>
  );
}
