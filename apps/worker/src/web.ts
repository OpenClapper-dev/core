/**
 * Opening the Studio in the phone's web view, signed in (docs/features/canvas.md, "The tablet"): the
 * phone asks for a page of the Studio with its bearer token in the header, and gets the same session
 * as a cookie and a redirect to that page. The token never travels in an address. Only a path of this
 * origin is a target.
 */
import { HttpError, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { sessionCookie } from "./authn/sessions.ts";

export function registerWebRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/web", async ({ request, url }) => {
    const auth = request.headers.get("Authorization");
    // Only a bearer session is handed over: a cookie would already be there.
    if (!auth?.startsWith("Bearer ")) throw new HttpError(400, "send the session as a bearer token");
    const to = url.searchParams.get("to") ?? "/";
    if (!to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\") || to.length > 500) throw new HttpError(400, "to must be a path of this site");
    return new Response(null, { status: 302, headers: { location: to, "set-cookie": sessionCookie(auth.slice(7).trim()), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });
}
