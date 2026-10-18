import { HttpError, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";

/**
 * Mobile sign-in. The app opens this URL in an in-app WebView; Cloudflare Access
 * shows its one-time-PIN login first, then lets the request through with the
 * Access JWT attached. This page hands that JWT to the app (postMessage), which
 * stores it and sends it back as the `cf-access-token` header on API calls.
 * Nothing new is exposed: the browser already holds the same token as a cookie.
 * Goes away with Access (#118); the phone then signs in with a password (#115).
 */
export function registerAuthRoutes(r: Router<Ctx>) {
  r.on("GET", "/auth/mobile", async ({ request, env, identity }) => {
    const token = env.ACCESS_DEV_BYPASS === "true" ? devToken(identity.email) : request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) throw new HttpError(403, "sign in through Cloudflare Access");
    const payload = JSON.stringify({ token, email: identity.email }).replace(/</g, "\\u003c");
    const email = identity.email.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fielder</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#f2f2f5;font:16px system-ui,sans-serif;text-align:center;padding:24px}b{color:#ffb300}</style></head>
<body><div>Signed in as <b>${email}</b>.<br>You can go back to the app.</div>
<script>var p=${payload};if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(p));}</script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  });
}

/**
 * Locally there is no Access, so no JWT to hand over; the app still needs a token shaped like one
 * (three parts, an email, an expiry) to count as signed in. Unsigned: the bypass ignores the header.
 */
function devToken(email: string): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ email, exp: Math.floor(Date.now() / 1000) + 365 * 86400 })}.`;
}
