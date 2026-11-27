// The picture that stands for a shot, a set or a location in lists (docs/features/shots.md, "The thumbnail"): the
// first photo, canvas or progression of its content; a progression through its first item and its default frame.
import type { PresetBody } from "@openclapper/model";
import type { FileRec } from "../api";
import { Pic } from "./Pic";
import { see } from "./picture";
import { coverOf as cover } from "./progression";

/** The file and frame a shot, set or location is shown by; null when it has no picture. */
export function coverOf(f: FileRec, files: ReadonlyMap<string, FileRec>) {
  const c = cover(f, files);
  return c && { to: c.ref.to, ref: c.ref, def: c.def, progression: c.progression };
}

/** The cover drawn in a card: fitted to its box, through its frame. */
export function CoverArt({ f, files, presets }: { f: FileRec; files: ReadonlyMap<string, FileRec>; presets: ReadonlyMap<string, PresetBody> }) {
  const c = coverOf(f, files);
  if (!c) return null;
  return <span className="sh-box sh-cover"><Pic seen={see(c.ref, { files, presets }, c.def)} /></span>;
}
