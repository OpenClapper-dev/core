import test from "node:test";
import assert from "node:assert/strict";
import * as wm from "./wm.ts";

const fresh = () => { wm.reset(); wm.setViewport({ w: 1280, h: 768 }); };
const openApp = (app: string, extra: Partial<wm.OpenIntent> = {}) => wm.open({ app, title: app, ...extra });
const get = (id: string) => wm.getWindows().find((w) => w.id === id)!;

test("open places, focuses and dedupes per app:resource", () => {
  fresh();
  const a = openApp("shot", { resource: { type: "shot", id: "s1" } });
  const b = openApp("shot", { resource: { type: "shot", id: "s2" } });
  assert.equal(wm.getWindows().length, 2);
  assert.equal(wm.getFocusedId(), b);
  // Same resource → the existing window is focused, no new one.
  const again = openApp("shot", { resource: { type: "shot", id: "s1" } });
  assert.equal(again, a);
  assert.equal(wm.getWindows().length, 2);
  assert.equal(wm.getFocusedId(), a);
  assert.ok(get(a).z > get(b).z);
});

test("singletons dedupe on the app alone; per-resource apps keep one resource-less window", () => {
  fresh();
  const a = openApp("files", { singleton: true });
  const b = openApp("files", { singleton: true, resource: { type: "folder", id: "f1" }, state: { folder: "f1" } });
  assert.equal(a, b);
  assert.deepEqual(get(a).state, { folder: "f1" });
  assert.equal(get(a).stateSeq, 1);
  const c = openApp("timeline");
  const d = openApp("timeline");
  assert.equal(c, d);
  const e = openApp("timeline", { resource: { type: "timeline", id: "t1" } });
  assert.notEqual(c, e);
});

test("setResource re-targets a window unless another one shows that resource", () => {
  fresh();
  const list = openApp("timeline");
  const t1 = openApp("timeline", { resource: { type: "timeline", id: "t1" } });
  assert.equal(wm.setResource(list, { type: "timeline", id: "t1" }), false);
  assert.equal(wm.getFocusedId(), t1);
  assert.equal(get(list).resource, null);
  assert.equal(wm.setResource(list, { type: "timeline", id: "t2" }), true);
  assert.deepEqual(get(list).resource, { type: "timeline", id: "t2" });
  // Now opening t2 focuses the re-targeted window.
  assert.equal(openApp("timeline", { resource: { type: "timeline", id: "t2" } }), list);
});

test("toggleDesktop minimizes everything and brings it back; focusDesktop clears focus", () => {
  fresh();
  const a = openApp("x");
  const b = openApp("y");
  wm.toggleMax(a);
  wm.toggleDesktop();
  assert.ok(wm.getWindows().every((w) => w.mode === "min"));
  assert.equal(wm.getFocusedId(), null);
  wm.toggleDesktop();
  assert.equal(get(a).mode, "max");
  assert.equal(get(b).mode, "normal");
  assert.equal(wm.getFocusedId(), a);
  wm.focusDesktop();
  assert.equal(wm.getFocusedId(), null);
  wm.setRoute(b, "#/plan");
  assert.equal(get(b).route, "#/plan");
});

test("bounds are clamped to min size and the window stays grabbable", () => {
  fresh();
  const a = openApp("x", { minSize: { w: 400, h: 300 } });
  wm.setBounds(a, { x: 5000, y: 5000, w: 100, h: 100 });
  const w = get(a);
  assert.equal(w.bounds.w, 400);
  assert.equal(w.bounds.h, 300);
  assert.ok(w.bounds.x <= 1280 - 48);
  assert.ok(w.bounds.y <= 768 - 36);
  wm.setBounds(a, { x: -5000, y: -50, w: 400, h: 300 });
  assert.equal(get(a).bounds.x, 48 - 400);
  assert.equal(get(a).bounds.y, 0);
});

test("a viewport change re-clamps windows", () => {
  fresh();
  const a = openApp("x");
  wm.setBounds(a, { x: 900, y: 600, w: 400, h: 300 });
  wm.setViewport({ w: 800, h: 500 });
  const b = get(a).bounds;
  assert.ok(b.x <= 800 - 48 && b.y <= 500 - 36 && b.w <= 800 && b.h <= 500);
});

