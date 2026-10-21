/** Response headers of API answers, the CSRF guard on cookie sessions, strict JSON bodies, malformed paths (#224). */
import { exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { api, newUser, ok, uuid } from "./helpers.ts";

/** A Studio session: the cookie the login sets for `client: "dashboard"`. */
async function studioCookie(): Promise<string> {
  const u = await newUser({ signIn: false });
  const res = await api(null, "POST", "/api/auth/login", { email: u.email, password: u.password, client: "dashboard" });
  await ok(res);
  return res.headers.get("set-cookie")!.split(";")[0];
}

describe("API answers", () => {
  test("are never cached, never sniffed and send no full referrer, errors included", async () => {
    const u = await newUser();
    for (const res of [await api(u.token, "GET", "/api/me"), await api(null, "GET", "/api/me"), await api(u.token, "GET", "/api/nothing-here")]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
      await res.arrayBuffer();
    }
  });
});

describe("CSRF: a cross-site change with the cookie", () => {
  test("is refused, and changes nothing", async () => {
    const cookie = await studioCookie();
    const res = await ok<{ error: string }>(api(null, "PUT", `/api/projects/${uuid()}`, { name: "Forged" }, { Cookie: cookie, "Sec-Fetch-Site": "cross-site" }), 403);
    expect(res.error).toMatch(/cross-site/);
    const { projects } = await ok<{ projects: { name: string }[] }>(api(null, "GET", "/api/projects", undefined, { Cookie: cookie }));
    expect(projects.map((p) => p.name)).not.toContain("Forged");
  });

  test("is refused on the public routes too (signing out)", async () => {
    const cookie = await studioCookie();
    await ok(api(null, "POST", "/api/auth/logout", undefined, { Cookie: cookie, "Sec-Fetch-Site": "cross-site" }), 403);
    await ok(api(null, "GET", "/api/me", undefined, { Cookie: cookie }));
  });

  test("passes from the Studio itself (same-origin) and for reads", async () => {
    const cookie = await studioCookie();
    await ok(api(null, "PUT", `/api/projects/${uuid()}`, { name: "Mine" }, { Cookie: cookie, "Sec-Fetch-Site": "same-origin" }));
    await ok(api(null, "GET", "/api/projects", undefined, { Cookie: cookie, "Sec-Fetch-Site": "cross-site" }));
  });

  test("a bearer token passes whatever the header says (the phone)", async () => {
    const u = await newUser();
    await ok(api(u.token, "PUT", `/api/projects/${uuid()}`, { name: "Phone" }, { "Sec-Fetch-Site": "cross-site" }));
  });
});

describe("JSON bodies", () => {
  test("need application/json exactly; parameters are fine", async () => {
    const u = await newUser();
    const raw = (type: string) => putRaw(u.token, type, JSON.stringify({ name: `Typed ${uuid()}` }));
    await ok(raw("text/plain; application/json"), 415);
    await ok(raw("application/jsonx"), 415);
    await ok(raw("application/json; charset=utf-8"));
    await ok(raw("Application/JSON"));
  });
});

/** A project PUT with a raw body and a chosen content type (the `api` helper always labels JSON application/json). */
function putRaw(token: string, type: string, body: string): Promise<Response> {
  return exports.default.fetch(new Request(`http://openclapper.test/api/projects/${uuid()}`, {
    method: "PUT", body, headers: { Authorization: `Bearer ${token}`, "content-type": type },
  }));
}

test("a malformed % sequence in the path is a 400, not a 500", async () => {
  const u = await newUser();
  const res = await ok<{ error: string }>(api(u.token, "GET", "/api/projects/%E0%A4%A"), 400);
  expect(res.error).toBe("malformed path");
});
