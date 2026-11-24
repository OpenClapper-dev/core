/** Extensions are switched on per project (step B9, #381; docs/rewrite/08-extensions.md). */
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, ok, uuid, type User } from "./helpers.ts";

let u: User;
beforeAll(async () => { u = await newUser(); });

describe("a project's extensions", () => {
  test("none at first; a list is kept, kept when absent, checked when sent", async () => {
    const id = uuid();
    const made = await ok<{ project: { extensions: string[] } }>(api(u.token, "PUT", `/api/projects/${id}`, { name: `E ${id}` }), 201);
    expect(made.project.extensions).toEqual([]);
    const on = await ok<{ project: { extensions: string[] } }>(api(u.token, "PUT", `/api/projects/${id}`, { name: `E ${id}`, extensions: ["hardware"] }));
    expect(on.project.extensions).toEqual(["hardware"]);
    const kept = await ok<{ project: { extensions: string[] } }>(api(u.token, "PUT", `/api/projects/${id}`, { name: `F ${id}` }));
    expect(kept.project.extensions).toEqual(["hardware"]);
    await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `F ${id}`, extensions: "hardware" }), 400);
    await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `F ${id}`, extensions: ["hardware", "hardware"] }), 400);
    await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `F ${id}`, extensions: ["Bad Id"] }), 400);
  });

  test("a phone registers only as a phone or tablet", async () => {
    await ok(api(u.token, "POST", "/api/devices/register", { fingerprint: `fp-${uuid().slice(0, 12)}`, kind: "light", make: "X", model: "Y", lenses: [], screen: null, app: "1" }), 400);
  });
});
