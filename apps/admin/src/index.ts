/**
 * OpenClapper admin plane (epic #107, issue #116). Its own hostname behind its own Cloudflare Access
 * application: operators sign in there (with whatever the Access policy asks, 2FA included) and are
 * not app users. It reads across all workspaces and manages accounts; there is no sign-up in the app,
 * so this is where accounts are made. Same D1 as the app, whose migrations it never runs.
 */
import {
  AccessError, assertEnum, assertNumber, assertString, assertUuid, BOOTSTRAP_USER_ID, BUILD, hashPassword, HttpError, json, readJson, Router, targetIterations, verifyAccessJwt,
} from "@openclapper/service-kit";
import { auditEntry, listAudit, type AuditAction } from "./audit.ts";
import { configured, MAX_DAYS, overlay, snapshotCloudflare } from "./cloudflare.ts";
import { marksStatement, parseMarks, readMarks, storageReport } from "./storage.ts";

export interface Env {
  DB: D1Database;
  SHOTS_BUCKET: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  PBKDF2_ITERATIONS?: string;
  /**
   * Local development only (gitignored `.dev.vars`): no Access in front, every request is `admin@localhost`.
   * Honoured only for requests to localhost / 127.0.0.1, so a var set by mistake on a deployment opens nothing.
   */
  ADMIN_DEV_BYPASS?: string;
  /** The Cloudflare overlay (cloudflare.ts): off unless both the account and the read-only token are set. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  /** Which script and bucket are this instance's, to filter and mark them in the overlay. */
  APP_WORKER_NAME?: string;
  R2_BUCKET?: string;
}

interface Ctx {
  env: Env;
  request: Request;
  url: URL;
  /** The operator, from the Access JWT. */
  admin: string;
}

/**
 * Every change an operator makes: a row in admin_audit (audit.ts) for the batch of the change, and a
 * line in the Worker log (observability).
 */
function audit(ctx: Ctx, action: AuditAction, target: { userId?: string | null; email?: string | null }, detail: Record<string, unknown> = {}): D1PreparedStatement {
  console.log(JSON.stringify({ audit: action, by: ctx.admin, user: target.userId ?? undefined, ...detail }));
  return auditEntry(ctx.env.DB, ctx.admin, action, target, detail);
}

const userEmail = (env: Env, id: string) => env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(id).first<{ email: string }>().then((r) => r?.email ?? null);

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
    `SELECT u.id, u.email, u.name, u.status, u.created_at, u.password_hash = '!' AS no_password,
       (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?1) AS sessions,
       (SELECT max(s.last_used_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
       (SELECT count(*) FROM workspace_members m WHERE m.user_id = u.id) AS workspaces
     FROM users u ORDER BY u.created_at`,
  ).bind(new Date().toISOString()).all<{ no_password: number }>();
  return json({ users: results.map((u) => ({ ...u, no_password: u.no_password === 1 })) });
});

/** Loose on purpose: the address is only a sign-in name, nothing is mailed to it. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** A new account with its personal workspace: JSON { email, name? }. The temporary password comes back once. */
router.on("POST", "/api/users", async (ctx) => {
  const { env, request } = ctx;
  const b = await readJson<Record<string, unknown>>(request);
  const email = assertString(b.email, "email", 320);
  if (!EMAIL.test(email)) throw new HttpError(400, "email is not an email address");
  const name = b.name === undefined || b.name === null || b.name === "" ? null : assertString(b.name, "name", 80);
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?1 COLLATE NOCASE").bind(email).first()) throw new HttpError(409, "an account with this email exists");
  const id = crypto.randomUUID();
  const ws = crypto.randomUUID();
  const password = tempPassword();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?1, ?2, ?3, ?4)").bind(id, email, name, await hashPassword(password, targetIterations(env))),
    env.DB.prepare("INSERT INTO workspaces (id, name, owner_user_id, kind) VALUES (?1, 'Personal', ?2, 'personal')").bind(ws, id),
    env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'owner')").bind(ws, id),
    audit(ctx, "user.create", { userId: id, email }, { name }),
  ]);
  return json({ user: { id, email, name }, password }, 201);
});

/** JSON { email?, name?, status? }. Blocking ends every session at once (and the next sign-in is refused). */
router.on("PATCH", "/api/users/:id", async (ctx, { id }) => {
  const { env, request } = ctx;
  const uid = assertUuid(id, "id");
  const b = await readJson<Record<string, unknown>>(request);
  const was = await userEmail(env, uid);
  if (was === null) throw new HttpError(404, "user not found");
  const stmts: D1PreparedStatement[] = [];
  const changes: Record<string, unknown> = {};
  const now = new Date().toISOString();
  if (b.email !== undefined) {
    const email = assertString(b.email, "email", 320);
    if (!EMAIL.test(email)) throw new HttpError(400, "email is not an email address");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?1 COLLATE NOCASE AND id != ?2").bind(email, uid).first()) throw new HttpError(409, "an account with this email exists");
    stmts.push(env.DB.prepare("UPDATE users SET email = ?2, updated_at = ?3 WHERE id = ?1").bind(uid, email, now));
    changes.email = email;
  }
  if (b.name !== undefined) {
    const name = b.name === null || b.name === "" ? null : assertString(b.name, "name", 80);
    stmts.push(env.DB.prepare("UPDATE users SET name = ?2, updated_at = ?3 WHERE id = ?1").bind(uid, name, now));
    changes.name = name;
  }
  if (b.status !== undefined) {
    const status = assertEnum(b.status, "status", ["active", "blocked"] as const);
    stmts.push(env.DB.prepare("UPDATE users SET status = ?2, updated_at = ?3 WHERE id = ?1").bind(uid, status, now));
    if (status === "blocked") stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(uid));
    changes.status = status;
  }
  if (!stmts.length) throw new HttpError(400, "nothing to update");
  await env.DB.batch([...stmts, audit(ctx, "user.update", { userId: uid, email: was }, changes)]);
  return json({ user: await env.DB.prepare("SELECT id, email, name, status FROM users WHERE id = ?1").bind(uid).first() });
});