test("snap and maximize never touch bounds; restore returns to them", () => {
  fresh();
  const a = openApp("x");
  wm.setBounds(a, { x: 100, y: 80, w: 500, h: 400 });
  const before = get(a).bounds;
  wm.setSnap(a, "left");
  assert.equal(get(a).mode, "snapped");
  assert.equal(get(a).snap, "left");
  assert.deepEqual(get(a).bounds, before);
  wm.toggleMax(a);
  assert.equal(get(a).mode, "max");
  assert.equal(get(a).snap, undefined);
  assert.deepEqual(get(a).bounds, before);
  wm.toggleMax(a);
  assert.equal(get(a).mode, "normal");
  assert.deepEqual(get(a).bounds, before);
  wm.setSnap(a, "right");
  wm.setSnap(a, null);
  assert.equal(get(a).mode, "normal");
  assert.deepEqual(get(a).bounds, before);
});

test("minimize parks the mode and drops focus to the next window; focus restores it", () => {
  fresh();
  const a = openApp("x");
  const b = openApp("y");
  wm.setSnap(b, "left");
  wm.minimize(b);
  assert.equal(get(b).mode, "min");
  assert.equal(wm.getFocusedId(), a);
  wm.focus(b);
  assert.equal(get(b).mode, "snapped");
  assert.equal(get(b).snap, "left");
  assert.equal(wm.getFocusedId(), b);
});

test("close hands focus to the topmost remaining window", () => {
  fresh();
  const a = openApp("x");
  const b = openApp("y");
  const c = openApp("z");
  wm.focus(a);
  wm.close(a);
  // b and c remain; c was focused later than b before a took over.
  assert.equal(wm.getFocusedId(), c);
  wm.close(c);
  assert.equal(wm.getFocusedId(), b);
  wm.close(b);
  assert.equal(wm.getFocusedId(), null);
  assert.equal(wm.getWindows().length, 0);
});

test("cycle walks the z-order in both directions and restores a minimized stop", () => {
  fresh();
  const a = openApp("x");
  const b = openApp("y");
  const c = openApp("z");
  assert.equal(wm.getFocusedId(), c);
  wm.cycle(1); // wraps to the lowest
  assert.equal(wm.getFocusedId(), a);
  wm.cycle(-1);
  assert.equal(wm.getFocusedId(), c);
  wm.minimize(b);
  // b sits lowest in z now? No: z unchanged by minimize; cycling must still reach and restore it.
  wm.focus(a);
  wm.cycle(1);
  assert.equal(wm.getFocusedId(), b);
  assert.equal(get(b).mode, "normal");
});

test("open with a stored bounds rect honours it (clamped)", () => {
  fresh();
  const a = openApp("x", { bounds: { x: 10, y: 10, w: 600, h: 400 } });
  assert.deepEqual(get(a).bounds, { x: 10, y: 10, w: 600, h: 400 });
});

test("setTitle notifies without disturbing geometry; old local pins are kept for seeding", () => {
  fresh();
  const a = openApp("x");
  const before = get(a).bounds;
  wm.setTitle(a, "Renamed");
  assert.equal(get(a).title, "Renamed");
  assert.deepEqual(get(a).bounds, before);
  wm.hydrate({ ...wm.snapshot(), pins: ["gallery", "files"] });
  assert.deepEqual(wm.getLegacyPins(), ["gallery", "files"]);
});

test("snapshot/hydrate round-trips and fixes a stale focus id", () => {
  fresh();
  const a = openApp("x");
  const b = openApp("y");
  wm.setSnap(a, "left"); // also focuses a
  const snap = wm.snapshot();
  wm.reset();
  assert.equal(wm.getWindows().length, 0);
  wm.hydrate(snap);
  assert.equal(wm.getWindows().length, 2);
  assert.equal(wm.getFocusedId(), a);
  assert.equal(get(a).mode, "snapped");
  // A stale focus id falls back to the topmost remaining window.
  wm.hydrate({ ...snap, windows: snap.windows.filter((w) => w.id !== a), focusedId: a });
  assert.equal(wm.getFocusedId(), b);
});

