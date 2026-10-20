/**
 * POST /api/shots, the phone's upload: never lose a capture (idempotent, continued in parts,
 * lenient about stale metadata), against the strict interactive PATCH.
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, ok, photoMeta, uploadForm, uuid, type User } from "./helpers.ts";

interface Shot { id: string; name: string | null; location_id: string | null; captured_at: string; extra: Record<string, unknown>; photos: { id: string; preset_id: string | null }[] }
type Upload = { shot: Shot; duplicate: boolean };

let u: User;
let project: string, other: string, location: string, preset: string;

beforeAll(async () => {
  u = await newUser();
  [project, other, location, preset] = [uuid(), uuid(), uuid(), uuid()];
  await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: "Uploads" }));
  await ok(api(u.token, "PUT", `/api/projects/${other}`, { name: "Other" }));
  await ok(api(u.token, "PUT", `/api/locations/${location}`, { name: "Station", project_id: project }));
  await ok(api(u.token, "PUT", `/api/presets/${preset}`, { name: "Rig", sensor_width_mm: 36, sensor_height_mm: 24 }));
});

const photoRows = (shot: string) => env.DB.prepare("SELECT id, size_bytes, r2_object_key FROM photos WHERE shot_id = ?1 ORDER BY ordinal").bind(shot).all<{ id: string; size_bytes: number; r2_object_key: string }>().then((r) => r.results);
const shotCount = (shot: string) => env.DB.prepare("SELECT count(*) AS n FROM shots WHERE id = ?1").bind(shot).first<{ n: number }>().then((r) => r!.n);

describe("idempotent", () => {
  test("a first upload stores the shot, the image in R2 and its size; a retry adds nothing", async () => {
    const id = uuid(), p = photoMeta(0, { preset_id: preset });
    const form = () => uploadForm({ id, project_id: project, name: "Platform", location_id: location, photos: [p] });
    const first = await ok<Upload>(api(u.token, "POST", "/api/shots", form()), 201);
    expect(first.duplicate).toBe(false);
    expect(first.shot.photos.map((x) => x.id)).toEqual([p.id]);
    expect(first.shot.photos[0].preset_id).toBe(preset);
    const [row] = await photoRows(id);
    expect(row.r2_object_key).toBe(`photos/${p.id}.jpg`);
    const obj = await env.SHOTS_BUCKET.head(row.r2_object_key);
    expect(obj?.size).toBeGreaterThan(0);
    expect(row.size_bytes).toBe(obj!.size);
    expect(obj!.customMetadata).toMatchObject({ shot_id: id, photo_id: p.id, workspace_id: u.workspace });

    const again = await ok<Upload>(api(u.token, "POST", "/api/shots", form()), 200);
    expect(again.duplicate).toBe(true);
    expect(await photoRows(id)).toHaveLength(1);
    expect(await shotCount(id)).toBe(1);
  });

  test("a retry leaves tags edited since alone", async () => {
    const id = uuid(), p = photoMeta(0);
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, name: "Phone name", photos: [p] })), 201);
    await ok(api(u.token, "PATCH", `/api/shots/${id}`, { name: "Edited in the Studio" }));
    const again = await ok<Upload>(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, name: "Phone name", photos: [p] })), 200);
    expect(again.shot.name).toBe("Edited in the Studio");
  });

  test("a sequence sent in parts ends up whole, ordered, with the earliest capture time", async () => {
    const id = uuid();
    const [p0, p1, p2] = [photoMeta(1), photoMeta(2), photoMeta(0)];
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [p0] })), 201);
    // The second part lists the whole sequence but only sends the images not stored yet.
    const done = await ok<Upload>(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [p0, p1, p2] }, [p1.id, p2.id])), 200);
    expect(done.duplicate).toBe(false);
    expect(done.shot.photos.map((x) => x.id)).toEqual([p2.id, p0.id, p1.id]);
    expect(done.shot.captured_at).toBe(p2.timestamp);
    for (const ph of [p0, p1, p2]) expect(await env.SHOTS_BUCKET.head(`photos/${ph.id}.jpg`)).not.toBeNull();
  });

  test("an upload for a shot binned meanwhile brings it back", async () => {
    const id = uuid(), p0 = photoMeta(0);
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [p0] })), 201);
    await ok(api(u.token, "DELETE", `/api/shots/${id}`));
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [p0, photoMeta(1)] })), 200);
    await ok(api(u.token, "GET", `/api/shots/${id}`));
  });

  test("a photo id of another shot is a conflict, and nothing is written", async () => {
    const taken = photoMeta(0);
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id: uuid(), project_id: project, photos: [taken] })), 201);
    const before = await env.SHOTS_BUCKET.head(`photos/${taken.id}.jpg`);
    const id = uuid();
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [taken] })), 409);
    expect(await shotCount(id)).toBe(0);
    expect((await env.SHOTS_BUCKET.head(`photos/${taken.id}.jpg`))?.etag).toBe(before?.etag);
  });

  test("a missing image is refused before anything is stored", async () => {
    const id = uuid(), p = photoMeta(0);
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [p] }, [])), 400);
    expect(await shotCount(id)).toBe(0);
    expect(await env.SHOTS_BUCKET.head(`photos/${p.id}.jpg`)).toBeNull();
  });
});

describe("lenient upload, strict edit", () => {
  test("stale rig and location are nulled, an overlong name is cut, unknown extra fields are kept", async () => {
    const id = uuid();
    const res = await ok<Upload>(api(u.token, "POST", "/api/shots", uploadForm({
      id, project_id: project, name: "n".repeat(200), location_id: uuid(), extra: { gone_field: "kept" },
      photos: [photoMeta(0, { preset_id: uuid() })],
    })), 201);
    expect(res.shot.name).toBe("n".repeat(120));
    expect(res.shot.location_id).toBeNull();
    expect(res.shot.photos[0].preset_id).toBeNull();
    expect(res.shot.extra).toEqual({ gone_field: "kept" });

    // The same values in an interactive edit are refused.
    await ok(api(u.token, "PATCH", `/api/shots/${id}`, { name: "n".repeat(200) }), 400);
    await ok(api(u.token, "PATCH", `/api/shots/${id}`, { location_id: uuid() }), 400);
    await ok(api(u.token, "PATCH", `/api/shots/${id}`, { extra: { gone_field: "x" } }), 400);
  });

  test("a binned location is dropped from an upload", async () => {
    const binned = uuid();
    await ok(api(u.token, "PUT", `/api/locations/${binned}`, { name: "Binned", project_id: project }));
    await ok(api(u.token, "DELETE", `/api/locations/${binned}`));
    const res = await ok<Upload>(api(u.token, "POST", "/api/shots", uploadForm({ id: uuid(), project_id: project, location_id: binned, photos: [photoMeta(0)] })), 201);
    expect(res.shot.location_id).toBeNull();
  });

  test("a location of another project (a stale phone) becomes this project's location of that name", async () => {
    const res = await ok<Upload>(api(u.token, "POST", "/api/shots", uploadForm({ id: uuid(), project_id: other, location_id: location, photos: [photoMeta(0)] })), 201);
    expect(res.shot.location_id).not.toBeNull();
    expect(res.shot.location_id).not.toBe(location);
    const copy = await env.DB.prepare("SELECT project_id, name FROM locations WHERE id = ?1").bind(res.shot.location_id).first();
    expect(copy).toEqual({ project_id: other, name: "Station" });
    // An edit may only pick the shot's own project's locations.
    await ok(api(u.token, "PATCH", `/api/shots/${res.shot.id}`, { location_id: location }), 400);
  });

  test("an unknown project parks the upload (400, the phone keeps it as stuck)", async () => {
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id: uuid(), project_id: uuid(), photos: [photoMeta(0)] })), 400);
  });

  test("a field value the project's definition refuses passes an upload but not an edit", async () => {
    const fieldProject = uuid();
    await ok(api(u.token, "PUT", `/api/projects/${fieldProject}`, { name: "With fields" }));
    await ok(api(u.token, "PUT", `/api/fields/${uuid()}`, { project_id: fieldProject, definition: { key: "takes", label: "Takes", type: "number" } }));
    const res = await ok<Upload>(api(u.token, "POST", "/api/shots", uploadForm({ id: uuid(), project_id: fieldProject, extra: { takes: "many" }, photos: [photoMeta(0)] })), 201);
    expect(res.shot.extra).toEqual({ takes: "many" });
    await ok(api(u.token, "PATCH", `/api/shots/${res.shot.id}`, { extra: { takes: "many" } }), 400);
    await ok(api(u.token, "PATCH", `/api/shots/${res.shot.id}`, { extra: { takes: 3 } }), 200);
  });
});
