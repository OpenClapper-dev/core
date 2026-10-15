/**
 * Fielder API Worker.
 * Every request runs behind Cloudflare Access at the edge AND verifies the
 * Access JWT here before touching any route.
 */
import { AccessError, verifyAccessJwt, type AccessIdentity } from "./access.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerComposeRoutes } from "./compose.ts";
import { registerDayRoutes } from "./days.ts";
import { registerFieldRoutes } from "./fields.ts";
import { registerFramingRoutes } from "./framings.ts";
import { HttpError, json, Router } from "./http.ts";
import { registerLocationRoutes } from "./locations.ts";
import { registerPresetRoutes } from "./presets.ts";
import { registerProjectRoutes } from "./projects.ts";
import { registerShotRoutes } from "./shots.ts";
import { registerSpotRoutes } from "./spots.ts";
import { registerTimelineRoutes } from "./timelines.ts";
import { registerViewRoutes } from "./views.ts";

export interface Env {
  DB: D1Database;
  SHOTS_BUCKET: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /**
   * Local development only. Set `ACCESS_DEV_BYPASS="true"` in a gitignored
   * `.dev.vars` file so `wrangler dev` works without Access in front of it.
   * Never define this in wrangler.jsonc.
   */
  ACCESS_DEV_BYPASS?: string;
}

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  identity: AccessIdentity;
}

const router = new Router<Ctx>();

router.on("GET", "/health", async ({ env, identity }) => {
  const [d1, r2] = await Promise.allSettled([
    env.DB.prepare("SELECT count(*) AS n FROM shots").first<{ n: number }>(),
    env.SHOTS_BUCKET.list({ limit: 1 }),
  ]);
  const ok = d1.status === "fulfilled" && r2.status === "fulfilled";
  return json(
    {
      ok,
      identity: identity.kind === "user" ? identity.email : `service:${identity.serviceTokenId}`,
      d1: d1.status === "fulfilled" ? { shots: d1.value?.n ?? 0 } : { error: String(d1.reason) },
      r2: r2.status === "fulfilled" ? { reachable: true } : { error: String(r2.reason) },
    },
    ok ? 200 : 503,
  );
});
registerAuthRoutes(router);
registerPresetRoutes(router);
registerProjectRoutes(router);
registerFieldRoutes(router);
registerDayRoutes(router);
registerLocationRoutes(router);
registerSpotRoutes(router);
registerShotRoutes(router);
registerViewRoutes(router);
registerComposeRoutes(router);
registerTimelineRoutes(router);
registerFramingRoutes(router);

async function authenticate(request: Request, env: Env): Promise<AccessIdentity> {
  if (env.ACCESS_DEV_BYPASS === "true") return { email: "dev@localhost", kind: "user" };
  return verifyAccessJwt(request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const identity = await authenticate(request, env);
      return await router.handle(request.method, url.pathname, { request, env, url, identity });
    } catch (err) {
      if (err instanceof AccessError) return json({ error: "unauthorized", reason: err.message }, 401);
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("unhandled", err);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
