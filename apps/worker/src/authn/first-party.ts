import { HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { burnVerification, hashPassword, passwordProblem, targetIterations, verifyPassword } from "@openclapper/service-kit";
import type { AuthProvider, PublicCtx } from "./provider.ts";
import { CLEAR_COOKIE, createSession, deleteSession, requestToken, resolveSession, sessionCookie, sha256Hex, type SessionClient } from "./sessions.ts";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  status: "active" | "blocked";
}

/** One answer for an unknown email and a wrong password, so sign-in does not reveal who has an account. */
const BAD_CREDENTIALS = "wrong email or password";
/**
 * Email + password accounts in D1 (users created by an admin; there is no sign-up yet) and opaque
 * sessions (sessions.ts). The default provider of every build.
 *
 * No brute-force limit (#224): the account lockout was dropped, since anyone could use it to lock an
 * account out and a 429 told a guesser the email exists. Rate limiting (per IP and email, a Cloudflare
 * rule or the Workers rate-limit binding) belongs to the auth revamp due before the app opens up to
 * users. `users.failed_logins` and `locked_until` stay in the schema, unused.
 */
export const provider: AuthProvider = {
  async identify(request, env) {
    const token = requestToken(request);
    return token ? resolveSession(env, token) : null;
  },

  registerPublic(r: Router<PublicCtx>) {
    // `client: "mobile"` gets the token in the body (the phone keeps it in secure storage);
    // the Studio gets it only as an HttpOnly cookie, out of reach of page scripts.
    r.on("POST", "/api/auth/login", async ({ request, env }) => {
      const b = await readJson<Record<string, unknown>>(request);
      const email = typeof b.email === "string" ? b.email.trim() : "";
      const password = typeof b.password === "string" ? b.password : "";
      // `dashboard` = the Studio: the value `sessions.client` has held since migration 0021.
      const client: SessionClient = b.client === "mobile" ? "mobile" : "dashboard";
      if (!email || !password) throw new HttpError(400, "email and password are required");
      if (email.length > 320 || password.length > 200) throw new HttpError(401, BAD_CREDENTIALS);
      const target = targetIterations(env);
      const user = await env.DB.prepare(
        "SELECT id, email, name, password_hash, status FROM users WHERE email = ?1 COLLATE NOCASE",
      ).bind(email).first<UserRow>();
      // An unknown email costs the same PBKDF2 work as a wrong password, so timing does not tell them apart.
      if (!user) {
        await burnVerification(password, target);
        throw new HttpError(401, BAD_CREDENTIALS);
      }
      const { ok, needsRehash } = await verifyPassword(password, user.password_hash, target);
      if (!ok) throw new HttpError(401, BAD_CREDENTIALS);
      // Only after the right password, so a blocked account is not revealed to a guesser.
      if (user.status !== "active") throw new HttpError(403, "this account is blocked");

      if (needsRehash) {
        await env.DB.prepare("UPDATE users SET password_hash = ?2 WHERE id = ?1").bind(user.id, await hashPassword(password, target)).run();
      }
      const session = await createSession(env, user.id, client);
      const body = {
        user: { id: user.id, email: user.email, name: user.name },
        expires_at: session.expiresAt,
        ...(client === "mobile" ? { token: session.token } : {}),
      };
      return json(body, 200, client === "dashboard" ? { "set-cookie": sessionCookie(session.token) } : {});
    });

    // Changing one's own password (issue #148). Under /api/auth/ because only this provider has
    // passwords, so it resolves the session itself. A wrong current password answers 403, not 401,
    // which the clients read as "signed out". Every other session of the account ends. (A stolen
    // session can guess the current password here as at sign-in: rate limiting, #224, is the revamp's.)
    r.on("POST", "/api/auth/password", async ({ request, env }) => {
      const token = requestToken(request);
      const me = token ? await resolveSession(env, token) : null;
      if (!token || !me) throw new HttpError(401, "unauthorized");
      const b = await readJson<Record<string, unknown>>(request);
      const current = typeof b.current === "string" ? b.current : "";
      if (!current) throw new HttpError(400, "current is required");
      const problem = passwordProblem(b.password);
      if (problem) throw new HttpError(400, problem);
      const password = b.password as string;
      if (password === current) throw new HttpError(400, "the new password is the same as the current one");
      const target = targetIterations(env);
      const user = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1")
        .bind(me.userId).first<Pick<UserRow, "password_hash">>();
      if (!user) throw new HttpError(401, "unauthorized");
      if (current.length > 200 || !(await verifyPassword(current, user.password_hash, target)).ok) throw new HttpError(403, "the current password is wrong");
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash = ?2, updated_at = ?3 WHERE id = ?1")
          .bind(me.userId, await hashPassword(password, target), new Date().toISOString()),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND id != ?2").bind(me.userId, await sha256Hex(token)),
      ]);
      return new Response(null, { status: 204 });
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
