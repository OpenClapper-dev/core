/**
 * OpenClapper API Worker.
 * Every request except signing in needs a user: a session from the auth provider
 * (`@openclapper/auth-provider`, first-party.ts by default). The routes are in routes.ts.
 */
import { provider } from "@openclapper/auth-provider";
import { HttpError, json } from "@openclapper/service-kit";
import type { Identity } from "./authn/provider.ts";
import { purgeExpiredSessions } from "./authn/sessions.ts";
import { isPublic, publicRouter, router } from "./routes.ts";
import { loadTenant, type Tenant } from "./tenancy.ts";
import { purgeExpired } from "./trash.ts";

export interface Env {
  DB: D1Database;
  SHOTS_BUCKET: R2Bucket;
  /** Live layout preview rooms, one per user (preview.ts, issue #50). */
  PREVIEW: DurableObjectNamespace<import("./preview.ts").PreviewRoom>;
  /** PBKDF2 iterations for new password hashes (password.ts); default and maximum 100 000. */
  PBKDF2_ITERATIONS?: string;
}

export { PreviewRoom } from "./preview.ts";

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  identity: Identity;
  tenant: Tenant;
}

/** A session, everywhere: local development signs in too (dev@localhost, `make init`), so it behaves like production. */
const identify = (request: Request, env: Env): Promise<Identity | null> => provider.identify(request, env);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (isPublic(url.pathname)) return await publicRouter.handle(request.method, url.pathname, { request, env, url });
      const identity = await identify(request, env);
      if (!identity) return json({ error: "unauthorized" }, 401);
      if (request.method !== "GET" && request.method !== "HEAD") {
        const capability = request.method === "POST" && url.pathname === "/api/shots" ? "upload" : "write";
        if (!(await provider.allow(identity, capability, env))) throw new HttpError(403, "not allowed for this account");
      }
      const tenant = await loadTenant(env, identity.userId);
      return await router.handle(request.method, url.pathname, { request, env, url, identity, tenant });
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("unhandled", err);
      return json({ error: "internal error" }, 500);
    }
  },
  /** Daily (wrangler.jsonc triggers): empty what has been in the recycle bin for 30 days, drop expired sessions. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purgeExpired(env).then((n) => console.log(`recycle bin: purged ${n} item(s)`)));
    ctx.waitUntil(purgeExpiredSessions(env).then((n) => console.log(`sessions: purged ${n} expired`)));
  },
} satisfies ExportedHandler<Env>;
