/** Signing in and out (authn/first-party.ts, sessions.ts) through the public routes. */
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { sha256Hex } from "../../src/authn/sessions.ts";
import { api, newUser, ok, runCron, signIn } from "./helpers.ts";

const login = (email: string, password: string, client = "mobile") => api(null, "POST", "/api/auth/login", { email, password, client });
const failures = (id: string) => env.DB.prepare("SELECT failed_logins AS n FROM users WHERE id = ?1").bind(id).first<{ n: number }>().then((r) => r!.n);

describe("sign-in", () => {
  test("a wrong password and an unknown email get the same 401; the failure is counted", async () => {
    const u = await newUser({ signIn: false });
    const wrong = await ok<{ error: string }>(login(u.email, "not the password"), 401);
    const unknown = await ok<{ error: string }>(login("nobody@test.invalid", "whatever"), 401);
    expect(wrong.error).toBe(unknown.error);
    expect(await failures(u.id)).toBe(1);
    await signIn(u.email, u.password);
    expect(await failures(u.id)).toBe(0);
  });

  test("five failures in a row lock the account for a while, even for the right password", async () => {
    const u = await newUser({ signIn: false });
    for (let i = 0; i < 5; i++) await ok(login(u.email, "wrong"), 401);
    await ok(login(u.email, u.password), 429);
  });

  test("a blocked account is told so only after the right password", async () => {
    const u = await newUser({ status: "blocked", signIn: false });
    await ok(login(u.email, "wrong"), 401);
    const res = await ok<{ error: string }>(login(u.email, u.password), 403);
    expect(res.error).toMatch(/blocked/);
  });

  test("blocking ends the sessions the account already has", async () => {
    const u = await newUser();
    await ok(api(u.token, "GET", "/api/me"));
    await env.DB.prepare("UPDATE users SET status = 'blocked' WHERE id = ?1").bind(u.id).run();
    await ok(api(u.token, "GET", "/api/me"), 401);
  });

  test("the Studio gets an HttpOnly cookie and no token in the body", async () => {
    const u = await newUser({ signIn: false });
    const res = await login(u.email, u.password, "dashboard");
    const body = await ok<Record<string, unknown>>(res);
    expect(body.token).toBeUndefined();
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^openclapper_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    await ok(api(null, "GET", "/api/me", undefined, { Cookie: cookie.split(";")[0] }));
  });

  test("without a session every API route answers 401", async () => {
    await ok(api(null, "GET", "/api/projects"), 401);
    await ok(api("not-a-token", "GET", "/api/projects"), 401);
  });
});

describe("sign-out and expiry", () => {
  test("signing out ends the session at once", async () => {
    const u = await newUser();
    await ok(api(u.token, "POST", "/api/auth/logout"), 204);
    await ok(api(u.token, "GET", "/api/me"), 401);
    expect(await env.DB.prepare("SELECT 1 FROM sessions WHERE id = ?1").bind(await sha256Hex(u.token)).first()).toBeNull();
  });

  test("an expired session is refused, and the cron deletes it", async () => {
    const u = await newUser();
    const id = await sha256Hex(u.token);
    await env.DB.prepare("UPDATE sessions SET expires_at = ?1 WHERE id = ?2").bind(new Date(Date.now() - 1000).toISOString(), id).run();
    await ok(api(u.token, "GET", "/api/me"), 401);
    const live = await newUser();
    await runCron();
    expect(await env.DB.prepare("SELECT 1 FROM sessions WHERE id = ?1").bind(id).first()).toBeNull();
    await ok(api(live.token, "GET", "/api/me"));
  });

  test("changing the password ends every other session of the account", async () => {
    const u = await newUser();
    const second = await signIn(u.email, u.password);
    await ok(api(u.token, "POST", "/api/auth/password", { current: u.password, password: "a new long password!" }), 204);
    await ok(api(u.token, "GET", "/api/me"));
    await ok(api(second, "GET", "/api/me"), 401);
    await ok(login(u.email, u.password), 401);
    await ok(login(u.email, "a new long password!"));
  });
});