/** A new temporary password (comes back once); every session of the account ends. */
router.on("POST", "/api/users/:id/password", async (ctx, { id }) => {
  const { env } = ctx;
  const uid = assertUuid(id, "id");
  const email = await userEmail(env, uid);
  if (email === null) throw new HttpError(404, "user not found");
  const password = tempPassword();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(uid, await hashPassword(password, targetIterations(env)), new Date().toISOString()),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(uid),
    audit(ctx, "user.password", { userId: uid, email }),
  ]);
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
  const email = await userEmail(env, uid);
  if (email === null) throw new HttpError(404, "user not found");
  const owned = await env.DB.prepare(
    "SELECT count(*) AS n FROM projects WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_user_id = ?1)",
  ).bind(uid).first<{ n: number }>();
  if (owned && owned.n > 0) throw new HttpError(409, `the account's workspaces still hold ${owned.n} project(s)`);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM viewfinder_layouts WHERE user_id = ?1").bind(uid),
    env.DB.prepare("DELETE FROM devices WHERE user_id = ?1").bind(uid),
    env.DB.prepare("DELETE FROM workspaces WHERE owner_user_id = ?1").bind(uid),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(uid),
    audit(ctx, "user.delete", { userId: uid, email }),
  ]);
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


/** Storage over time with the operator's marks ([monitoring](../../../docs/features/monitoring.md)); `days` 1..365, default 90. */
router.on("GET", "/api/storage", async ({ env, url }) => {
  const raw = url.searchParams.get("days");
  const days = raw === null ? 90 : assertNumber(Number(raw), "days", { min: 1, max: 365 });
  return json(await storageReport(env.DB, days));
});

router.on("GET", "/api/settings", async ({ env }) => json({ storage_marks: await readMarks(env.DB) }));

/** JSON { storage_marks: [{ bytes, label }] }: the whole list, at most MAX_MARKS, validated strictly. */
router.on("PUT", "/api/settings", async (ctx) => {
  const { env, request } = ctx;
  const b = await readJson<Record<string, unknown>>(request);
  if (b.storage_marks === undefined) throw new HttpError(400, "nothing to update");
  const marks = parseMarks(b.storage_marks);
  await env.DB.batch([marksStatement(env.DB, marks, ctx.admin), audit(ctx, "settings.update", {}, { storage_marks: marks })]);
  return json({ storage_marks: marks });
});
/** The audit trail, newest first: `?limit=` (1..200, default 50), `before` + `before_id` from the previous page's `next`. */
router.on("GET", "/api/audit", async ({ env, url }) => json(await listAudit(env.DB, url.searchParams)));

/** The Cloudflare overlay for the last `days` (1..31, default 30); `{ configured: false }` without a token, so the board can say how to enable it. */
router.on("GET", "/api/cloudflare", async ({ env, url }) => {
  if (!configured(env)) return json({ configured: false });
  const raw = url.searchParams.get("days");
  const days = raw === null ? 30 : assertNumber(Number(raw), "days", { min: 1, max: MAX_DAYS });
  return json(await overlay(env, days));
});

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** The operator: verified Access JWT of the admin application (its own AUD), or the local bypass on a local hostname. */
async function operator(request: Request, url: URL, env: Env): Promise<string> {
  if (env.ADMIN_DEV_BYPASS === "true") {
    if (LOCAL_HOSTS.has(url.hostname)) return "admin@localhost";
    console.warn(`admin: ADMIN_DEV_BYPASS ignored for host ${url.hostname}`);
  }
  const who = await verifyAccessJwt(request, env);
  if (who.kind !== "user") throw new AccessError("sign in as a person, not a service token");
  return who.email;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const admin = await operator(request, url, env);
      return await router.handle(request.method, url.pathname, { env, request, url, admin });
    } catch (err) {
      // The reason goes to the log only: it would tell a prober which check to work on.
      if (err instanceof AccessError) {
        console.warn(`admin: refused (${err.message})`);
        return json({ error: "unauthorized" }, 401);
      }
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("unhandled", err);
      return json({ error: "internal error" }, 500);
    }
  },
  /** Daily (wrangler.jsonc triggers): keep yesterday's Cloudflare numbers beyond the API's 31-day window. Runs even while the plane refuses fetches. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!configured(env)) { console.log("cloudflare snapshot: not configured"); return; }
    ctx.waitUntil(snapshotCloudflare(env).then((n) => console.log(`cloudflare snapshot: ${n} value(s)`), (err) => console.error("cloudflare snapshot failed", err)));
  },
} satisfies ExportedHandler<Env>;
