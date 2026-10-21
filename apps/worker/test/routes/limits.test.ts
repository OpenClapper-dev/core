/**
 * Upload limits and checks (#224): the body size before parsing, the image type from its magic
 * bytes, photos per shot, and the preview room's message size.
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { api, buildWorld, jpeg, newUser, ok, overlayBody, photoMeta, png, uploadForm, uuid, type User, type World } from "./helpers.ts";
import { DEFAULT_VIEWFINDER_LAYOUT } from "@openclapper/vocab";

let u: User;
let w: World;
let project: string;
beforeAll(async () => {
  u = await newUser();
  w = await buildWorld(u);
  project = uuid();
  await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: "Limits" }));
});

const BIG = String(1024 * 1024 * 1024);
const webp = () => new File([new TextEncoder().encode("RIFF"), new Uint8Array([1, 2, 3, 4]), new TextEncoder().encode("WEBPVP8 ")], "w.webp", { type: "application/octet-stream" });
const text = () => new File(["just some text, not an image"], "p.jpg", { type: "image/jpeg" });
const objects = (prefix: string) => env.SHOTS_BUCKET.list({ prefix }).then((r) => r.objects.map((o) => o.key));

/** The phone's upload with chosen files per photo. */
function formWith(meta: Record<string, unknown> & { photos: { id: string }[] }, files: File[]): FormData {
  const form = new FormData();
  form.set("metadata", JSON.stringify(meta));
  meta.photos.forEach((p, i) => form.set(`photo.${p.id}`, files[i]));
  return form;
}

describe("POST /api/shots", () => {
  test("a declared body above the ceiling is 413 before anything is read", async () => {
    const id = uuid();
    const res = await ok<{ error: string }>(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [photoMeta(0)] }), { "content-length": BIG }), 413);
    expect(res.error).toMatch(/request too large/);
    await ok(api(u.token, "GET", `/api/shots/${id}`), 404);
  });

  test("the stored type comes from the bytes, not from what the client says", async () => {
    const id = uuid(), [a, b, c] = [photoMeta(0), photoMeta(1), photoMeta(2)];
    const files = [png("p", "image/jpeg"), webp(), new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), "x"], "p.bin", { type: "" })];
    await ok(api(u.token, "POST", "/api/shots", formWith({ id, project_id: project, photos: [a, b, c] }, files)), 201);
    expect(await objects(`photos/${a.id}`)).toEqual([`photos/${a.id}.png`]);
    expect(await objects(`photos/${b.id}`)).toEqual([`photos/${b.id}.webp`]);
    expect(await objects(`photos/${c.id}`)).toEqual([`photos/${c.id}.jpg`]);
    const res = await api(u.token, "GET", `/api/photos/${a.id}/image`);
    expect(res.headers.get("content-type")).toBe("image/png");
    await res.arrayBuffer();
  });

  test("a file that is no JPEG, PNG or WebP is 415 and nothing is written (the phone keeps it as stuck)", async () => {
    const id = uuid(), [a, b] = [photoMeta(0), photoMeta(1)];
    const res = await ok<{ error: string }>(api(u.token, "POST", "/api/shots", formWith({ id, project_id: project, photos: [a, b] }, [jpeg(), text()])), 415);
    expect(res.error).toMatch(/not a JPEG, PNG or WebP/);
    await ok(api(u.token, "GET", `/api/shots/${id}`), 404);
    expect(await objects(`photos/${a.id}`)).toEqual([]);
  });

  test("a shot holds at most 200 photos across its uploads; a retry of what it has still passes", async () => {
    const id = uuid(), first = photoMeta(0);
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [first] })), 201);
    // 198 more straight in D1 (the Worker only counts them): 199 held.
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 198)
       INSERT INTO photos (id, shot_id, ordinal, timestamp, lens_mm, r2_object_key) SELECT ?1 || '-' || i, ?1, i, ?2, 35, 'photos/' || ?1 || '-' || i FROM n`,
    ).bind(id, first.timestamp).run();
    const two = [photoMeta(500), photoMeta(501)];
    const res = await ok<{ error: string }>(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [first, ...two] }, two.map((p) => p.id))), 413);
    expect(res.error).toMatch(/at most 200 photos/);
    expect(await objects(`photos/${two[0].id}`)).toEqual([]);
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [first, two[0]] }, [two[0].id])), 200);
    const again = await ok<{ duplicate: boolean }>(api(u.token, "POST", "/api/shots", uploadForm({ id, project_id: project, photos: [first] })), 200);
    expect(again.duplicate).toBe(true);
  });
});

describe("compose renders", () => {
  test("a declared body above the ceiling is 413", async () => {
    const form = new FormData();
    form.set("metadata", JSON.stringify(overlayBody(w.photo, "big")));
    form.set("render", png());
    await ok(api(u.token, "PUT", `/api/overlays/${uuid()}`, form, { "content-length": BIG }), 413);
  });

  test("the render's type comes from its bytes; anything else is 415", async () => {
    const id = uuid();
    const form = (file: File) => { const f = new FormData(); f.set("metadata", JSON.stringify(overlayBody(w.photo, `typed ${id}`))); f.set("render", file); return f; };
    await ok(api(u.token, "PUT", `/api/overlays/${id}`, form(text())), 415);
    await ok(api(u.token, "PUT", `/api/overlays/${id}`, form(webp())), 201);
    expect(await objects(`renders/overlays/${id}`)).toEqual([`renders/overlays/${id}.webp`]);
  });
});

describe("preview room", () => {
  /** A websocket into the caller's room, collecting what it receives. */
  async function socket(role: "phone" | "studio") {
    const res = await api(u.token, "GET", `/api/preview/socket?role=${role}`, undefined, { Upgrade: "websocket" });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const got: Record<string, unknown>[] = [];
    ws.addEventListener("message", (e) => got.push(JSON.parse(String(e.data)) as Record<string, unknown>));
    ws.accept();
    return { ws, got };
  }
  const until = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); expect(fn()).toBe(true); };

  test("a message over 64 KiB is dropped; the next normal one is relayed", async () => {
    const phone = await socket("phone");
    const studio = await socket("studio");
    // Valid apart from its size: the padding sits outside the layout, which passes validation.
    studio.ws.send(JSON.stringify({ type: "preview", layout: DEFAULT_VIEWFINDER_LAYOUT, orientation: "portrait", pad: "x".repeat(70 * 1024) }));
    studio.ws.send(JSON.stringify({ type: "preview", layout: DEFAULT_VIEWFINDER_LAYOUT, orientation: "landscape" }));
    const previews = () => phone.got.filter((m) => m.type === "preview");
    await until(() => previews().length > 0);
    expect(previews().map((m) => m.orientation)).toEqual(["landscape"]);
    studio.ws.send(JSON.stringify({ type: "stop" }));
    phone.ws.close();
    studio.ws.close();
  });
});
