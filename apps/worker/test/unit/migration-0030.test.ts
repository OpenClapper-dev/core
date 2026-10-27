/**
 * Migration 0030 (epic #275) on a real SQLite: every migration before it, then overlays in each
 * shape its rules cover, then 0030 and what the layers, steps and clips look like afterwards.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const look = (patch: Record<string, unknown> = {}) => ({ exposure: 0, contrast: 0, saturation: 0, bw: false, tint: null, tint_opacity: 0.3, vignette: 0, blur: 0, ...patch });
const drawing = (shapes: unknown[], l: Record<string, unknown> | null) => JSON.stringify({ v: 1, shapes, look: l });
const shape = (id: string) => ({ id, type: "line", from: [0.1, 0.1], to: [0.5, 0.5], color: "#FFD60A", width: 0.006, opacity: 1 });

function before0030() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of files) { if (f.startsWith("0030")) break; db.exec(readFileSync(dir + f, "utf8")); }
  return db;
}

test("0030 turns overlays into layers, gives overlay-only shots steps, re-points clips", () => {
  const db = before0030();
  const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);
  run("INSERT INTO workspaces (id, name) VALUES ('w', 'W')");
  run("INSERT INTO projects (id, name, workspace_id) VALUES ('pr', 'P', 'w')");
  const shot = (id: string) => run("INSERT INTO shots (id, project_id, captured_at) VALUES (?1, 'pr', '2026-10-01T10:00:00Z')", id);
  const photo = (id: string, s: string, ordinal: number) => run("INSERT INTO photos (id, shot_id, ordinal, timestamp, lens_mm, r2_object_key) VALUES (?1, ?2, ?3, '2026-10-01T10:00:00Z', 35, ?4)", id, s, ordinal, `photos/${id}.jpg`);
  const overlay = (id: string, p: string, position: number, d: string, framingId: string | null = null, owner: [string, string] | null = null) =>
    run("INSERT INTO overlays (id, photo_id, name, drawing, presentation, position, timeline_id, clip_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '2026-10-02T10:00:00Z', NULL)",
      id, p, `Overlay ${id}`, d, JSON.stringify({ mode: "fit", frame: null, framing_id: framingId, label: null }), position, owner?.[0] ?? null, owner?.[1] ?? null);

  // Shot A: no stored steps; photo a1 has a lighting overlay (with a look) and a neutral one; a2 has none.
  shot("A"); photo("a1", "A", 0); photo("a2", "A", 1);
  run("INSERT INTO framings (id, photo_id, name, lens_mm, frame) VALUES ('fa', 'a1', 'Tight', 50, '{\"width_fraction\":0.4,\"height_fraction\":0.4}')");
  overlay("oA1", "a1", 0, drawing([shape("s1")], look({ exposure: -0.5, tint: "#0A84FF" })), "fa");
  overlay("oA2", "a1", 1, drawing([shape("s2")], look()));
  // Shot B: curated steps showing overlay oB1; oB2 is left out of the progression.
  shot("B"); photo("b1", "B", 0);
  overlay("oB1", "b1", 0, drawing([shape("s3")], look()));
  overlay("oB2", "b1", 1, drawing([], look({ bw: true })));
  run("INSERT INTO shot_steps (id, shot_id, ordinal, photo_id, overlay_id) VALUES ('stB1', 'B', 0, 'b1', NULL), ('stB2', 'B', 1, 'b1', 'oB1')");
  // Shot C: nothing composed, must stay untouched.
  shot("C"); photo("c1", "C", 0);
  // A cut: one clip shows oA1, one shows the left-out oB2, one shows its own overlay.
  run("INSERT INTO timelines (id, project_id, name) VALUES ('t', 'pr', 'Cut')");
  const clip = (id: string, pos: number, p: string, o: string | null) => run("INSERT INTO timeline_clips (id, timeline_id, position, photo_id, overlay_id, presentation, duration_ms) VALUES (?1, 't', ?2, ?3, ?4, '{\"mode\":\"fit\",\"frame\":null,\"label\":null}', 2000)", id, pos, p, o);
  clip("cA", 0, "a1", "oA1"); clip("cB", 1, "b1", "oB2"); clip("cOwn", 2, "c1", null);
  overlay("oOwn", "c1", 0, drawing([shape("s4")], look({ contrast: 0.3 })), null, ["t", "cOwn"]);
  run("UPDATE timeline_clips SET overlay_id = 'oOwn' WHERE id = 'cOwn'");

  db.exec(readFileSync(dir + files.find((f) => f.startsWith("0030"))!, "utf8"));

  const all = <T>(sql: string, ...args: string[]) => db.prepare(sql).all(...args) as T[];
  type L = { id: string; shot_id: string; kind: string; name: string; position: number; space: string; photo_id: string; range: string | null; shapes: string | null; look: string | null; timeline_id: string | null; clip_id: string | null };
  const layers = all<L>("SELECT * FROM layers ORDER BY shot_id, position, kind");

  // Shot A got stored steps: a1, then its two overlays (in position order), then a2.
  const stepsA = all<{ id: string; ordinal: number; photo_id: string; framing_id: string | null; overlay_id: string | null }>("SELECT * FROM shot_steps WHERE shot_id = 'A' ORDER BY ordinal");
  expect(stepsA.map((s) => [s.photo_id, s.overlay_id, s.framing_id])).toEqual([["a1", null, null], ["a1", "oA1", "fa"], ["a1", "oA2", null], ["a2", null, null]]);
  for (const s of stepsA) expect(s.id).toMatch(UUID_RE);
  const stepOf = (o: string) => stepsA.find((s) => s.overlay_id === o)!.id;
  // Shot B's curated steps were not touched.
  expect(all<{ id: string }>("SELECT id FROM shot_steps WHERE shot_id = 'B' ORDER BY ordinal").map((s) => s.id)).toEqual(["stB1", "stB2"]);
  expect(all("SELECT * FROM shot_steps WHERE shot_id = 'C'")).toEqual([]);

  const shotLayer = (id: string) => layers.find((l) => l.id === id)!;
  // oA1: a drawing layer with its id and shapes, and an adjustment layer just below with the look; both on its step.
  expect(shotLayer("oA1")).toMatchObject({ kind: "drawing", shot_id: "A", space: "photo", photo_id: "a1", position: 1, range: JSON.stringify([stepOf("oA1")]), look: null });
  expect(JSON.parse(shotLayer("oA1").shapes!)).toHaveLength(1);
  const adjA = layers.filter((l) => l.kind === "adjustment" && l.shot_id === "A" && !l.timeline_id);
  expect(adjA).toHaveLength(1);
  expect(adjA[0]).toMatchObject({ position: 0, photo_id: "a1", range: JSON.stringify([stepOf("oA1")]), name: "Overlay oA1 · look" });
  expect(adjA[0].id).toMatch(UUID_RE);
  expect(JSON.parse(adjA[0].look!)).toMatchObject({ exposure: -0.5, tint: "#0A84FF" });
  // oA2 has a neutral look: a drawing layer only.
  expect(shotLayer("oA2")).toMatchObject({ kind: "drawing", position: 3, range: JSON.stringify([stepOf("oA2")]) });
  // Shot B: oB1 on the step that showed it; oB2 (bw look, no shapes) waits on no step.
  expect(shotLayer("oB1").range).toBe(JSON.stringify(["stB2"]));
  expect(shotLayer("oB2").range).toBe("[]");
  expect(layers.some((l) => l.kind === "adjustment" && l.shot_id === "B" && !l.timeline_id && l.range === "[]")).toBe(true);
  expect(layers.filter((l) => l.shot_id === "C" && !l.timeline_id)).toEqual([]);

  const clips = all<{ id: string; step_id: string | null }>("SELECT id, step_id FROM timeline_clips ORDER BY position");
  // cA now shows oA1's step; cB had no step showing oB2, so oB2's layers became cB's own copies.
  expect(clips.map((c) => c.step_id)).toEqual([stepOf("oA1"), null, null]);
  const cB = layers.filter((l) => l.clip_id === "cB");
  expect(cB.map((l) => l.kind).sort()).toEqual(["adjustment", "drawing"]);
  expect(cB.every((l) => l.timeline_id === "t" && l.shot_id === "B" && l.range === null && l.id !== "oB2")).toBe(true);
  // The clip's own overlay is the clip's own layers (drawing with the same id, adjustment for the contrast).
  const own = layers.filter((l) => l.clip_id === "cOwn");
  expect(own.find((l) => l.kind === "drawing")!.id).toBe("oOwn");
  expect(own.map((l) => l.kind).sort()).toEqual(["adjustment", "drawing"]);
  // Nothing was deleted, and the helper tables are gone.
  expect(all<{ n: number }>("SELECT count(*) AS n FROM overlays")[0].n).toBe(5);
  expect(all("SELECT name FROM sqlite_master WHERE name LIKE '_m30%'")).toEqual([]);
});
