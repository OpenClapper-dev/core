import assert from "node:assert/strict";
import { test } from "vitest";
import { HttpError } from "@openclapper/service-kit";
import { assertRank, RANK, type Access } from "../../src/tenancy.ts";

const ranks = new Map([["ws-view", RANK.viewer], ["ws-edit", RANK.editor], ["ws-own", RANK.owner]]);
const a: Access = { env: { DB: null as unknown as D1Database }, tenant: { userId: "u", ranks, wsList: JSON.stringify([...ranks.keys()]) } };
const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : -1; } };

test("a workspace the caller is not in looks like a missing row", () => {
  assert.equal(status(() => assertRank(a, "ws-other", "viewer")), 404);
  assert.equal(status(() => assertRank(a, null, "viewer")), 404);
  assert.equal(status(() => assertRank(a, undefined, "viewer")), 404);
});

test("each role can do what the ones below it can, and no more", () => {
  assert.equal(status(() => assertRank(a, "ws-view", "viewer")), 200);
  assert.equal(status(() => assertRank(a, "ws-view", "editor")), 403);
  assert.equal(status(() => assertRank(a, "ws-edit", "editor")), 200);
  assert.equal(status(() => assertRank(a, "ws-edit", "admin")), 403);
  assert.equal(status(() => assertRank(a, "ws-own", "admin")), 200);
  assert.equal(status(() => assertRank(a, "ws-own", "owner")), 200);
});

test("the workspace id comes back for the caller to use", () => {
  assert.equal(assertRank(a, "ws-edit", "viewer"), "ws-edit");
});
