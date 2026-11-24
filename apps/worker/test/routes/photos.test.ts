/**
 * Photos (step B2, #374): what is known about a photo, its three images each on its own, delivery in
 * three sizes, retries that change nothing, copies that share the stored images, and purge that
 * removes them only with the last photo using them.
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { addPhoto, api, folderBody, jpeg, newUser, ok, png, putImage, runCron, uuid, type User } from "./helpers.ts";

interface PhotoFile { id: string; name: string; container: string | null; body: { exif: Record<string, unknown>; readout: Record<string, string> }; photo: { origin: string; taken_at: string; width: number; height: number; stored: Record<string, number | null>; angle_of_view: { horizontal: number; vertical: number; source: string } | null } }

let u: User, project: string;
beforeAll(async () => {
  u = await newUser();
  project = uuid();
  await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: "Photos" }), 201);
});
const objects = (prefix: string) => env.SHOTS_BUCKET.list({ prefix }).then((r) => r.objects.map((o) => o.key).sort());
const meta = (extra: Record<string, unknown> = {}) => ({ project_id: project, origin: "capture", media_type: "image/jpeg", taken_at: "2026-11-02T09:30:00+01:00", width: 3000, height: 4000, ...extra });
const one = async (id: string) => (await ok<{ file: PhotoFile }>(api(u.token, "GET", `/api/files/${id}`))).file;

describe("adding a photo", () => {
  test("what is known comes first; the angle of view is computed from the EXIF; sent again it changes nothing", async () => {
    const id = uuid();
    const made = await ok<{ file: PhotoFile }>(api(u.token, "PUT", `/api/photos/${id}`, meta({ name: "IMG_0142", exif: { FocalLengthIn35mmFilm: 24, Make: "Google", Bad: { x: 1 } }, readout: { make: "Google", model: "Pixel 9", owner: "x" } })), 201);
    expect(made.file).toMatchObject({ name: "IMG_0142", type: "photo", body: { exif: { FocalLengthIn35mmFilm: 24, Make: "Google" }, readout: { make: "Google", model: "Pixel 9" } } });
    expect(made.file.photo).toMatchObject({ origin: "capture", taken_at: "2026-11-02T08:30:00.000Z", width: 3000, height: 4000, stored: { thumbnail: null, preview: null, original: null } });
    expect(made.file.photo.angle_of_view?.source).toBe("exif-35mm");
    expect(made.file.photo.angle_of_view!.vertical).toBeGreaterThan(made.file.photo.angle_of_view!.horizontal);
    const again = await ok<{ file: PhotoFile }>(api(u.token, "PUT", `/api/photos/${id}`, meta({ name: "Something else", width: 10, height: 10 })), 200);
    expect(again.file.name).toBe("IMG_0142");
    expect(again.file.photo.width).toBe(3000);
  });

  test("without usable EXIF there is no angle of view; without a time it is the time of the import", async () => {
    const id = uuid();
    const f = (await ok<{ file: PhotoFile }>(api(u.token, "PUT", `/api/photos/${id}`, meta({ origin: "import", taken_at: "not a date", exif: {} })), 201)).file;
    expect(f.photo.angle_of_view).toBeNull();
    expect(Date.now() - Date.parse(f.photo.taken_at)).toBeLessThan(60_000);
  });

  test("a folder or collection that is gone is dropped, not refused (never lose a capture)", async () => {
    const coll = uuid(), gone = uuid();
    await ok(api(u.token, "PUT", `/api/files/${coll}`, { type: "collection", project_id: project, name: "Day 1" }), 201);
    expect((await ok<{ file: PhotoFile }>(api(u.token, "PUT", `/api/photos/${uuid()}`, meta({ container: coll })), 201)).file.container).toBe(coll);
    expect((await ok<{ file: PhotoFile }>(api(u.token, "PUT", `/api/photos/${uuid()}`, meta({ container: gone })), 201)).file.container).toBeNull();
    await ok(api(u.token, "POST", "/api/files/bin", { ids: [coll] }));
    expect((await ok<{ file: PhotoFile }>(api(u.token, "PUT", `/api/photos/${uuid()}`, meta({ container: coll })), 201)).file.container).toBeNull();
  });

  test("what is strict: the project, the origin, the size", async () => {
    await ok(api(u.token, "PUT", `/api/photos/${uuid()}`, meta({ project_id: uuid() })), 400);
    await ok(api(u.token, "PUT", `/api/photos/${uuid()}`, meta({ origin: "drawn" })), 400);
    await ok(api(u.token, "PUT", `/api/photos/${uuid()}`, meta({ width: 0 })), 400);
    // A photo is never made, nor its body changed, through the general file route.
    await ok(api(u.token, "PUT", `/api/files/${uuid()}`, { type: "photo", project_id: project }), 400);
    const id = await addPhoto(u.token, project);
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { exif: {}, readout: {} } }), 400);
    expect((await ok<{ file: PhotoFile }>(api(u.token, "PUT", `/api/files/${id}`, { name: "Renamed" }), 200)).file.name).toBe("Renamed");
    // Another file's id is not taken over by a photo.
    const folder = uuid();
    await ok(api(u.token, "PUT", `/api/files/${folder}`, folderBody({ project_id: project }, "F")), 201);
    await ok(api(u.token, "PUT", `/api/photos/${folder}`, meta()), 409);
  });
});

describe("images", () => {
  test("each image on its own, in any order; stored once; the type from the bytes", async () => {
    const id = uuid();
    await ok(api(u.token, "PUT", `/api/photos/${id}`, meta()), 201);
    await ok(api(u.token, "GET", `/api/photos/${id}/image`), 404);
    expect((await ok<{ file: PhotoFile }>(putImage(u.token, id, "preview", jpeg("pre")), 201)).file.photo.stored.preview).toBe(7);
    const again = await ok<{ already: boolean }>(putImage(u.token, id, "preview", jpeg("different")), 200);
    expect(again.already).toBe(true);
    await ok(putImage(u.token, id, "original", png("orig")), 201);
    expect(await objects(`photos/${id}/`)).toEqual([`photos/${id}/original.png`, `photos/${id}/preview.jpg`]);
    const res = await api(u.token, "GET", `/api/photos/${id}/image?size=original`);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89);
    expect(await (await api(u.token, "GET", `/api/photos/${id}/image`)).arrayBuffer().then((b) => b.byteLength)).toBe(7);
    await ok(api(u.token, "GET", `/api/photos/${id}/image?size=thumbnail`), 404);
    await ok(api(u.token, "GET", `/api/photos/${id}/image?size=huge`), 400);
  });

  test("what is refused: not an image, the wrong kind for a preview, too large, empty, another part", async () => {
    const id = uuid();
    await ok(api(u.token, "PUT", `/api/photos/${id}`, meta()), 201);
    await ok(putImage(u.token, id, "preview", new TextEncoder().encode("just text")), 415);
    await ok(putImage(u.token, id, "thumbnail", png()), 415);
    await ok(putImage(u.token, id, "thumbnail", new Uint8Array(0)), 400);
    await ok(putImage(u.token, id, "thumbnail", new Uint8Array([0xff, 0xd8, 0xff, ...new Uint8Array(401 * 1024)])), 413);
    await ok(putImage(u.token, id, "poster" as "preview", jpeg()), 404);
    expect(await objects(`photos/${id}/`)).toEqual([]);
  });

  test("served with its type, an ETag and a year of private caching; conditional requests as HTTP says", async () => {
    const id = await addPhoto(u.token, project);
    const path = `/api/photos/${id}/image?size=thumbnail`;
    const res = await api(u.token, "GET", path);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const etag = res.headers.get("etag")!;
    await res.arrayBuffer();
    const same = await api(u.token, "GET", path, undefined, { "If-None-Match": etag });
    expect(same.status).toBe(304);
    await same.arrayBuffer();
    await ok(api(u.token, "GET", path, undefined, { "If-Match": '"else"' }), 412);
    await ok(api(null, "GET", path), 401);
  });
});

describe("copies and purge", () => {
  test("a copy shares the stored images; they go only with the last photo using them", async () => {
    const id = await addPhoto(u.token, project);
    const copy = (await ok<{ file: PhotoFile & { id: string } }>(api(u.token, "POST", `/api/files/${id}/duplicate`, { id: uuid() }), 201)).file;
    expect(copy.photo.stored).toEqual((await one(id)).photo.stored);
    expect(await objects(`photos/${copy.id}/`)).toEqual([]);
    expect((await api(u.token, "GET", `/api/photos/${copy.id}/image`)).status).toBe(200);
    await ok(api(u.token, "POST", "/api/files/bin", { ids: [id] }));
    await ok(api(u.token, "POST", "/api/files/purge", { ids: [id] }));
    expect(await objects(`photos/${id}/`)).toHaveLength(3);
    expect((await api(u.token, "GET", `/api/photos/${copy.id}/image?size=original`)).status).toBe(200);
    await ok(api(u.token, "POST", "/api/files/bin", { ids: [copy.id] }));
    await ok(api(u.token, "POST", "/api/files/purge", { ids: [copy.id] }));
    expect(await objects(`photos/${id}/`)).toEqual([]);
  });

  test("a binned collection's photos are purged with it, by hand or by the cron", async () => {
    const coll = uuid();
    await ok(api(u.token, "PUT", `/api/files/${coll}`, { type: "collection", project_id: project, name: "Old" }), 201);
    const id = await addPhoto(u.token, project, uuid(), { container: coll });
    await ok(api(u.token, "POST", "/api/files/bin", { ids: [coll] }));
    await env.DB.prepare("UPDATE files SET deleted_at = ?1 WHERE id IN (?2, ?3)").bind(new Date(Date.now() - 31 * 86_400_000).toISOString(), coll, id).run();
    await runCron();
    expect(await objects(`photos/${id}/`)).toEqual([]);
    expect(await env.DB.prepare("SELECT 1 FROM photos WHERE file_id = ?1").bind(id).first()).toBeNull();
  });
});

describe("lists", () => {
  test("photos come with their facts; a list can be paged", async () => {
    const p = uuid();
    await ok(api(u.token, "PUT", `/api/projects/${p}`, { name: "Paged" }), 201);
    for (let i = 0; i < 3; i++) await addPhoto(u.token, p, uuid(), { name: `P${i}` });
    const first = await ok<{ files: PhotoFile[]; more: boolean }>(api(u.token, "GET", `/api/files?project_id=${p}&type=photo&limit=2`));
    expect(first.files.map((f) => f.name)).toEqual(["P0", "P1"]);
    expect(first.more).toBe(true);
    expect(first.files[0].photo.stored.preview).toBeGreaterThan(0);
    const rest = await ok<{ files: PhotoFile[]; more: boolean }>(api(u.token, "GET", `/api/files?project_id=${p}&type=photo&limit=2&offset=2`));
    expect([rest.files.map((f) => f.name), rest.more]).toEqual([["P2"], false]);
  });
});
