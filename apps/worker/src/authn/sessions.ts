/**
 * Sessions (epic #107): an opaque random token, stored only as its SHA-256. One mechanism, two
 * transports: the phone (and its websocket) sends `Authorization: Bearer <token>`, the Studio
 * an HttpOnly cookie. Revoking or blocking takes effect on the next request, which a signed JWT
 * could not do.
 */

/** `dashboard` = the Studio: the value `sessions.client` has held since migration 0021 (kept, not migrated). */
export type SessionClient = "dashboard" | "mobile";

export const COOKIE = "openclapper_session";
const DAY_MS = 86_400_000;
/** Sliding: a session in use is extended, at most once a day. */
const LIFETIME_MS: Record<SessionClient, number> = { dashboard: 30 * DAY_MS, mobile: 180 * DAY_MS };
const RENEW_AFTER_MS = DAY_MS;

export interface SessionUser {
  userId: string;
  email: string;
}

interface Db {
  DB: D1Database;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256Hex(s: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The request's token: the bearer header wins over the cookie. */
export function requestToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=") || null;
  }
  return null;
}

/**
 * The cookie outlives the session on purpose (400 days, the browser maximum): the server decides
 * expiry, so sliding renewal never needs to re-send it.
 */
export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${400 * 86_400}`;
}
export const CLEAR_COOKIE = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function createSession(env: Db, userId: string, client: SessionClient): Promise<{ token: string; expiresAt: string }> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const expiresAt = new Date(now + LIFETIME_MS[client]).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, client, expires_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(await sha256Hex(token), userId, client, expiresAt, new Date(now).toISOString())
    .run();
  return { token, expiresAt };
}

/** The live session's user, or null (unknown, expired, or the user is blocked). */
export async function resolveSession(env: Db, token: string): Promise<SessionUser | null> {
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.client, s.expires_at, s.last_used_at, u.id AS user_id, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?1 AND u.status = 'active'`,
  ).bind(id).first<{ client: SessionClient; expires_at: string; last_used_at: string | null; user_id: string; email: string }>();
  const now = Date.now();
  if (!row || Date.parse(row.expires_at) <= now) return null;
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > RENEW_AFTER_MS) {
    await env.DB.prepare("UPDATE sessions SET last_used_at = ?2, expires_at = ?3 WHERE id = ?1")
      .bind(id, new Date(now).toISOString(), new Date(now + LIFETIME_MS[row.client]).toISOString())
      .run();
  }
  return { userId: row.user_id, email: row.email };
}

export async function deleteSession(env: Db, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(await sha256Hex(token)).run();
}

/** Daily cron: expired sessions are only clutter (they are already refused). */
export async function purgeExpiredSessions(env: Db): Promise<number> {
  const res = await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(new Date().toISOString()).run();
  return res.meta.changes ?? 0;
}
