/**
 * Fielder admin plane (epic #107, issue #116). Its own hostname behind its own Cloudflare Access
 * application: operators sign in there (with whatever the Access policy asks, 2FA included) and are
 * not app users. It reads across all workspaces and manages accounts; there is no sign-up in the app,
 * so this is where accounts are made. Same D1 as the app, whose migrations it never runs.
 */
import {
  AccessError, assertEnum, assertString, assertUuid, BOOTSTRAP_USER_ID, BUILD, hashPassword, HttpError, json, readJson, Router, targetIterations, verifyAccessJwt,
} from "@fielder/service-kit";

export interface Env {
  DB: D1Database;
  SHOTS_BUCKET: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  PBKDF2_ITERATIONS?: string;
  /** Local development only (gitignored `.dev.vars`): no Access in front, every request is `admin@localhost`. */
  ADMIN_DEV_BYPASS?: string;
}

interface Ctx {
  env: Env;
  request: Request;
  url: URL;
  /** The operator, from the Access JWT. */
  admin: string;
}

/** Every change an operator makes goes to the Worker log (observability), with who made it. */
const audit = (ctx: Ctx, action: string, target: Record<string, unknown>) => console.log(JSON.stringify({ audit: action, by: ctx.admin, ...target }));

/** Readable once, typed once: 4 groups of 4 from letters and digits that are hard to confuse. */
function tempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

const router = new Router<Ctx>();

router.on("GET", "/api/whoami", async ({ admin }) => json({ email: admin, ...BUILD }));

router.on("GET", "/api/overview", async ({ env }) => {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const row = await env.DB.prepare(
    `SELECT (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM users WHERE status = 'blocked') AS blocked,
       (SELECT count(DISTINCT user_id) FROM sessions WHERE last_used_at > ?1) AS active_30d,
       (SELECT count(*) FROM workspaces) AS workspaces,
       (SELECT count(*) FROM projects) AS projects,
       (SELECT count(*) FROM shots WHERE deleted_at IS NULL) AS shots,
       (SELECT count(*) FROM photos) AS photos,
       (SELECT coalesce(sum(size_bytes), 0) FROM photos) AS bytes,
       (SELECT count(*) FROM photos WHERE size_bytes IS NULL) AS unsized`,
  ).bind(since).first();
  return json({ overview: row });
});

