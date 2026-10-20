import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VF_LOOK, DEFAULT_VIEWFINDER_LAYOUT, layoutLook, layoutOptions, type ViewfinderLayout } from "@openclapper/vocab";
import { applyPatch, mergePatch } from "./layoutPatch.ts";

const server: ViewfinderLayout = {
  ...DEFAULT_VIEWFINDER_LAYOUT,
  look: { ...DEFAULT_VF_LOOK, frameColor: "#FF3B30", frameWidth: 4, hud: { ...DEFAULT_VF_LOOK.hud, gps: false } },
};

test("a phone HUD chip lands on the server's newer look and leaves the rest alone", () => {
  const out = applyPatch(server, { look: { hud: { rig: false } } });
  assert.equal(layoutLook(out).frameColor, "#FF3B30");
  assert.equal(layoutLook(out).frameWidth, 4);
  assert.deepEqual(layoutLook(out).hud, { ...DEFAULT_VF_LOOK.hud, gps: false, rig: false });
  assert.deepEqual(out.portrait, server.portrait);
});

test("a layout without a look gets the defaults under the patch", () => {
  const { look: _, ...bare } = server;
  const out = applyPatch(bare, { look: { blackout: true } });
  assert.deepEqual(layoutLook(out), { ...DEFAULT_VF_LOOK, blackout: true });
  assert.deepEqual(layoutOptions(out), layoutOptions(bare));
});

test("later edits win field by field, chips one by one", () => {
  const p = mergePatch({ look: { frameColor: "#00E676", hud: { gps: false } } }, { look: { hud: { fov: false } }, options: { lenses: { mode: "all" } } });
  const out = applyPatch(server, p);
  assert.equal(layoutLook(out).frameColor, "#00E676");
  assert.equal(layoutLook(out).hud.gps, false);
  assert.equal(layoutLook(out).hud.fov, false);
  assert.equal(layoutLook(out).hud.rig, true);
  assert.deepEqual(layoutOptions(out).lenses, { mode: "all" });
});
