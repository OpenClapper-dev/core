import { FRAME_MODES, frameModeLabel } from "./format";
import type { MaskMode } from "./Framed";
import { Seg } from "@openclapper/ui";

export function ModeSwitch({ value, onChange }: { value: MaskMode; onChange: (m: MaskMode) => void }) {
  return <Seg label="How to show the rig frame on photos" value={value} onChange={onChange} options={FRAME_MODES.map((m) => ({ id: m, label: frameModeLabel(m) }))} />;
}
