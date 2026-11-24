import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFile, fileType } from "./index.ts";
import { masterError, remapTimeline, timelineRefs, type TimelineBody } from "./timeline.ts";

const A = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6b", B = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6c";
const body: TimelineBody = { holdMs: null, clips: [
  { id: "c1", file: A, ms: 2000, chapter: { title: "Arrival", color: 6 } },
  { id: "c2", file: null, ms: 1500, title: "Insert: the ticket" },
  { id: "c3", file: B, frame: "f35", ms: 2500 },
] };

test("a timeline: clips with files keep their references in order; a placeholder keeps none", () => {
  const t = fileType("timeline")!;
  assert.deepEqual(timelineRefs(body).map((r) => [r.to, r.data]), [[A, { clip: "c1" }], [B, { clip: "c3" }]]);
  assert.equal(checkFile(t, body, 1, timelineRefs(body)).ok, true);
  assert.equal(checkFile(t, body, 1, []).ok, false, "references must match");
  assert.equal(checkFile(t, { ...body, clips: [{ id: "x", file: null, ms: 50 }] }, 1, []).ok, false, "too short");
  assert.equal(checkFile(t, { ...body, clips: [{ id: "x", file: null, ms: 1000, frame: "f" }] }, 1, []).ok, false, "a frame needs a file");
  assert.equal(checkFile(t, { ...body, clips: [body.clips[0], body.clips[0]] }, 1, []).ok, false, "ids are unique");
});

test("a copy of a timeline with its files points at the copies; the master timeline is a list of ids", () => {
  const c = remapTimeline(body as unknown as Record<string, unknown>, new Map([[A, B]])) as unknown as TimelineBody;
  assert.equal(c.clips[0].file, B);
  assert.equal(masterError([A, B]), null);
  assert.ok(masterError([A, A]));
  assert.ok(masterError(["x"]));
});
