/**
 * OpenClapper API Worker.
 * Every request except signing in needs a user: a session from the auth provider
 * (`@openclapper/auth-provider`, first-party.ts by default).
 */
import { provider } from "@openclapper/auth-provider";
import { BUILD, HttpError, json, Router } from "@openclapper/service-kit";
import type { Identity, PublicCtx } from "./authn/provider.ts";
import { purgeExpiredSessions } from "./authn/sessions.ts";
import { registerComposeRoutes } from "./compose.ts";
import { registerDayRoutes } from "./days.ts";
import { registerDeviceRoutes } from "./devices.ts";
import { registerFieldRoutes } from "./fields.ts";
import { registerFileRoutes } from "./files.ts";
import { registerFramingRoutes } from "./framings.ts";
import { registerLayoutRoutes } from "./layouts.ts";
import { registerLocationRoutes } from "./locations.ts";
import { registerPresetRoutes } from "./presets.ts";
import { registerPreviewRoutes } from "./preview.ts";
import { registerProjectRoutes } from "./projects.ts";
import { registerShotRoutes } from "./shots.ts";
import { registerSpotRoutes } from "./spots.ts";
import { loadTenant, type Tenant } from "./tenancy.ts";
import { registerTimelineRoutes } from "./timelines.ts";
import { purgeExpired, registerTrashRoutes } from "./trash.ts";
import { registerViewRoutes } from "./views.ts";
import { registerWorkspaceRoutes } from "./workspaces.ts";

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

/** Routes that run without a user: the provider's /api/auth/* and a liveness probe that also says which version runs. */
const publicRouter = new Router<PublicCtx>();
publicRouter.on("GET", "/api/ping", async () => json({ ok: true, ...BUILD }));
provider.registerPublic(publicRouter);
const isPublic = (path: string) => path === "/api/ping" || path.startsWith("/api/auth/");

const router = new Router<Ctx>();

router.on("GET", "/health", async ({ env, identity }) => {
  const [d1, r2] = await Promise.allSettled([
    env.DB.prepare("SELECT 1").first(),
    env.SHOTS_BUCKET.list({ limit: 1 }),
  ]);
  const ok = d1.status === "fulfilled" && r2.status === "fulfilled";
  return json(
    {
      ok,
      identity: identity.email,
      d1: d1.status === "fulfilled" ? { reachable: true } : { error: String(d1.reason) },
      r2: r2.status === "fulfilled" ? { reachable: true } : { error: String(r2.reason) },
    },
    ok ? 200 : 503,
  );
});

/** The signed-in user and their workspaces; the clients' "am I signed in" probe. */
router.on("GET", "/api/me", async ({ env, identity }) => {
  const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?1").bind(identity.userId).first();
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, m.role, (w.kind = 'personal' AND w.owner_user_id = ?1) AS personal FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = ?1 ORDER BY personal DESC, w.created_at`,
  ).bind(identity.userId).all<{ id: string; name: string; role: string; personal: number }>();
  return json({ user, workspaces: results.map((w) => ({ ...w, personal: w.personal === 1 })) });
});
registerPresetRoutes(router);
registerProjectRoutes(router);
registerFieldRoutes(router);
registerDayRoutes(router);
registerLocationRoutes(router);
registerSpotRoutes(router);
registerShotRoutes(router);
registerViewRoutes(router);
registerFileRoutes(router);
registerTrashRoutes(router);
registerComposeRoutes(router);
registerTimelineRoutes(router);
registerFramingRoutes(router);
registerLayoutRoutes(router);
registerDeviceRoutes(router);
registerPreviewRoutes(router);
registerWorkspaceRoutes(router);

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
