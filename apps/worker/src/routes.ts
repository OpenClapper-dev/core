/**
 * The Worker's routes, in their own module so the route tests (test/tenancy.test.ts) can enumerate
 * what is registered: a route added here without a tenancy fixture turns that test red.
 */
import { provider } from "@openclapper/auth-provider";
import { BUILD, json, Router } from "@openclapper/service-kit";
import type { PublicCtx } from "./authn/provider.ts";
import { registerFileRoutes } from "./files.ts";
import type { Ctx } from "./index.ts";
import { registerPhotoRoutes } from "./photos.ts";
import { registerPreviewRoutes } from "./preview.ts";
import { registerProjectRoutes } from "./projects.ts";
import { registerWorkspaceRoutes } from "./workspaces.ts";

/** Routes that run without a user: the provider's /api/auth/* and a liveness probe that also says which version and instance run. */
export const publicRouter = new Router<PublicCtx>();
publicRouter.on("GET", "/api/ping", async ({ env }) => json({ ok: true, ...BUILD, instance: env.INSTANCE_LABEL ?? "" }));
provider.registerPublic(publicRouter);
export const isPublic = (path: string) => path === "/api/ping" || path.startsWith("/api/auth/");

export const router = new Router<Ctx>();

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
registerProjectRoutes(router);
registerFileRoutes(router);
registerPhotoRoutes(router);
registerPreviewRoutes(router);
registerWorkspaceRoutes(router);
