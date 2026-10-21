/**
 * The admin plane: nothing without a verified Access JWT of its own application (or the local
 * bypass), and the account actions. The Worker's fetch is called directly so each test can set
 * the Access variables; the Access JWKS endpoint is answered by a stubbed fetch.
 */
import { env } from "cloudflare:workers";
import { BOOTSTRAP_USER_ID, verifyPassword } from "@openclapper/service-kit";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import worker, { type Env } from "../src/index.ts";

const TEAM = "team.example.test", AUD = "admin-aud";
const configured: Env = { ...env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_DEV_BYPASS: undefined };
const bypass: Env = { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_DEV_BYPASS: "true" };

/** A request to the admin Worker; on localhost unless `host` says otherwise (the bypass works only there). */
function call(e: Env, method: string, path: string, opts: { jwt?: string; body?: unknown; host?: string } = {}): Promise<Response> {
  const headers = new Headers();
  if (opts.jwt) headers.set("Cf-Access-Jwt-Assertion", opts.jwt);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return worker.fetch(new Request(`http://${opts.host ?? "localhost:8788"}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), e);
}
async function json<T = Record<string, unknown>>(res: Promise<Response>, status: number): Promise<T> {
  const r = await res;
  const text = await r.text();
  expect(r.status, text).toBe(status);
  return JSON.parse(text) as T;
}

// ---------- A signing key standing in for Access's ----------
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
let accessKey: CryptoKeyPair, strangerKey: CryptoKeyPair;

async function jwt(claims: Record<string, unknown>, key = accessKey, kid = "k1"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: "RS256", kid });
  const body = enc({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 300, iat: now, ...claims });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

beforeAll(async () => {
  accessKey = (await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair;
  strangerKey = (await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", accessKey.publicKey) as JsonWebKey), kid: "k1" };
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    return real(input, init);
  });
});
afterAll(() => { vi.restoreAllMocks(); });

describe("who gets in", () => {
  test("without Access configured and without the bypass, every request is refused", async () => {
    const bare: Env = { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_DEV_BYPASS: undefined };
    await json(call(bare, "GET", "/api/whoami"), 401);
    await json(call(bare, "GET", "/api/users", { jwt: await jwt({ email: "op@example.test", aud: [""], iss: "https://" }) }), 401);
  });

  test("the local bypass only with ADMIN_DEV_BYPASS=true", async () => {
    expect(await json(call(bypass, "GET", "/api/whoami"), 200)).toMatchObject({ email: "admin@localhost" });
    await json(call({ ...bypass, ADMIN_DEV_BYPASS: "1" }, "GET", "/api/whoami"), 401);
  });

  test("the bypass only on localhost and 127.0.0.1: set on a deployment it opens nothing", async () => {
    await json(call(bypass, "GET", "/api/whoami", { host: "127.0.0.1:8788" }), 200);
    await json(call(bypass, "GET", "/api/users", { host: "admin.example.test" }), 401);
    await json(call(bypass, "GET", "/api/users", { host: "localhost.example.test" }), 401);
    await json(call(bypass, "POST", "/api/users", { host: "admin.example.test", body: { email: "sneak@test.invalid" } }), 401);
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE email = 'sneak@test.invalid'").first()).toBeNull();
    // With Access configured too, the JWT decides on a real hostname.
    const both: Env = { ...configured, ADMIN_DEV_BYPASS: "true" };
    await json(call(both, "GET", "/api/whoami", { host: "admin.example.test" }), 401);
    expect(await json(call(both, "GET", "/api/whoami", { host: "admin.example.test", jwt: await jwt({ email: "op@example.test" }) }), 200)).toMatchObject({ email: "op@example.test" });
  });

  test("a refusal says only unauthorized; the reason is logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = await json(call(configured, "GET", "/api/users", { jwt: await jwt({ email: "op@example.test", aud: ["app-aud"] }) }), 401);
    expect(body).toEqual({ error: "unauthorized" });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/audience mismatch/);
    warn.mockRestore();
  });

  test("an unknown signing key refetches the JWKS at most once a minute", async () => {
    await json(call(configured, "GET", "/api/whoami", { jwt: await jwt({ email: "op@example.test" }) }), 200);
    const certs = () => vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).endsWith("/cdn-cgi/access/certs")).length;
    const before = certs();
    for (let i = 0; i < 3; i++) await json(call(configured, "GET", "/api/whoami", { jwt: await jwt({ email: "op@example.test" }, accessKey, `rotated-${i}`) }), 401);
    expect(certs() - before).toBe(1);
  });

  test("a valid Access JWT of this application lets its person in", async () => {
    expect(await json(call(configured, "GET", "/api/whoami", { jwt: await jwt({ email: "op@example.test" }) }), 200)).toMatchObject({ email: "op@example.test" });
  });

  test.each([
    ["no JWT", async () => undefined],
    ["another application's audience", () => jwt({ email: "op@example.test", aud: ["app-aud"] })],
    ["another issuer", () => jwt({ email: "op@example.test", iss: "https://evil.example.test" })],
    ["an expired token", () => jwt({ email: "op@example.test", exp: Math.floor(Date.now() / 1000) - 10 })],
    ["a signature by another key", () => jwt({ email: "op@example.test" }, strangerKey)],
    ["a service token instead of a person", () => jwt({ common_name: "ci.access" })],
    ["garbage", async () => "a.b.c"],
  ])("%s is refused", async (_what, token) => {
    await json(call(configured, "GET", "/api/users", { jwt: await token() }), 401);
  });
});

describe("accounts", () => {
  const sessionsOf = (id: string) => env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ?1").bind(id).first<{ n: number }>().then((r) => r!.n);
  const addSession = (id: string) => env.DB.prepare("INSERT INTO sessions (id, user_id, client, expires_at) VALUES (?1, ?2, 'mobile', ?3)")
    .bind(crypto.randomUUID(), id, new Date(Date.now() + 86_400_000).toISOString()).run();

  test("create: a personal workspace and a temporary password that verifies; the email is unique", async () => {
    const res = await json<{ user: { id: string }; password: string }>(call(bypass, "POST", "/api/users", { body: { email: "new@test.invalid", name: "New" } }), 201);
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(res.user.id).first<{ password_hash: string }>();
    expect((await verifyPassword(res.password, row!.password_hash, 10_000)).ok).toBe(true);
    const ws = await env.DB.prepare("SELECT w.kind, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE w.owner_user_id = ?1").bind(res.user.id).all();
    expect(ws.results).toEqual([{ kind: "personal", role: "owner" }]);
    await json(call(bypass, "POST", "/api/users", { body: { email: "NEW@test.invalid" } }), 409);
    await json(call(bypass, "POST", "/api/users", { body: { email: "not an email" } }), 400);
  });

  test("block ends every session; unblock lets the account in again", async () => {
    const { user } = await json<{ user: { id: string } }>(call(bypass, "POST", "/api/users", { body: { email: "block@test.invalid" } }), 201);
    await addSession(user.id);
    await json(call(bypass, "PATCH", `/api/users/${user.id}`, { body: { status: "blocked" } }), 200);
    expect(await sessionsOf(user.id)).toBe(0);
    await json(call(bypass, "PATCH", `/api/users/${user.id}`, { body: { status: "active" } }), 200);
    expect(await env.DB.prepare("SELECT status FROM users WHERE id = ?1").bind(user.id).first()).toEqual({ status: "active" });
  });

  test("reset: a new temporary password, the old one and every session gone", async () => {
    const created = await json<{ user: { id: string }; password: string }>(call(bypass, "POST", "/api/users", { body: { email: "reset@test.invalid" } }), 201);
    await addSession(created.user.id);
    const { password } = await json<{ password: string }>(call(bypass, "POST", `/api/users/${created.user.id}/password`), 200);
    const hash = (await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(created.user.id).first<{ password_hash: string }>())!.password_hash;
    expect((await verifyPassword(password, hash, 10_000)).ok).toBe(true);
    expect((await verifyPassword(created.password, hash, 10_000)).ok).toBe(false);
    expect(await sessionsOf(created.user.id)).toBe(0);
  });

  test("delete: refused while the account's workspaces hold projects and for the bootstrap user", async () => {
    const { user } = await json<{ user: { id: string } }>(call(bypass, "POST", "/api/users", { body: { email: "delete@test.invalid" } }), 201);
    const ws = (await env.DB.prepare("SELECT id FROM workspaces WHERE owner_user_id = ?1").bind(user.id).first<{ id: string }>())!.id;
    const project = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO projects (id, name, workspace_id) VALUES (?1, 'Kept', ?2)").bind(project, ws).run();
    await json(call(bypass, "DELETE", `/api/users/${user.id}`), 409);
    await env.DB.prepare("DELETE FROM projects WHERE id = ?1").bind(project).run();
    await json(call(bypass, "DELETE", `/api/users/${user.id}`), 200);
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(user.id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM workspaces WHERE id = ?1").bind(ws).first()).toBeNull();
    await json(call(bypass, "DELETE", `/api/users/${user.id}`), 404);
    await json(call(bypass, "DELETE", `/api/users/${BOOTSTRAP_USER_ID}`), 400);
  });
});

describe("audit trail", () => {
  interface Entry { id: string; at: string; operator_email: string; action: string; target_user_id: string | null; target_email: string | null; detail: Record<string, unknown> }
  const rowsFor = (id: string) => env.DB.prepare("SELECT action, operator_email, target_email, detail FROM admin_audit WHERE target_user_id = ?1 ORDER BY at, rowid").bind(id)
    .all<{ action: string; operator_email: string; target_email: string; detail: string }>().then((r) => r.results.map((x) => ({ ...x, detail: JSON.parse(x.detail) })));
  const count = () => env.DB.prepare("SELECT count(*) AS n FROM admin_audit").first<{ n: number }>().then((r) => r!.n);

  test("every account action writes a row with the operator, the account and what changed; never a password", async () => {
    const op = await jwt({ email: "op@example.test" });
    const created = await json<{ user: { id: string }; password: string }>(call(configured, "POST", "/api/users", { jwt: op, body: { email: "audited@test.invalid", name: "Aud" } }), 201);
    const id = created.user.id;
    await json(call(configured, "PATCH", `/api/users/${id}`, { jwt: op, body: { email: "renamed@test.invalid", status: "blocked" } }), 200);
    const { password } = await json<{ password: string }>(call(configured, "POST", `/api/users/${id}/password`, { jwt: op }), 200);
    await json(call(configured, "DELETE", `/api/users/${id}`, { jwt: op }), 200);
    const rows = await rowsFor(id);
    expect(rows).toEqual([
      { action: "user.create", operator_email: "op@example.test", target_email: "audited@test.invalid", detail: { name: "Aud" } },
      { action: "user.update", operator_email: "op@example.test", target_email: "audited@test.invalid", detail: { email: "renamed@test.invalid", status: "blocked" } },
      { action: "user.password", operator_email: "op@example.test", target_email: "renamed@test.invalid", detail: {} },
      { action: "user.delete", operator_email: "op@example.test", target_email: "renamed@test.invalid", detail: {} },
    ]);
    const all = JSON.stringify(rows);
    expect(all).not.toContain(created.password);
    expect(all).not.toContain(password);
  });

  test("a refused action writes nothing", async () => {
    const before = await count();
    await json(call(bypass, "POST", "/api/users", { body: { email: "not an email" } }), 400);
    await json(call(bypass, "DELETE", `/api/users/${BOOTSTRAP_USER_ID}`), 400);
    await json(call(bypass, "PATCH", `/api/users/${crypto.randomUUID()}`, { body: { name: "x" } }), 404);
    expect(await count()).toBe(before);
  });

  test("changing the storage marks is audited", async () => {
    await json(call(bypass, "PUT", "/api/settings", { body: { storage_marks: [{ bytes: 1e9, label: "1 GB" }] } }), 200);
    const row = await env.DB.prepare("SELECT operator_email, target_user_id, detail FROM admin_audit WHERE action = 'settings.update' ORDER BY at DESC LIMIT 1").first<{ operator_email: string; target_user_id: string | null; detail: string }>();
    expect(row).toMatchObject({ operator_email: "admin@localhost", target_user_id: null });
    expect(JSON.parse(row!.detail)).toEqual({ storage_marks: [{ bytes: 1e9, label: "1 GB" }] });
  });

  test("GET /api/audit: newest first, page by page, nothing twice", async () => {
    for (let i = 0; i < 5; i++) await json(call(bypass, "POST", "/api/users", { body: { email: `page${i}@test.invalid` } }), 201);
    const total = await count();
    const seen: Entry[] = [];
    let query = "?limit=2";
    for (;;) {
      const page = await json<{ entries: Entry[]; next: { before: string; before_id: string } | null }>(call(bypass, "GET", `/api/audit${query}`), 200);
      expect(page.entries.length).toBeLessThanOrEqual(2);
      seen.push(...page.entries);
      if (!page.next) break;
      query = `?limit=2&before=${encodeURIComponent(page.next.before)}&before_id=${page.next.before_id}`;
    }
    expect(seen.length).toBe(total);
    expect(new Set(seen.map((e) => e.id)).size).toBe(total);
    const order = seen.map((e) => e.at);
    expect(order).toEqual([...order].sort().reverse());
    expect(seen[0]).toMatchObject({ action: "user.create", target_email: "page4@test.invalid", operator_email: "admin@localhost" });
    await json(call(bypass, "GET", "/api/audit?limit=0"), 400);
    await json(call(bypass, "GET", "/api/audit?before=2026-01-01T00:00:00Z"), 400);
  });

  test("needs an operator like every route", async () => {
    await json(call(configured, "GET", "/api/audit"), 401);
  });
});
