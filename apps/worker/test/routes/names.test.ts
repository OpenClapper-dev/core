/** Project names clash within a workspace (409 + existing_id, the client adopts that row); a project is deleted only when empty. */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { api, folderBody, newUser, ok, uuid, type User } from "./helpers.ts";

let u: User, other: User;
beforeAll(async () => { [u, other] = await Promise.all([newUser(), newUser()]); });

describe("projects", () => {
  test("a name taken in the workspace, in any case, answers 409 with the existing id", async () => {
    const first = uuid();
    await ok(api(u.token, "PUT", `/api/projects/${first}`, { name: "Night Shoot" }), 201);
    const res = await ok<{ existing_id: string }>(api(u.token, "PUT", `/api/projects/${uuid()}`, { name: "night shoot" }), 409);
    expect(res.existing_id).toBe(first);
    // Saving the project under its own name is no clash; another workspace may use the name.
    await ok(api(u.token, "PUT", `/api/projects/${first}`, { name: "Night Shoot" }), 200);
    await ok(api(other.token, "PUT", `/api/projects/${uuid()}`, { name: "Night Shoot" }), 201);
  });

  test("a project with live files cannot be deleted; with only binned ones it can, and they are purged", async () => {
    const pid = uuid(), folder = uuid();
    const made = await ok<{ project: { file_count: number } }>(api(u.token, "PUT", `/api/projects/${pid}`, { name: "To delete" }));
    expect(made.project.file_count).toBe(0);
    await ok(api(u.token, "PUT", `/api/files/${folder}`, folderBody({ project_id: pid }, "Kept")), 201);
    const refused = await ok<{ error: string }>(api(u.token, "DELETE", `/api/projects/${pid}`), 409);
    expect(refused.error).toMatch(/1 file/);
    await ok(api(u.token, "POST", "/api/files/bin", { ids: [folder] }));
    await ok(api(u.token, "DELETE", `/api/projects/${pid}`));
    expect(await env.DB.prepare("SELECT 1 FROM projects WHERE id = ?1").bind(pid).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM files WHERE project_id = ?1").bind(pid).first()).toBeNull();
    await ok(api(u.token, "DELETE", `/api/projects/${pid}`), 404);
  });
});
