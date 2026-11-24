// The picture that stands for a shot, a set or a location in lists (docs/features/shots.md, "The cover"): the first
// item of a shot's progression through its frame (or the default frame), else the first photo or canvas of the content.
import { shotCover, type FrameValues, type PresetBody, type ShotBody } from "@openclapper/model";
import type { FileRec } from "../api";
import { Pic } from "./Pic";
import { see } from "./picture";

const HOLDERS = new Set(["shot", "set", "location"]);

/** The file and frame a shot, set or location is shown by; null when it has no picture. */
export function coverOf(f: FileRec, files: ReadonlyMap<string, FileRec>): { to: string; frame?: string; def: FrameValues | null } | null {
  if (!HOLDERS.has(f.type)) return null;
  const c = shotCover((f.refs ?? []) as Parameters<typeof shotCover>[0], (id) => { const x = files.get(id); return x && !x.deleted_at ? x.type : null; });
  if (!c) return null;
  const prog = (f.body as Partial<ShotBody> | undefined)?.progression;
  return { to: c.to, frame: c.frame, def: c.rule === "progression" ? prog?.frame ?? null : null };
}

/** The cover drawn in a card: fitted to its box, through its frame. */
export function CoverArt({ f, files, presets }: { f: FileRec; files: ReadonlyMap<string, FileRec>; presets: ReadonlyMap<string, PresetBody> }) {
  const c = coverOf(f, files);
  if (!c) return null;
  return <span className="sh-box sh-cover"><Pic seen={see({ to: c.to, frame: c.frame }, { files, presets }, c.def)} /></span>;
}