test("workspaces: windows belong to one, switching keeps each one's focus", () => {
  fresh();
  const first = wm.getActiveWs();
  const a = openApp("gallery", { singleton: true });
  const second = wm.addWorkspace({ go: true });
  assert.equal(wm.getActiveWs(), second);
  assert.equal(wm.getWindows().length, 0, "a new workspace starts empty");
  assert.equal(wm.getFocusedId(), null);
  const b = openApp("files", { singleton: true });
  assert.equal(wm.getAllWindows().length, 2);
  assert.deepEqual(wm.getWindows().map((w) => w.id), [b]);
  wm.switchWorkspace(first);
  assert.equal(wm.getFocusedId(), a, "the window focused there before comes back");
  wm.switchWorkspace(1);
  assert.equal(wm.getActiveWs(), second);
  assert.equal(wm.getFocusedId(), b);
  wm.switchWorkspace(1);
  assert.equal(wm.getActiveWs(), first, "stepping wraps");
});

test("workspaces: opening what is open elsewhere switches there; names are fresh", () => {
  fresh();
  const first = wm.getActiveWs();
  const shot = openApp("shot", { resource: { type: "shot", id: "s1" } });
  const second = wm.addWorkspace();
  assert.equal(wm.getWorkspaces().find((w) => w.id === second)?.name, "Desktop 2");
  wm.switchWorkspace(second);
  assert.equal(openApp("shot", { resource: { type: "shot", id: "s1" } }), shot);
  assert.equal(wm.getActiveWs(), first);
  assert.equal(wm.getFocusedId(), shot);
  wm.renameWorkspace(second, "  Review  ");
  assert.equal(wm.getWorkspaces().find((w) => w.id === second)?.name, "Review");
});

test("workspaces: moving a window, removing a workspace hands its windows over", () => {
  fresh();
  const first = wm.getActiveWs();
  const a = openApp("gallery", { singleton: true });
  const b = openApp("files", { singleton: true });
  wm.moveToWorkspace(b, "new");
  assert.equal(wm.getWorkspaces().length, 2);
  assert.deepEqual(wm.getWindows().map((w) => w.id), [a], "the moved window left this workspace");
  assert.equal(wm.getFocusedId(), a);
  const second = wm.getWorkspaces()[1].id;
  wm.switchWorkspace(second);
  assert.equal(wm.getFocusedId(), b, "it is the front window over there");
  wm.removeWorkspace(second);
  assert.equal(wm.getActiveWs(), first);
  assert.equal(wm.getWindows().length, 2, "its windows came along");
  wm.removeWorkspace(first);
  assert.equal(wm.getWorkspaces().length, 1, "the last workspace stays");
});

test("workspaces: show desktop and cycling stay on the active one; old layouts load into the first", () => {
  fresh();
  const a = openApp("gallery", { singleton: true });
  const second = wm.addWorkspace({ go: true });
  const b = openApp("files", { singleton: true });
  wm.toggleDesktop();
  wm.switchWorkspace(-1);
  assert.equal(wm.getAllWindows().find((w) => w.id === a)?.mode, "normal", "the other workspace's windows were not minimized");
  wm.cycle(1);
  assert.equal(wm.getFocusedId(), a, "cycling never leaves the workspace");
  // A layout from before workspaces: no ws on the windows, no workspace list.
  const old = wm.snapshot();
  wm.hydrate({ windows: old.windows.map(({ ws: _ws, ...w }) => w as wm.Win), zTop: old.zTop, focusedId: b, pins: [] });
  assert.equal(wm.getWorkspaces().length, 1);
  assert.equal(wm.getWindows().length, 2);
  assert.ok(second);
});

test("split: per workspace, clamped to 20–80 % and to the snapped windows' minimum widths", () => {
  fresh();
  assert.equal(wm.getSplit(), 0.5);
  wm.setSplit(0.05);
  assert.equal(wm.getSplit(), 0.2);
  wm.setSplit(0.95);
  assert.equal(wm.getSplit(), 0.8);
  const a = openApp("timeline", { singleton: true, minSize: { w: 640, h: 300 } });
  wm.setSnap(a, "right");
  wm.setSplit(0.8);
  assert.equal(wm.getSplit(), 0.5, "the right window needs 640 of 1280 px");
  wm.setSplit(0.3);
  assert.equal(wm.getSplit(), 0.3);
  const other = wm.addWorkspace({ go: true });
  assert.equal(wm.getSplit(), 0.5, "another workspace has its own");
  wm.switchWorkspace(-1);
  assert.equal(wm.getSplit(), 0.3);
  assert.ok(other);
});
