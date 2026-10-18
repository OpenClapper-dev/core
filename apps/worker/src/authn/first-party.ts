import { HttpError, json, readJson, type Router } from "../http.ts";
import { burnVerification, hashPassword, targetIterations, verifyPassword } from "./password.ts";
import type { AuthProvider, PublicCtx } from "./provider.ts";
import { CLEAR_COOKIE, createSession, deleteSession, requestToken, resolveSession, sessionCookie, type SessionClient } from "./sessions.ts";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  status: "active" | "blocked";
  failed_logins: number;
  locked_until: string | null;
}

/** One answer for an unknown email and a wrong password, so sign-in does not reveal who has an account. */
const BAD_CREDENTIALS = "wrong email or password";
/** After this many failures in a row the account locks: 1 minute, doubling, at most an hour. */
const FREE_ATTEMPTS = 5;

function lockUntil(failures: number, now: number): string | null {
  if (failures < FREE_ATTEMPTS) return null;
  return new Date(now + Math.min(60, 2 ** (failures - FREE_ATTEMPTS)) * 60_000).toISOString();
}

/**
 * Email + password accounts in D1 (users created by an admin; there is no sign-up yet) and opaque
 * sessions (sessions.ts). The default provider of every build.
 */
export const provider: AuthProvider = {
  async identify(request, env) {
    const token = requestToken(request);
    return token ? resolveSession(env, token) : null;
  },

  registerPublic(r: Router<PublicCtx>) {
    // `client: "mobile"` gets the token in the body (the phone keeps it in secure storage);
    // the dashboard gets it only as an HttpOnly cookie, out of reach of page scripts.
    r.on("POST", "/api/auth/login", async ({ request, env }) => {
      const b = await readJson<Record<string, unknown>>(request);
      const email = typeof b.email === "string" ? b.email.trim() : "";
      const password = typeof b.password === "string" ? b.password : "";
      const client: SessionClient = b.client === "mobile" ? "mobile" : "dashboard";
      if (!email || !password) throw new HttpError(400, "email and password are required");
      if (email.length > 320 || password.length > 200) throw new HttpError(401, BAD_CREDENTIALS);
      const target = targetIterations(env);
      const user = await env.DB.prepare(
        "SELECT id, email, name, password_hash, status, failed_logins, locked_until FROM users WHERE email = ?1 COLLATE NOCASE",
      ).bind(email).first<UserRow>();
      if (!user) {
        await burnVerification(password, target);
        throw new HttpError(401, BAD_CREDENTIALS);
      }
      const now = Date.now();
      if (user.locked_until && Date.parse(user.locked_until) > now) throw new HttpError(429, "too many failed sign-ins, try again later");

      const { ok, needsRehash } = await verifyPassword(password, user.password_hash, target);
      if (!ok) {
        const failures = user.failed_logins + 1;
        await env.DB.prepare("UPDATE users SET failed_logins = ?2, locked_until = ?3 WHERE id = ?1")
          .bind(user.id, failures, lockUntil(failures, now)).run();
        throw new HttpError(401, BAD_CREDENTIALS);
      }
      // Only after the right password, so a blocked account is not revealed to a guesser.
      if (user.status !== "active") throw new HttpError(403, "this account is blocked");

      const hash = needsRehash ? await hashPassword(password, target) : user.password_hash;
      await env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, password_hash = ?2 WHERE id = ?1")
        .bind(user.id, hash).run();
      const session = await createSession(env, user.id, client);
      const body = {
        user: { id: user.id, email: user.email, name: user.name },
        expires_at: session.expiresAt,
        ...(client === "mobile" ? { token: session.token } : {}),
      };
      return json(body, 200, client === "dashboard" ? { "set-cookie": sessionCookie(session.token) } : {});
    });

    // Works without a valid session (an expired one still clears the cookie).
    r.on("POST", "/api/auth/logout", async ({ request, env }) => {
      const token = requestToken(request);
      if (token) await deleteSession(env, token);
      return new Response(null, { status: 204, headers: { "set-cookie": CLEAR_COOKIE } });
    });
  },

  async allow() {
    return true;
  },
};
