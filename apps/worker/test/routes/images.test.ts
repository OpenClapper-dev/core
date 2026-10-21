/** The image proxy (photos, overlay and sketch renders): headers and conditional requests. */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { api, buildWorld, newUser, ok, type User, type World } from "./helpers.ts";

let u: User;
let w: World;
beforeAll(async () => {
  u = await newUser();
  w = await buildWorld(u);
});

const IMMUTABLE = "private, max-age=31536000, immutable";

describe.each([
  ["photo", () => `/api/photos/${w.photo}/image`, "image/jpeg"],
  ["overlay render", () => `/api/overlays/${w.overlay}/render`, "image/png"],
  ["sketch render", () => `/api/sketches/${w.sketch}/render`, "image/png"],
])("%s", (_what, path, type) => {
  test("is served with its type (never sniffed), an ETag and a year of private caching", async () => {
    const res = await api(u.token, "GET", path());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toMatch(/^"[^"]+"$/);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("If-None-Match with its ETag answers 304 without a body; another ETag gets the image", async () => {
    const etag = (await api(u.token, "GET", path()).then(async (r) => { await r.arrayBuffer(); return r; })).headers.get("etag")!;
    const same = await api(u.token, "GET", path(), undefined, { "If-None-Match": etag });
    expect(same.status).toBe(304);
    expect(same.headers.get("etag")).toBe(etag);
    expect(same.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(await same.text()).toBe("");
    const other = await api(u.token, "GET", path(), undefined, { "If-None-Match": '"something-else"' });
    expect(other.status).toBe(200);
    await other.arrayBuffer();
  });

  test("needs a signed-in user", async () => {
    await ok(api(null, "GET", path()), 401);
  });
});

test("HEAD answers the headers without a body", async () => {
  const res = await api(u.token, "HEAD", `/api/photos/${w.photo}/image`);
  expect(res.status).toBe(200);
  expect(res.headers.get("etag")).toBeTruthy();
  expect(await res.text()).toBe("");
});

// #224: a failed If-Match precondition should be 412; R2 returns the object without a body and the
// route answers 304 like an If-None-Match hit. Turns red once fixed: then drop `.fails`.
test.fails("If-Match with another ETag answers 412 (#224)", async () => {
  const res = await api(u.token, "GET", `/api/photos/${w.photo}/image`, undefined, { "If-Match": '"something-else"' });
  await res.arrayBuffer();
  expect(res.status).toBe(412);
});

test("an image missing in storage is a 404, not an error", async () => {
  const lost = await buildWorld(u);
  const key = (await env.DB.prepare("SELECT r2_object_key AS k FROM photos WHERE id = ?1").bind(lost.photo).first<{ k: string }>())!.k;
  await env.SHOTS_BUCKET.delete(key);
  const res = await ok<{ error: string }>(api(u.token, "GET", `/api/photos/${lost.photo}/image`), 404);
  expect(res.error).toBe("image missing in storage");
});
