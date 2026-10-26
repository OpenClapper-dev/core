/** Rigs: the lens vignetting points (issue #266) round-trip, are sorted, and are checked strictly. */
import { beforeEach, describe, expect, test } from "vitest";
import { api, buildWorld, newUser, ok, snapshot, uuid, type User, type World } from "./helpers.ts";

let u: User;
let w: World;
beforeEach(async () => { u ??= await newUser(); w = await buildWorld(u); });

const body = (extra: Record<string, unknown> = {}) => ({ name: "Vig rig", sensor_width_mm: 36, sensor_height_mm: 24, workspace_id: w.workspace, ...extra });

describe("PUT /api/presets/:id vignetting", () => {
  test("stores the points sorted by focal length and lists them; absent or [] clears", async () => {
    const id = uuid();
    const pts = [{ mm: 24, start: 0.8, end: 1, opacity: 0.2 }, { mm: 18, start: 0.6, end: 0.95, opacity: 0.8 }];
    const r = await ok<{ preset: { vignetting: unknown[] } }>(api(u.token, "PUT", `/api/presets/${id}`, body({ vignetting: pts })));
    expect(r.preset.vignetting).toEqual([pts[1], pts[0]]);
    const list = await ok<{ presets: { id: string; vignetting: unknown[] }[] }>(api(u.token, "GET", "/api/presets"));
    expect(list.presets.find((p) => p.id === id)!.vignetting).toEqual([pts[1], pts[0]]);
    expect(list.presets.find((p) => p.id === w.preset)!.vignetting).toEqual([]);
    const cleared = await ok<{ preset: { vignetting: unknown[] } }>(api(u.token, "PUT", `/api/presets/${id}`, body()));
    expect(cleared.preset.vignetting).toEqual([]);
  });

  test("rejects bad points and changes nothing", async () => {
    const before = await snapshot();
    for (const vignetting of [{}, [{ mm: 18, start: 0.9, end: 0.5, opacity: 1 }], [{ mm: 18, start: 0.5, end: 1, opacity: 3 }], [{ mm: 0, start: 0, end: 1, opacity: 1 }]]) {
      const res = await api(u.token, "PUT", `/api/presets/${uuid()}`, body({ vignetting }));
      expect(res.status, JSON.stringify(vignetting)).toBe(400);
      expect(await res.text()).toMatch(/vignetting/);
    }
    expect(await snapshot()).toBe(before);
  });
});