router.on("GET", "/api/users", async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.status, u.created_at, u.locked_until, u.password_hash = '!' AS no_password,
       (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?1) AS sessions,
       (SELECT max(s.last_used_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
       (SELECT count(*) FROM workspace_members m WHERE m.user_id = u.id) AS workspaces
     FROM users u ORDER BY u.created_at`,
  ).bind(new Date().toISOString()).all<{ no_password: number }>();
  return json({ users: results.map((u) => ({ ...u, no_password: u.no_password === 1 })) });
});

/** A new account with its personal workspace: JSON { email, name? }. The temporary password comes back once. */
router.on("POST", "/api/users", async (ctx) => {
  const { env, request } = ctx;
  const b = await readJson<Record<string, unknown>>(request);
  const email = assertString(b.email, "email", 320);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new HttpError(400, "email is not an email address");
  const name = b.name === undefined || b.name === null || b.name === "" ? null : assertString(b.name, "name", 80);
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?1 COLLATE NOCASE").bind(email).first()) throw new HttpError(409, "an account with this email exists");
  const id = crypto.randomUUID();
  const ws = crypto.randomUUID();
  const password = tempPassword();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?1, ?2, ?3, ?4)").bind(id, email, name, await hashPassword(password, targetIterations(env))),
    env.DB.prepare("INSERT INTO workspaces (id, name, owner_user_id, kind) VALUES (?1, 'Personal', ?2, 'personal')").bind(ws, id),
    env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'owner')").bind(ws, id),
  ]);
  audit(ctx, "user.create", { user: id, email });
  return json({ user: { id, email, name }, password }, 201);
});

/**
 * JSON { email?, name?, status? }. Blocking ends every session at once (and the next sign-in is
 * refused); unblocking also clears a sign-in lock.
 */
router.on("PATCH", "/api/users/:id", async (ctx, { id }) => {
  const { env, request } = ctx;
  const uid = assertUuid(id, "id");
  const b = await readJson<Record<string, unknown>>(request);
  if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(uid).first())) throw new HttpError(404, "user not found");
  const stmts: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  if (b.email !== undefined) {
    const email = assertString(b.email, "email", 320);
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?1 COLLATE NOCASE AND id != ?2").bind(email, uid).first()) throw new HttpError(409, "an account with this email exists");
    stmts.push(env.DB.prepare("UPDATE users SET email = ?2, updated_at = ?3 WHERE id = ?1").bind(uid, email, now));
  }
  if (b.name !== undefined) stmts.push(env.DB.prepare("UPDATE users SET name = ?2, updated_at = ?3 WHERE id = ?1").bind(uid, b.name === null || b.name === "" ? null : assertString(b.name, "name", 80), now));
  if (b.status !== undefined) {
    const status = assertEnum(b.status, "status", ["active", "blocked"] as const);
    stmts.push(status === "blocked"
      ? env.DB.prepare("UPDATE users SET status = 'blocked', updated_at = ?2 WHERE id = ?1").bind(uid, now)
      : env.DB.prepare("UPDATE users SET status = 'active', failed_logins = 0, locked_until = NULL, updated_at = ?2 WHERE id = ?1").bind(uid, now));
    if (status === "blocked") stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(uid));
  }
  if (!stmts.length) throw new HttpError(400, "nothing to update");
  await env.DB.batch(stmts);
  audit(ctx, "user.update", { user: uid, ...b });
  return json({ user: await env.DB.prepare("SELECT id, email, name, status FROM users WHERE id = ?1").bind(uid).first() });
});

/** A new temporary password (comes back once); every session of the account ends. */
router.on("POST", "/api/users/:id/password", async (ctx, { id }) => {
  const { env } = ctx;
  const uid = assertUuid(id, "id");
  if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(uid).first())) throw new HttpError(404, "user not found");
  const password = tempPassword();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?2, failed_logins = 0, locked_until = NULL, updated_at = ?3 WHERE id = ?1")
      .bind(uid, await hashPassword(password, targetIterations(env)), new Date().toISOString()),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(uid),
  ]);
  audit(ctx, "user.password", { user: uid });
  return json({ password });
});

/**
 * Delete an account. Refused while a workspace it owns has projects (their data would go with it;
 * move or delete those first) and for the bootstrap user. Its devices, layouts and empty workspaces go.
 */
router.on("DELETE", "/api/users/:id", async (ctx, { id }) => {
  const { env } = ctx;
  const uid = assertUuid(id, "id");
  if (uid === BOOTSTRAP_USER_ID) throw new HttpError(400, "the bootstrap user owns the data from before accounts and stays");
  if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(uid).first())) throw new HttpError(404, "user not found");
  const owned = await env.DB.prepare(
    "SELECT count(*) AS n FROM projects WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_user_id = ?1)",
  ).bind(uid).first<{ n: number }>();
  if (owned && owned.n > 0) throw new HttpError(409, `the account's workspaces still hold ${owned.n} project(s)`);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM viewfinder_layouts WHERE user_id = ?1").bind(uid),
    env.DB.prepare("DELETE FROM devices WHERE user_id = ?1").bind(uid),
    env.DB.prepare("DELETE FROM workspaces WHERE owner_user_id = ?1").bind(uid),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(uid),
  ]);
  audit(ctx, "user.delete", { user: uid });
  return json({ deleted: uid });
});

/** Every workspace with its owner, size and storage (`unsized`: photos from before size_bytes was recorded). */
router.on("GET", "/api/workspaces", async ({ env }) => {
  const { results } = await env.DB.prepare(
    `WITH ph AS (SELECT p.workspace_id AS ws, count(*) AS photos, coalesce(sum(x.size_bytes), 0) AS bytes, sum(x.size_bytes IS NULL) AS unsized
                 FROM photos x JOIN shots s ON s.id = x.shot_id JOIN projects p ON p.id = s.project_id GROUP BY p.workspace_id)
     SELECT w.id, w.name, w.kind, w.created_at, o.email AS owner_email,
       (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS members,
       (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id) AS projects,
       (SELECT count(*) FROM shots s JOIN projects p ON p.id = s.project_id WHERE p.workspace_id = w.id AND s.deleted_at IS NULL) AS shots,
       coalesce(ph.photos, 0) AS photos, coalesce(ph.bytes, 0) AS bytes, coalesce(ph.unsized, 0) AS unsized
     FROM workspaces w LEFT JOIN users o ON o.id = w.owner_user_id LEFT JOIN ph ON ph.ws = w.id ORDER BY w.created_at`,
  ).all();
  return json({ workspaces: results });
});

/** The operator: verified Access JWT of the admin application (its own AUD), or the local bypass. */
async function operator(request: Request, env: Env): Promise<string> {
  if (env.ADMIN_DEV_BYPASS === "true") return "admin@localhost";
  const who = await verifyAccessJwt(request, env);
  if (who.kind !== "user") throw new AccessError("sign in as a person, not a service token");
  return who.email;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const admin = await operator(request, env);
      return await router.handle(request.method, url.pathname, { env, request, url, admin });
    } catch (err) {
      if (err instanceof AccessError) return json({ error: "unauthorized", reason: err.message }, 401);
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("unhandled", err);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
