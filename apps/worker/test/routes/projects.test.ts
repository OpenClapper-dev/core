/**
 * A project's description and picture (#426, second round): the description goes with the project; the picture is
 * an image of its own (not a file of the project), JPEG, PNG or WebP, at most 5 MB and 4 megapixels.
 */
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, ok, uuid, type User } from "./helpers.ts";

let u: User, other: User;
beforeAll(async () => { u = await newUser(); other = await newUser(); });

/** A PNG header that says it is w × h (the server reads the size from the header, never decodes). */
const pngOf = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const putPicture = (token: string, id: string, bytes: Uint8Array) =>
  exports.default.fetch(new Request(`http://localhost/api/projects/${id}/picture`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: bytes }));

describe("a project's description and picture", () => {
  test("the description is saved and kept; the picture is checked, read back, refused to others, and removed", async () => {
    const id = uuid();
    const made = await ok<{ project: { description: string; picture_at: string | null } }>(api(u.token, "PUT", `/api/projects/${id}`, { name: `P ${id}`, description: "Night train, two weeks in March" }), 201);
    expect(made.project).toMatchObject({ description: "Night train, two weeks in March", picture_at: null });
    const renamed = await ok<{ project: { description: string } }>(api(u.token, "PUT", `/api/projects/${id}`, { name: `Q ${id}` }));
    expect(renamed.project.description).toBe("Night train, two weeks in March");
    await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `Q ${id}`, description: "x".repeat(2001) }), 400);

    expect((await putPicture(u.token, id, pngOf(2100, 2100))).status).toBe(413);
    expect((await putPicture(u.token, id, new TextEncoder().encode("not an image"))).status).toBe(415);
    const set = await putPicture(u.token, id, pngOf(2000, 1500));
    expect(set.status).toBe(200);
    expect(((await set.json()) as { project: { picture_at: string | null } }).project.picture_at).toBeTruthy();
    const got = await api(u.token, "GET", `/api/projects/${id}/picture`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect((await api(other.token, "GET", `/api/projects/${id}/picture`)).status).toBe(404);
    expect([403, 404]).toContain((await putPicture(other.token, id, pngOf(10, 10))).status);
    await ok(api(u.token, "DELETE", `/api/projects/${id}/picture`));
    expect((await api(u.token, "GET", `/api/projects/${id}/picture`)).status).toBe(404);
  });
});
