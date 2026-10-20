/** Name clashes answer 409 + existing_id (the client adopts that row); a project is deleted only when empty. */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, ok, photoMeta, uploadForm, uuid, type User } from "./helpers.ts";

let u: User, other: User;
beforeAll(async () => { [u, other] = await Promise.all([newUser(), newUser()]); });

describe("projects", () => {
  test("a name taken in the workspace, in any case, answers 409 with the existing id", async () => {
    const first = uuid();
    await ok(api(u.token, "PUT", `/api/projects/${first}`, { name: "Night Shoot" }));
    const res = await ok<{ existing_id: string }>(api(u.token, "PUT", `/api/projects/${uuid()}`, { name: "night shoot" }), 409);
    expect(res.existing_id).toBe(first);
    // Saving the project under its own name is no clash; another workspace may use the name.
    await ok(api(u.token, "PUT", `/api/projects/${first}`, { name: "Night Shoot", notes: "kept" }));
    await ok(api(other.token, "PUT", `/api/projects/${uuid()}`, { name: "Night Shoot" }));
  });

  test("a project with live shots cannot be deleted; with only binned ones it can, and they are purged", async () => {
    const pid = uuid(), shot = uuid(), p = photoMeta(0);
    await ok(api(u.token, "PUT", `/api/projects/${pid}`, { name: "To delete" }));
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id: shot, project_id: pid, photos: [p] })), 201);
    const refused = await ok<{ error: string }>(api(u.token, "DELETE", `/api/projects/${pid}`), 409);
    expect(refused.error).toMatch(/1 shot/);
    await ok(api(u.token, "DELETE", `/api/shots/${shot}`));
    await ok(api(u.token, "DELETE", `/api/projects/${pid}`));
    expect(await env.DB.prepare("SELECT 1 FROM projects WHERE id = ?1").bind(pid).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM shots WHERE id = ?1").bind(shot).first()).toBeNull();
    expect(await env.SHOTS_BUCKET.head(`photos/${p.id}.jpg`)).toBeNull();
    await ok(api(u.token, "DELETE", `/api/projects/${pid}`), 404);
  });
});

describe("locations", () => {
  let project: string, second: string;
  beforeAll(async () => {
    [project, second] = [uuid(), uuid()];
    await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: "Locations" }));
    await ok(api(u.token, "PUT", `/api/projects/${second}`, { name: "Locations 2" }));
  });

  test("a name taken in the project answers 409 with the existing id; other projects may use it", async () => {
    const first = uuid();
    await ok(api(u.token, "PUT", `/api/locations/${first}`, { name: "Bridge", project_id: project }));
    const res = await ok<{ existing_id: string }>(api(u.token, "PUT", `/api/locations/${uuid()}`, { name: "BRIDGE", project_id: project }), 409);
    expect(res.existing_id).toBe(first);
    await ok(api(u.token, "PUT", `/api/locations/${uuid()}`, { name: "Bridge", project_id: second }));
  });

  test("a binned location's name is free again", async () => {
    const binned = uuid();
    await ok(api(u.token, "PUT", `/api/locations/${binned}`, { name: "Pier", project_id: project }));
    await ok(api(u.token, "DELETE", `/api/locations/${binned}`));
    await ok(api(u.token, "PUT", `/api/locations/${uuid()}`, { name: "Pier", project_id: project }));
  });
});
