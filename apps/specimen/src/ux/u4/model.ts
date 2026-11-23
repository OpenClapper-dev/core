// Fake data of the U4 prototype (the timeline): two cuts of the project of U1 and U3, a third that is not in the
// master timeline, and the master's order. Nothing here is product code. Specified in docs/rewrite/06-timeline.md.
import type { FileRec } from "../u1/data";
import { START_FILES, type DefFrame, type Ref } from "../u3/model";

/** A clip: a reference and a time. Without a reference it is a placeholder with a title. A chapter marker sits at its start. */
export interface Clip { id: string; ref?: Ref; hold: number; title?: string; marker?: { title: string; color: number } }
/** What plays for a stretch of time: one picture, a placeholder, or a hole where a file is missing. */
export interface Seg { dur: number; kind: "pic" | "prog" | "placeholder" | "missing" | "empty"; ref?: Ref & { to?: string; ease?: boolean }; def?: DefFrame | null; overlay?: boolean; label: string }

export const CUTS: Record<string, Clip[]> = {
  t1: [
    { id: "a1", ref: { file: "s1" }, hold: 3, marker: { title: "Arrival", color: 6 } },
    { id: "a2", ref: { file: "s2" }, hold: 3 },
    { id: "a3", hold: 2, title: "Insert: the ticket, close" },
    { id: "a4", ref: { file: "cv2", frame: "p6k-35-2" }, hold: 2.5 },
    { id: "a5", ref: { file: "ph103" }, hold: 2, marker: { title: "At the quay", color: 2 } },
    { id: "a6", ref: { file: "s3" }, hold: 3 },
    { id: "a7", ref: { file: "cv5" }, hold: 2 },
    { id: "a8", ref: { file: "b1" }, hold: 1.5 },
  ],
  t2: [
    { id: "b1", ref: { file: "s4" }, hold: 3, marker: { title: "Kitchen, morning", color: 4 } },
    { id: "b2", ref: { file: "s5" }, hold: 2 },
    { id: "b3", hold: 2, title: "Reverse on Joe" },
    { id: "b4", ref: { file: "s6" }, hold: 2 },
    { id: "b5", ref: { file: "ph124" }, hold: 2 },
  ],
  t3: [{ id: "c1", ref: { file: "s1" }, hold: 3 }, { id: "c2", ref: { file: "ph104" }, hold: 2 }, { id: "c3", ref: { file: "s3" }, hold: 4 }],
};
export const MASTER = ["t1", "t2"];
export const FILES4: FileRec[] = [...START_FILES, { id: "t3", type: "timeline", name: "Scene 12, alternative", created: "2026-11-10 09:12", by: "Ben", props: {} }];
